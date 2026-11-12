export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers:
        init?.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : undefined,
      signal: controller.signal,
    });
    const data = await response.json();
    if (response.status === 401) {
      // Reload the document to discard private client state after session expiry.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login");
      throw new RequestError("Please sign in again.", 401);
    }
    if (response.status === 403) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/not-authorized");
      throw new RequestError("This account is not authorized.", 403);
    }
    if (!response.ok)
      throw new RequestError(
        data.error || "Something went wrong. Please try again.",
        response.status,
      );
    return data as T;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(
      "We couldn’t confirm the connection. Refresh to check whether your change was saved.",
      0,
    );
  } finally {
    clearTimeout(timeout);
  }
}
