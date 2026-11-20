# PULZ – automatické demo (Render Free)

1. Rozbalte ZIP a nahrajte **obsah složky** do kořene nového GitHub repozitáře (v kořeni musí být `package.json`).
2. Na Renderu: Root Directory prázdné, Build Command `npm ci --omit=dev`, Start Command `npm start`.
3. Na nové, prázdné databázi zaregistrujte **první účet** – ten bude majitelem. Při registraci se automaticky vytvoří dva členové týmu (Kikin a Honza), služby PULZu a přibližně 300–400 fiktivních rezervací.
4. V dashboardu otevřete Správa týmu, vyberte Kikina nebo Honzu a přepněte jejich kalendář. Nic není potřeba spouštět v Render Shellu.
5. Demo účty mají z bezpečnostních důvodů zpočátku **vypnuté přihlášení**. V části Správa týmu → Aktivovat účet barbera jim majitel může nastavit skutečný e-mail a nové heslo. Nezadávejte do dema reálná zákaznická data.

**Důležité:** Automatika se spouští při registraci prvního účtu na prázdné databázi. Pokud už jste účet zaregistrovali, na téže databázi se demo samo zpětně nevytvoří. Pro nové demo použijte čistou instanci/databázi.

**Render Free:** SQLite není trvalé úložiště. Po restartu, uspání či redeployi se data včetně účtů mohou ztratit. Toto je pouze krátkodobá ukázka, nikoliv produkční řešení.

Demo zákazníci jsou smyšlení, mají neplatné adresy na doméně example.invalid, rezervace mají source=demo a neposílají se do Google Kalendáře.
