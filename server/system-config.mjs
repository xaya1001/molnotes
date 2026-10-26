/** Host settings of the update service and its deploy and release commands, provided by the service unit. */
export function systemConfig(env = process.env) {
  const read = (name) => {
    if (!env[name]) throw new Error(`${name} is not configured`);
    return env[name];
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
  };
}
