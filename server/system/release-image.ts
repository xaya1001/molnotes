export function publishedImage(
  repository: string,
  revision: string,
  inspectJson: string,
): string {
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("invalid revision");
  const inspected = JSON.parse(inspectJson);
  if (
    inspected.Config?.Labels?.["org.opencontainers.image.revision"] !==
      revision ||
    inspected.Os !== "linux" ||
    inspected.Architecture !== "arm64"
  ) {
    throw new Error("published image does not match revision or platform");
  }
  const matches = inspected.RepoDigests?.filter((value: string) =>
    new RegExp(
      `^${repository.replaceAll(".", "\\.")}@sha256:[0-9a-f]{64}$`,
    ).test(value),
  );
  if (matches?.length !== 1) {
    throw new Error("published image has no unique repository digest");
  }
  return matches[0];
}
