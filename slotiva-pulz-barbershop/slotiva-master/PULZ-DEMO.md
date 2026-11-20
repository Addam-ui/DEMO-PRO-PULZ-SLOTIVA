# Pulz Barbershop – demo

Tato úprava přidává příkaz `npm run demo:pulz` a **nemění původní obecný demo skript**.

## Použití

1. Udělejte zálohu databáze `slotiva.db` a spusťte aplikaci s trvalým uložištěm.
2. Přihlaste se / založte účet, pro který chcete demo.
3. Ve stejném prostředí jako běží aplikace spusťte:

```bash
npm run demo:pulz -- --email VAS_PRIHLASOVACI_EMAIL
```

Příkaz vytvoří tři služby, fiktivní rezervace (42 dní zpět, 21 dní dopředu) a nastaví profil Pulz Barbershop. Nemění otevírací dobu ani nepřidává skutečné účty barberů. Fiktivní rezervace mají `source=demo` a nezapisují se do Google Kalendáře.

Odstranění demo rezervací a jím vytvořených služeb:

```bash
npm run demo:pulz -- --email VAS_PRIHLASOVACI_EMAIL --smazat
```

**Pozor:** Smazání nevrací změny profilu podniku. Příkaz nevykonávejte opakovaně bez smazání dat. Existující služby zůstávají zachované, takže pokud již máte stejné služby, mohou se zobrazit duplicitně.

## Render

Repozitář obsahuje `render.yaml` pro placený Starter a persistent disk `/data`. Pokud používáte bezplatnou instanci Render bez disku, SQLite data se po redeployi/restartu mohou ztratit. Pouhé pushnutí kódu **nespustí seed**; příkaz musí běžet v prostředí se stejnou databází. Neprovádějte seed v build commandu.

## Barbeři

Kikin a Honza jsou podklady pro budoucí funkci výběru barbera. Aktuální datový model Slotivy váže rezervace na uživatele, nikoli na zaměstnance; výběr konkrétního barbera by vyžadoval změnu databáze, dostupnosti a rezervačního formuláře.
