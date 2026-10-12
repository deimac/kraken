import { Navigate, Route, Routes } from 'react-router';
import { AuthProvider, RequireRole } from './auth';
import { Institutional } from './pages/admin/Institutional';
import { MidoraPlans } from './pages/admin/MidoraPlans';
import { Partners } from './pages/admin/Partners';
import { CampaignDetail } from './pages/campaigns/CampaignDetail';
import { CampaignForm } from './pages/campaigns/CampaignForm';
import { CampaignList } from './pages/campaigns/CampaignList';
import { Home, TvNotice } from './pages/Home';
import { Login } from './pages/Login';
import { Advertisers } from './pages/partner/Advertisers';
import { Plans } from './pages/partner/Plans';
import { TvAccount } from './pages/partner/TvAccount';
import { PublicPartner } from './pages/public/PublicPartner';
import { Layout } from './ui';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/entrar" element={<Login />} />
      <Route path="/tv" element={<TvNotice />} />
      <Route path="/p/:slug" element={<PublicPartner />} />
      <Route path="/admin" element={<RequireRole role="admin"><Layout role="admin" /></RequireRole>}>
        <Route index element={<Navigate to="parceiros" replace />} />
        <Route path="parceiros" element={<Partners />} />
        <Route path="planos-midora" element={<MidoraPlans />} />
        <Route path="institucionais" element={<Institutional />} />
      </Route>
      <Route path="/parceiro" element={<RequireRole role="partner_user"><Layout role="partner_user" /></RequireRole>}>
        <Route index element={<Navigate to="campanhas" replace />} />
        <Route path="campanhas" element={<CampaignList base="/parceiro" />} />
        <Route path="campanhas/nova" element={<CampaignForm base="/parceiro" />} />
        <Route path="campanhas/:id" element={<CampaignDetail base="/parceiro" />} />
        <Route path="anunciantes" element={<Advertisers />} />
        <Route path="planos" element={<Plans />} />
        <Route path="tv" element={<TvAccount />} />
      </Route>
      <Route path="/anunciante" element={<RequireRole role="advertiser"><Layout role="advertiser" /></RequireRole>}>
        <Route index element={<Navigate to="campanhas" replace />} />
        <Route path="campanhas" element={<CampaignList base="/anunciante" />} />
        <Route path="campanhas/nova" element={<CampaignForm base="/anunciante" />} />
        <Route path="campanhas/:id" element={<CampaignDetail base="/anunciante" />} />
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
