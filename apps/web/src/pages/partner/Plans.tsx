import { useEffect } from 'react';
import { api } from '../../api';
import { PageHeader } from '../../ui';

export function Plans() {
  useEffect(() => {
    api('/api/partner/plans').catch(() => undefined);
  }, []);
  return <PageHeader title="Planos" />;
}
