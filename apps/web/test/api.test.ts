import { describe, expect, it } from 'vitest';
import { ApiError, api, onUnauthorized } from '../src/api';
import { errorMessage } from '../src/messages';
import { mockApi, reply } from './mock-api';

describe('api', () => {
  it('sends JSON bodies with content-type and none for empty POSTs', async () => {
    const calls = mockApi({ 'POST /api/x': { ok: 1 }, 'POST /api/y': { ok: 2 } });
    expect(await api('/api/x', { method: 'POST', body: { a: 1 } })).toEqual({ ok: 1 });
    await api('/api/y', { method: 'POST' });
    expect(calls[0]).toMatchObject({ body: { a: 1 }, contentType: 'application/json' });
    expect(calls[1]!.contentType).toBeNull();
  });

  it('throws ApiError with the server code and handles 204', async () => {
    mockApi({ 'GET /api/bad': reply(409, { error: 'invalid_state' }), 'POST /api/none': reply(204) });
    await expect(api('/api/bad')).rejects.toMatchObject({ status: 409, code: 'invalid_state' });
    expect(await api('/api/none', { method: 'POST' })).toBeUndefined();
  });

  it('notifies on 401', async () => {
    mockApi({ 'GET /api/me': reply(401, { error: 'unauthenticated' }) });
    let called = 0;
    const off = onUnauthorized(() => { called++; });
    await expect(api('/api/me')).rejects.toBeInstanceOf(ApiError);
    off();
    expect(called).toBe(1);
  });
});

describe('errorMessage', () => {
  it('translates known codes and rate limits', () => {
    expect(errorMessage(new ApiError(401, 'invalid_credentials'))).toBe('E-mail ou senha incorretos.');
    expect(errorMessage(new ApiError(429, 'invalid_request'))).toBe('Muitas tentativas. Aguarde um pouco e tente de novo.');
    expect(errorMessage(new ApiError(415, 'unsupported_media'))).toContain('MP4');
    expect(errorMessage(new Error('boom'))).toBe('Algo deu errado. Tente de novo.');
  });
});
