/* Akce nad rezervací sdílené seznamem, kalendářem i bočním panelem s detailem,
   aby se otázka „opravdu zrušit?" formulovala na jednom místě. */

import { patch } from '../api.js';
import { fmt, capitalize, confirmDialog, toast } from '../ui.js';

export const isPast = (booking) => Date.parse(booking.end) < Date.now();

/** Zeptá se a rezervaci zruší. Vrací aktualizovanou rezervaci, nebo null, když uživatel couvl. */
export async function cancelBooking(booking, { mailEnabled = false, googleActive = false } = {}) {
  const when = `${capitalize(fmt.dateLongNoYear(booking.date))} v ${booking.time}`;
  const inCalendar = googleActive && booking.google?.eventId;
  const consequence = isPast(booking)
    ? `Rezervace se označí jako zrušená${inCalendar ? ' a událost zmizí z Google Kalendáře' : ''}.`
    : `Termín se uvolní${inCalendar ? ' a událost zmizí z Google Kalendáře' : ''}.`;

  const result = await confirmDialog({
    title: 'Zrušit rezervaci?',
    message: `${booking.customer.name} · ${when}. ${consequence}`,
    confirmLabel: 'Zrušit rezervaci',
    danger: true,
    checkbox: mailEnabled && booking.customer.email
      ? { label: 'Poslat klientovi e-mail o zrušení', checked: true }
      : null,
  });
  if (!result) return null;

  const data = await patch(`/bookings/${booking.id}`, {
    action: 'status',
    status: 'cancelled',
    notifyCustomer: result.checked,
  });
  toast('Rezervace zrušena');
  return data.booking;
}

/** Změní stav rezervace (obnovení, „nedostavil se“ a zpět). */
export async function setBookingStatus(booking, status, message) {
  const data = await patch(`/bookings/${booking.id}`, { action: 'status', status });
  if (message) toast(message);
  return data.booking;
}

/** Zabalí akci tak, aby chyba skončila hláškou místo tiché nefunkčnosti. */
export function guard(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      toast(err.message, { error: true });
      return null;
    }
  };
}
