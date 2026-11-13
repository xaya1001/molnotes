import { readdirSync, readFileSync } from "node:fs";
import type { ConformationData } from "../shared/chemical-templates/conformation.ts";

const root = new URL("../shared/chemical-templates/", import.meta.url);
export function templateDataFiles() {
  return ["conformations", "scaffolds"].flatMap((dir) =>
    readdirSync(new URL(`${dir}/`, root))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => `shared/chemical-templates/${dir}/${name}`),
  );
}
function read<T>(directory: string): T[] {
  return templateDataFiles()
    .filter((file) => file.includes(`/${directory}/`))
    .map((file) =>
      JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")),
    );
}
export const conformations = new Map(
  read<ConformationData>("conformations").map((data) => [data.id, data]),
);
export interface ScaffoldData {
  id: string;
  smiles: string;
  smarts: string;
  conformer: { xyz: [number, number, number][] };
  views: {
    perspective: { camera: number[][]; depth_width: [number, number] };
    flat: {
      engine: string;
      xy?: [number, number][];
      overpasses?: [number, number][];
      outward?: Record<string, [number, number]>;
    };
  };
}
export const scaffolds = read<ScaffoldData>("scaffolds").sort(
  (a, b) =>
    b.conformer.xyz.length - a.conformer.xyz.length || a.id.localeCompare(b.id),
);
