import { describe, expect, it } from 'vitest';
import { isValidCnpj, isValidCpf, isValidDocument, onlyDigits } from '../src/catalog/document';

describe('document validation', () => {
  it('strips non digits', () => {
    expect(onlyDigits('12.345.678/0001-95')).toBe('12345678000195');
  });
  it('validates CPF check digits', () => {
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('52998224724')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('5299822472')).toBe(false);
  });
  it('validates CNPJ check digits', () => {
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11222333000180')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });
  it('matches the person type', () => {
    expect(isValidDocument('pf', '52998224725')).toBe(true);
    expect(isValidDocument('pj', '52998224725')).toBe(false);
    expect(isValidDocument('pf', '11222333000181')).toBe(false);
    expect(isValidDocument('pj', '11222333000181')).toBe(true);
  });
});
