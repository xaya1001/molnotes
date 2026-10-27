/** Host settings of the update service and its deploy and release commands, provided by the service unit. */
export function systemConfig(env: NodeJS.ProcessEnv = process.env) {
  const read = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not configured`);
    return value;
  };
  const githubRepository = read("MOLNOTES_GITHUB_REPOSITORY");
  return {
    checkout: read("MOLNOTES_CHECKOUT"),
    githubRepository,
    image: `ghcr.io/${githubRepository.toLowerCase()}`,
    registryUser: githubRepository.split("/")[0],
    origin: read("MOLNOTES_ORIGIN"),
    container: read("MOLNOTES_CONTAINER"),
    compose: read("MOLNOTES_COMPOSE_FILE"),
    socket: read("MOLNOTES_SYSTEM_SOCKET"),
    logs: read("MOLNOTES_DEPLOY_LOG_DIR"),
    releases: read("MOLNOTES_RELEASE_ROOT"),
    autoDeploySeconds: autoDeploySeconds(env.MOLNOTES_AUTO_DEPLOY_SECONDS),
  };
}

/** Seconds between automatic update checks; unset or empty disables them. */
function autoDeploySeconds(value: string | undefined) {
  if (value === undefined || value === "") return 0;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 60)
    throw new Error(
      "MOLNOTES_AUTO_DEPLOY_SECONDS must be an integer of at least 60",
    );
  return seconds;
}
