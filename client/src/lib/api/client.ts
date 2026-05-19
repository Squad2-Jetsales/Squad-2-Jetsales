// Typed fetch wrapper for the JetGO Node REST API.
// Auth is cookie-based (httpOnly) — set by the backend. The frontend never
// reads, writes, or decodes tokens. credentials: 'include' attaches them.

export class ApiError extends Error {
  status: number;
  code?: string;
  fields?: Record<string, string>;

  constructor(message: string, status: number, code?: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const API_PREFIX = "/api/v1";

const STATE_CHANGING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]!) : null;
}

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE_URL}${API_PREFIX}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: buildCsrfHeader("POST"),
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function buildCsrfHeader(method: string): Record<string, string> {
  if (!STATE_CHANGING.has(method.toUpperCase())) return {};
  const token = readCookie("csrf_token");
  return token ? { "X-CSRF-Token": token } : {};
}

type LogoutHandler = () => void;
let onForceLogout: LogoutHandler | null = null;
export function registerForceLogoutHandler(fn: LogoutHandler | null): void {
  onForceLogout = fn;
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** internal — used by retry path */
  _isRetry?: boolean;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  // API_BASE_URL pode ser vazio quando o frontend usa rewrite proxy
  // (ex.: Vercel reescreve /api/* pro Render). Nesse caso a request sai
  // do próprio origin do front — cookies viram first-party e o navegador
  // não bloqueia. Quando VITE_API_BASE_URL está setado, o request vai
  // direto cross-site (modo dev / quem usar fora da Vercel).
  const method = (options.method ?? "GET").toUpperCase();
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...buildCsrfHeader(method),
    ...(options.headers as Record<string, string> | undefined),
  };

  let body: BodyInit | undefined;
  if (options.body !== undefined && options.body !== null) {
    if (isFormData) {
      body = options.body as FormData;
    } else {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
      body = JSON.stringify(options.body);
    }
  }

  const url = `${API_BASE_URL}${API_PREFIX}${path}`;
  const res = await fetch(url, {
    ...options,
    method,
    headers,
    body,
    credentials: "include",
    cache: "no-store",
  });

  if (res.status === 401 && !options._isRetry && !path.startsWith("/auth/")) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return apiFetch<T>(path, { ...options, _isRetry: true });
    }
    if (onForceLogout) onForceLogout();
    throw new ApiError("Sessão expirada", 401, "UNAUTHORIZED");
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!res.ok) {
    const p = (payload ?? {}) as { error?: string; code?: string; fields?: Record<string, string> };
    throw new ApiError(p.error ?? res.statusText ?? "Erro na requisição", res.status, p.code, p.fields);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, init?: ApiFetchOptions) => apiFetch<T>(path, { ...init, method: "GET" }),
  post: <T>(path: string, body?: unknown, init?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...init, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, init?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...init, method: "PATCH", body }),
  put: <T>(path: string, body?: unknown, init?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...init, method: "PUT", body }),
  delete: <T>(path: string, init?: ApiFetchOptions) => apiFetch<T>(path, { ...init, method: "DELETE" }),
};

export const apiBaseUrl = API_BASE_URL;
