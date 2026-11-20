import { config } from './config.js';
import { DEFAULT_BRAND } from './settings.js';
import { escapeHtml as e, fmtDateLong, fmtTime, fmtPrice } from './format.js';
import { buildIcs } from './ics.js';

export const manageUrl = (booking) => `${config.baseUrl}/rezervace/${booking.cancel_token}`;
const dashboardUrl = (booking) => `${config.baseUrl}/app/#/rezervace/${booking.id}`;

function when(booking, settings) {
  const tz = settings.timezone;
  return `${fmtDateLong(booking.start_utc, tz)}, ${fmtTime(booking.start_utc, tz)}–${fmtTime(booking.end_utc, tz)}`;
}

function layout({ brand = DEFAULT_BRAND, sender, heading, paragraphs = [], rows = [], button, footerNote, contact = '' }) {
  const rowsHtml = rows.map(([label, value]) => `
      <tr>
        <td style="padding:9px 0;color:#5f6f72;font-size:14px;width:130px;vertical-align:top">${e(label)}</td>
        <td style="padding:9px 0;color:#0f1f22;font-size:14px;font-weight:600;vertical-align:top">${e(value)}</td>
      </tr>`).join('');

  return `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f1f6f6;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f6f6;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dfe9e9">
        <tr><td style="height:6px;background:${brand}"></td></tr>
        <tr><td style="padding:28px 32px 6px">
          <div style="font-size:13px;color:#5f6f72;font-weight:600">${e(sender)}</div>
          <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;color:#0f1f22">${e(heading)}</h1>
        </td></tr>
        <tr><td style="padding:6px 32px 0">
          ${paragraphs.map((p) => `<p style="margin:12px 0;font-size:15px;line-height:1.6;color:#34474a">${e(p).replace(/\n/g, '<br>')}</p>`).join('')}
        </td></tr>
        ${rows.length ? `<tr><td style="padding:12px 32px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e8efef;border-bottom:1px solid #e8efef">${rowsHtml}</table></td></tr>` : ''}
        ${button ? `<tr><td style="padding:24px 32px 8px"><a href="${e(button.url)}" style="display:inline-block;background:${brand};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:11px">${e(button.label)}</a></td></tr>` : ''}
        <tr><td style="padding:20px 32px 26px;font-size:12px;line-height:1.6;color:#7f8e90">
          ${footerNote ? `${e(footerNote)}<br>` : ''}${contact}
        </td></tr>
      </table>
      <div style="padding:16px;font-size:12px;color:#92a0a2">Rezervační systém <a href="${e(config.baseUrl)}" style="color:#0a7c80;text-decoration:none;font-weight:600">Slotiva</a></div>
    </td></tr>
  </table>
</body></html>`;
}

function plainText({ heading, paragraphs = [], rows = [], button }) {
  return [heading, '', ...paragraphs, '', ...rows.map(([l, v]) => `${l}: ${v}`), '', button ? `${button.label}: ${button.url}` : '', '', '— Slotiva']
    .join('\n')
    .trim();
}

function build(content) {
  return { html: layout(content), text: plainText(content) };
}

function businessContent(settings) {
  const b = settings.business;
  return {
    brand: settings.brandColor,
    sender: b.name,
    contact: [b.address, b.phone, b.email].filter(Boolean).map(e).join(' · '),
  };
}

export function bookingIcs(booking, settings) {
  return buildIcs({
    uid: `${booking.code}@slotiva`,
    start: Date.parse(booking.start_utc),
    end: Date.parse(booking.end_utc),
    summary: `${booking.service_name} – ${settings.business.name}`,
    description: `Kód rezervace: ${booking.code}\nSpráva rezervace: ${manageUrl(booking)}`,
    location: settings.business.address,
    url: manageUrl(booking),
  });
}

const customerRows = (booking, settings) => [
  ['Služba', booking.service_name],
  ['Termín', when(booking, settings)],
  ['Cena', fmtPrice(booking.price)],
  ['Kód rezervace', booking.code],
  ...(settings.business.address ? [['Adresa', settings.business.address]] : []),
];

const ownerRows = (booking, settings) => [
  ['Klient', booking.customer_name],
  ['Telefon', booking.customer_phone || '—'],
  ['E-mail', booking.customer_email || '—'],
  ['Služba', booking.service_name],
  ['Termín', when(booking, settings)],
  ['Cena', fmtPrice(booking.price)],
  ...(booking.note ? [['Poznámka', booking.note]] : []),
  ['Kód', booking.code],
];


export function customerConfirmation(booking, settings) {
  const tz = settings.timezone;
  return {
    to: booking.customer_email,
    replyTo: settings.business.email || undefined,
    subject: `Potvrzení rezervace – ${booking.service_name}, ${fmtDateLong(booking.start_utc, tz)} v ${fmtTime(booking.start_utc, tz)}`,
    ...build({
      ...businessContent(settings),
      heading: 'Rezervace je potvrzená',
      paragraphs: [
        `Dobrý den, ${booking.customer_name},`,
        settings.confirmationMessage,
        'Nemůžete přijít? Rezervaci si zrušíte sami tlačítkem níže, termín se uvolní a zmizí i z našeho kalendáře.',
      ].filter(Boolean),
      rows: customerRows(booking, settings),
      button: { label: 'Zobrazit nebo zrušit rezervaci', url: manageUrl(booking) },
      footerNote: settings.cancelLimitHours > 0 ? `Rezervaci můžete zrušit nejpozději ${settings.cancelLimitHours} h před začátkem.` : '',
    }),
  };
}

export function customerRescheduled(booking, settings) {
  return {
    to: booking.customer_email,
    replyTo: settings.business.email || undefined,
    subject: `Změna termínu rezervace – ${booking.service_name}`,
    ...build({
      ...businessContent(settings),
      heading: 'Termín vaší rezervace se změnil',
      paragraphs: [`Dobrý den, ${booking.customer_name},`, 'váš termín byl přesunut. Nový termín najdete níže.'],
      rows: customerRows(booking, settings),
      button: { label: 'Zobrazit nebo zrušit rezervaci', url: manageUrl(booking) },
    }),
  };
}

export function customerCancelled(booking, settings, { byCustomer, slug }) {
  return {
    to: booking.customer_email,
    replyTo: settings.business.email || undefined,
    subject: `Rezervace zrušena – ${booking.service_name}, ${fmtDateLong(booking.start_utc, settings.timezone)}`,
    ...build({
      ...businessContent(settings),
      heading: 'Rezervace byla zrušena',
      paragraphs: [
        `Dobrý den, ${booking.customer_name},`,
        byCustomer
          ? 'potvrzujeme zrušení vaší rezervace. Budeme rádi, když si vyberete jiný termín.'
          : 'je nám líto, ale vaši rezervaci jsme museli zrušit. Omlouváme se a budeme rádi, když si vyberete jiný termín.',
      ],
      rows: customerRows(booking, settings),
      button: { label: 'Vybrat nový termín', url: `${config.baseUrl}/${slug}` },
    }),
  };
}

const ownerAddress = (settings, owner) => settings.notifyEmail || owner.email;

export function ownerNewBooking(booking, settings, owner) {
  const tz = settings.timezone;
  return {
    to: ownerAddress(settings, owner),
    replyTo: booking.customer_email || undefined,
    subject: `Nová rezervace: ${booking.customer_name} – ${fmtDateLong(booking.start_utc, tz)} ${fmtTime(booking.start_utc, tz)}`,
    ...build({
      sender: 'Slotiva',
      heading: 'Máte novou rezervaci',
      rows: ownerRows(booking, settings),
      button: { label: 'Otevřít v dashboardu', url: dashboardUrl(booking) },
    }),
  };
}

export function ownerCancelled(booking, settings, owner) {
  const tz = settings.timezone;
  return {
    to: ownerAddress(settings, owner),
    subject: `Zrušená rezervace: ${booking.customer_name} – ${fmtDateLong(booking.start_utc, tz)} ${fmtTime(booking.start_utc, tz)}`,
    ...build({
      sender: 'Slotiva',
      heading: 'Klient zrušil rezervaci',
      paragraphs: ['Termín se uvolnil a je znovu k dispozici pro další rezervace.'],
      rows: ownerRows(booking, settings),
      button: { label: 'Otevřít v dashboardu', url: dashboardUrl(booking) },
    }),
  };
}

export function passwordResetEmail(user, token) {
  return {
    to: user.email,
    subject: 'Obnova hesla – Slotiva',
    ...build({
      sender: 'Slotiva',
      heading: 'Nastavte si nové heslo',
      paragraphs: [`Dobrý den, ${user.name},`, 'někdo (nejspíš vy) požádal o obnovu hesla k účtu Slotiva. Odkaz platí 1 hodinu.', 'Pokud jste o obnovu nežádali, tento e-mail ignorujte.'],
      button: { label: 'Nastavit nové heslo', url: `${config.baseUrl}/nove-heslo?token=${encodeURIComponent(token)}` },
    }),
  };
}

export function adminPasswordEmail(user, url, hours) {
  return {
    to: user.email,
    subject: 'Nastavení hesla k účtu – Slotiva',
    ...build({
      sender: 'Slotiva',
      heading: 'Nastavte si heslo ke svému účtu',
      paragraphs: [`Dobrý den, ${user.name},`, `správce Slotivy pro vás připravil odkaz, kterým si nastavíte heslo. Platí ${hours} hodin.`],
      button: { label: 'Nastavit heslo', url },
    }),
  };
}

export function googleDisconnectedEmail(user, reason) {
  return {
    to: user.email,
    subject: 'Google Kalendář se odpojil – Slotiva',
    ...build({
      sender: 'Slotiva',
      heading: 'Google Kalendář je potřeba připojit znovu',
      paragraphs: [
        `Dobrý den, ${user.name},`,
        reason,
        'Rezervace fungují dál, ale dokud kalendář znovu nepřipojíte, nezapisují se do něj a nekontroluje se v něm obsazenost.',
      ],
      button: { label: 'Připojit kalendář', url: `${config.baseUrl}/app/#/napojeni` },
    }),
  };
}
