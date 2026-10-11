const REDACT_PATHS = [
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
];

export function loggerOptions(level: string, stream?: { write(msg: string): void }) {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(stream ? { stream } : {}),
  };
}
