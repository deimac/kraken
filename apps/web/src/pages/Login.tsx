import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { homeFor, useAuth } from '../auth';
import { errorMessage } from '../messages';
import { ThemeToggle } from '../ThemeToggle';
import { Field, Notice } from '../ui';

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      const back = params.get('voltar');
      navigate(back && back.startsWith('/') ? back : homeFor(u), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <div className="card auth-card">
        <div className="page-header">
          <h1>Entrar</h1>
          <ThemeToggle />
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <form className="form" onSubmit={submit}>
          <Field label="E-mail">
            <input type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Senha">
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <button className="btn btn-primary" type="submit" disabled={busy}>Entrar</button>
        </form>
      </div>
    </div>
  );
}
