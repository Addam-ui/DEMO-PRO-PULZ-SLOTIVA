# PULZ Barbershop – oprava dema

- Po přihlášení majitele se při načtení `/api/app/meta` doplní demo data i pro dříve založený účet.
- Nový dashboard automaticky vybere prvního aktivního barbera, aby se rezervace zobrazily.
- Aktualizována cache PWA a načítání JS.
- Správa týmu je v menu jako **Správa týmu**.
- Pro přepínání barberů použijte Správa týmu.

## Render

Rozbalte ZIP a nahrajte **obsah kořenové složky** na GitHub. Render Root Directory nechte prázdné. Build: `npm ci --omit=dev`, Start: `npm start`. Pokud ponecháte projekt v podsložce, Root Directory musí ukazovat na složku obsahující `package.json`.

Po deployi se odhlaste a přihlaste nebo obnovte dashboard. Není třeba nový účet ani Render Shell.

**Upozornění:** Render Free nemá perzistentní SQLite. Data se mohou po restartu či deployi ztratit. Demo se pro nově založený účet vytvoří znovu.
