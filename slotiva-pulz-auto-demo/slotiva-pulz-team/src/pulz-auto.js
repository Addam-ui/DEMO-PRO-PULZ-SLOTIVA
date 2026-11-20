import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { db } from './db.js';
import { createUser, uniqueSlug } from './users.js';
import { createService } from './services.js';
import { getSettings, patchSettings } from './settings.js';

const SERVICES = [['Pánský střih',390,30],['Dětský střih',290,25],['Combo',590,45]];
const NAMES = ['Petr Dvořák','Jakub Novák','Martin Svoboda','Tomáš Beneš','David Král','Filip Marek','Adam Dvořák','Lukáš Černý','Michal Veselý','Ondřej Fiala'];
const DESCRIPTION = 'Zapomeň na uspěchané střihy jak z pásu. V PULZU si dáváme záležet na každém detailu. Pohodlně se usaď, dej si dobrou kávu nebo něco ostřejšího a nech to na nás.';

/** Demo je idempotentní pro daný účet. Nespouští se při každém requestu. */
export function ensurePulzDemo(ownerId) {
  const key = `pulz:auto:v1:${ownerId}`;
  if (db.prepare('SELECT 1 FROM kv WHERE key=?').get(key)) return 0;
  const owner = db.prepare('SELECT * FROM users WHERE id=?').get(ownerId);
  if (!owner) return 0;
  const settings = getSettings(ownerId);
  patchSettings(ownerId, {
    business: { ...settings.business, name:'PULZ Barbershop', tagline:'Střih s důrazem na každý detail.', description:DESCRIPTION, address:'Na Struze 30, 541 01 Trutnov', phone:'+420 704 202 026', email:'pulzbarbershop@gmail.com' },
    timezone:'Europe/Prague', settingsSaved:true, servicesEdited:true, onboardingDismissed:true
  });
  let count = 0;
  for (const name of ['Kikin','Honza']) {
    let member = db.prepare('SELECT u.* FROM team_members t JOIN users u ON u.id=t.member_id WHERE t.owner_id=? AND t.display_name=?').get(ownerId,name);
    if (!member) {
      // Neaktivované demo účty: bez hesla, majitel může nastavit přístup ve Správě týmu.
      const email = `pulz-demo-${ownerId}-${name.toLowerCase()}@example.invalid`;
      member = createUser({name,email,slug:uniqueSlug(`pulz-${name}-${ownerId}`),passwordHash:null});
      db.prepare('INSERT INTO team_members(owner_id,member_id,display_name) VALUES(?,?,?)').run(ownerId,member.id,name);
    }
    const memberSettings=getSettings(member.id);
    patchSettings(member.id,{business:{...memberSettings.business,name:'PULZ Barbershop',description:DESCRIPTION,address:'Na Struze 30, 541 01 Trutnov',phone:'+420 704 202 026',email:'pulzbarbershop@gmail.com'},timezone:'Europe/Prague',settingsSaved:true,servicesEdited:true});
    db.prepare('DELETE FROM services WHERE user_id=?').run(member.id);
    for(const [label,price,duration] of SERVICES) createService(member.id,{name:label,price,durationMin:duration,description:'',colorId:'9'});
    const services=db.prepare('SELECT * FROM services WHERE user_id=? AND active=1').all(member.id);
    const insert=db.prepare(`INSERT INTO bookings(user_id,code,cancel_token,service_id,service_name,color_id,price,start_utc,end_utc,customer_name,customer_email,status,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'demo')`);
    for(let offset=-28;offset<=21;offset++) {
      const day=DateTime.now().setZone('Europe/Prague').startOf('day').plus({days:offset});
      if(day.weekday===7)continue;
      for(let slot=0;slot<5;slot++) {
        if((offset+slot+member.id)%6===0)continue;
        const service=services[(slot+offset+1000)%services.length];
        const start=day.plus({hours:9+slot*1.5});
        const end=start.plus({minutes:service.duration_min});
        const status=offset<0 && (offset+slot)%9===0?'cancelled':'confirmed';
        const person=NAMES[(offset+slot+member.id+1000)%NAMES.length];
        insert.run(member.id,crypto.randomBytes(6).toString('hex').toUpperCase(),crypto.randomBytes(24).toString('base64url'),service.id,service.name,service.color_id,service.price,start.toUTC().toISO(),end.toUTC().toISO(),person,`demo-${ownerId}-${count}@example.invalid`,status);
        count++;
      }
    }
  }
  db.prepare('INSERT INTO kv(key,value) VALUES(?,?)').run(key,new Date().toISOString());
  return count;
}
