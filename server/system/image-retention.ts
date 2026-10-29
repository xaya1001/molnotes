import { deploymentFailure } from "./deploy-command.ts";

type Command = (name: string, file: string, args: string[]) => Promise<string>;

/** Retain the deployed image and its rollback target within one repository. */
export async function retainImages(
  run: Command,
  repository: string,
  current: string,
  previous: string,
) {
  const removed: string[] = [];
  const failures: { image: string | null; reason: string }[] = [];
  let kept: string[] = [];
  try {
    kept = (
      await run("images.keep", "docker", [
        "image",
        "inspect",
        current,
        previous,
        "--format",
        "{{.Id}}",
      ])
    ).split("\n");
    const listed = await run("images.list", "docker", [
      "image",
      "ls",
      "--no-trunc",
      "--format",
      "{{json .}}",
      repository,
    ]);
    const candidates = new Set<string>();
    for (const line of listed.split("\n").filter(Boolean)) {
      const image = JSON.parse(line);
      if (image.Repository === repository && !kept.includes(image.ID))
        candidates.add(image.ID);
    }
    for (const image of candidates) {
      try {
        await run("images.remove", "docker", ["image", "rm", image]);
        removed.push(image);
      } catch (error) {
        failures.push({ image, reason: deploymentFailure(error).reason });
      }
    }
  } catch (error) {
    failures.push({ image: null, reason: deploymentFailure(error).reason });
  }
  return { kept: [...new Set(kept)], removed, failures };
}
