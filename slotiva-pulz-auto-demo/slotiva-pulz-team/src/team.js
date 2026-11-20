import { db } from './db.js';
import { badRequest } from './errors.js';

export function teamForOwner(ownerId) {
  return db.prepare(`SELECT t.member_id AS id, t.display_name AS name, t.active, u.email
    FROM team_members t JOIN users u ON u.id=t.member_id WHERE t.owner_id=? ORDER BY t.member_id`).all(ownerId);
}
export function teamOwner(userId) {
  return db.prepare('SELECT owner_id FROM team_members WHERE member_id=?').get(userId)?.owner_id ?? userId;
}
export function memberFor(ownerId, memberId) {
  if (Number(memberId) === Number(ownerId)) return ownerId;
  const m = db.prepare('SELECT member_id FROM team_members WHERE owner_id=? AND member_id=? AND active=1').get(ownerId,Number(memberId));
  if (!m) throw badRequest('Neplatný nebo neaktivní člen týmu.');
  return m.member_id;
}
export function publicBarbers(ownerId) {
  return teamForOwner(ownerId).filter(m=>m.active).map(({id,name})=>({id,name}));
}
