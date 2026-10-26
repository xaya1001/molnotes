import { isMainModule } from "../server/main-module.mjs";

/** A pushed tag alone does not prove that its image passed smoke and browser checks. */
export function assertCheckedParent(runs, revision) {
  const latest = runs
    .filter(
      (run) =>
        run.head_sha === revision &&
        run.head_branch === "main" &&
        run.event === "push",
    )
    .sort((a, b) => b.id - a.id)[0];
  if (latest?.status !== "completed" || latest.conclusion !== "success")
    throw new Error(
      "Parent revision has no successful main Check; refusing image reuse",
    );
}

if (isMainModule(import.meta.url)) {
  const revision = process.argv[2];
  if (!/^[a-f0-9]{40}$/.test(revision ?? ""))
    throw new Error("Invalid parent revision");
  const url = new URL(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/check.yml/runs`,
  );
  url.search = new URLSearchParams({
    head_sha: revision,
    event: "push",
    branch: "main",
    per_page: "100",
  }).toString();
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!response.ok)
    throw new Error(`Parent Check lookup failed (${response.status})`);
  assertCheckedParent((await response.json()).workflow_runs, revision);
}
