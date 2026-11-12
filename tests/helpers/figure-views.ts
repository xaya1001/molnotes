import type { Page } from "@playwright/test";
import type {
  FigureReference,
  LibrarySnapshot,
} from "../../shared/chemical-library/types.ts";
import { prepareFigureViews } from "../../scripts/content/figure-build.ts";
import { figureProofReferences } from "../../scripts/content/figure-proofs.ts";

/** Fixtures expose the same published SVG boundary as the content builder. */
export async function serveFigureViews(
  page: Page,
  library: LibrarySnapshot,
  references: FigureReference[] = [],
) {
  const prepared = await prepareFigureViews(
    library.entries,
    figureProofReferences(library.entries, references),
    ".",
  );
  library.renders = prepared.renders;
  for (const asset of prepared.assets)
    await page.route(`**/library/${asset.path}`, (route) =>
      route.fulfill({ body: asset.bytes, contentType: asset.content_type }),
    );
  return library;
}
