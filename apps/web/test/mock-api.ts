import { vi } from 'vitest';

type Reply = { __reply: true; status: number; json?: unknown };
export const reply = (status: number, json?: unknown): Reply => ({ __reply: true, status, json });
type Handler = unknown | ((body: unknown) => unknown);
export interface Call { method: string; path: string; body: unknown; form: FormData | null; contentType: string | null }

/** Stubs global fetch. Keys are "METHOD /path" (query string optional in the key). */
export function mockApi(routes: Record<string, Handler>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const method = (init.method ?? 'GET').toUpperCase();
      const path = String(input);
      const headers = new Headers(init.headers);
      const form = init.body instanceof FormData ? init.body : null;
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body, form, contentType: headers.get('content-type') });
      const handler = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`];
      if (handler === undefined) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      const out = await (typeof handler === 'function' ? (handler as (b: unknown) => unknown)(body ?? form) : handler);
      const r: Reply = out && typeof out === 'object' && '__reply' in out ? (out as Reply) : reply(200, out);
      if (r.status === 204) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(r.json ?? {}), { status: r.status, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}
