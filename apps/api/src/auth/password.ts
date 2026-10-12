import { hash, verify } from '@node-rs/argon2';

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Spends the same time as a real verification so unknown e-mails are not detectable by timing.
let dummyHash: Promise<string> | undefined;
export async function dummyVerify(password: string): Promise<false> {
  dummyHash ??= hash('midora-dummy-password');
  await verifyPassword(await dummyHash, password);
  return false;
}
