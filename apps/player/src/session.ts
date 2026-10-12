import { ApiError, api } from './api';

/** Only an explicit "not signed in" sends the TV to the login screen; outages keep it playing. */
export async function isTvSession(): Promise<boolean> {
  try {
    const r = await api<{ user: { role: string } }>('/api/auth/me');
    return r.user.role === 'player';
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return false;
    return true;
  }
}
