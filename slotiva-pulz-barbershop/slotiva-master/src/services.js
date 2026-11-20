import { db, transaction } from './db.js';
import { COLOR_IDS, colorHex } from './settings.js';
import { notFound } from './errors.js';
import * as v from './validate.js';

const STARTER_SERVICES = [
  { name: 'Konzultace', description: 'Úvodní nezávazná konzultace.', duration_min: 30, price: 0, color_id: '7' },
  { name: 'Standardní termín', description: 'Běžná schůzka nebo služba.', duration_min: 60, price: 500, color_id: '9' },
];

export function seedServices(userId, services = STARTER_SERVICES) {
  const insert = db.prepare(
    'INSERT INTO services (user_id, name, description, duration_min, price, color_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  transaction(() => services.forEach((s, i) => insert.run(userId, s.name, s.description, s.duration_min, s.price, s.color_id, i)));
}

export function serviceView(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    durationMin: row.duration_min,
    price: row.price,
    colorId: row.color_id,
    color: colorHex(row.color_id),
    active: Boolean(row.active),
    sortOrder: row.sort_order,
  };
}

export function listServices(userId, { activeOnly = false } = {}) {
  const where = activeOnly ? 'AND active = 1' : '';
  return db.prepare(`SELECT * FROM services WHERE user_id = ? ${where} ORDER BY sort_order, id`).all(userId).map(serviceView);
}

export function getServiceRow(userId, id) {
  const row = db.prepare('SELECT * FROM services WHERE id = ? AND user_id = ?').get(Number(id) || 0, userId);
  if (!row) throw notFound('Služba nebyla nalezena.');
  return row;
}

function validateService(input) {
  return {
    name: v.text(input.name, { field: 'name', label: 'Název', required: true, max: 80 }),
    description: v.text(input.description, { field: 'description', label: 'Popis', max: 400, multiline: true }),
    duration_min: v.integer(Number(input.durationMin), { field: 'durationMin', label: 'Délka (min)', min: 5, max: 720 }),
    price: v.integer(Number(input.price), { field: 'price', label: 'Cena', min: 0, max: 1_000_000 }),
    color_id: v.oneOf(String(input.colorId), COLOR_IDS, { field: 'colorId', label: 'Barva' }),
    active: input.active === undefined ? 1 : Number(v.bool(input.active)),
  };
}

export function createService(userId, input) {
  const s = validateService(input);
  const { next } = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM services WHERE user_id = ?').get(userId);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO services (user_id, name, description, duration_min, price, color_id, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(userId, s.name, s.description, s.duration_min, s.price, s.color_id, s.active, next);
  return serviceView(getServiceRow(userId, lastInsertRowid));
}

export function updateService(userId, id, input) {
  getServiceRow(userId, id);
  const s = validateService(input);
  db.prepare('UPDATE services SET name = ?, description = ?, duration_min = ?, price = ?, color_id = ?, active = ? WHERE id = ? AND user_id = ?')
    .run(s.name, s.description, s.duration_min, s.price, s.color_id, s.active, Number(id), userId);
  return serviceView(getServiceRow(userId, id));
}

export function deleteService(userId, id) {
  getServiceRow(userId, id);
  db.prepare('DELETE FROM services WHERE id = ? AND user_id = ?').run(Number(id), userId);
}

export function reorderServices(userId, ids) {
  if (!Array.isArray(ids)) return;
  const update = db.prepare('UPDATE services SET sort_order = ? WHERE id = ? AND user_id = ?');
  transaction(() => ids.forEach((id, index) => update.run(index, Number(id), userId)));
}
