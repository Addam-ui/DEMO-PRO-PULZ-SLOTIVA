import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSlots, findSlot, openMinutes } from '../src/availability.js';

const BASE = {
  timezone: 'Europe/Prague',
  workingHours: {
    1: [{ from: '09:00', to: '12:00' }, { from: '13:00', to: '17:00' }],
    2: [], 3: [], 4: [], 5: [], 6: [],
    7: [{ from: '09:00', to: '12:00' }],
  },
  slotStep: 30,
  bufferMin: 0,
  minNoticeHours: 0,
  maxAdvanceDays: 60,
};
const settings = (overrides = {}) => ({ ...BASE, ...overrides });
const utc = (s) => Date.parse(s);

const NOW = utc('2026-09-10T08:00:00Z'); // čtvrtek 10:00 v Praze
const MONDAY = '2026-09-14';
const times = (days, date) => days[date].map((s) => s.time);

test('nabízí časy v otevírací době s krokem 30 minut', () => {
  const days = computeSlots({ settings: settings(), durationMin: 60, fromDate: MONDAY, toDate: MONDAY, now: NOW });
  assert.deepEqual(times(days, MONDAY), [
    '09:00', '09:30', '10:00', '10:30', '11:00',
    '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00',
  ]);
  assert.equal(days[MONDAY][0].start, utc('2026-09-14T07:00:00Z'));
  assert.equal(days[MONDAY][0].end, utc('2026-09-14T08:00:00Z'));
});

test('zavřený den nemá žádné časy', () => {
  const days = computeSlots({ settings: settings(), durationMin: 30, fromDate: '2026-09-15', toDate: '2026-09-15', now: NOW });
  assert.deepEqual(days['2026-09-15'], []);
});

test('obsazený čas i pauza mezi termíny blokují', () => {
  const busy = [{ start: utc('2026-09-14T08:00:00Z'), end: utc('2026-09-14T09:00:00Z') }]; // 10:00–11:00 Praha
  const list = times(computeSlots({ settings: settings({ bufferMin: 15 }), durationMin: 30, fromDate: MONDAY, toDate: MONDAY, busy, now: NOW }), MONDAY);
  assert.ok(list.includes('09:00'));
  assert.ok(!list.includes('09:30'), '09:30–10:00 zasahuje do pauzy před obsazeným časem');
  assert.ok(!list.includes('10:30'));
  assert.ok(!list.includes('11:00'), '11:00 je v pauze po obsazeném čase');
  assert.ok(list.includes('11:30'));
});

test('minimální předstih', () => {
  const now = utc('2026-09-14T07:10:00Z'); // pondělí 9:10
  const list = times(computeSlots({ settings: settings({ minNoticeHours: 2 }), durationMin: 30, fromDate: MONDAY, toDate: MONDAY, now }), MONDAY);
  assert.equal(list[0], '11:30');
});

test('limit dní dopředu a volba applyRules pro admina', () => {
  const limited = computeSlots({ settings: settings({ maxAdvanceDays: 3 }), durationMin: 30, fromDate: MONDAY, toDate: MONDAY, now: NOW });
  assert.deepEqual(limited[MONDAY], []);
  const admin = computeSlots({ settings: settings({ maxAdvanceDays: 3 }), durationMin: 30, fromDate: MONDAY, toDate: MONDAY, now: NOW, applyRules: false });
  assert.ok(admin[MONDAY].length > 0);
});

test('minulé dny se nenabízejí', () => {
  const days = computeSlots({ settings: settings(), durationMin: 30, fromDate: '2026-09-07', toDate: '2026-09-07', now: NOW });
  assert.deepEqual(days['2026-09-07'], []);
});

test('krok 0 = časy podle délky služby', () => {
  const list = times(computeSlots({ settings: settings({ slotStep: 0 }), durationMin: 90, fromDate: MONDAY, toDate: MONDAY, now: NOW }), MONDAY);
  assert.deepEqual(list, ['09:00', '10:30', '13:00', '14:30']);
});

test('přechod na letní a zimní čas', () => {
  const summer = computeSlots({ settings: settings(), durationMin: 60, fromDate: '2026-03-29', toDate: '2026-03-29', now: utc('2026-03-01T00:00:00Z') });
  assert.equal(summer['2026-03-29'][0].start, utc('2026-03-29T07:00:00Z'), '9:00 SELČ = 7:00 UTC');

  const winter = computeSlots({ settings: settings(), durationMin: 60, fromDate: '2026-10-25', toDate: '2026-10-25', now: utc('2026-10-01T00:00:00Z') });
  assert.equal(winter['2026-10-25'][0].start, utc('2026-10-25T08:00:00Z'), '9:00 SEČ = 8:00 UTC');
  assert.deepEqual(times(winter, '2026-10-25'), ['09:00', '09:30', '10:00', '10:30', '11:00']);
});

test('findSlot najde konkrétní čas nebo vrátí null', () => {
  const busy = [{ start: utc('2026-09-14T07:00:00Z'), end: utc('2026-09-14T08:00:00Z') }];
  const opts = { settings: settings(), durationMin: 60, date: MONDAY, busy, now: NOW };
  assert.equal(findSlot({ ...opts, time: '09:00' }), null);
  assert.equal(findSlot({ ...opts, time: '10:00' }).start, utc('2026-09-14T08:00:00Z'));
  assert.equal(findSlot({ ...opts, time: '10:15' }), null, 'čas mimo krok se nenabízí');
});

test('openMinutes sečte otevírací dobu', () => {
  assert.equal(openMinutes(settings(), '2026-09-14', '2026-09-20'), 3 * 60 + 4 * 60 + 3 * 60);
});
