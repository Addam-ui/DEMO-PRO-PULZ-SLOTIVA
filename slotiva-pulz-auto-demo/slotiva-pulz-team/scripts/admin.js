/**
 * Správa účtů z příkazové řádky.
 *
 *   npm run admin                          přehled účtů a správcovských práv
 *   npm run admin -- --odkaz e@mail.cz     vytvoří odkaz pro nastavení hesla (platí 24 h)
 *   npm run admin -- --heslo e@mail.cz     nastaví heslo; když účet neexistuje, založí ho
 *                                          (heslo se zeptá, nebo ho vezme z proměnné SLOTIVA_HESLO)
 *
 * Kdo je správce, se řídí výhradně proměnnou ADMIN_EMAILS v .env – tenhle skript ji jen kontroluje.
 */

import readline from 'node:readline/promises';
import { config } from '../src/config.js';
import { db, nowIso } from '../src/db.js';
import { hashPassword } from '../src/crypto.js';
import { syncAllAdmins, syncAdminFlag, getUserByEmail, getUserRow, createUser, uniqueSlug } from '../src/users.js';
import { passwordLink } from '../src/admin.js';

const args = process.argv.slice(2);
const flag = (...names) => {
  const i = args.findIndex((a) => names.includes(a));
  return i >= 0 ? args[i + 1] || true : null;
};

const date = (value) => (value ? new Date(value).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' }) : '–');

function report() {
  const changed = syncAllAdmins();
  const users = db.prepare(`
    SELECT u.id, u.email, u.name, u.slug, u.is_admin, u.blocked_at, u.created_at, u.last_login_at,
      (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id) AS bookings,
      (SELECT status FROM google_connections g WHERE g.user_id = u.id) AS google
    FROM users u ORDER BY u.is_admin DESC, u.created_at
  `).all();

  console.log('');
  console.log(`  ADMIN_EMAILS:  ${config.adminEmails.length ? config.adminEmails.join(', ') : '(nenastaveno – nikdo nemá správcovská práva)'}`);
  if (changed.length) console.log(`  Práva se právě změnila u: ${changed.join(', ')}`);
  console.log('');

  if (!users.length) {
    console.log('  Zatím tu není žádný účet. Zaregistrujte se na adrese ' + `${config.baseUrl}/registrace`);
  } else {
    console.log(`  ${'E-MAIL'.padEnd(30)} ${'ADRESA'.padEnd(20)} ${'REZ.'.padStart(5)}  ${'KALENDÁŘ'.padEnd(9)} ${'POSLEDNÍ PŘIHLÁŠENÍ'.padEnd(18)} ROLE`);
    for (const u of users) {
      const role = [u.is_admin ? 'správce' : '', u.blocked_at ? 'zablokován' : ''].filter(Boolean).join(', ') || 'uživatel';
      const cal = u.google === 'ok' ? 'připojen' : u.google ? 'chyba' : '–';
      console.log(`  ${u.email.padEnd(30)} /${u.slug.padEnd(19)} ${String(u.bookings).padStart(5)}  ${cal.padEnd(9)} ${date(u.last_login_at).padEnd(18)} ${role}`);
    }
  }

  const missing = config.adminEmails.filter((e) => !getUserByEmail(e));
  if (missing.length) {
    console.log('');
    console.log(`  ⚠ Na tyto e-maily zatím není založený účet: ${missing.join(', ')}`);
    console.log(`    Zaregistrujte se na ${config.baseUrl}/registrace – práva správce se přidělí automaticky.`);
  }
  console.log('');
}

function makeLink(email) {
  const user = getUserByEmail(email);
  if (!user) {
    console.error(`\n  ✖ Účet ${email} neexistuje.\n`);
    process.exitCode = 1;
    return;
  }
  const link = passwordLink(user.id);
  console.log('');
  console.log(`  Odkaz pro nastavení hesla k účtu ${user.email} (platí ${link.expiresHours} h):`);
  console.log('');
  console.log(`  ${link.url}`);
  console.log('');
}

async function setPassword(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`\n  ✖ „${email}“ nevypadá jako e-mail.\n`);
    process.exitCode = 1;
    return;
  }

  let password = process.env.SLOTIVA_HESLO || '';
  if (!password) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question(`  Nové heslo pro ${email}: `);
    rl.close();
  }
  if (password.length < 8) {
    console.error('\n  ✖ Heslo musí mít alespoň 8 znaků.\n');
    process.exitCode = 1;
    return;
  }

  const hash = await hashPassword(password);
  let user = getUserByEmail(email);
  if (user) {
    // Zvýšení verze relace odhlásí dosavadní přihlášení na všech zařízeních.
    db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?')
      .run(hash, nowIso(), user.id);
  } else {
    const name = email.split('@')[0];
    user = createUser({ name, email, slug: uniqueSlug(name), passwordHash: hash });
    console.log(`\n  ✦ Založen nový účet ${user.email} (/${user.slug}).`);
  }

  syncAdminFlag(getUserRow(user.id));
  const fresh = getUserRow(user.id);
  console.log('');
  console.log(`  ✔ Heslo k účtu ${fresh.email} je nastavené. Dosavadní přihlášení se odhlásila.`);
  console.log(`    ${fresh.is_admin ? 'Účet má práva správce.' : 'Účet nemá práva správce (e-mail není v ADMIN_EMAILS).'}`);
  console.log(`    Přihlášení: ${config.baseUrl}/prihlaseni`);
  console.log('');
}

const linkFor = flag('--odkaz', '--link', '--reset');
const passwordFor = flag('--heslo', '--password');
if (typeof linkFor === 'string') makeLink(linkFor.trim());
else if (typeof passwordFor === 'string') await setPassword(passwordFor.trim());
else report();
