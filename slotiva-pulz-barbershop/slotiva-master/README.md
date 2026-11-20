# Slotiva

Online rezervační systém **pro více uživatelů**. Každý si vytvoří účet, dostane vlastní rezervační stránku (`/jmeno`) a jedním kliknutím připojí **svůj Google Kalendář** – rezervace se do něj pak zapisují samy.

- **Klient** si na vaší stránce vybere službu, den a volný čas.
- **Vám** se termín objeví v Google Kalendáři i v dashboardu.
- **Co máte v kalendáři obsazené** (dovolená, schůzka, jiná rezervace), se klientům vůbec nenabídne.

---

## Co Slotiva umí

**Pro klienty**
- Rezervace ve třech krocích: služba → termín → kontakt
- Potvrzení s kódem a odkazem, kterým klient rezervaci kdykoliv sám zruší
- Vlastní stránka rezervace s možností zrušení (do nastaveného limitu)
- Funguje na mobilu, ve vloženém formuláři i ve vyskakovacím okně

**Pro uživatele (dashboard na `/app/`)**
- **Přehled** – dnešek, týden, tržby, vytíženost, graf po dnech, průvodce prvními kroky
- **Rezervace** – hledání, filtry, detail, přesun, zrušení, „nedostavil se“, interní poznámky, export do CSV
- **Kalendář** – týdenní pohled s rezervacemi i událostmi z Google Kalendáře; kliknutím do volného místa přidáte rezervaci po telefonu
- **Služby** – název, popis, délka, cena, barva (stejná bude i v Google Kalendáři), pořadí, skrytí
- **Nastavení** – účet a adresa stránky, údaje pro klienty, otevírací doba, pravidla rezervací, heslo, smazání účtu
- **Kalendář a web** – připojení Googlu, výběr kalendářů, testy a synchronizace, hotové kódy pro vložení na web, přidání Slotivy na plochu telefonu

**Pro správce (`ADMIN_EMAILS`)**
- Sekce **Správa platformy** v dashboardu: kolik je uživatelů, kolik přibylo, kdo je aktivní, kdo má připojený kalendář
- Graf rezervací a nových účtů za 30 dní, upozornění na problémy (vypršelý přístup ke kalendáři, nezapsané rezervace)
- Seznam všech účtů s hledáním a filtry, detail účtu s čísly a poslední aktivitou
- Zablokování účtu (okamžitě ho odhlásí), smazání účtu, odkaz pro nastavení hesla, interní poznámka

**Google Kalendář (obousměrně)**
- Volné časy = otevírací doba **minus** vše obsazené v kalendáři
- Každá rezervace se hned zapíše jako událost (služba, jméno, telefon, e-mail, poznámka, odkaz do dashboardu)
- Smažete událost v kalendáři → rezervace se zruší. Přesunete ji → změní se čas. (Synchronizace každých 5 minut a při načtení volných časů.)
- Před uložením se obsazenost ověřuje znovu → žádné dvojité rezervace
- Když je Google dočasně nedostupný, rezervace se dopíšou automaticky později

Bez připojeného Googlu Slotiva funguje také – obsazenost se pak počítá jen z rezervací v ní.

---

## Rychlý start

Potřebujete [Node.js](https://nodejs.org/) **22.13 nebo novější** (doporučeno 24).

```bash
npm install
```

```bash
cp .env.example .env
```

Na Windows místo toho `copy .env.example .env`. V `.env` vyplňte aspoň `ADMIN_EMAILS` – e-mail, který má mít správcovská práva.

```bash
npm run dev
```

| Co | Adresa |
|---|---|
| Web Slotivy | http://localhost:3000 |
| Registrace / přihlášení | http://localhost:3000/registrace |
| Dashboard | http://localhost:3000/app/ |
| Ukázkový web s widgetem | http://localhost:3000/ukazka-webu |

První účet si založte přes registraci. Pokud je jeho e-mail v `ADMIN_EMAILS`, dostane rovnou i správcovská práva.

```bash
npm run admin
```

Vypíše všechny účty, jejich rezervace, stav kalendáře a kdo je správce. Když někdo ztratí heslo a e-maily nejsou nastavené, vyrobíte mu odkaz:

```bash
npm run admin -- --odkaz jeho@email.cz
```

Heslo k účtu nastavíte takhle (když účet neexistuje, rovnou se založí). Heslo se zeptá, případně ho vezme z proměnné `SLOTIVA_HESLO`:

```bash
npm run admin -- --heslo vas@email.cz
```

Ukázková data – pět služeb a rezervace na šest týdnů zpět a tři dopředu, ať je vidět, jak dashboard vypadá v provozu. Do Google Kalendáře se nikdy nezapisují a nastavení účtu nemění:

```bash
npm run demo -- --email vas@email.cz
```

```bash
npm run demo -- --email vas@email.cz --smazat
```

---

## Správcovská práva

O tom, kdo je správce, rozhoduje **jediné místo** – proměnná `ADMIN_EMAILS` v `.env`:

```
ADMIN_EMAILS=vas@email.cz,kolega@email.cz
```

Práva se přidělí automaticky při registraci, při přihlášení i po restartu serveru. Kdo v seznamu není, práva nemá – i kdyby je měl dřív. Správcovský účet nejde zablokovat ani smazat z dashboardu; nejdřív se musí odebrat e-mail z `ADMIN_EMAILS`.

---

## Připojení Google Kalendáře

OAuth klienta vytvoříte **jednou pro celou Slotivu**. Uživatelé pak jen kliknou na „Připojit Google Kalendář“.

> **Podmínka:** účet Google, pod kterým to nastavujete, musí mít zapnuté **dvoufázové ověření**. Od 24. 11. 2025 bez něj Google Cloud Console vůbec nepustí dál. Zapnete ho na [myaccount.google.com/signinoptions/twosv](https://myaccount.google.com/signinoptions/twosv).

1. V [Google Cloud Console](https://console.cloud.google.com/) vytvořte projekt (např. `Slotiva`).
2. **APIs & Services → Library** → zapněte **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** → typ **External**, vyplňte název aplikace, e-mail podpory a kontaktní e-mail vývojáře. Doplňte i odkazy:
   - Application home page: `https://vase-domena.cz`
   - Privacy policy: `https://vase-domena.cz/ochrana-osobnich-udaju`
   - Terms of service: `https://vase-domena.cz/podminky`
4. V sekci se **scopes** přidejte:
   - `openid`, `userinfo.email`, `userinfo.profile`
   - `auth/calendar.events` – zápis a čtení událostí
   - `auth/calendar.readonly` – seznam kalendářů a obsazenost
5. **Credentials → Create credentials → OAuth client ID → Web application**. Do **Authorized redirect URIs** přidejte přesně:

   ```
   http://localhost:3000/auth/google/callback
   https://vase-domena.cz/auth/google/callback
   ```

6. Vzniklé ID a secret vložte do `.env`:

   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```

7. Restartujte server. V dashboardu v sekci **Kalendář a web** se objeví tlačítko „Připojit Google Kalendář“.

### Ověření aplikace u Googlu

Rozsahy ke kalendáři patří mezi **citlivé (sensitive)**, takže se aplikace neobejde bez schválení:

| Stav aplikace | Co to znamená |
|---|---|
| **Testing** | Funguje jen pro účty přidané v **Test users** (max 100). Přístup ke kalendáři vyprší po 7 dnech a je potřeba ho připojit znovu. Slotiva na to upozorní v dashboardu i e-mailem. |
| **Production, neověřená** | Funguje pro kohokoliv, ale před přihlášením se zobrazí varování „Google hasn't verified this app“. Platí limit 100 udělených souhlasů. Tokeny už nevyprší po 7 dnech. |
| **Production, ověřená** | Bez varování a bez limitu. Google chce ověření vlastnictví domény (Search Console), funkční stránky s podmínkami a ochranou údajů na stejné doméně a video s ukázkou, kde je vidět, proč aplikace kalendář potřebuje. Vyřízení trvá zpravidla několik dní až týdnů. |

Pro ostrý provoz s veřejnou registrací je cílem poslední řádek. Než ověření proběhne, běžte na **Production (neověřená)** – funguje to pro všechny, jen s varovnou obrazovkou.

### Co se stane, když…

| Situace | Výsledek |
|---|---|
| Klient si zarezervuje termín | Událost v kalendáři, e-mail klientovi i vám |
| Zapíšete si do kalendáře dovolenou | Ten čas se přestane nabízet |
| Událost označíte jako „Volno“ | Neblokuje |
| Smažete rezervaci v Google Kalendáři | V dashboardu se označí jako zrušená |
| Přesunete rezervaci v kalendáři | V dashboardu se změní čas |
| Zrušíte rezervaci v dashboardu | Událost z kalendáře zmizí, klientovi můžete poslat e-mail |
| Odpojíte kalendář | Rezervace fungují dál, jen se nezapisují; po opětovném připojení se dopíšou |

---

## E-maily (volitelné)

Bez SMTP e-maily neodcházejí, ostatní funguje. Nastavení je společné pro celou Slotivu (`.env`), adresu pro upozornění si každý uživatel nastaví v dashboardu.

```
SMTP_HOST=smtp.seznam.cz
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=rezervace@seznam.cz
SMTP_PASS=heslo
SMTP_FROM=Slotiva <rezervace@seznam.cz>
```

U Gmailu použijte [heslo aplikace](https://myaccount.google.com/apppasswords). Bez SMTP nefunguje obnova zapomenutého hesla – správce ji zastoupí odkazem z dashboardu nebo z `npm run admin -- --odkaz`.

---

## Podmínky a ochrana osobních údajů

Slotiva má připravené stránky `/podminky` a `/ochrana-osobnich-udaju`. Texty odpovídají tomu, co aplikace opravdu dělá, včetně povinného prohlášení o **Google API Services User Data Policy (Limited Use)**, které Google při ověřování vyžaduje.

Údaje provozovatele se doplňují z `.env`, do HTML se nesahá:

```
OPERATOR_NAME=Jan Novák
OPERATOR_ADDRESS=Dlouhá 1, 110 00 Praha 1
OPERATOR_ID=12345678
OPERATOR_EMAIL=podpora@vase-domena.cz
OPERATOR_HOSTING=Railway (servery v EU)
LEGAL_UPDATED=1. 3. 2026
```

Dokud `OPERATOR_NAME` není vyplněné, zůstanou v textu závorky `[DOPLŇTE]` a server na to při startu upozorní. Takovou stránku Google při ověřování neuzná.

---

## Vložení na web

Hotové kódy s vaší adresou najdete v dashboardu v sekci **Kalendář a web**. Místo `vase-adresa` bude vaše adresa stránky.

**Odkaz nebo tlačítko**

```html
<a href="https://vase-domena.cz/vase-adresa">Rezervovat termín</a>
```

**Formulář přímo ve stránce** (výška se přizpůsobí sama)

```html
<div data-slotiva="vase-adresa"></div>
<script src="https://vase-domena.cz/widget.js" async></script>
```

**Vyskakovací okno**

```html
<button type="button" data-slotiva-open="vase-adresa">Rezervovat termín</button>
<script src="https://vase-domena.cz/widget.js" async></script>
```

**Plovoucí tlačítko vpravo dole**

```html
<script src="https://vase-domena.cz/widget.js" data-slotiva-user="vase-adresa" data-floating-button="Rezervovat termín" async></script>
```

Atribut `data-service="ID"` předvybere konkrétní službu. Po dokončení rezervace widget vyvolá událost, kterou můžete použít třeba pro měření: `window.addEventListener('slotiva:booked', (e) => console.log(e.detail))`. WordPress: blok **Vlastní HTML**. Wix / Webnode: prvek **Vložit kód**.

Stránka `/ukazka-webu` ukazuje všechny varianty pohromadě na smyšleném webu. Kterou rezervační stránku má předvést, se bere z `DEMO_SLUG` v `.env` (klidně vaši vlastní), z `?u=adresa` v odkazu, nebo z právě přihlášeného účtu.

---

## Aplikace v telefonu

Dashboard jde přidat na plochu telefonu a chová se pak jako aplikace: vlastní ikona, spuštění na celou obrazovku bez adresního řádku a přihlášení, které vydrží. Nic se neinstaluje z obchodu a nic to nestojí.

- **Android:** v dashboardu **Kalendář a web → Slotiva v telefonu** klepněte na „Přidat na plochu“. Chrome instalaci obvykle nabídne i sám.
- **iPhone:** otevřete dashboard v Safari → Sdílet → „Přidat na plochu“. V jiném prohlížeči to Apple nedovolí.

Aplikace potřebuje internet, protože rezervace i nastavení se vždy načítají ze serveru – uložený je jen vzhled aplikace (`public/app/sw.js`). Bez signálu se otevře a napíše, že není připojení, s tlačítkem na další pokus.

Ikony vycházejí z loga a vytváří je `npm run ikony` (`scripts/icons.js` → `public/icons/`). Po změně loga je spusťte znovu.

## Nasazení na internet

Slotiva je jedna Node.js aplikace se SQLite databází. Hosting musí mít **trvalý disk** pro `DATA_DIR` – jinak se při novém nasazení smažou data i klíč `.secret`, kterým jsou zašifrované tokeny ke kalendářům. Kvůli SQLite běží vždy **jedna instance** (bez škálování do více replik).

### Railway

1. Nahrajte projekt na GitHub (`.env` a `data/` jsou v `.gitignore`).
2. **New Project → Deploy from GitHub repo**. Soubor `railway.json` už nastavuje start i kontrolu stavu na `/healthz`.
3. **Add Volume** připojený na `/data`.
4. **Variables** – proměnné z tabulky níže, včetně `DATA_DIR=/data`.
5. **Settings → Networking → Generate Domain** (nebo vlastní doména). Stejnou adresu dejte do `PUBLIC_BASE_URL` i do redirect URI v Google Cloud.

### Render

Repozitář obsahuje `render.yaml` – stačí **New → Blueprint** a doplnit proměnné označené `sync: false`. Disk je připojený na `/data` (vyžaduje placený plán).

### Vlastní VPS

```bash
npm ci --omit=dev && npx pm2 start npm --name slotiva -- start
```

Před aplikaci dejte Nginx s HTTPS (certbot) a přeposílejte na `http://127.0.0.1:3000` s hlavičkami `X-Forwarded-For` a `X-Forwarded-Proto`.

### Proměnné pro produkci

| Proměnná | Hodnota |
|---|---|
| `NODE_ENV` | `production` |
| `PUBLIC_BASE_URL` | `https://vase-domena.cz` |
| `SESSION_SECRET` | náhodný řetězec, min. 32 znaků (šifruje tokeny Google) |
| `DATA_DIR` | trvalý disk, např. `/data` |
| `ADMIN_EMAILS` | e-maily správců oddělené čárkou |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | z Google Cloud Console |
| `OPERATOR_*`, `LEGAL_UPDATED` | údaje do Podmínek a Ochrany osobních údajů |
| `ALLOW_REGISTRATION` | `false`, pokud účty zakládáte jen vy |
| `ALLOWED_EMBED_ORIGINS` | `*`, když si uživatelé vkládají rezervace na vlastní weby |
| `DEMO_SLUG` | rezervační stránka pro `/ukazka-webu` |
| `SMTP_*` | volitelně, pro e-maily |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Nezapomeňte:** zálohovat `data/slotiva.db` i `data/.secret`. Bez `.secret` (nebo `SESSION_SECRET`) se nedají rozšifrovat tokeny ke kalendářům a všichni uživatelé si musí kalendář připojit znovu.

---

## Bezpečnost

- Hesla se ukládají jako **scrypt** hash, přihlášení drží podepsaná HttpOnly cookie (po změně hesla se odhlásíte i na ostatních zařízeních).
- **Tokeny ke Google Kalendáři jsou v databázi zašifrované** (AES-256-GCM klíčem odvozeným ze `SESSION_SECRET`).
- Změny přes API projdou jen jako JSON ze stejného původu (ochrana proti CSRF), limity požadavků na přihlášení, registraci i rezervace.
- Dashboard a přihlášení nelze vložit do cizího webu (`frame-ancestors none`), rezervační stránky ano.
- Data jsou oddělená po uživatelích – každý dotaz je omezený na přihlášený účet (pokryto testy).
- Zablokovaný účet se okamžitě odhlásí na všech zařízeních a nepustí ho ani přihlášení přes Google.
- Správcovská část je za dvojí kontrolou: přihlášení + příznak správce v databázi.

## Struktura projektu

```
server.js               spuštění serveru (Express)
railway.json            nastavení pro Railway
render.yaml             nastavení pro Render
src/
  config.js             .env a tajný klíč
  db.js                 SQLite (users, services, bookings, google_connections…)
  users.js, crypto.js   účty, hesla, šifrování, podepsané tokeny
  admin.js              přehled platformy a správa účtů
  auth.js               přihlašovací cookie
  settings.js           nastavení uživatele
  availability.js       výpočet volných časů
  bookings.js           rezervace, kontrola kolizí, synchronizace
  google.js             OAuth a Google Calendar API
  stats.js, emails.js, mailer.js, ics.js, http.js, validate.js
  routes/               auth.js (účty), public.js (rezervace), app.js (dashboard), admin.js (správa)
public/
  index.html            web Slotivy
  auth.html             přihlášení, registrace, obnova hesla
  booking.html          rezervační stránka uživatele (/adresa)
  manage.html           správa rezervace klientem
  podminky.html         podmínky používání
  soukromi.html         ochrana osobních údajů
  widget.js             vložení na cizí web
  ukazka-webu.html      ukázkový web
  app/                  dashboard (+ sw.js a manifest.webmanifest = aplikace na ploše)
  icons/                ikony aplikace (vytváří npm run ikony)
scripts/admin.js        přehled účtů, hesla a odkazy na heslo z příkazové řádky
scripts/demo.js         ukázková data pro jeden účet
scripts/icons.js        ikony aplikace vykreslené z loga
test/                   automatické testy
```

## Testy

```bash
npm test
```

Pokrývají výpočet volných časů (včetně přechodu na letní čas), formát `.ics`, hesla a šifrování a celý průchod API: registrace, rezervace, dvojitá rezervace, oddělení dat mezi uživateli, změna adresy i hesla, smazání účtu a přístup do správcovské části.

## Omezení

- Jeden účet = jeden kalendář (jedna osoba nebo místnost). Pro víc pracovníků pod jedním účtem by bylo potřeba rozšíření.
- Běží jako jedna instance (SQLite) – pro desítky až stovky uživatelů to stačí.
- E-mail se při registraci neověřuje a online platby nejsou součástí.
