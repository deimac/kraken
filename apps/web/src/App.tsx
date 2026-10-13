import { Navigate, Route, Routes, useParams } from 'react-router';
import { AuthProvider, RequireRole } from './auth';
import { Institutional } from './pages/admin/Institutional';
import { KrakenPlans } from './pages/admin/KrakenPlans';
import { Partners } from './pages/admin/Partners';
import { Dashboard } from './pages/Dashboard';
import { Home, TvNotice } from './pages/Home';
import { Login } from './pages/Login';
import { AdvertiserDetail } from './pages/partner/AdvertiserDetail';
import { AdvertiserForm } from './pages/partner/AdvertiserForm';
import { Advertisers } from './pages/partner/Advertisers';
import { Plans } from './pages/partner/Plans';
import { TvAccount } from './pages/partner/TvAccount';
import { PublicPartner } from './pages/public/PublicPartner';
import { Reports } from './pages/reports/Reports';
import { SubscriptionDetail } from './pages/subscriptions/SubscriptionDetail';
import { SubscriptionForm } from './pages/subscriptions/SubscriptionForm';
import { SubscriptionList } from './pages/subscriptions/SubscriptionList';
import { Layout } from './ui';

/** Campaigns became subscriptions: keep old bookmarks working. */
function OldAddress({ base }: { base: string }) {
  const rest = useParams()['*'] ?? '';
  return <Navigate to={`${base}/assinaturas${rest ? `/${rest}` : ''}`} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/entrar" element={<Login />} />
      <Route path="/tv" element={<TvNotice />} />
      <Route path="/p/:slug" element={<PublicPartner />} />
      <Route path="/admin" element={<RequireRole role="admin"><Layout role="admin" /></RequireRole>}>
        <Route index element={<Navigate to="inicio" replace />} />
        <Route path="inicio" element={<Dashboard />} />
        <Route path="parceiros" element={<Partners />} />
        <Route path="planos-kraken" element={<KrakenPlans />} />
        <Route path="institucionais" element={<Institutional />} />
        <Route path="relatorios" element={<Reports />} />
      </Route>
      <Route path="/parceiro" element={<RequireRole role="partner_user"><Layout role="partner_user" /></RequireRole>}>
        <Route index element={<Navigate to="inicio" replace />} />
        <Route path="inicio" element={<Dashboard />} />
        <Route path="assinaturas" element={<SubscriptionList base="/parceiro" />} />
        <Route path="assinaturas/nova" element={<SubscriptionForm base="/parceiro" />} />
        <Route path="assinaturas/:id" element={<SubscriptionDetail base="/parceiro" />} />
        <Route path="campanhas/*" element={<OldAddress base="/parceiro" />} />
        <Route path="anunciantes" element={<Advertisers />} />
        <Route path="anunciantes/novo" element={<AdvertiserForm />} />
        <Route path="anunciantes/:id" element={<AdvertiserDetail />} />
        <Route path="anunciantes/:id/editar" element={<AdvertiserForm />} />
        <Route path="planos" element={<Plans />} />
        <Route path="tv" element={<TvAccount />} />
        <Route path="relatorios" element={<Reports />} />
      </Route>
      <Route path="/anunciante" element={<RequireRole role="advertiser"><Layout role="advertiser" /></RequireRole>}>
        <Route index element={<Navigate to="inicio" replace />} />
        <Route path="inicio" element={<Dashboard />} />
        <Route path="assinaturas" element={<SubscriptionList base="/anunciante" />} />
        <Route path="assinaturas/nova" element={<SubscriptionForm base="/anunciante" />} />
        <Route path="assinaturas/:id" element={<SubscriptionDetail base="/anunciante" />} />
        <Route path="campanhas/*" element={<OldAddress base="/anunciante" />} />
        <Route path="relatorios" element={<Reports />} />
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
