import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..');

// SKIP_ENV_FILE=1 → .env se nenačte (používají testy, aby nesahaly na skutečná data).
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath) && !process.env.SKIP_ENV_FILE) process.loadEnvFile(envPath);

const env = process.env;
const isProduction = env.NODE_ENV === 'production';
const port = Number(env.PORT) || 3000;
const warnings = [];

const list = (value, separator = /[\s,]+/) => (value || '').split(separator).map((s) => s.trim()).filter(Boolean);

const dataDir = path.resolve(ROOT, env.DATA_DIR || './data');
fs.mkdirSync(dataDir, { recursive: true });

/**
 * Tajný klíč pro podepisování přihlášení a šifrování tokenů Google.
 * Když není v .env, vygeneruje se jednou do DATA_DIR/.secret (nesmí se ztratit).
 */
function loadSecret() {
  if ((env.SESSION_SECRET || '').length >= 32) return env.SESSION_SECRET;
  const file = path.join(dataDir, '.secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  if (isProduction) warnings.push(`SESSION_SECRET není nastavené – vygeneroval jsem ho do ${file}. Zálohujte ho spolu s databází.`);
  return secret;
}

const baseUrl = (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');

const google = {
  clientId: (env.GOOGLE_CLIENT_ID || '').trim(),
  clientSecret: (env.GOOGLE_CLIENT_SECRET || '').trim(),
  redirectUri: `${baseUrl}/auth/google/callback`,
};
google.enabled = Boolean(google.clientId && google.clientSecret);
if (!google.enabled) {
  warnings.push('GOOGLE_CLIENT_ID a GOOGLE_CLIENT_SECRET nejsou nastavené – připojení Google Kalendáře a přihlášení přes Google jsou vypnuté.');
}

if (isProduction && !env.OPERATOR_NAME) {
  warnings.push('OPERATOR_NAME není nastavené – v Podmínkách a Ochraně osobních údajů zůstanou místo údajů provozovatele závorky [DOPLŇTE].');
}

export const config = {
  appName: 'Slotiva',
  isProduction,
  port,
  baseUrl,
  dataDir,
  secret: loadSecret(),
  allowRegistration: env.ALLOW_REGISTRATION !== 'false',
  // E-maily, které mají automaticky správcovská práva (oddělené čárkou).
  adminEmails: list(env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
  google,
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT) || 465,
    secure: (env.SMTP_SECURE || 'true') !== 'false',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || env.SMTP_USER || '',
  },
  // Rezervační stránka, kterou ukazuje /ukazka-webu, když není v adrese ?u=
  demoSlug: (env.DEMO_SLUG || '').trim().toLowerCase(),
  // Údaje do Podmínek a Ochrany osobních údajů (vyplní se samy přes /api/public/operator).
  operator: {
    name: env.OPERATOR_NAME || '',
    address: env.OPERATOR_ADDRESS || '',
    id: env.OPERATOR_ID || '',
    email: env.OPERATOR_EMAIL || '',
    hosting: env.OPERATOR_HOSTING || '',
    pricing: env.OPERATOR_PRICING || '',
    updated: env.LEGAL_UPDATED || '',
  },
  embedOrigins: list(env.ALLOWED_EMBED_ORIGINS || '*'),
  warnings,
};
