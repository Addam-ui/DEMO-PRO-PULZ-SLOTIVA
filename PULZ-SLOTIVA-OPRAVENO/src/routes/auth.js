import express from 'express';
import { config } from '../config.js';
import { AppError, badRequest } from '../errors.js';
import { rateLimit } from '../http.js';
import { startSession, endSession, readSession, parseCookies } from '../auth.js';
import { sealPayload, openPayload, randomToken, safeEqual } from '../crypto.js';
import { db, nowIso } from '../db.js';
import * as users from '../users.js';
import * as google from '../google.js';
import { onGoogleConnected } from '../bookings.js';
import { mailEnabled, sendMail } from '../mailer.js';
import { passwordResetEmail } from '../emails.js';
import * as v from '../validate.js';
import { ensurePulzDemo } from '../pulz-auto.js';

/* ───────────── /api/auth ───────────── */

export const authApi = express.Router();

authApi.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

authApi.get('/session', (req, res) => {
  const session = readSession(req);
  res.json({
    authenticated: Boolean(session),
    user: session ? users.publicUser(session.user) : null,
    registration: config.allowRegistration,
    googleLogin: google.oauthEnabled(),
    passwordReset: mailEnabled(),
  });
});

const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, message: 'Příliš mnoho pokusů. Zkuste to prosím za 15 minut.' });

authApi.post('/register', authLimiter, async (req, res) => {
  if (!config.allowRegistration) throw new AppError(403, 'Registrace nových účtů je momentálně vypnutá.');
  const body = req.body || {};
  if (body.website) throw badRequest('Registraci se nepodařilo dokončit.'); // skryté pole pro roboty
  const user = await users.registerUser(body);
  // Demo pouze na nové instanci / pro první účet. Bez zásahu do jiných uživatelů.
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 1) {
    try { ensurePulzDemo(user.id); } catch (err) { console.error('PULZ demo seed:', err); }
  }
  startSession(res, user);
  console.log(`✦  Nový účet: ${user.email} (/${user.slug})`);
  res.status(201).json({ user: users.publicUser(user) });
});

authApi.post('/login', authLimiter, async (req, res) => {
  const user = await users.authenticate(req.body?.email, req.body?.password);
  startSession(res, user);
  res.json({ user: users.publicUser(user) });
});

authApi.post('/logout', (req, res) => {
  endSession(res);
  res.json({ ok: true });
});

authApi.post('/forgot-password', rateLimit({ windowMs: 60 * 60_000, max: 6 }), async (req, res) => {
  if (!mailEnabled()) throw badRequest('Obnova hesla e-mailem není na tomto serveru zapnutá.');
  const email = v.email(req.body?.email, { field: 'email', required: true });
  const reset = users.createPasswordReset(email);
  if (reset) await sendMail(passwordResetEmail(reset.user, reset.token));
  res.json({ ok: true }); // stejná odpověď i pro neexistující e-mail
});

authApi.post('/reset-password', authLimiter, async (req, res) => {
  const user = await users.resetPassword(req.body?.token, req.body?.password);
  startSession(res, user);
  res.json({ user: users.publicUser(user) });
});

/* ───────────── /auth/google – přihlášení a připojení kalendáře ───────────── */

export const oauthRoutes = express.Router();
const OAUTH_COOKIE = 'slotiva_oauth';
const OAUTH_WINDOW_MS = 30 * 60_000;
const oauthCookieOptions = { httpOnly: true, sameSite: 'lax', secure: config.isProduction, path: '/auth/google' };

oauthRoutes.get('/google/start', (req, res) => {
  if (!google.oauthEnabled()) return res.redirect('/prihlaseni?chyba=google-vypnuto');
  const intent = req.query.intent === 'connect' ? 'connect' : 'login';
  const session = readSession(req);
  if (intent === 'connect' && !session) return res.redirect('/prihlaseni');

  const nonce = randomToken(16);
  // 30 minut: přihlášení u Googlu může zdržet výběr účtu, heslo i dvoufázové ověření.
  res.cookie(OAUTH_COOKIE, nonce, { ...oauthCookieOptions, maxAge: OAUTH_WINDOW_MS });
  const welcome = req.query.vitejte === '1';
  const state = sealPayload({ nonce, intent, welcome, uid: session?.user.id ?? null });
  res.redirect(google.authorizationUrl({ state, loginHint: session?.user.email }));
});

oauthRoutes.get('/google/callback', async (req, res) => {
  const state = openPayload(req.query.state, OAUTH_WINDOW_MS);
  const nonce = parseCookies(req.headers.cookie)[OAUTH_COOKIE];
  res.clearCookie(OAUTH_COOKIE, oauthCookieOptions);

  const welcomeFlag = state?.welcome ? '&vitejte=1' : '';
  const fail = (code) => res.redirect(state?.intent === 'connect' ? `/app/?google=${code}${welcomeFlag}#/prehled` : `/prihlaseni?chyba=${code}`);
  if (!state || !nonce || !safeEqual(nonce, state.nonce)) return fail('neplatny-pozadavek');
  if (req.query.error) return fail(req.query.error === 'access_denied' ? 'zamitnuto' : 'google-chyba');

  let result;
  try {
    result = await google.exchangeCode(String(req.query.code || ''));
  } catch (err) {
    console.error('✖  Google OAuth:', err.message);
    return fail('google-chyba');
  }
  const { profile } = result;
  if (!profile.emailVerified) return fail('neovereny-email');

  let user;
  let created = false;

  if (state.intent === 'connect') {
    const session = readSession(req);
    if (!session || session.user.id !== state.uid) return fail('neplatny-pozadavek');
    user = session.user;
    const owner = users.getUserByGoogleSub(profile.sub);
    if (owner && owner.id !== user.id) return fail('ucet-pouzity');
    if (!user.google_sub) users.linkGoogleAccount(user.id, profile.sub);
  } else {
    user = users.getUserByGoogleSub(profile.sub);
    if (!user) {
      const byEmail = users.getUserByEmail(profile.email);
      if (byEmail) {
        // Propojení s existujícím účtem podle ověřeného e-mailu. Heslo i všechna přihlášení se zneplatní,
        // aby účet předem založený cizím člověkem s tímto e-mailem nemohl získat přístup ke kalendáři.
        db.prepare('UPDATE users SET google_sub = ?, password_hash = NULL, session_version = session_version + 1, updated_at = ? WHERE id = ?')
          .run(profile.sub, nowIso(), byEmail.id);
        user = users.getUserRow(byEmail.id);
      } else {
        if (!config.allowRegistration) return fail('registrace-vypnuta');
        user = users.createUser({
          name: profile.name.slice(0, 80),
          email: profile.email,
          slug: users.uniqueSlug(profile.name),
          googleSub: profile.sub,
        });
        created = true;
        console.log(`✦  Nový účet přes Google: ${user.email} (/${user.slug})`);
      }
    }
    if (user.blocked_at) return fail('ucet-zablokovan');
    users.touchLogin(user.id);
    users.syncAdminFlag(user);
    user = users.getUserRow(user.id);
  }

  try {
    google.saveConnection(user.id, result);
  } catch (err) {
    console.error('✖  Google OAuth:', err.message);
    return fail('bez-tokenu');
  }
  onGoogleConnected(user.id);
  startSession(res, users.getUserRow(user.id));

  const flag = google.getConnection(user.id)?.status === 'noscope' ? 'bez-kalendare' : 'pripojeno';
  const target = state.intent === 'connect' && !state.welcome ? 'napojeni' : 'prehled';
  res.redirect(`/app/?google=${flag}${created || state.welcome ? '&vitejte=1' : ''}#/${target}`);
});
