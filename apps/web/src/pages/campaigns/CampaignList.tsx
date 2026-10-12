import { useEffect } from 'react';
import { api } from '../../api';
import { PageHeader } from '../../ui';

export function CampaignList({ base }: { base: '/parceiro' | '/anunciante' }) {
  useEffect(() => {
    api('/api/campaigns').catch(() => undefined);
  }, []);
  return <PageHeader title={base === '/parceiro' ? 'Campanhas' : 'Minhas campanhas'} />;
}
