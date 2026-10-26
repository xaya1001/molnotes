export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
/** Read same-origin JSON without reusing a stale response. */
export async function api<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const body = await response.json();
      if (typeof body.error === "string") message = body.error;
    } catch {
      /* Use status. */
    }
    throw new ApiError(message, response.status);
  }
  return response.json();
}
/** Initial content must load before mounting a page. A failed load can be retried. */
export function boot(load: () => Promise<void>) {
  const host = document.querySelector("#app");
  if (!host) return;
  async function run() {
    host!.replaceChildren(
      Object.assign(document.createElement("p"), {
        textContent: "正在加载…",
        className: "page-reading",
      }),
    );
    try {
      await load();
    } catch (error) {
      const message = Object.assign(document.createElement("p"), {
        textContent: error instanceof Error ? error.message : "加载失败",
      });
      message.setAttribute("role", "alert");
      const retry = Object.assign(document.createElement("button"), {
        textContent: "重试",
        className: "button",
      });
      retry.onclick = () => void run();
      host!.replaceChildren(message, retry);
    }
  }
  void run();
}
