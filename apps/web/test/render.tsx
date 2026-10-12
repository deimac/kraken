import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App } from '../src/App';

export function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

export const partnerUser = { id: 'u1', email: 'g@a.com', role: 'partner_user', partnerId: 'p1', advertiserId: null };
export const advertiserUser = { id: 'u2', email: 'ad@a.com', role: 'advertiser', partnerId: 'p1', advertiserId: 'a1' };
export const adminUser = { id: 'u0', email: 'admin@m.com', role: 'admin', partnerId: null, advertiserId: null };
