import { execFileSync } from "node:child_process";
import { publishedImage } from "../server/system/release-image.ts";

const [repository, revision, tag] = process.argv.slice(2);
if (!repository || !revision || !tag)
  throw new Error("usage: repository revision tag");
const inspect = execFileSync("docker", ["image", "inspect", tag], {
  encoding: "utf8",
});
const images = JSON.parse(inspect);
if (images.length !== 1) throw new Error("expected one published image");
process.stdout.write(
  `${publishedImage(repository, revision, JSON.stringify(images[0]))}\n`,
);
