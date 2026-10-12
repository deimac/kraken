import { Navigate } from 'react-router';
import { homeFor, useAuth } from '../auth';

export function Home() {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-page muted">Carregando…</div>;
  return <Navigate to={user ? homeFor(user) : '/entrar'} replace />;
}

export function TvNotice() {
  return (
    <div className="center-page">
      <div className="card auth-card">
        <h1>Conta da TV</h1>
        <p className="muted">Esta conta é usada pelo player. Na TV, abra o endereço <a href="/player/">/player</a>.</p>
      </div>
    </div>
  );
}
