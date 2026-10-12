import { describe, expect, it } from 'vitest';
import { digits, formatDocument, maskDocument, maskPhone, maskZip } from '../src/format';

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
