/**
 * Thin client for the PressFlow FastAPI service. The browser only calls
 * same-origin /api/v1/*; Next.js rewrites it to PRESSFLOW_API_URL, so the API
 * location and every credential stay server-side.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: unknown,
  ) {
    super(message);
  }
}

/** The API could not be reached at all (not started, proxy error). */
export class ApiUnavailableError extends Error {
  constructor() {
    super("The PressFlow API is not reachable. Start the API service (see README) or continue in the demo workspace.");
  }
}

function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as { detail?: unknown; message?: unknown };
    if (typeof b.detail === "string") return b.detail;
    if (Array.isArray(b.detail) && b.detail[0] && typeof b.detail[0] === "object" && "msg" in b.detail[0]) return String((b.detail[0] as { msg: unknown }).msg);
    if (typeof b.message === "string") return b.message;
  }
  return fallback;
}

export async function apiFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      credentials: "include",
      ...rest,
      headers: { Accept: "application/json", ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiUnavailableError();
  }
  // The Next.js rewrite answers 500/502/504 with an HTML page when the upstream is down.
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok && !type.includes("application/json") && res.status >= 500) throw new ApiUnavailableError();
  if (res.status === 204) return undefined as T;
  const body = type.includes("application/json") ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(messageFrom(body, `Request failed (${res.status})`), res.status, body);
  return body as T;
}

export async function apiUpload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/v1${path}`);
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    // A dropped upload isn't proof the API is down: the proxy may have cut off
    // a large body. Ask the API before blaming it.
    const transportFailure = async (status?: number) => {
      if (!(await apiHealth())) return reject(new ApiUnavailableError());
      reject(new ApiError(`The upload didn't reach the API${status ? ` (HTTP ${status})` : ""}. The file may be larger than the server accepts, or the connection was interrupted — try again, or check the web server log.`, status ?? 0));
    };
    xhr.onerror = () => void transportFailure();
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as T);
      else if (xhr.status >= 500 && !xhr.response) void transportFailure(xhr.status);
      else reject(new ApiError(messageFrom(xhr.response, `Upload failed (${xhr.status})`), xhr.status, xhr.response));
    };
    xhr.send(form);
  });
}

export interface IntegrationStatus {
  key: string;
  label: string;
  configured: boolean;
  available: boolean;
  detail?: string;
  docsHint?: string;
  /** A step the user can take from Settings to make this available. */
  action?: "connect_google" | null;
}

export async function apiHealth(): Promise<boolean> {
  try {
    await apiFetch("/health");
    return true;
  } catch {
    return false;
  }
}
