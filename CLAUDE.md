# Marketer

Il prodotto, le decisioni e le fasi stanno in [PRODUCT.md](PRODUCT.md): è l'autorità.

- Testi, commenti e copy in italiano, salvo i messaggi ai prospect esteri (lingua del mercato).
- Niente trattini lunghi (U+2014) né medi (U+2013) da nessuna parte, come in tutto didap.
- Nessun messaggio a un prospect parte senza approvazione, finché una campagna non ha
  l'autopilota acceso.
- Nessun canale passa senza il controllo della matrice legale (base legale, paese, canale).
- I job Claude girano solo su Opus e rispettano il tetto giornaliero dei token.

## Comandi

Node 26.11.1 (`.nvmrc`): con un altro Node `better-sqlite3` non si carica, quindi prima `nvm use`.

- `pnpm check`: trattini, typecheck di app e worker, test. Poche righe, esce con un codice.
- `pnpm db:generate` dopo ogni modifica a `server/db/schema.ts`; il worker applica le migrazioni all'avvio.
- `pnpm build && pnpm service restart`: rimette in servizio l'app dopo una modifica.
- `pnpm service install | uninstall | restart | status`: app (`127.0.0.1:4310`) e worker sotto launchd.
  Log in `data/logs/`.
- `pnpm dev`: app di sviluppo su `127.0.0.1:4311`, accanto a quella in servizio.
- `pnpm mcp:register`: registra `marketer` in Claude Code (scope utente) con il token di `.env`.
- `pnpm segnali <regione>`: segnali dei Comuni dai dati aperti (PNRR, OpenCoesione, ANAC, siti) per il fit
  di CityFix. Serve `python3`; scarica circa 2 GB la prima volta, poi usa la cache per 30 giorni.
  Il percorso dei file PNRR cambia a ogni rilascio di Italia Domani: è in `scripts/segnali_comuni.py`.
- `pnpm contatti <Comune>`: email istituzionali e deleghe di sindaco e giunta dal sito del Comune, con la
  pagina di fonte. Un Comune per volta.

Fonti a pagamento dei prospect: `GOOGLE_PLACES_API_KEY` e `OPENAPI_COMPANY_TOKEN` in `.env`
(senza, restano spente). Bot Telegram: `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` (senza, spento). Gli audit usano Lighthouse con il Chrome installato
(`MARKETER_CHROME_PATH` per sceglierne un altro); il codice di Lighthouse sta solo in `worker/`.

Codice condiviso da app e worker in `server/db` e `server/lib`, senza auto-import di Nuxt.
