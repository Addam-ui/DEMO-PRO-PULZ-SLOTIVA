import express from 'express';
import { AppError, badRequest } from '../errors.js';
import { requireUser } from '../auth.js';
import * as admin from '../admin.js';
import * as users from '../users.js';
import * as google from '../google.js';
import { mailEnabled, sendMail } from '../mailer.js';
import { adminPasswordEmail } from '../emails.js';

export const adminRouter = express.Router();

adminRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
adminRouter.use(requireUser);
adminRouter.use((req, res, next) => {
  if (!req.user.is_admin) return next(new AppError(403, 'Tato část je jen pro správce.'));
  next();
});

adminRouter.get('/overview', (req, res) => {
  res.json({ stats: admin.platformStats(), trend: admin.platformTrend(30), mailEnabled: mailEnabled() });
});

adminRouter.get('/users', (req, res) => {
  res.json(admin.listUsers({
    q: String(req.query.q || ''),
    sort: String(req.query.sort || 'new'),
    filter: String(req.query.filter || 'all'),
    limit: Number(req.query.limit) || 50,
    offset: Number(req.query.offset) || 0,
  }));
});

adminRouter.get('/users/:id', (req, res) => {
  res.json({ user: admin.userDetail(req.params.id) });
});

adminRouter.post('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const action = req.body?.action;

  if (action === 'block' || action === 'unblock') {
    if (id === req.user.id) throw badRequest('Vlastní účet nelze zablokovat.');
    users.setBlocked(id, action === 'block');
    return res.json({ user: admin.userDetail(id) });
  }

  if (action === 'note') {
    admin.setUserNote(id, req.body?.note);
    return res.json({ user: admin.userDetail(id) });
  }

  if (action === 'password-link') {
    const link = admin.passwordLink(id);
    let sent = false;
    if (mailEnabled() && req.body?.send) sent = await sendMail(adminPasswordEmail(link.user, link.url, link.expiresHours));
    return res.json({ url: link.url, expiresHours: link.expiresHours, sent, email: link.user.email });
  }

  throw badRequest('Neznámá akce.');
});

adminRouter.delete('/users/:id', async (req, res) => {
  const user = admin.assertDeletable(req.params.id, req.user.id);
  await google.disconnect(user.id).catch(() => {}); // odvolá přístup ke kalendáři, i když Google neodpoví
  users.deleteUser(user.id);
  console.log(`✖  Správce smazal účet: ${user.email}`);
  res.json({ ok: true });
});
