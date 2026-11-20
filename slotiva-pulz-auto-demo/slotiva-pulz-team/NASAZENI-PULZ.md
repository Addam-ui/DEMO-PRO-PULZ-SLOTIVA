# PULZ Barbershop – týmová verze Slotivy

## Render

Nahrajte **obsah této složky** do kořene GitHub repozitáře, nikoli ZIP. Root Directory na Renderu nechte prázdné. Build: `npm ci --omit=dev`, Start: `npm start`. Node 22 nebo 24.

## První použití

1. Zaregistrujte si **vlastní účet majitele** (e-mail si zvolte sami).
2. V aplikaci otevřete **Správa týmu** a vytvořte Kikinovi a Honzovi účty s jejich **vlastními e-maily a hesly**. Hesla neposílejte přes chat.
3. Na stejné stránce stiskněte **Vytvořit demo rezervace pro tým**. Akce je idempotentní – při opakování nevkládá další demo pro již naplněné členy.
4. V přepínači vyberte Kikina nebo Honzu a otevřete kalendář.
5. Zákazníci na veřejném odkazu majitele vybírají barbera a jeho službu.

## Důležitá omezení

- Účty zaměstnanců jsou oddělené a mají vlastní kalendář, služby a přihlášení. Majitel může mezi nimi přepínat v sekci Správa týmu.
- Demo rezervace jsou fiktivní, s adresami `example.com`; nejsou odesílány zákazníkům.
- Deaktivovaný zaměstnanec nemá přístup do aplikace; po opětovné aktivaci se může vrátit.
- Týmová verze používá SQLite jako původní Slotiva. **Render Free nemá perzistentní disk: po restartu/deployi se mohou ztratit účty i rezervace.** Pro produkci je nutná trvalá databáze.
- Nejde o plně otestovanou produkční verzi; před reálným provozem ověřte celý proces rezervace, oprávnění a e-mailové notifikace.
