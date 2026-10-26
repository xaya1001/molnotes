import type { APIRequestContext } from "@playwright/test";
/** Test setup and validation writes still use the public conditional-write contract. */
export async function putRecords(
  request: APIRequestContext,
  endpoint: string,
  options: NonNullable<Parameters<APIRequestContext["put"]>[1]>,
) {
  const current = await request.get(endpoint);
  return request.put(endpoint, {
    ...options,
    headers: { ...options.headers, "If-Match": current.headers().etag },
  });
}
