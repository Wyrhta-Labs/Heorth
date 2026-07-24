const BASE_URL = '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const TOKEN_KEY = 'he_jwt';

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}, parse: 'json' | 'text' = 'json'): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  if (options.headers) Object.assign(headers, options.headers);

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    if (window.location.pathname !== '/login') window.location.href = '/login';
    throw new ApiError(401, 'UNAUTHORIZED', 'Session expired');
  }

  if (parse === 'text') {
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, 'UNKNOWN', text || 'Request failed');
    return text as unknown as T;
  }

  const json = await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, json.error?.code ?? 'UNKNOWN', json.error?.message ?? 'Request failed');
  }
  return json as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}
export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}
export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}
export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}
export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}
/** GET returning text/plain or text/csv (Feoh export). */
export function apiGetText(path: string): Promise<string> {
  return request<string>(path, {}, 'text');
}
/** POST raw text body (Feoh CSV import); overrides the JSON content-type. */
export function apiPostText<T>(path: string, text: string): Promise<T> {
  return request<T>(path, { method: 'POST', body: text, headers: { 'Content-Type': 'text/csv' } });
}

/** Build a `?a=b` query string, skipping empty values. */
export function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
