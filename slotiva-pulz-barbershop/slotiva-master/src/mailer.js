import nodemailer from 'nodemailer';
import { config } from './config.js';

let transporter = null;

export const mailEnabled = () => Boolean(config.smtp.host && config.smtp.from);

function getTransporter() {
  if (!transporter) {
    const { host, port, secure, user, pass } = config.smtp;
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
      connectionTimeout: 15000,
    });
  }
  return transporter;
}

/** Odešle e-mail. Chyby jen zaloguje – rezervace nesmí spadnout kvůli e-mailu. */
export async function sendMail({ to, subject, html, text, attachments, replyTo }) {
  if (!mailEnabled() || !to) return false;
  try {
    await getTransporter().sendMail({ from: config.smtp.from, to, subject, html, text, attachments, replyTo });
    return true;
  } catch (err) {
    console.error(`✉  E-mail „${subject}“ pro ${to} se nepodařilo odeslat: ${err.message}`);
    return false;
  }
}

export async function verifyMail() {
  if (!mailEnabled()) return { enabled: false };
  try {
    await getTransporter().verify();
    return { enabled: true, ok: true };
  } catch (err) {
    return { enabled: true, ok: false, error: err.message };
  }
}
