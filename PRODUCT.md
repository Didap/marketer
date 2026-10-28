# Marketer

Agente commerciale AI di didap, attivo H24 sul Mac. Trova potenziali clienti in Italia e
all'estero, li studia, propone idee su misura e prepara i messaggi su ogni canale. Usa come
prova i lavori e i prodotti che didap ha già fatto. Dalla dashboard locale lo si comanda e si
vede cosa fa, e via MCP mette in coda lavori che Claude Code esegue in locale.

Modello di partenza: explee.com (ICP dal sito, lead, email personalizzate, risposte, call,
campagne che si autoregolano sul costo per lead). Marketer lo copia e va oltre su quattro
punti: audit del prospect, motore di idee, demo su misura, leva sui clienti passati.

Uso **solo interno didap**: non è un prodotto da vendere. Decisioni prese con William il
21/10/2026.

## Decisioni

| Tema | Scelta |
|---|---|
| Target | PMI italiane, aziende estere, persone fisiche (queste ultime solo inbound o con consenso) |
| Mercati | Italia, poi Spagna e Francia, USA e Canada, Svizzera e DACH |
| Offerta | Prodotti didap adattati, sviluppo su misura, AI per aziende, formazione |
| Canali | Email, LinkedIn, telefono e WhatsApp, inbound e contenuti |
| Mittenti | Più persone didap, ognuna con identità, lingue e caselle proprie |
| Autonomia | Per ora William approva **ogni** messaggio. L'autopilota arriva dopo, campagna per campagna |
| Approvazioni | Dashboard e telefono (notifica con Approva, Modifica, Scarta) |
| Dove gira | Tutto sul Mac: dashboard, worker, scheduler (launchd), job Claude Code headless |
| Dati storici | Solo repo in `/Users/w` e sito didap (`/Users/w/didap`) |
| Fonti lead | Registro Imprese, Google Maps, segnali |
| Budget extra token | Si parte piccoli e si scala sui canali che portano call, con tetto in dashboard |
| Stack | Nuxt 4, Drizzle, SQLite locale, `@modelcontextprotocol/sdk` |

## Architettura

Tutto in questo repo, tutto sul Mac.

1. **App Nuxt** (dashboard e API) su `localhost`, raggiungibile dal telefono solo via
   Tailscale. Mai esposta su Internet.
2. **Worker** (processo Node separato, tenuto vivo da launchd, Mac tenuto sveglio con
   `caffeinate`). Fa il lavoro meccanico senza LLM: importa lead, arricchisce, lancia gli
   audit, invia i messaggi già approvati dentro finestre e tetti, legge le risposte via IMAP,
   cerca i segnali, manda le notifiche.
3. **Runner dei job**. Il lavoro di testa (ricerca di segmenti, idee, testi, risposte, demo)
   diventa un job in coda. Il runner lancia `claude -p --model opus --output-format
   stream-json` con il server MCP di Marketer, nella cartella giusta. Ogni evento dello
   stream finisce in `job_events` e in dashboard via SSE. A fine job salva token e costo.
   I job lavorano a lotti (un job, molti prospect) per spendere meno contesto.
4. **Server MCP** (`/mcp`, HTTP streamable, solo localhost, con token). Funziona nei due
   sensi: da terminale Claude Code usa Marketer come strumento, e i job lanciati dal runner
   leggono e scrivono attraverso gli stessi tool.
5. **Notifiche e approvazioni sul telefono** con un bot Telegram in long polling, quindi
   nessun webhook pubblico. Bottoni Approva, Modifica, Scarta. Rapporto del giorno la sera.

### Guardia sui token

Regola di William: al massimo il 14% dei token settimanali al giorno. Il runner tiene il
conto dei token per giorno. Il tetto si imposta in dashboard e si tara sui consumi reali.
Al tetto i job nuovi restano in coda e la dashboard dice perché. Un job di demo chiede
sempre conferma prima di partire, perché è il più caro.

## Base legale e canali

Ogni contatto ha una `legal_basis`: `consent`, `existing_customer` (soft spam, art. 130 c.4
Codice Privacy: servizi simili, opt-out in ogni messaggio), `b2b_optout` (dove la legge lo
permette), `public_office`, `inbound_only`. Prima di accodare un messaggio, il motore incrocia contatto,
paese e canale con la matrice e blocca quello che non è ammesso. Ogni email ha opt-out e
`List-Unsubscribe`. La suppression list vale per tutte le identità.

Default prudenti della matrice. **Vanno verificati con un legale prima della Fase 5.**

| Mercato | Email a freddo B2B | Riferimento |
|---|---|---|
| Italia | No, serve consenso (anche per indirizzi pubblici sul web) | art. 130 Codice Privacy, linee guida Garante sullo spam |
| Spagna | No, serve consenso | LSSI |
| Germania, Austria | No, serve consenso | UWG, TKG |
| Svizzera | No, serve consenso | UWG |
| Francia | Sì se il messaggio riguarda il ruolo del destinatario, con opt-out | CNIL |
| USA | Sì, con opt-out e indirizzo fisico | CAN-SPAM |
| Canada | Solo con consenso implicito (indirizzo pubblicato, messaggio pertinente al ruolo) | CASL |
| Persone fisiche, ovunque | No | solo inbound o consenso |

`public_office` (decisione di William del 24/10/2026): sindaci e assessori ai loro indirizzi
istituzionali, che il Comune pubblica per il ruolo. Email ammessa con un messaggio che riguarda il
ruolo e la riga per non ricevere altro; telefono al numero del Comune o della segreteria; WhatsApp no.
Le caselle personali non si usano. È la base dei Comuni trovati da `it_comuni`. Da far vedere a un
legale prima di scalare gli invii: il Garante ritiene che un indirizzo pubblicato non sia per questo
libero per proposte commerciali.

Conseguenza pratica: la cold email in stile Explee rende soprattutto in USA, Canada e Francia.
In Italia, Spagna e DACH il lavoro dell'agente è ricerca, audit e idee su misura, che poi
passano per LinkedIn, telefono, inbound, referral e clienti passati.

- **LinkedIn**: nessuna automazione, perché viola i termini e porta al ban. L'agente prepara
  la lista del giorno per ogni mittente (profilo, nota di collegamento, messaggio) e il
  mittente invia a mano e segna fatto.
- **Telefono e WhatsApp**: lista da chiamare con uno script per azienda e l'esito da
  registrare. WhatsApp solo con chi ha dato il consenso, con link `wa.me` precompilato.
- **Inbound**: il modulo "audit gratuito" sta sul sito didap e scrive a una casella che il
  worker legge via IMAP, così il Mac non si espone. Post e SEO passano da Verso via MCP.

## Funzioni

### Portfolio (la leva)
Prodotti, casi studio e clienti passati, ricavati dai repo in `/Users/w` (README, PRODUCT.md)
e dai contenuti del sito didap. William li corregge in dashboard. Ogni caso ha settore,
problema, soluzione, risultati e stack. Servono per le prove nei messaggi, per trovare
aziende simili ai clienti passati e per le sequenze di referral.

- L'import è un job Opus in sola lettura ogni 8 fonti circa. Le voci nascono **da rivedere**.
- Come prova in un messaggio vale solo una voce **confermata**, e il nome del cliente o del
  prodotto si fa solo se la voce è **citabile** (di partenza solo quello che sta sul sito).
- Su una voce già rivista o corretta da William un job non scrive: lascia una proposta che
  lui applica o scarta. Le note di William per l'agente non le tocca nessun job.
- Una fonte che non è materiale da portfolio si ignora, con il motivo, finché non la si riprende.

### Prospect
- **Fonti**: Registro Imprese via API a pagamento (es. OpenAPI.it), Google Maps (Places API),
  registri esteri gratuiti dove ci sono (Francia: API Recherche d'entreprises; Svizzera:
  Zefix).
- **Segnali**: aziende appena nate, bandi e finanziamenti vinti, siti vecchi o lenti, assunzioni
  IT, gare (riusa la logica di `/Users/w/gare-monitor`).
- **Scoring**: fit (settore, dimensione, mercato), bisogno (difetti trovati dall'audit),
  freschezza del segnale. I segmenti si ordinano per punteggio, come in Explee.

Come funziona dalla Fase 3:

- Un **segmento** ha mercato, settore (con le parole del portfolio) e da 1 a 10 ricerche, ognuna
  su una fonte. Un job di Opus in sola lettura li propone dal portfolio (bottone *Proponi
  segmenti*): nascono *proposti* e li accende William. Le ricerche partono solo dal bottone
  *Cerca ora* o dal tool `segment_search`, mai da un job, perché due fonti su tre si pagano.
- Le **ricerche** le fa il worker, senza LLM. Google Places (New) con `GOOGLE_PLACES_API_KEY`,
  Registro Imprese con l'API Company di OpenAPI.it (`OPENAPI_COMPANY_TOKEN`, arricchimento
  `start`, si paga a record), registro francese gratuito. Senza chiave una fonte resta spenta e
  la dashboard lo dice. I registri non danno il sito: se Places è acceso, il worker lo cerca su
  Maps per nome e città (una chiamata a pagamento per azienda nuova), altrimenti lo scrive William.
- Francia: si tengono solo le aziende con la **sede** nel dipartimento cercato, e gli
  imprenditori individuali (persone fisiche) si scartano. Zefix rimandato: cerca solo per nome
  e chiede credenziali, quindi serve ad arricchire, non a trovare.
- Lo stesso prospect non si duplica: lo riconoscono numero di registro, scheda di Maps o dominio.
- **Punteggio** da 0 a 100: 40% fit (dimensione, settore presente nel portfolio confermato,
  sito o telefono), 40% bisogno (somma dei difetti dell'audit, 70 se Maps conosce l'azienda e
  non ha un sito, 30 se non si sa ancora), 20% freschezza (anni dalla nascita dell'azienda). Un
  segmento vale la media dei suoi dieci prospect migliori. I punteggi si rifanno ogni ora.
- Gli altri segnali (bandi, assunzioni IT, gare) arrivano dopo: per ora la freschezza è solo la
  data di nascita.
- **Comuni** (dal 23/10/2026, per CityFix): fonte `it_comuni`, gratuita, dai dati aperti.
  L'Anagrafe degli amministratori locali del Ministero dell'Interno dà sindaco, giunta, liste e
  abitanti; l'elenco ISTAT codice, regione e provincia; IndicePA sito, PEC e indirizzo. Si cerca
  per regione, provincia e fascia di abitanti. Un Comune si riconosce dal codice ISTAT, e ogni
  ricerca riscrive giunta, data di elezione e orientamento. L'orientamento si legge dalle liste
  del sindaco: centrodestra in nero, centrosinistra in rosso, civica (grigio) quando le liste non
  lo dicono.
- **Segnali dei Comuni** (`pnpm segnali <regione>`, dal 23/10/2026): dai dati aperti, per ogni
  Comune già trovato. PNRR di Italia Domani (progetti di rigenerazione urbana, PINQuA, piani
  urbani integrati, borghi, verde urbano, sport e inclusione; misure di PA digitale 2026),
  OpenCoesione (progetti urbani di cui il Comune è beneficiario), ANAC (affidamenti di
  manutenzione di strade, verde, illuminazione e decoro fino a 500.000 euro dal 2024, e acquisti
  di piattaforme di segnalazione), il sito del Comune (cosa offre oggi a chi vuole segnalare) e,
  in Puglia, le app di segnalazione tra i dati aperti della Regione. Ogni segnale è una frase da
  citare con la sua fonte e, dove c'è, il link per verificarla (OpenCUP, OpenCoesione, il sito).
  Le fonti grandi restano in cache 30 giorni.
- **Contatti della giunta** (`pnpm contatti <Comune>`, dal 24/10/2026): dal sito del Comune, per
  sindaco e assessori già noti dall'Anagrafe, l'email istituzionale (mai le caselle generiche né la
  PEC), le deleghe e la pagina da cui vengono. Le deleghe dicono chi conta per CityFix (interventi
  sul territorio, innovazione e digitale, fondi e bilancio, ambiente e rifiuti, sicurezza urbana).
  Restano alla persona anche quando una nuova ricerca riscrive la giunta. Scrivere a queste
  caselle resta soggetto alla matrice legale.
- Punteggio dei Comuni: 30% fit, 30% bisogno, 40% freschezza (giunta eletta da meno di 6 mesi
  100, da meno di un anno 80, poi 50, 30 e 10). Con i segnali, il fit è rigenerazione urbana
  (0-40: 10 se ha progetti, più il percentile regionale degli euro, metà per abitante e metà
  assoluti), digitale (0-30: 5 punti per ogni misura di PA digitale oltre la terza, più 5 se il
  sito segue il modello nazionale) e spazio per CityFix (30 se non c'è modo di segnalare, 22 se
  c'è un modulo generico, 6 se c'è già una piattaforma con mappa o ne ha comprata una); il
  bisogno è il numero di affidamenti di manutenzione (10 se nessuno, poi da 20 a 100 col
  percentile regionale). Senza segnali, fit da abitanti, portfolio e sito, e bisogno 70 se in home
  non c'è uno strumento di segnalazione, 20 se c'è. Per i Comuni l'audit legge solo la home,
  senza Lighthouse.

### Audit del prospect
Per ogni sito: velocità e mobile (Lighthouse), SEO di base, accessibilità, stack (CMS,
framework, versioni vecchie), HTTPS, form e prenotazioni. I difetti più concreti diventano
l'aggancio del messaggio.

Lo fa il worker, uno alla volta, appena un prospect ha un sito: lettura della home (con e senza
www, https e http) e Lighthouse su mobile con il Chrome del Mac, senza finestre, circa un minuto
a sito. Ogni difetto ha un peso da 1 a 3 e un testo in italiano già pronto per un messaggio. Le
soglie delle versioni vecchie (WordPress, Joomla, Drupal, jQuery, PHP) sono di ottobre 2026 e
vanno riviste quando escono versioni nuove. Social e vetrine (Facebook, Instagram, TheFork) non
contano come sito.

### Strategie di contatto
Dal 24/10/2026. Per un target o per un gruppo di target (fino a 30), un job di Opus in sola lettura
scrive la strategia da tutti i dati dei prospect (persone e deleghe, segnali dai dati aperti, colore
politico, freschezza della giunta, audit) e dal portfolio: in breve, perché adesso, chi contattare e
in che ordine, gli agganci con la fonte, il tono, canali e sequenza, obiezioni, prossimi passi, e il
primo messaggio. I canali li decide la matrice legale, che il prompt riporta per ogni target: se
l'email non è ammessa la strategia lo dice e propone la strada ammessa. Per ogni persona il job
cerca il profilo LinkedIn sul web (LinkedIn non si apre senza accesso) e lo segna attivo, poco attivo
o assente con la prova: LinkedIn si aggiunge all'email solo con chi è attivo. Il tono è rilassato, la
proposta è un regalo alla città (mai alla persona), semplice da attivare, e si chiede una chiamata di
10 minuti. Il colore politico serve solo
al tono, mai nei messaggi. William la rivede, scrive le note, la fa riscrivere, la approva o la
archivia, e la scarica in .md. Si avvia dalla scheda del prospect o selezionando più prospect nella
lista; i job delle bozze la ritrovano con strategy_get.

### Motore di idee
Per ogni prospect 2 o 3 idee concrete: un prodotto didap adattato al suo settore (es. Quadra
per uno studio di consulenza del lavoro), un'idea AI su misura, un lavoro veloce dall'audit.
Ogni idea ha il pitch, lo sforzo stimato, una fascia di prezzo e il caso studio più vicino.

### Demo su misura
Per i prospect migliori, su conferma di William, un job di sviluppo crea in
`demos/<prospect>` una mini demo o un mockup con il brand del prospect (logo e colori presi
dal sito), più gli screenshot. Pubblicarla è un passo a parte, sempre approvato.

### Campagne e messaggi
Una campagna ha segmento, mercato, lingua, identità mittente e sequenza di passi su più
canali (es. giorno 0 email, giorno 3 LinkedIn, giorno 7 follow-up, giorno 10 chiamata). Ogni
messaggio nasce come bozza, va in coda di approvazione e parte solo dopo l'approvazione. Lo
stato della campagna (In crescita, Funziona, In pausa) dipende dal costo per call.

Come funziona dalla Fase 4:

- Le bozze si scrivono solo per i prospect che William ha **qualificato**, con il bottone
  *Prepara bozze* della campagna: un job di Opus in sola lettura ogni 5 prospect. Se un prospect
  non ha idee, il job le scrive prima. Le idee si possono anche chiedere dalla scheda del prospect.
- La **matrice legale** sta nel codice (`server/lib/legal.ts`) e si vede in Impostazioni. Il job
  riceve solo i passi ammessi per ogni prospect, il tool `message_draft` rifiuta gli altri, e
  all'approvazione la matrice si ricontrolla, perché la base legale può essere cambiata.
- Il job non scrive l'opt-out: lo aggiunge l'invio (Fase 5), con `List-Unsubscribe`.
- Una bozza ancora da approvare si può riscrivere (dal job o da William); approvata o scartata,
  non si tocca più. Un messaggio approvato aspetta l'invio della Fase 5.
- Il **bot Telegram** (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) gira nel worker in long
  polling e risponde solo alla chat di William. Manda ogni bozza nuova (tre per giro) con
  Approva, Modifica, Scarta. Modifica chiede il testo nuovo in risposta, poi rimanda la bozza.
  Alle 19 il rapporto delle ultime 24 ore; qualunque altro messaggio al bot lo chiede subito.

### Risposte
Il worker legge le caselle via IMAP e classifica le risposte: interessato, non ora, togliere,
fuori ufficio, bounce, persona sbagliata o referral. Per gli interessati un job scrive la
bozza di risposta con il link di prenotazione e William riceve subito la notifica.

### Referral e riattivazione
Sequenze per i clienti passati: check-in, novità e prodotti nuovi pertinenti, richiesta di
referenze e recensioni. Base legale: `existing_customer`.

### Invio email
Domini secondari per ogni identità, mai `didap.it` per l'outbound. Controllo di SPF, DKIM e
DMARC dalla dashboard, rampa di riscaldamento con tetti giornalieri che salgono, pausa
automatica della casella se crescono bounce o reclami.

## Dashboard

- **Oggi**: cosa ha fatto l'agente, cosa sta facendo, token del giorno contro il tetto, call
  fissate, costo per call.
- **Approvazioni**: la coda dei messaggi, con il contesto del prospect accanto (audit, idee,
  timeline).
- **Prospect**: tabella con filtri e scheda (dati, audit, idee, base legale, timeline).
- **Campagne**, **Risposte**, **Task manuali** (LinkedIn e chiamate del giorno per mittente).
- **Job**: coda, log in diretta, token e costo per job. Da qui si lancia anche un job libero
  in qualsiasi cartella.
- **Portfolio**: prodotti, casi studio, clienti passati.
- **Impostazioni**: identità, caselle e domini, matrice legale, budget, tetto token.

## Fasi

Ogni fase è una sessione corta e chiude con qualcosa che si vede funzionare.

1. **Fondamenta**. Scaffold Nuxt 4, schema SQLite e Drizzle, worker sotto launchd, runner dei
   job con log in diretta, server MCP con i primi tool, guardia sui token, pagine Oggi e Job.
   *Fatto quando*: dalla dashboard si accoda un job, Claude lo esegue, il log scorre, i token
   restano salvati, e da terminale `claude mcp list` mostra `marketer`.
2. **Portfolio**. Import da repo e sito didap, revisione in dashboard.
3. **Prospect e audit**. Google Maps, Registro Imprese, registri esteri, audit, scoring,
   segmenti.
   *Fatto quando*: dalla dashboard si crea un segmento, la ricerca salva i prospect con il
   punteggio, il worker fa l'audit dei siti e la scheda del prospect mostra i difetti.
4. **Idee e messaggi**. Motore di idee, bozze per canale e lingua, coda di approvazione,
   bot Telegram, controllo della matrice legale.
   *Fatto quando*: da una campagna si preparano le bozze per i prospect qualificati, la matrice
   salta i passi non ammessi, e le bozze si approvano, correggono o scartano dalla dashboard e
   da Telegram.
5. **Invio e risposte**. Domini e caselle, riscaldamento, SMTP con tetti, IMAP,
   classificazione, link di prenotazione, task LinkedIn e chiamate.
6. **Leve**. Referral e riattivazione, demo su misura, modulo audit gratuito sul sito didap.
7. **Autopilota**. Autonomia per campagna con soglie, pausa automatica sulle metriche
   cattive, budget che scala sul costo per call.

## Da preparare (William)

Non blocca la Fase 1.

- Mittenti: nomi, ruoli, lingue, profilo LinkedIn di ognuno.
- Domini secondari e provider delle caselle (prima della Fase 5).
- Chiave Google Cloud per Places API e account OpenAPI.it (Fase 3): vanno in `.env` come
  `GOOGLE_PLACES_API_KEY` e `OPENAPI_COMPANY_TOKEN`, poi `pnpm service restart`.
- Mac attaccato alla corrente: a batteria `caffeinate` non lo tiene sveglio, e ricerche e
  audit si fermano finché dorme.
- Bot Telegram (BotFather) e Tailscale su Mac e telefono (Fase 4): in `.env`
  `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`, poi `pnpm service restart`.
- Mittenti in Impostazioni: c'è William, da completare con ruolo, firma e LinkedIn.
- Link di prenotazione: Cal.com o Google Calendar (Fase 5).
- Verifica legale della matrice (prima della Fase 5).
