export type PersonType = 'pf' | 'pj';

export const onlyDigits = (s: string): string => s.replace(/\D/g, '');

const allSame = (d: string) => /^(\d)\1*$/.test(d);

function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((acc, w, i) => acc + Number(digits[i]) * w, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCpf(d: string): boolean {
  if (!/^\d{11}$/.test(d) || allSame(d)) return false;
  const first = checkDigit(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(d[9]) && second === Number(d[10]);
}

export function isValidCnpj(d: string): boolean {
  if (!/^\d{14}$/.test(d) || allSame(d)) return false;
  const first = checkDigit(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(d[12]) && second === Number(d[13]);
}

/** CPF for individuals (pf), CNPJ for companies (pj); digits only. */
export const isValidDocument = (type: PersonType, d: string): boolean => (type === 'pf' ? isValidCpf(d) : isValidCnpj(d));
