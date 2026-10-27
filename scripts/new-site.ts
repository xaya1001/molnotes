import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { resolve } from "node:path";
import { siteGroups } from "../shared/site-catalog.ts";
import { setting } from "../shared/settings.ts";
const [slug, title, description, group] = process.argv.slice(2);
if (
  !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? "") ||
  !title?.trim() ||
  !description?.trim() ||
  !siteGroups.includes(group)
)
  throw new Error(
    `Usage: npm run site:new -- <slug> "<title>" "<description>" <${siteGroups.join("|")}>`,
  );
const root = setting("MOLNOTES_CONTENT_DIR");
const destination = resolve(root, "sites", slug);
if (existsSync(destination)) throw new Error(`Site already exists: ${slug}`);
const siteRoot = resolve(root, "sites");
let order = 1;
if (existsSync(siteRoot))
  for (const name of readdirSync(siteRoot)) {
    const file = resolve(siteRoot, name, "site.json");
    if (existsSync(file))
      order = Math.max(order, JSON.parse(readFileSync(file, "utf8")).order + 1);
  }
mkdirSync(resolve(destination, "static"), { recursive: true });
writeFileSync(
  resolve(destination, "site.json"),
  JSON.stringify({ title, description, order, group }, null, 2) + "\n",
);
writeFileSync(
  resolve(destination, "content.json"),
  readFileSync(
    new URL("../toolbox/templates/site/content.json", import.meta.url),
  ),
);
console.log(`Created ${destination}`);
