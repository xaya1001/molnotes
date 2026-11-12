import { readFile } from "node:fs/promises";
import { create } from "fontkit";
import type {
  FigureFont,
  FigureFontResolver,
} from "../src/ui/library/font-geometry.ts";
import type { FigureTextRun } from "../shared/chemical-library/geometry.ts";

const arimoSubsets = [
  "latin",
  "latin-ext",
  "greek",
  "greek-ext",
  "cyrillic",
  "cyrillic-ext",
  "hebrew",
  "vietnamese",
];
const notoSubsets = [
  "chinese-simplified",
  "latin",
  "latin-ext",
  "cyrillic",
  "vietnamese",
];
let pending: Promise<FigureFontResolver> | undefined;

/** Load pinned build dependencies once. Font files never enter a reader bundle. */
export function loadFigureFonts() {
  return (pending ??= (async () => {
    const faces = new Map<string, FigureFont[]>();
    const loaded = new Map<string, Promise<FigureFont>>();
    const load = (file: string) => {
      if (!loaded.has(file))
        loaded.set(
          file,
          (async () => {
            const bytes = await readFile(new URL(import.meta.resolve(file)));
            const font = create(bytes);
            if (!("layout" in font))
              throw new Error(`Expected a single font: ${file}`);
            return { id: file, font };
          })(),
        );
      return loaded.get(file)!;
    };
    for (const weight of [400, 700])
      for (const italic of [false, true]) {
        const files = [
          ...arimoSubsets.map(
            (subset) =>
              `@fontsource/arimo/files/arimo-${subset}-${weight}-${italic ? "italic" : "normal"}.woff2`,
          ),
          ...notoSubsets.map(
            (subset) =>
              `@fontsource/noto-sans-sc/files/noto-sans-sc-${subset}-${weight}-normal.woff2`,
          ),
        ];
        const fonts = await Promise.all(files.map(load));
        faces.set(`${weight}:${italic}`, fonts);
      }
    return (run: FigureTextRun, character: string) => {
      const code = character.codePointAt(0)!;
      const face = faces
        .get(`${run.weight}:${run.italic}`)!
        .find(({ font }) => font.hasGlyphForCodePoint(code));
      if (!face)
        throw new Error(
          `Figure fonts lack U+${code.toString(16).toUpperCase()}`,
        );
      return face;
    };
  })());
}
