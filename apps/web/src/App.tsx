import { Navigate, Route, Routes } from 'react-router';
import { AuthProvider, RequireRole } from './auth';
import { CampaignList } from './pages/campaigns/CampaignList';
import { Home, TvNotice } from './pages/Home';
import { Login } from './pages/Login';
import { Plans } from './pages/partner/Plans';
import { Layout } from './ui';

function Placeholder({ title }: { title: string }) {
  return <h1>{title}</h1>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/entrar" element={<Login />} />
      <Route path="/tv" element={<TvNotice />} />
      <Route path="/admin" element={<RequireRole role="admin"><Layout role="admin" /></RequireRole>}>
        <Route path="parceiros" element={<Placeholder title="Parceiros" />} />
        <Route path="institucionais" element={<Placeholder title="Institucionais" />} />
      </Route>
      <Route path="/parceiro" element={<RequireRole role="partner_user"><Layout role="partner_user" /></RequireRole>}>
        <Route path="campanhas" element={<CampaignList base="/parceiro" />} />
        <Route path="anunciantes" element={<Placeholder title="Anunciantes" />} />
        <Route path="planos" element={<Plans />} />
        <Route path="tv" element={<Placeholder title="Conta da TV" />} />
      </Route>
      <Route path="/anunciante" element={<RequireRole role="advertiser"><Layout role="advertiser" /></RequireRole>}>
        <Route path="campanhas" element={<CampaignList base="/anunciante" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
