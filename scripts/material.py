#!/usr/bin/env python3
"""Look things up in the ignored materials/ shelf (PDF and epub).

  python3 -I scripts/material.py list
  python3 -I scripts/material.py toc  <file.pdf|file.epub>
  python3 -I scripts/material.py nav  <file.epub>                    # navigation paths for src:<id>#ch=<path>
  python3 -I scripts/material.py text <file.pdf> <first> <last>      # PDF page numbers, 1-based
  python3 -I scripts/material.py text <file.epub> <heading>          # chapters whose heading contains it
  python3 -I scripts/material.py find <file.pdf|file.epub> <query>   # pages / chapters that mention it
  python3 -I scripts/material.py page <file.pdf> <page> [dpi]        # render one page to PNG, prints the path
  python3 -I scripts/material.py check <issue.md|->                  # every materials/ path in the text exists on the shelf
  python3 -I scripts/material.py cite < request.json                 # content build: render cited pages, extract archived pages and epub chapters

PDF page numbers are the viewer's page index, not the printed folio; cite both.
epub text is extracted chapter by chapter from the XHTML documents in the OPF spine
order (headings become `#` lines; images, audio and fonts are never read) and cached
in ~/.cache/molnotes-materials by content digest, so a renamed file keeps
its cache. Chapters are addressed by heading.

MOLNOTES_MATERIALS_DIR and MOLNOTES_MATERIALS_CACHE replace the shelf and the cache directory.
"""

import hashlib
import io
import json
import os
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from html import escape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit

ROOT = Path(os.environ.get("MOLNOTES_MATERIALS_DIR") or Path(__file__).resolve().parent.parent / "materials")
CACHE = Path(os.environ.get("MOLNOTES_MATERIALS_CACHE") or Path.home() / ".cache" / "molnotes-materials")
EXTS = (".pdf", ".epub")


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def resolve(name):
    path = Path(name)
    if not path.is_absolute():
        path = ROOT / name
    if not path.exists():
        fail(f"not found: {path}")
    return path


def pdf(path):
    import pymupdf

    return pymupdf.open(path)


def content_digest(path):
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()[:24]


def spine_documents(archive):
    """Entry names of the reading-order documents from the OPF; archive order of (x)html files without one."""
    for name in archive.namelist():
        if not name.lower().endswith(".opf"):
            continue
        opf = archive.read(name).decode("utf8", "replace")
        base = posixpath.dirname(name)
        hrefs = {}
        for tag in re.findall(r"<item\b[^>]*>", opf):
            item_id = re.search(r'\bid="([^"]+)"', tag)
            href = re.search(r'\bhref="([^"]+)"', tag)
            if item_id and href:
                hrefs[item_id.group(1)] = posixpath.normpath(posixpath.join(base, unquote(href.group(1))))
        docs = [hrefs[ref] for ref in re.findall(r'<itemref\b[^>]*?idref="([^"]+)"', opf) if ref in hrefs]
        if docs:
            return docs
    return [name for name in archive.namelist() if name.lower().endswith((".xhtml", ".html", ".htm"))]


class _TextExtractor(HTMLParser):
    """Headings and paragraphs of one XHTML document as markdown-style text."""

    SKIP = {"head", "script", "style", "svg"}
    BLOCK = {"p", "div", "li", "tr", "td", "th", "br", "hr", "table", "section", "article", "blockquote", "pre",
             "ul", "ol", "dl", "dt", "dd", "figure", "figcaption", "aside", "header", "footer", "nav", "body"}

    def __init__(self):
        super().__init__()
        self.parts, self.skipping = [], 0

    @staticmethod
    def heading_level(tag):
        return int(tag[1]) if len(tag) == 2 and tag[0] == "h" and tag[1].isdigit() else 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skipping += 1
        elif self.heading_level(tag):
            self.parts.append("\n\n" + "#" * self.heading_level(tag) + " ")
        elif tag in self.BLOCK:
            self.parts.append("\n\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.skipping = max(0, self.skipping - 1)
        elif tag in self.BLOCK or self.heading_level(tag):
            self.parts.append("\n\n")

    def handle_data(self, data):
        if not self.skipping:
            self.parts.append(data)

    def text(self):
        blocks = (" ".join(block.split()) for block in "".join(self.parts).split("\n\n"))
        return "\n\n".join(block for block in blocks if block)


def epub_markdown(path):
    """Chapters in spine order; only the text documents are read, never the media."""
    chunks = []
    with zipfile.ZipFile(path) as archive:
        for name in spine_documents(archive):
            extractor = _TextExtractor()
            extractor.feed(archive.read(name).decode("utf8", "replace"))
            extractor.close()
            if text := extractor.text():
                chunks.append(text)
    return "\n\n".join(chunks) + "\n"


def epub_text(path):
    """Extracted text, cached by content digest and size so a renamed file keeps its cache."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cache = CACHE / f"epub-{content_digest(path)}-{path.stat().st_size}.md"
    if not cache.exists():
        cache.write_text(epub_markdown(path), encoding="utf8")
    return cache.read_text(encoding="utf8")


def epub_chapters(path):
    """Split the extracted text at level 1 and 2 headings."""
    chapters, title, buf = [], "(front matter)", []
    for line in epub_text(path).splitlines():
        if line.startswith("# ") or line.startswith("## "):
            chapters.append((title, "\n".join(buf)))
            title, buf = " ".join(line.lstrip("#").split()), []
            continue
        buf.append(line)
    chapters.append((title, "\n".join(buf)))
    return [(t, b) for t, b in chapters if b.strip()]


def cmd_list():
    for path in sorted(ROOT.rglob("*")):
        if path.suffix.lower() in EXTS and path.is_file():
            size = path.stat().st_size // (1024 * 1024)
            print(f"{size:5d}M  {path.relative_to(ROOT)}")


def cmd_toc(path):
    if path.suffix.lower() == ".pdf":
        doc = pdf(path)
        toc = doc.get_toc()
        if not toc:
            print(f"(no bookmarks; {doc.page_count} pages)")
        for level, title, page in toc:
            print(f"{'  ' * (level - 1)}{title}  ·  p{page}")
    else:
        for title, body in epub_chapters(path):
            print(f"{title}  ·  {len(body)} chars")


def cmd_nav(path):
    """Navigation entries with the paths that epub citations use."""
    try:
        with zipfile.ZipFile(path) as archive:
            _, entries = epub_navigation(archive)
    except (zipfile.BadZipFile, CiteError) as error:
        fail(str(error))
    for key, title, doc, _ in entries:
        print(f"{key:<12}{title}{'' if doc else '  (no target)'}")


def cmd_epub_text(path, heading):
    needle = heading.lower()
    shown = 0
    for title, body in epub_chapters(path):
        if needle in title.lower():
            shown += 1
            print(f"\n===== {title} =====")
            print(body.strip("\n"))
    if not shown:
        fail(f"no chapter heading contains {heading!r} (material.py toc lists them)")


def cmd_text(path, first, last):
    doc = pdf(path)
    first, last = int(first), int(last)
    if not 1 <= first <= last <= doc.page_count:
        fail(f"page range out of bounds (1..{doc.page_count})")
    for number in range(first, last + 1):
        print(f"\n===== PDF page {number} =====")
        print(doc[number - 1].get_text())


def cmd_find(path, query):
    needle = query.lower()
    if path.suffix.lower() == ".pdf":
        doc = pdf(path)
        hits = 0
        for index in range(doc.page_count):
            text = doc[index].get_text()
            lower = text.lower()
            position = lower.find(needle)
            if position == -1:
                continue
            hits += 1
            excerpt = " ".join(text[max(0, position - 80) : position + len(query) + 80].split())
            print(f"PDF page {index + 1}: {excerpt}")
            if hits >= 40:
                print("(first 40 pages shown)")
                break
        if hits == 0:
            print("no matches (scanned book without text layer?)")
    else:
        for title, body in epub_chapters(path):
            count = body.lower().count(needle)
            if count:
                position = body.lower().find(needle)
                excerpt = " ".join(body[max(0, position - 80) : position + len(query) + 80].split())
                print(f"{title} ({count}): {excerpt}")


def cmd_page(path, page, dpi="110"):
    doc = pdf(path)
    number = int(page)
    if not 1 <= number <= doc.page_count:
        fail(f"page out of bounds (1..{doc.page_count})")
    out_dir = Path(os.environ.get("MATERIAL_OUT", "/tmp")) / "material-pages"
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{path.stem}-p{number}.png"
    doc[number - 1].get_pixmap(dpi=int(dpi)).save(target)
    print(target)


def cmd_check(source):
    """Lists every shelf path mentioned in an Issue body; missing files fail."""
    text = sys.stdin.read() if source == "-" else Path(source).read_text(encoding="utf8")
    names = []
    for match in re.finditer(r"(?:`|\b)(?:materials/)?((?:papers|patents|reports|reviews|textbooks)/[^\s`|)]+)", text):
        name = match.group(1).rstrip(".,;:")
        if name.lower().endswith(EXTS) and name not in names:
            names.append(name)
    if not names:
        fail("no materials/ paths found in the text")
    missing = 0
    for name in names:
        path = ROOT / name
        if not path.is_file():
            missing += 1
            print(f"MISSING  {name}")
            continue
        size = path.stat().st_size // (1024 * 1024)
        layer = ""
        if path.suffix.lower() == ".pdf":
            doc = pdf(path)
            text_pages = sum(1 for i in range(min(doc.page_count, 5)) if doc[i].get_text().strip())
            layer = f"{doc.page_count} pages, text layer on {text_pages}/{min(doc.page_count, 5)} sampled"
        print(f"ok       {name}  ({size}M{', ' + layer if layer else ''})")
    print(f"{len(names) - missing}/{len(names)} present")
    if missing:
        sys.exit(1)


PAGE_DPI = 150
PAGE_QUALITY = 80


class CiteError(Exception):
    pass


def file_sha256(path):
    """SHA-256 of a shelf file, cached while its size, mtime, ctime and inode stay the same."""
    info = path.stat()
    identity = [info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_ino]
    record = CACHE / "digests" / f"{hashlib.sha256(str(path.resolve()).encode()).hexdigest()[:32]}.json"
    try:
        cached = json.loads(record.read_text(encoding="utf8"))
        if cached["identity"] == identity:
            return cached["sha256"]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    record.parent.mkdir(parents=True, exist_ok=True)
    temporary = record.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps({"identity": identity, "sha256": digest.hexdigest()}), encoding="utf8")
    os.replace(temporary, record)
    return digest.hexdigest()


class Shelf:
    """Shelf files with their SHA-256, checked against the collection's manifest.json when there is one."""

    def __init__(self):
        self.digests, self.manifests, self.documents = {}, {}, {}

    def pdf(self, path):
        """The opened PDF, shared by every request on it: opening a long book reads its whole outline."""
        if path not in self.documents:
            import pymupdf

            self.documents[path] = pymupdf.open(path)
        return self.documents[path]

    def close(self):
        for document in self.documents.values():
            document.close()

    def file(self, name):
        path = ROOT / name
        if not path.resolve().is_relative_to(ROOT.resolve()) or not path.is_file():
            raise CiteError(f"{name}: not on the shelf")
        return path

    def digest(self, path):
        if path not in self.digests:
            self.digests[path] = file_sha256(path)
        return self.digests[path]

    def manifest(self, folder):
        if folder not in self.manifests:
            path = folder / "manifest.json"
            files = json.loads(path.read_text(encoding="utf8"))["files"] if path.is_file() else None
            self.manifests[folder] = files
        return self.manifests[folder]

    def entry(self, name, path):
        """The manifest entry of a file after its hash check; None when the collection has no manifest."""
        files = self.manifest(path.parent)
        if files is None:
            return None
        entry = next((e for e in files if e.get("file") == path.name), None)
        if entry is None:
            raise CiteError(f"{name}: not listed in manifest.json")
        if entry.get("sha256") != self.digest(path):
            raise CiteError(f"{name}: SHA-256 differs from manifest.json")
        return entry


def cite_pdf(shelf, name, path, first, last):
    """Renders the cited pages and one page either side to WebP, cached by file digest."""
    import pymupdf
    from PIL import Image

    # MuPDF prints recoverable errors (an unloadable embedded font) to stdout,
    # which carries the JSON answer.
    pymupdf.set_messages(fd=2)
    shelf.entry(name, path)
    digest = shelf.digest(path)
    doc = shelf.pdf(path)
    count = doc.page_count
    if not 1 <= first <= last <= count:
        raise CiteError(f"{name}: pages {first}-{last} outside 1-{count}")
    shown = []
    for number in range(max(1, first - 1), min(count, last + 1) + 1):
        page = doc[number - 1]
        target = CACHE / "pages" / f"{digest[:24]}-{number}-{PAGE_DPI}-{PAGE_QUALITY}.webp"
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            pix = page.get_pixmap(dpi=PAGE_DPI, alpha=False)
            image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            temporary = target.with_suffix(f".{os.getpid()}.tmp")
            image.save(temporary, "WEBP", quality=PAGE_QUALITY)
            temporary.replace(target)
        shown.append({"page": number, "size": [page.rect.width, page.rect.height], "image": str(target)})
    return {"pages": count, "shown": shown}


class _CleanBody(HTMLParser):
    """Part of a page re-emitted through a tag and attribute whitelist.

    Capture begins at the element `start` accepts: an archived page's article
    element is a wrapper whose content is kept, an epub chapter's first element
    is kept itself and capture runs to the end of the body or to `stop_id`.
    Images become `IMAGE:<n>` placeholders for the keys `image(src)` returns;
    elements whose id is in `markers`, or the first element when `pending` is
    given, carry `data-section` with the section keys they start.
    """

    KEEP = {"p", "strong", "b", "em", "i", "sub", "sup", "br", "img", "a", "ul", "ol", "li",
            "table", "thead", "tbody", "tr", "th", "td", "blockquote", "figure", "figcaption", "dl", "dt", "dd"}
    # Headings sit under the viewer's own title.
    HEADINGS = {"h1": "h3", "h2": "h3", "h3": "h4", "h4": "h5", "h5": "h5", "h6": "h5"}
    # MathML is replaced by its image or its text when the element closes.
    DROP = {"script", "style", "noscript", "iframe", "svg", "annotation", "form", "button", "input", "select",
            "textarea", "video", "audio", "object", "embed", "template", "canvas", "map", "head", "title"}
    VOID = {"br", "img", "hr", "meta", "link", "input", "source", "wbr", "col", "area", "base", "embed",
            "param", "track"}
    BLOCKS = {"p", "h3", "h4", "h5", "li", "td", "th", "blockquote", "figcaption", "dt", "dd"}

    def __init__(self, start, image, base_url="", include_start=False, stop_id=None, markers=None, pending=(),
                 images=None):
        super().__init__(convert_charrefs=True)
        self.start, self.image, self.base_url = start, image, base_url
        self.include_start, self.stop_id = include_start, stop_id
        self.markers, self.pending = markers or {}, list(pending)
        self.stack = None  # open elements inside the capture: (source tag, emitted tag or None, dropped)
        self.math = None  # text and images of the MathML element being read
        self.done = self.stopped = False
        self.out, self.images, self.marked = [], [] if images is None else images, []

    @staticmethod
    def hidden(attrs):
        return ("hidden" in attrs or "hidden" in (attrs.get("class") or "").split()
                or re.search(r"display\s*:\s*none", attrs.get("style") or "") is not None)

    def dropping(self):
        return any(dropped for _, _, dropped in self.stack)

    def handle_starttag(self, tag, attrs):
        if self.done:
            return
        attrs = dict(attrs)
        if self.stack is None:
            if not self.start(tag, attrs):
                return
            self.stack, self.article_tag = [], "body" if self.include_start else tag
            if not self.include_start:
                return
        if self.stop_id is not None and attrs.get("id") == self.stop_id:
            self.stopped = True
            self.close_article()
            return
        self.pending += self.markers.get(attrs.get("id"), [])
        dropped = tag in self.DROP or self.hidden(attrs)
        emitted = None
        if not dropped and not self.dropping():
            if self.math is not None:
                if tag == "img":
                    self.math["images"].append(attrs)
            elif tag == "math":
                self.math = {"text": [], "images": [], "altimg": attrs.get("altimg")}
            else:
                emitted = self.emit_start(tag, attrs)
        if tag not in self.VOID:
            self.stack.append((tag, emitted, dropped))

    def marker(self):
        if not self.pending:
            return ""
        keys, self.pending = self.pending, []
        self.marked += keys
        return f' data-section="{" ".join(keys)}"'

    def emit_image(self, src, alt):
        if not src or src.startswith("data:"):
            return
        key, extra = self.image(src)
        self.images.append(key)
        self.out.append(f'<img src="IMAGE:{len(self.images) - 1}" alt="{escape(alt, quote=True)}"{extra}{self.marker()}>')

    def emit_start(self, tag, attrs):
        name = self.HEADINGS.get(tag, tag)
        if name not in self.KEEP and name not in self.HEADINGS.values():
            return None
        if name == "img":
            self.emit_image(attrs.get("src") or "", attrs.get("alt") or "")
            return None
        if name == "br":
            self.out.append("<br>")
            return None
        if name == "a":
            href = urljoin(self.base_url, attrs.get("href") or "")
            if urlsplit(href).scheme not in ("http", "https"):
                return None
            self.out.append(f'<a href="{escape(href, quote=True)}" target="_blank" rel="noopener noreferrer"{self.marker()}>')
            return name
        spans = "".join(
            f' {key}="{attrs[key]}"' for key in ("colspan", "rowspan") if name in ("td", "th") and (attrs.get(key) or "").isdigit()
        )
        self.out.append(f"<{name}{spans}{self.marker()}>")
        return name

    def finish_math(self):
        math, self.math = self.math, None
        text = " ".join("".join(math["text"]).split())
        sources = [math["altimg"]] if math["altimg"] else [image.get("src") for image in math["images"]]
        if any(sources):
            for src in sources:
                self.emit_image(src or "", text)
        elif text:
            self.out.append(escape(text, quote=False))

    def handle_endtag(self, tag):
        if self.stack is None or self.done:
            return
        if not any(open_tag == tag for open_tag, _, _ in self.stack):
            if tag == self.article_tag:
                self.close_article()
            return
        while self.stack:
            open_tag, emitted, _ = self.stack.pop()
            if open_tag == "math" and self.math is not None:
                self.finish_math()
            if emitted:
                if emitted in self.BLOCKS and self.out:
                    self.out[-1] = self.out[-1].rstrip()
                self.out.append(f"</{emitted}>")
            if open_tag == tag:
                break

    def close_article(self):
        while self.stack:
            self.handle_endtag(self.stack[-1][0])
        self.done = True

    def handle_data(self, data):
        if self.stack is None or self.done or self.dropping():
            return
        if self.math is not None:
            self.math["text"].append(data)
            return
        text = re.sub(r"[\s\xa0]+", " ", data)
        # Whitespace after a block boundary is layout, not text.
        if not self.out or re.search(r"</?(?:p|h3|h4|h5|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|figure|figcaption|dl|dt|dd)\b[^>]*>$|<br>$", self.out[-1]):
            text = text.lstrip()
        if text:
            self.out.append(escape(text, quote=False))

    def html(self):
        if self.stack:
            self.close_article()
        html = "".join(self.out)
        while True:
            cleaned = re.sub(r"<(p|h3|h4|h5|li|blockquote|figcaption|dt|dd|strong|b|em|i|sub|sup)>(?:\s|<br>)*</\1>", "", html)
            if cleaned == html:
                return html.strip()
            html = cleaned


def manifest_article(path):
    """The article element an archived collection declares in its manifest.json as {"tag", "class"}."""
    folder = path.parent / "manifest.json"
    article = json.loads(folder.read_text(encoding="utf8")).get("article") if folder.is_file() else None
    if not isinstance(article, dict) or not article.get("tag") or not article.get("class"):
        return None
    return lambda tag, attrs: tag == article["tag"] and article["class"] in (attrs.get("class") or "").split()


def cite_web(shelf, name, path):
    rule = manifest_article(path)
    if rule is None:
        raise CiteError(f"{name}: manifest.json declares no article element for this archived page")
    entry = shelf.entry(name, path)
    if not entry or not entry.get("source_url") or not entry.get("downloaded"):
        raise CiteError(f"{name}: manifest.json must give source_url and downloaded")
    parser = _CleanBody(rule, lambda src: (urljoin(entry["source_url"], src), ""), entry["source_url"])
    parser.feed(path.read_text(encoding="utf8"))
    parser.close()
    html = parser.html()
    if not re.sub(r"<[^>]*>|\s", "", html):
        raise CiteError(f"{name}: no article text found")
    files = shelf.manifest(path.parent)
    images = []
    for url in parser.images:
        image = next((e for e in files if e.get("source_url") == url), None)
        if image is None:
            raise CiteError(f"{name}: image {url} has no archived copy in manifest.json")
        image_path = shelf.file(posixpath.join(posixpath.dirname(name), image["file"]))
        shelf.entry(name, image_path)
        images.append(str(image_path))
    return {"url": entry["source_url"], "downloaded": entry["downloaded"], "html": html, "images": images}


EPUB_IMAGES = (".png", ".jpg", ".jpeg", ".gif", ".webp")
# Characters of cleaned HTML in one cited epub entry; the longest chapter on the shelf has about 290 000.
EPUB_MAX_HTML = 500_000


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _xml(archive, name, what):
    try:
        return ET.fromstring(archive.read(name))
    except (KeyError, ET.ParseError) as error:
        raise CiteError(f"{what} {name} is unreadable: {error}")


def _target(base, href):
    """A navigation href as (spine document, fragment or None)."""
    parts = urlsplit(href)
    doc = posixpath.normpath(posixpath.join(base, unquote(parts.path)))
    return doc, unquote(parts.fragment) or None


def epub_navigation(archive):
    """The reading-order documents and the navigation entries (path, title, doc, fragment) in order.

    Entries come from the EPUB 3 navigation document, or the NCX of an EPUB 2
    book; an entry's path is its position in the tree, such as "3.1.2".
    """
    container = _xml(archive, "META-INF/container.xml", "container")
    opf_name = next((el.get("full-path") for el in container.iter() if _local(el.tag) == "rootfile"), None)
    if not opf_name:
        raise CiteError("container.xml names no package document")
    package = _xml(archive, opf_name, "package document")
    base = posixpath.dirname(opf_name)
    items, spine, ncx = {}, [], None
    for el in package.iter():
        if _local(el.tag) == "item":
            items[el.get("id")] = el
        elif _local(el.tag) == "spine":
            ncx = el.get("toc")
            spine = [el.get("idref") for el in el if _local(el.tag) == "itemref"]
    path = lambda item: posixpath.normpath(posixpath.join(base, unquote(item.get("href"))))
    documents = [path(items[ref]) for ref in spine if ref in items]
    entries = []

    def add(prefix, children, read, nav):
        for index, child in enumerate(children, 1):
            key = f"{prefix}{index}"
            title, href, nested = read(child)
            doc, fragment = _target(posixpath.dirname(nav), href) if href else (None, None)
            entries.append((key, " ".join(title.split()), doc, fragment))
            add(key + ".", nested, read, nav)

    nav_item = next((item for item in items.values() if "nav" in (item.get("properties") or "").split()), None)
    if nav_item is not None:
        nav = path(nav_item)
        toc = next((el for el in _xml(archive, nav, "navigation document").iter() if _local(el.tag) == "nav"
                    and "toc" in (el.get("{http://www.idpf.org/2007/ops}type") or "").split()), None)
        if toc is None:
            raise CiteError(f"{nav} has no toc navigation")
        children = lambda el: next((list(c) for c in el if _local(c.tag) == "ol"), [])

        def read(li):
            label = next((c for c in li if _local(c.tag) in ("a", "span")), None)
            title = "".join(label.itertext()) if label is not None else ""
            href = label.get("href") if label is not None and _local(label.tag) == "a" else None
            return title, href, [c for c in children(li) if _local(c.tag) == "li"]

        add("", [c for c in children(toc) if _local(c.tag) == "li"], read, nav)
    elif ncx in items:
        nav = path(items[ncx])
        nav_map = next((el for el in _xml(archive, nav, "NCX").iter() if _local(el.tag) == "navMap"), None)
        points = lambda el: [c for c in el if _local(c.tag) == "navPoint"]

        def read(point):
            label = next((c for c in point if _local(c.tag) == "navLabel"), None)
            content = next((c for c in point if _local(c.tag) == "content"), None)
            return ("".join(label.itertext()) if label is not None else "",
                    content.get("src") if content is not None else None, points(point))

        add("", points(nav_map) if nav_map is not None else [], read, nav)
    else:
        raise CiteError("the book has no navigation document or NCX")
    return documents, entries


def cite_epub(shelf, name, path, chapter):
    """The text and images of one navigation entry, from its target to the next entry outside it."""
    from PIL import Image

    shelf.entry(name, path)
    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        raise CiteError(f"{name}: not a readable epub")
    with archive:
        try:
            documents, entries = epub_navigation(archive)
        except CiteError as error:
            raise CiteError(f"{name}: {error}")
        index = next((i for i, entry in enumerate(entries) if entry[0] == chapter), None)
        if index is None or entries[index][2] is None:
            raise CiteError(f"{name}: no chapter {chapter} in the navigation (material.py nav lists them)")
        _, title, doc, fragment = entries[index]
        inside = [entry for entry in entries[index + 1:] if entry[0].startswith(chapter + ".")]
        after = next((entry for entry in entries[index + 1 + len(inside):] if entry[2] is not None), None)
        if doc not in documents:
            raise CiteError(f"{name}: chapter {chapter} starts outside the reading order")
        first = documents.index(doc)
        if after is None:
            docs = documents[first:]
        elif after[2] not in documents or documents.index(after[2]) < first:
            raise CiteError(f"{name}: the entry after chapter {chapter} lies outside the reading order")
        else:
            end = documents.index(after[2])
            docs = documents[first:end + 1] if after[3] else documents[first:end]
        markers = {}
        for key, section_title, section_doc, section_fragment in inside:
            if section_doc is not None:
                markers.setdefault(section_doc, {}).setdefault(section_fragment, []).append(key[len(chapter) + 1:])
        titles = {key[len(chapter) + 1:]: section_title for key, section_title, _, _ in inside}

        cached = {}

        def image(document):
            def resolve(src):
                target = posixpath.normpath(posixpath.join(posixpath.dirname(document), unquote(urlsplit(src).path)))
                if target not in cached:
                    extension = posixpath.splitext(target)[1].lower()
                    if extension not in EPUB_IMAGES:
                        raise CiteError(f"{name}: image {target} is not PNG, JPEG, GIF or WebP")
                    try:
                        data = archive.read(target)
                    except KeyError:
                        raise CiteError(f"{name}: image {target} is missing from the book")
                    try:
                        width, height = Image.open(io.BytesIO(data)).size
                    except OSError:
                        raise CiteError(f"{name}: image {target} is unreadable")
                    out = CACHE / "epub-images" / f"{hashlib.sha256(data).hexdigest()}{extension}"
                    if not out.exists():
                        out.parent.mkdir(parents=True, exist_ok=True)
                        temporary = out.with_suffix(f".{os.getpid()}.tmp")
                        temporary.write_bytes(data)
                        temporary.replace(out)
                    cached[target] = str(out), f' width="{width}" height="{height}" loading="lazy"'
                return cached[target]

            return resolve

        html, images, marked = [], [], []
        for position, document in enumerate(docs):
            opening = position == 0 and fragment is not None
            stop = after[3] if after and position == len(docs) - 1 and after[2] == document else None
            ids = markers.get(document, {})
            parser = _CleanBody(
                (lambda tag, attrs: attrs.get("id") == fragment) if opening else (lambda tag, attrs: tag == "body"),
                image(document), include_start=opening, stop_id=stop,
                markers={key: value for key, value in ids.items() if key}, pending=ids.get(None, []), images=images)
            try:
                parser.feed(archive.read(document).decode("utf8", "replace"))
            except KeyError:
                raise CiteError(f"{name}: {document} is missing from the book")
            parser.close()
            if parser.stack is None:
                raise CiteError(f"{name}: {document}#{fragment} not found" if opening else f"{name}: {document} has no body")
            if stop is not None and not parser.stopped:
                raise CiteError(f"{name}: {document}#{stop} not found")
            html.append(parser.html())
            marked += parser.marked
        html = "".join(html)
        if not re.sub(r"<[^>]*>|\s", "", html):
            raise CiteError(f"{name}: chapter {chapter} has no text")
        if len(html) > EPUB_MAX_HTML:
            raise CiteError(f"{name}: chapter {chapter} is too long to cite; cite an entry inside it")
    return {"chapter": title, "sections": {key: titles[key] for key in marked}, "html": html, "images": images}


def cmd_cite():
    """stdin {"requests": [{"file", "first"?, "last"?, "chapter"?}]} -> stdout one result or {"error"} per request."""
    shelf = Shelf()
    results = []
    for request in json.load(sys.stdin)["requests"]:
        name = request["file"]
        try:
            path = shelf.file(name)
            if name.endswith(".pdf"):
                results.append(cite_pdf(shelf, name, path, request["first"], request["last"]))
            elif name.endswith(".epub"):
                results.append(cite_epub(shelf, name, path, request["chapter"]))
            else:
                results.append(cite_web(shelf, name, path))
        except CiteError as error:
            results.append({"error": str(error)})
    shelf.close()
    json.dump(results, sys.stdout, ensure_ascii=False)


def main(argv):
    if len(argv) < 1:
        fail(__doc__)
    command, args = argv[0], argv[1:]
    if command == "list" and not args:
        return cmd_list()
    if command == "cite" and not args:
        return cmd_cite()
    if command == "nav" and len(args) == 1 and args[0].lower().endswith(".epub"):
        return cmd_nav(resolve(args[0]))
    if command == "check" and len(args) == 1:
        return cmd_check(args[0])
    if command == "toc" and len(args) == 1:
        return cmd_toc(resolve(args[0]))
    if command == "text" and len(args) == 2 and args[0].lower().endswith(".epub"):
        return cmd_epub_text(resolve(args[0]), args[1])
    if command == "text" and len(args) == 3:
        return cmd_text(resolve(args[0]), *args[1:])
    if command == "find" and len(args) == 2:
        return cmd_find(resolve(args[0]), args[1])
    if command == "page" and len(args) in (2, 3):
        return cmd_page(resolve(args[0]), *args[1:])
    fail(__doc__)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except BrokenPipeError:  # output piped into head or similar
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
