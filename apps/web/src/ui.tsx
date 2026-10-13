import {
  IconBuildingStore, IconChartBar, IconDeviceTv, IconHome, IconLogout, IconReceipt, IconReceipt2, IconSearch, IconSpeakerphone, IconTags, IconUsersGroup,
} from '@tabler/icons-react';
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from './auth';
import { STATUS_LABEL, statusTone } from './format';
import { ThemeToggle } from './ThemeToggle';
import type { EffectiveStatus, Role } from './types';

const NAV: Record<Exclude<Role, 'player'>, { to: string; label: string; icon: ReactNode }[]> = {
  admin: [
    { to: '/admin/inicio', label: 'Início', icon: <IconHome size={18} /> },
    { to: '/admin/parceiros', label: 'Parceiros', icon: <IconUsersGroup size={18} /> },
    { to: '/admin/planos-kraken', label: 'Planos Kraken', icon: <IconReceipt size={18} /> },
    { to: '/admin/institucionais', label: 'Institucionais', icon: <IconSpeakerphone size={18} /> },
    { to: '/admin/relatorios', label: 'Relatórios', icon: <IconChartBar size={18} /> },
  ],
  partner_user: [
    { to: '/parceiro/inicio', label: 'Início', icon: <IconHome size={18} /> },
    { to: '/parceiro/assinaturas', label: 'Assinaturas', icon: <IconReceipt2 size={18} /> },
    { to: '/parceiro/anunciantes', label: 'Anunciantes', icon: <IconBuildingStore size={18} /> },
    { to: '/parceiro/planos', label: 'Planos de anúncio', icon: <IconTags size={18} /> },
    { to: '/parceiro/tv', label: 'Conta da TV', icon: <IconDeviceTv size={18} /> },
    { to: '/parceiro/relatorios', label: 'Relatórios', icon: <IconChartBar size={18} /> },
  ],
  advertiser: [
    { to: '/anunciante/inicio', label: 'Início', icon: <IconHome size={18} /> },
    { to: '/anunciante/assinaturas', label: 'Minhas assinaturas', icon: <IconReceipt2 size={18} /> },
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

export function StatCard({ icon, label, value, hint }: { icon?: ReactNode; label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="stat">
      {icon && <div className="stat-icon" aria-hidden="true">{icon}</div>}
      <div>
        <span className="stat-label">{label}</span>
        <strong className="stat-value">{value}</strong>
        {hint && <span className="stat-hint">{hint}</span>}
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="search">
      <IconSearch size={16} aria-hidden="true" />
      <input type="search" aria-label="Buscar" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon" aria-hidden="true">{icon}</div>}
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function IconButton({ icon, label, className = 'btn', ...rest }: { icon: ReactNode; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={className} {...rest}>
      {icon}
      {label}
    </button>
  );
}

export function ConfirmDialog(props: {
  open: boolean; title: string; children?: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const { open, title, children, confirmLabel, danger, busy, onConfirm, onCancel } = props;
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        {children && <div className="dialog-body">{children}</div>}
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>Cancelar</button>
          <button type="button" className={danger ? 'btn btn-danger-solid' : 'btn btn-primary'} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const num = (v: number) => v.toLocaleString('pt-BR');

/**
 * Single-series bar chart (no legend: the caption names the series). The bars are visual only, with a mouse tooltip;
 * screen readers and keyboard users get the same numbers from the table, so there are no extra tab stops.
 */
export function BarChart({ label, data, format = (s) => s }: {
  label: string; data: { label: string; value: number }[]; format?: (label: string) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const captionId = useId();
  const max = Math.max(1, ...data.map((d) => d.value));
  // Keep axis labels readable: at most ~8 of them, always including the last day.
  const every = Math.max(1, Math.ceil(data.length / 8));
  return (
    <figure className="chart" aria-labelledby={captionId}>
      <figcaption id={captionId} className="visually-hidden">{label}</figcaption>
      <div aria-hidden="true">
        <div className="chart-max">{num(max)}</div>
        <div className="chart-plot" onMouseLeave={() => setActive(null)}>
          {data.map((d, i) => (
            <div key={d.label} className="chart-col" data-label={d.label} onMouseEnter={() => setActive(i)}>
              <div className="chart-bar" style={{ height: `${(d.value / max) * 100}%` }} />
              {active === i && <div className="chart-tip">{format(d.label)}: {num(d.value)}</div>}
            </div>
          ))}
        </div>
        <div className="chart-axis">
          {data.map((d, i) => <span key={d.label}>{(data.length - 1 - i) % every === 0 ? format(d.label) : ''}</span>)}
        </div>
      </div>
      <table className="visually-hidden">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}><th scope="row">{format(d.label)}</th><td>{num(d.value)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
