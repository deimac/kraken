import { describe, expect, it } from 'vitest';
import { digits, formatDocument, formatPlanPrice, maskDocument, maskPhone, maskZip, periodEnd, planLimits } from '../src/format';

describe('input masks', () => {
  it('masks CPF and CNPJ progressively', () => {
    expect(maskDocument('pf', '529982')).toBe('529.982');
    expect(maskDocument('pf', '52998224725')).toBe('529.982.247-25');
    expect(maskDocument('pf', '529.982.247-2599')).toBe('529.982.247-25');
    expect(maskDocument('pj', '1122233')).toBe('11.222.33');
    expect(maskDocument('pj', '11222333000181')).toBe('11.222.333/0001-81');
  });
  it('masks CEP and phones', () => {
    expect(maskZip('01001000')).toBe('01001-000');
    expect(maskZip('0100')).toBe('0100');
    expect(maskPhone('11987654321')).toBe('(11) 98765-4321');
    expect(maskPhone('1133334444')).toBe('(11) 3333-4444');
    expect(maskPhone('11')).toBe('(11');
  });
  it('extracts digits and formats stored documents', () => {
    expect(digits('11.222.333/0001-81')).toBe('11222333000181');
    expect(formatDocument('52998224725')).toBe('529.982.247-25');
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatDocument(null)).toBe('');
  });
});

describe('plan formatting', () => {
  it('formats price by period', () => {
    expect(formatPlanPrice(30000, 1)).toMatch(/^R\$\s?300,00\/mês$/);
    expect(formatPlanPrice(360000, 12)).toMatch(/^R\$\s?3\.600,00\/ano$/);
    expect(formatPlanPrice(150000, 6)).toMatch(/^R\$\s?1\.500,00 por 6 meses$/);
    expect(formatPlanPrice(0, 1)).toBe('Sob consulta');
  });
  it('describes limits', () => {
    expect(planLimits({ maxVideos: 2, maxImages: 3, maxVideoSeconds: 30 })).toBe('Até 2 vídeos de até 30 s · até 3 imagens');
    expect(planLimits({ maxVideos: 1, maxImages: 0, maxVideoSeconds: 15 })).toBe('Até 1 vídeo de até 15 s');
    expect(planLimits({ maxVideos: 0, maxImages: 1, maxVideoSeconds: 30 })).toBe('Até 1 imagem');
  });
});

describe('periodEnd', () => {
  it('ends the day before the same date of the following period, clamping short months', () => {
    expect(periodEnd('2026-11-01', 1)).toBe('2026-11-30');
    expect(periodEnd('2026-10-15', 12)).toBe('2027-10-14');
    expect(periodEnd('2027-01-31', 1)).toBe('2027-02-27');
  });
});
