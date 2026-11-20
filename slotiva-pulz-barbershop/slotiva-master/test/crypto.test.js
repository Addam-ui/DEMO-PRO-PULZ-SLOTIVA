import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let crypto;

before(async () => {
  process.env.SKIP_ENV_FILE = '1';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'slotiva-crypto-'));
  process.env.SESSION_SECRET = 'test-secret-'.padEnd(48, 'x');
  crypto = await import('../src/crypto.js');
});

test('hash hesla se ověří jen správným heslem', async () => {
  const hash = await crypto.hashPassword('tajne-heslo-123');
  assert.match(hash, /^scrypt\$/);
  assert.equal(await crypto.verifyPassword('tajne-heslo-123', hash), true);
  assert.equal(await crypto.verifyPassword('spatne-heslo', hash), false);
  assert.equal(await crypto.verifyPassword('cokoliv', null), false);
});

test('šifrování tokenů je vratné a odhalí změnu dat', () => {
  const secret = '1//refresh-token-příklad';
  const encrypted = crypto.encrypt(secret);
  assert.notEqual(encrypted, secret);
  assert.equal(crypto.decrypt(encrypted), secret);
  const [v, iv, tag, data] = encrypted.split('.');
  const tampered = [v, iv, tag, `${data.slice(0, -2)}AA`].join('.');
  assert.throws(() => crypto.decrypt(tampered));
});

test('podepsaný balíček nejde podvrhnout a vyprší', async () => {
  const token = crypto.sealPayload({ intent: 'connect', uid: 7 });
  assert.equal(crypto.openPayload(token, 60_000).uid, 7);
  assert.equal(crypto.openPayload(`${token}x`, 60_000), null);
  const [body] = token.split('.');
  const forged = `${Buffer.from(JSON.stringify({ intent: 'connect', uid: 1, iat: Date.now() })).toString('base64url')}.${token.split('.')[1]}`;
  assert.equal(crypto.openPayload(forged, 60_000), null);
  assert.ok(body);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(crypto.openPayload(token, 5), null);
});
