import { fileURLToPath } from 'node:url';

/**
 * Local convenience only, and only when the variable is absent, so an explicitly set
 * environment always wins over the file. CI sets DATABASE_URL directly.
 */
export function loadDatabaseUrl(): string | undefined {
  if (process.env['DATABASE_URL'] === undefined) {
    try {
      process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
    } catch {
      // No .env file. Callers decide whether that is fatal.
    }
  }

  const url = process.env['DATABASE_URL'];
  return url === undefined || url === '' ? undefined : url;
}

export function requireDatabaseUrl(): string {
  const url = loadDatabaseUrl();
  if (url === undefined) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env, and run `pnpm db:up` first.',
    );
  }
  return url;
}
