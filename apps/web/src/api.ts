export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const unauthorizedListeners = new Set<() => void>();
export function onUnauthorized(fn: () => void): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const init: RequestInit = { method: opts.method ?? 'GET', credentials: 'same-origin' };
  if (opts.form) {
    init.body = opts.form;
  } else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401) unauthorizedListeners.forEach((fn) => fn());
    throw new ApiError(res.status, data.error ?? 'internal');
  }
  return data as T;
}
