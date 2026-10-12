export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  // A half-open connection must not stall polling forever on an unattended TV.
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000) : undefined;
  const init: RequestInit = { method: opts.method ?? 'GET', credentials: 'same-origin', signal: controller?.signal };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { 'content-type': 'application/json' };
  }
  let res: Response;
  let data: { error?: string };
  try {
    res = await fetch(path, init);
    data = res.status === 204 ? {} : ((await res.json().catch(() => ({}))) as { error?: string });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'internal');
  return data as T;
}
