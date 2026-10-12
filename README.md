# Agria Scout

Estensione Chrome per il prospecting di Agria System. Il commerciale apre il sito ufficiale di
un prospect, apre Agria Scout nel pannello laterale e preme **Scansione approfondita**: Scout
legge le pagine informative dello stesso sito (Contatti, Chi siamo, Team, pagine legali…) e
prepara i form **Azienda** e **Contatto** con le proprietà HubSpot di Agria. Ogni valore porta
con sé la pagina da cui viene, il metodo di rilevazione e l'affidabilità, e si corregge a mano.
HubSpot resta il CRM: Scout prepara i dati, non li conserva.

Costo zero: nessun server, nessun database, nessuna API a pagamento o di Google, nessuna AI,
nessuno scraping di Google Maps.

## Stato: cosa è reale e cosa è MOCK

| | |
|---|---|
| **Reale** | Scansione approfondita del sito (link interni + sitemap, stesso dominio, una pagina alla volta, annullabile), analisi della sola pagina aperta, estrazione di tutti i dati pubblici, accumulo e deduplica tra pagine, form HubSpot Azienda e Contatto, persone rilevate, contesto rapido, correzioni a mano, bozza conservata alla riapertura del pannello, impostazioni. |
| **MOCK** | **Verifica HubSpot.** Risponde in base allo scenario scelto nelle Impostazioni (*Azienda non presente*, *Azienda già presente*, *Errore HubSpot*). Nessuna chiamata a HubSpot, nessuna lettura, nessuna scrittura, nessuna credenziale. Il badge **HubSpot MOCK** resta sempre visibile. |
| **Non ancora presente** | Creazione o aggiornamento di Azienda e Contatto in HubSpot, invio email, follow-up, collegamento al Navigatore Chiamata. |

## Installazione

1. Apri `chrome://extensions` e attiva **Modalità sviluppatore** (in alto a destra).
2. **Carica estensione non pacchettizzata** e scegli la cartella **`agria-scout/extension`**
   (quella che contiene `manifest.json`).
3. Fissa Agria Scout nella barra (icona del puzzle → puntina). Un clic sull'icona apre il pannello.
4. Apri **Impostazioni** e indica nome e **ID owner HubSpot** del commerciale.

**Aggiornare dopo una nuova versione del codice:** in `chrome://extensions` premi ↻ sulla scheda
di Agria Scout, poi chiudi e riapri il pannello laterale. Le impostazioni restano; la bozza in
corso di una versione precedente si azzera. Serve Chrome 116 o successivo.

## Uso

1. Apri il sito del prospect (qualunque pagina) e clic sull'icona di Agria Scout.
2. **Scansione approfondita**: avanzamento «Analisi pagina 7 di 23…», si può annullare in ogni
   momento conservando quanto già trovato. Alla fine il riepilogo:
   «24 pagine · 4 email · 3 telefoni · 1 WhatsApp · 2 persone».
3. Controlla i form. Sotto ogni campo: **Alta affidabilità** o **Da verificare**, la pagina di
   origine (cliccabile) e il metodo. I chip *Altri trovati* sostituiscono il valore con un clic.
4. **Persone rilevate**: tutte le persone, anche parziali («Paolo — Host — cognome non trovato»),
   con recapiti, pagina e testo da cui sono state ricavate. Diventa Contatto in automatico solo chi
   ha **nome + cognome + almeno uno tra email, telefono e LinkedIn**; con «Usa come contatto» il
   commerciale può scegliere un'altra persona.
5. **Tutti i dati rilevati**: ogni email, telefono, WhatsApp, fax, indirizzo, dato societario,
   social e sistema esterno trovato, con tutte le sue fonti.
6. Conferma la **base giuridica** del Contatto e, se serve, correggi il **contesto rapido**.
7. **Verifica HubSpot** (MOCK) per provare il controllo dei doppioni.

**Analizza solo questa pagina** legge soltanto la pagina aperta. Pagine dello stesso sito si
sommano; un sito diverso è un nuovo prospect. Una correzione a mano non viene mai sovrascritta.
**Svuota** chiede conferma con un secondo clic.

## Modello HubSpot

**Azienda:** `name`, `domain`, `website`, `phone`, `email_aziendale_principale`,
`email_aziendale_secondaria`, `hs_quick_context`, `settore_agria`, `tipo_struttura_hospitality`,
`city`, `state` (regione), `country`, `linkedin_company_page`, `hubspot_owner_id`, `hs_lead_status`.

**Contatto:** `email`, `firstname`, `lastname`, `jobtitle` (in interfaccia «Qualifica»), `phone`,
`mobilephone`, `hs_linkedin_url`, `hubspot_owner_id`, `hs_legal_basis`.

- `settore_agria`: Hospitality · Cantina / Vitivinicolo · Frantoio / Olivicolo · Altro.
- `tipo_struttura_hospitality` (solo per Hospitality): Agriturismo · Boutique Hotel · Relais ·
  Masseria · Resort indipendente · Hotel · Struttura con ristorante · Struttura con spa · Altro.
  Settore e tipo sono proposti dalle parole del sito e restano sempre *da verificare*.
- `hs_lead_status`: `NEW` («Da contattare») per un nuovo prospect.
- `hubspot_owner_id`: il commerciale delle Impostazioni, mai dedotto dal sito.
- `hs_legal_basis`: suggerito «Legitimate interest – prospect/lead», da confermare a mano.
- Email: Scout propone una principale e una secondaria tra quelle aziendali (generiche, del
  dominio del sito); PEC, indirizzi di sistema ed email personali di una persona restano fuori, ma
  tutte le email restano selezionabili.
- `hs_quick_context`: generato solo con dati trovati che non hanno un campo dedicato (WhatsApp,
  email e telefoni in più, fax, ragione sociale, P.IVA, codice fiscale, REA, CIN, PEC, SDI, sede
  legale, persone, social, indirizzo, booking engine e portali).

## Come lavora la scansione

1. Legge la pagina aperta dal browser (contenuto reso, anche quello generato da JavaScript).
2. Raccoglie i link interni (menu, footer, contenuto) e la sitemap (`/sitemap.xml`,
   `/sitemap_index.xml` o `/wp-sitemap.xml`).
3. Normalizza gli indirizzi (http/https, www, barra finale, parametri di tracciamento) ed esclude
   altri domini e sottodomini, file (PDF, immagini…), aree riservate, carrello, archivi e ricerche.
4. Ordina per priorità: Contatti, home, Team, Chi siamo, pagine legali, pagine della struttura,
   il resto; la stessa pagina in un'altra lingua vale meno; al massimo 3 pagine di blog/news.
5. Scarica una pagina alla volta (pausa di 0,3 s, tempo massimo 10 s, al massimo 3 MB), solo GET,
   senza cookie né referrer, fino al limite delle Impostazioni (predefinito 30). Le pagine
   scaricate si leggono con `DOMParser`: documento inerte, nessuno script eseguito.
6. Le pagine non raggiungibili (errore HTTP, timeout, non HTML, redirect fuori dominio) restano
   in elenco con il motivo; la scansione continua.

### Fonti e priorità

Ogni valore viene dalla pagina, mai inventato. Priorità: dati strutturati JSON-LD/schema.org,
pagine Contatti, pagine Chi siamo/Team/struttura, pagine legali per i dati societari (ragione
sociale, P.IVA con cifra di controllo, codice fiscale, REA, CIN, SDI, PEC, sede legale), footer e
intestazione, resto del testo. Valori uguali su più pagine diventano una voce sola con tutte le
fonti; valori diversi restano tutti visibili, con il principale proposto e gli altri come
alternative.

## Permessi e privacy

- `sidePanel`, `storage`, `scripting` e accesso ai siti `http`/`https`: serve per leggere la pagina
  aperta e per scaricare le pagine dello stesso sito **solo quando si avvia un'analisi**. Nessuno
  script fisso sulle pagine.
- Il content script (`extension/content/collector.js`) **legge soltanto**: non modifica la pagina.
  I test lo verificano sul codice e nel browser vero (nessuna mutazione del DOM).
- I dati restano nel browser (`chrome.storage.session` per la bozza, `chrome.storage.local` per le
  impostazioni). L'unica richiesta esterna oltre al sito analizzato è il font Public Sans da Google
  Fonts, come nel Navigatore.

## Struttura

```
extension/                 ← la cartella da caricare in Chrome
  manifest.json
  background/service-worker.js   apre il pannello al clic sull'icona
  content/collector.js           fotografia di una pagina (iniettata o su HTML scaricato), sola lettura
  lib/parser.js                  estrattore: pagina → dati con fonte, metodo, affidabilità, evidenza
  lib/companyData.js             ragione sociale, P.IVA, CF, REA, CIN, SDI, social, sistemi esterni, settore
  lib/discovery.js               URL, stesso dominio, priorità delle pagine, sitemap
  lib/fetchPage.js               download sicuro di una pagina (GET, timeout, controlli)
  lib/scanner.js                 scansione approfondita: coda per priorità, limite, annullamento
  lib/siteData.js                dati accumulati e deduplicati tra le pagine, persone
  lib/crmModel.js                modello HubSpot, proposte, contesto rapido
  lib/draft.js                   bozza: form, correzioni a mano, scelta della persona
  lib/validation.js · italy.js · names.js   controlli, province e regioni, nomi propri
  lib/config.js                  impostazioni
  lib/hubspotClient.js           contratto HubSpot + client reale (non attivo)
  lib/mockHubspotClient.js       HubSpot simulato con i tre scenari
  sidepanel/                     pannello laterale (pageReader.js, render.js, sidepanel.js)
  options/                       pagina Impostazioni
  ui/agria.css                   stile Agria condiviso
  icons/                         generate da tools/make-icons.js
tests/                     test Node e siti di prova (fixtures)
tools/                     e2e.js (prova nel browser), make-icons.js
```

## Controlli

Servono Node 20 o successivo. Nessuna dipendenza da installare per i test principali.

| Comando | Cosa fa |
|---|---|
| `npm test` | Estrazione, scoperta delle pagine, sitemap, scansione (limite, dominio, errori, timeout, annullamento, niente doppioni), download contro un server locale, accumulo tra pagine, modello HubSpot, contesto rapido, bozza, impostazioni, mock HubSpot e controlli statici su manifest, permessi e sicurezza. |
| `npm run e2e` | Carica l'estensione vera in Chromium e ripercorre il lavoro del commerciale sui siti di prova (`tests/fixtures`): analisi, correzioni, scansione approfondita con sitemap, pagine rotte, file non HTML, link esterni e blog lungo, persone, dati rilevati, MOCK, annullamento, nuovo prospect, riapertura, Svuota. Verifica l'ordine esatto delle pagine scaricate e che le pagine analizzate restino identiche. Schermate in `.tmp/e2e/`. |
| `npm run check` | I due precedenti in fila. |

`npm run e2e` usa Playwright, che **non** è una dipendenza del progetto: si installa al momento
con `npm i --no-save playwright && npx playwright install chromium`, oppure si indica con
`NODE_PATH` una cartella `node_modules` che lo contiene già. I test non usano mai siti reali.

## Limiti noti

- Le pagine scaricate dalla scansione si leggono come HTML: i contenuti generati solo da
  JavaScript (alcuni siti Wix o app) non si vedono. La pagina aperta invece si legge com'è a schermo.
- Persone, settore e tipo di struttura sono riconosciuti con regole sul testo: per questo sono
  segnati *da verificare*. Impaginazioni insolite possono non dare un contatto o darne uno da correggere.
- Informative privacy ospitate su servizi esterni (es. iubenda) non vengono lette: sono su un
  altro dominio. Il sistema viene comunque segnalato tra i sistemi esterni.
- Siti protetti da sistemi anti-bot possono rispondere con un errore: la pagina finisce tra quelle
  non raggiungibili.
- La scansione si ferma se si chiude il pannello laterale; i dati raccolti fino a quel momento restano.
- Pagine protette da Chrome (`chrome://`, Chrome Web Store, PDF) non si possono analizzare.
