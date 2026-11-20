import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

/* ───────────── hesla ───────────── */

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string' || !stored.startsWith('scrypt$')) {
    // Stejná časová náročnost i pro neexistující účet.
    await scrypt('neexistuje', 'slotiva-dummy-salt', KEY_LENGTH, SCRYPT);
    return false;
  }
  const [, N, r, p, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(actual, expected);
}

/* ───────────── tokeny a podpisy ───────────── */

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('base64url');

export function safeEqual(a, b) {
  return crypto.timingSafeEqual(Buffer.from(sha256(a)), Buffer.from(sha256(b)));
}

const signingKey = crypto.createHash('sha256').update(`sign:${config.secret}`).digest();
export const sign = (value) => crypto.createHmac('sha256', signingKey).update(value).digest('base64url');

/** Podepsaný krátkodobý balíček dat (např. OAuth state). */
export function sealPayload(data) {
  const body = Buffer.from(JSON.stringify({ ...data, iat: Date.now() })).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function openPayload(token, maxAgeMs) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature || !safeEqual(signature, sign(body))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (maxAgeMs && Date.now() - data.iat > maxAgeMs) return null;
    return data;
  } catch {
    return null;
  }
}

/* ───────────── šifrování (tokeny Google v databázi) ───────────── */

const encryptionKey = crypto.createHash('sha256').update(`encrypt:${config.secret}`).digest();

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decrypt(payload) {
  const [version, iv, tag, data] = String(payload).split('.');
  if (version !== 'v1') throw new Error('Neznámý formát zašifrovaných dat.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
