import type { Unchecked } from "../shared/unchecked.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const script = resolve(import.meta.dirname, "../scripts/material.py");

// A small epub: two chapters whose spine order is the reverse of the archive
// order, a glossary with entities and a <style> block, plus a 20 MB image, a
// font and an audio file that a reader must never load.
const buildEpub = (target: Unchecked) => {
  const result = spawnSync(
    "python3",
    [
      "-I",
      "-c",
      `
import sys, zipfile
container = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
opf = '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Probe</dc:title><dc:identifier id="id">x</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="c2" href="xhtml/ch02.xhtml" media-type="application/xhtml+xml"/><item href="xhtml/ch01.xhtml" id="c1" media-type="application/xhtml+xml"/><item id="g" href="xhtml/glossary.xhtml" media-type="application/xhtml+xml"/><item media-type="image/png" id="i1" href="img/figure%201.png"/><item id="f1" href="fonts/body.otf" media-type="application/vnd.ms-opentype"/><item id="a1" href="audio/intro.mp3" media-type="audio/mpeg"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/><itemref idref="g"/></spine></package>'
ch01 = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>ignored title</title><style>p { color: red }</style></head><body><h1><span class="pagebreak" aria-label="1"></span>Chapter 1 Glycolysis</h1><p>Glucose is split\\n   into two <i>three-carbon</i> units.</p><img src="img/figure%201.png" alt="pathway"/><h2>1.1 Payoff</h2><p>Two ATP per glucose &amp; two NADH.</p></body></html>'
ch02 = '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter 2 Citric Acid Cycle</h1><p>Acetyl-CoA enters the cycle.</p><table><tr><td>Step</td><td>Enzyme</td></tr><tr><td>1</td><td>citrate synthase</td></tr></table></body></html>'
glossary = '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Glossary</h1><dl><dt>Amphibolic</dt><dd>both catabolic and anabolic &#8212; see Chapter 2</dd></dl><script>alert(1)</script></body></html>'
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", container)
    z.writestr("OEBPS/package.opf", opf)
    z.writestr("OEBPS/xhtml/ch02.xhtml", ch02)
    z.writestr("OEBPS/xhtml/ch01.xhtml", ch01)
    z.writestr("OEBPS/xhtml/glossary.xhtml", glossary)
    z.writestr("OEBPS/toc.ncx", "<ncx/>")
    z.writestr("OEBPS/img/figure 1.png", b"\\x89PNG" + bytes(20 * 1024 * 1024))
    z.writestr("OEBPS/fonts/body.otf", bytes(5000))
    z.writestr("OEBPS/audio/intro.mp3", bytes(5000))
`,
      target,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
};

test("epub text follows the spine, skips media and styles, and is cached by content", () => {
  const dir = mkdtempSync(join(tmpdir(), "il-material-"));
  try {
    const home = join(dir, "home");
    mkdirSync(home);
    const epub = join(dir, "Sample Biochemistry.epub");
    buildEpub(epub);
    const env = { ...process.env, HOME: home };
    const run = (...args: string[]) =>
      spawnSync("python3", ["-I", script, ...args], { encoding: "utf8", env });

    const toc = run("toc", epub);
    assert.equal(toc.status, 0, toc.stderr);
    assert.deepEqual(
      toc.stdout
        .trim()
        .split("\n")
        .map((line) => line.split("  ·  ")[0]),
      [
        "Chapter 1 Glycolysis",
        "1.1 Payoff",
        "Chapter 2 Citric Acid Cycle",
        "Glossary",
      ],
    );

    const cacheDir = join(home, ".cache/molnotes-materials");
    const [cacheName] = readdirSync(cacheDir);
    assert.match(cacheName, /^epub-[0-9a-f]{24}-\d+\.md$/);
    const cached = readFileSync(join(cacheDir, cacheName), "utf8");
    assert.equal(
      cached,
      [
        "# Chapter 1 Glycolysis",
        "Glucose is split into two three-carbon units.",
        "## 1.1 Payoff",
        "Two ATP per glucose & two NADH.",
        "# Chapter 2 Citric Acid Cycle",
        "Acetyl-CoA enters the cycle.",
        "Step",
        "Enzyme",
        "1",
        "citrate synthase",
        "# Glossary",
        "Amphibolic",
        "both catabolic and anabolic — see Chapter 2",
      ].join("\n\n") + "\n",
    );
    const written = statSync(join(cacheDir, cacheName)).mtimeMs;

    // Renaming the book keeps the cache: same file, not rewritten.
    const renamed = join(dir, "sample-principles-of-biochemistry-2021.epub");
    renameSync(epub, renamed);
    const find = run("find", renamed, "chapter 2");
    assert.equal(find.status, 0, find.stderr);
    assert.equal(
      find.stdout,
      "Glossary (1): Amphibolic both catabolic and anabolic — see Chapter 2\n",
    );
    assert.deepEqual(readdirSync(cacheDir), [cacheName]);
    assert.equal(statSync(join(cacheDir, cacheName)).mtimeMs, written);

    const text = run("text", renamed, "citric");
    assert.equal(text.status, 0, text.stderr);
    assert.equal(
      text.stdout,
      "\n===== Chapter 2 Citric Acid Cycle =====\nAcetyl-CoA enters the cycle.\n\nStep\n\nEnzyme\n\n1\n\ncitrate synthase\n",
    );
    const missing = run("text", renamed, "nowhere");
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /no chapter heading contains 'nowhere'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The publication side of the shelf: cited PDF pages with one neighbour each
// side, and the article of an archived page through the whitelist.
test("cite renders neighbouring pages and extracts a whitelisted article", () => {
  const dir = mkdtempSync(join(tmpdir(), "il-material-cite-"));
  try {
    const shelf = join(dir, "shelf");
    cpSync(resolve(import.meta.dirname, "fixtures/shelf"), shelf, {
      recursive: true,
    });
    const cite = (...requests: unknown[]) => {
      const result = spawnSync("python3", ["-I", script, "cite"], {
        encoding: "utf8",
        input: JSON.stringify({ requests }),
        env: {
          ...process.env,
          MOLNOTES_MATERIALS_DIR: shelf,
          MOLNOTES_MATERIALS_CACHE: join(dir, "cache"),
        },
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const handbook = "textbooks/sample-handbook.pdf";
    const [middle, start, end, outside] = cite(
      { file: handbook, first: 2, last: 3 },
      { file: handbook, first: 1, last: 1 },
      { file: handbook, first: 4, last: 4 },
      { file: handbook, first: 4, last: 5 },
    );
    assert.equal(middle.pages, 4);
    assert.deepEqual(
      middle.shown.map(({ page, size }: Unchecked) => [page, size]),
      [1, 2, 3, 4].map((page) => [page, [612, 792]]),
    );
    assert.deepEqual(
      start.shown.map(({ page }: Unchecked) => page),
      [1, 2],
    );
    assert.deepEqual(
      end.shown.map(({ page }: Unchecked) => page),
      [3, 4],
    );
    assert.equal(
      readFileSync(middle.shown[0].image).subarray(8, 12).toString(),
      "WEBP",
    );
    assert.match(outside.error, /pages 4-5 outside 1-4/);
    // MuPDF reports a font it cannot load and still renders the page; the
    // report goes to stderr so stdout stays the JSON answer.
    const [broken] = cite({
      file: "textbooks/broken-font.pdf",
      first: 1,
      last: 1,
    });
    assert.deepEqual(
      broken.shown.map(({ page }: Unchecked) => page),
      [1],
    );

    const [lesson] = cite({ file: "reports/sample-report/chapter-1.html" });
    assert.equal(lesson.url, "https://example.org/lesson-1");
    assert.equal(lesson.downloaded, "2026-10-01");
    assert.deepEqual(lesson.images, [
      join(shelf, "reports/sample-report/figure-1.png"),
    ]);
    assert.equal(
      lesson.html,
      [
        "<h3>样本课程：读一张轨道图</h3>",
        "<h4>样本课堂 | 第一课</h4>",
        "<p>这一课用一张示意图说明 <strong>LUMO</strong> 的读法。</p>",
        '<p><img src="IMAGE:0" alt="Fig1.png"></p>',
        "<p>图一. 示意图</p>",
        "<p>H<sub>2</sub>O 与 10<sup>3</sup> 保留上下标；样式被去掉。</p>",
        "<p>嵌套的 section 只保留文字。</p>",
        '<p>危险链接 与 <a href="https://example.org/lesson-2" target="_blank" rel="noopener noreferrer">下一课</a></p>',
      ].join(""),
    );

    // Copies that drift from the manifest, unlisted files, other collections
    // and archived pages without an article are refused.
    const manifest = join(shelf, "reports/sample-report/manifest.json");
    const page = join(shelf, "reports/sample-report/chapter-1.html");
    const original = readFileSync(page, "utf8");
    writeFileSync(page, original.replace("示意图说明", "示意图讲解"));
    writeFileSync(join(shelf, "reports/sample-report/extra.pdf"), "%PDF-1.4");
    mkdirSync(join(shelf, "reports/other"));
    writeFileSync(join(shelf, "reports/other/page.html"), original);
    const [drift, unlisted, other, missing] = cite(
      { file: "reports/sample-report/chapter-1.html" },
      { file: "reports/sample-report/extra.pdf", first: 1, last: 1 },
      { file: "reports/other/page.html" },
      { file: "textbooks/missing.pdf", first: 1, last: 1 },
    );
    assert.match(drift.error, /SHA-256 differs from manifest.json/);
    assert.match(unlisted.error, /not listed in manifest.json/);
    assert.match(other.error, /declares no article element/);
    assert.match(missing.error, /not on the shelf/);
    const entries = JSON.parse(readFileSync(manifest, "utf8"));
    const listed = (html: string) => {
      writeFileSync(page, html);
      entries.files[0].sha256 = createHash("sha256").update(html).digest("hex");
      writeFileSync(manifest, JSON.stringify(entries));
      return cite({ file: "reports/sample-report/chapter-1.html" })[0];
    };
    assert.match(
      listed(original.replace('class="article-body', 'class="article-other'))
        .error,
      /no article text found/,
    );
    assert.match(
      listed(original.replace("sample/figure-1.png", "sample/figure-2.png"))
        .error,
      /figure-2.png has no archived copy/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// An epub is cited by navigation entry: its text runs from the entry's target
// to the next entry outside it, through the same whitelist as archived pages,
// with each nested entry marked so the viewer can open at a section.
test("cite extracts an epub chapter with its images and section markers", () => {
  const dir = mkdtempSync(join(tmpdir(), "il-material-epub-"));
  try {
    const shelf = join(dir, "shelf");
    cpSync(resolve(import.meta.dirname, "fixtures/shelf"), shelf, {
      recursive: true,
    });
    const book = "textbooks/sample-reader.epub";
    const env = {
      ...process.env,
      MOLNOTES_MATERIALS_DIR: shelf,
      MOLNOTES_MATERIALS_CACHE: join(dir, "cache"),
    };
    const cite = (...chapters: unknown[]) => {
      const result = spawnSync("python3", ["-I", script, "cite"], {
        encoding: "utf8",
        input: JSON.stringify({
          requests: chapters.map((chapter) => ({ file: book, chapter })),
        }),
        env,
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const nav = spawnSync("python3", ["-I", script, "nav", book], {
      encoding: "utf8",
      env,
    });
    assert.equal(nav.status, 0, nav.stderr);
    assert.deepEqual(
      nav.stdout
        .trim()
        .split("\n")
        .map((line) => line.split(/\s+/)[0]),
      ["1", "2", "2.1", "3", "3.1", "3.1.1", "3.1.2", "3.1.2.1", "3.2", "4"],
    );

    const [pathways, first, cover, vector, missing] = cite(
      "3.1",
      "2",
      "1",
      "3.2",
      "9",
    );
    assert.equal(pathways.chapter, "第 2 章 通路");
    assert.deepEqual(pathways.sections, {
      1: "2.1 概览",
      2: "2.2 细节",
      2.1: "小结",
    });
    const image = (
      n: number,
      alt: Unchecked,
      width: Unchecked,
      height: Unchecked,
    ) =>
      `<img src="IMAGE:${n}" alt="${alt}" width="${width}" height="${height}" loading="lazy">`;
    const overview = Array.from(
      { length: 30 },
      (_, i) =>
        `<p>第 ${i + 1} 段概览正文：三碳单元在后续步骤中被氧化，产生 ATP 与 NADH，这一段用来让小节之间有足够的距离。</p>`,
    ).join("");
    assert.equal(
      pathways.html,
      [
        "<h3>第 2 章 通路</h3>",
        `<p>糖酵解把葡萄糖分成两个三碳单元，第一步 ${image(0, "", 20, 20)} 消耗 ATP。</p>`,
        '<p>H<sub>2</sub>O 与 10<sup>3</sup> 保留上下标；<a href="https://example.org/pathway" target="_blank" rel="noopener noreferrer">外部资料</a>保留链接，书内交叉引用只留文字。</p>',
        `<p>自由能 ${image(1, "ΔG", 54, 20)} 用图，K=2 用文字。</p>`,
        `<figure>${image(2, "通路示意图", 480, 240)}<figcaption><p>图 2-1 两个三碳单元</p></figcaption></figure>`,
        "<p>样式与事件被去掉。</p>",
        `<h3 data-section="1">2.1 概览</h3>${overview}`,
        '<h3 data-section="2">2.2 细节</h3><p>细节正文。</p>',
        '<h4 data-section="2.1">小结</h4><p>小结正文。</p>',
      ].join(""),
    );
    const archive = (name: string) =>
      spawnSync(
        "python3",
        [
          "-I",
          "-c",
          "import sys, zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))",
          join(shelf, book),
          name,
        ],
        { env },
      ).stdout;
    assert.deepEqual(
      pathways.images.map((path: string) => readFileSync(path)),
      ["step-1.png", "eq-1.png", "figure 1.png"].map((name) =>
        archive(`OEBPS/images/${name}`),
      ),
    );
    // A chapter that starts inside a document leaves out what comes before it.
    assert.equal(
      first.html,
      '<h3>第 1 章 起点</h3><p>本章从一个问题开始。</p><h3 data-section="1">1.1 第一节</h3><p>第一节正文。</p>',
    );
    assert.deepEqual(first.images, []);
    assert.match(cover.error, /chapter 1 has no text/);
    assert.match(vector.error, /diagram\.svg is not PNG, JPEG, GIF or WebP/);
    assert.match(missing.error, /no chapter 9 in the navigation/);

    // An EPUB 2 book without a navigation document is read from its NCX.
    const rewrite = (name: string, from: string, to: string) => {
      const result = spawnSync(
        "python3",
        [
          "-I",
          "-c",
          `
import sys, zipfile
path, name, old, new = sys.argv[1:]
with zipfile.ZipFile(path) as z:
    entries = [(i, z.read(i)) for i in z.infolist()]
with zipfile.ZipFile(path, "w") as z:
    for info, data in entries:
        z.writestr(info, data.replace(old.encode(), new.encode()) if info.filename == name else data)
`,
          join(shelf, book),
          name,
          from,
          to,
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
    };
    rewrite("OEBPS/content.opf", ' properties="nav"', "");
    assert.deepEqual(cite("3.1")[0], pathways);
    rewrite("OEBPS/toc.ncx", "text/ch2.xhtml#c2", "text/ch2.xhtml#gone");
    assert.match(cite("3.1")[0].error, /ch2\.xhtml#gone not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
