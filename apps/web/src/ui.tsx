import {
  IconBuildingStore, IconChartBar, IconDeviceTv, IconLogout, IconReceipt, IconSpeakerphone, IconTags, IconUsersGroup,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from './auth';
import { STATUS_LABEL, statusTone } from './format';
import { ThemeToggle } from './ThemeToggle';
import type { EffectiveStatus, Role } from './types';

const NAV: Record<Exclude<Role, 'player'>, { to: string; label: string; icon: ReactNode }[]> = {
  admin: [
    { to: '/admin/parceiros', label: 'Parceiros', icon: <IconUsersGroup size={18} /> },
    { to: '/admin/planos-kraken', label: 'Planos Kraken', icon: <IconReceipt size={18} /> },
    { to: '/admin/institucionais', label: 'Institucionais', icon: <IconSpeakerphone size={18} /> },
    { to: '/admin/relatorios', label: 'Relatórios', icon: <IconChartBar size={18} /> },
  ],
  partner_user: [
    { to: '/parceiro/campanhas', label: 'Campanhas', icon: <IconSpeakerphone size={18} /> },
    { to: '/parceiro/anunciantes', label: 'Anunciantes', icon: <IconBuildingStore size={18} /> },
    { to: '/parceiro/planos', label: 'Planos de anúncio', icon: <IconTags size={18} /> },
    { to: '/parceiro/tv', label: 'Conta da TV', icon: <IconDeviceTv size={18} /> },
    { to: '/parceiro/relatorios', label: 'Relatórios', icon: <IconChartBar size={18} /> },
  ],
  advertiser: [
    { to: '/anunciante/campanhas', label: 'Minhas campanhas', icon: <IconSpeakerphone size={18} /> },
    { to: '/anunciante/relatorios', label: 'Relatórios', icon: <IconChartBar size={18} /> },
  ],
};

export function Layout({ role }: { role: Exclude<Role, 'player'> }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="shell">
      <nav className="side" aria-label="Menu principal">
        <div className="brand"><img className="brand-mark" src="/kraken-symbol.png" alt="" />Kraken Ads</div>
        {NAV[role].map((item) => (
          <NavLink key={item.to} to={item.to} className="nav-link">
            {item.icon}
            {item.label}
          </NavLink>
        ))}
        <div className="side-foot">
          <span>{user?.email}</span>
          <div className="side-actions">
            <ThemeToggle />
            <button
              type="button"
              className="btn-icon"
              aria-label="Sair"
              onClick={async () => {
                await logout();
                navigate('/entrar');
              }}
            >
              <IconLogout size={18} />
            </button>
          </div>
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

export function Badge({ status }: { status: EffectiveStatus }) {
  return <span className={`badge badge-${statusTone(status)}`}>{STATUS_LABEL[status]}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Notice({ kind, children }: { kind: 'error' | 'ok' | 'info'; children: ReactNode }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {action}
    </div>
  );
}
