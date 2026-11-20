import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs } from '../src/ics.js';

test('ICS má správný formát, escapování a zalomení řádků', () => {
  const ics = buildIcs({
    uid: 'ABC123@rezervacni-system',
    start: Date.parse('2026-09-14T07:00:00Z'),
    end: Date.parse('2026-09-14T08:00:00Z'),
    summary: 'Dámský střih; mytí, foukaná',
    description: `Řádek 1\n${'Příliš žluťoučký kůň úpěl ďábelské ódy. '.repeat(4)}`,
    location: 'Náměstí Míru 1, Praha',
  });

  const lines = ics.split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.ok(lines.includes('DTSTART:20260914T070000Z'));
  assert.ok(lines.includes('DTEND:20260914T080000Z'));
  assert.ok(lines.includes('SUMMARY:Dámský střih\\; mytí\\, foukaná'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  for (const line of lines) {
    assert.ok(Buffer.byteLength(line) <= 75, `řádek je delší než 75 bajtů: ${line}`);
  }
});
