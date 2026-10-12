# Agria Scout

Estensione Chrome per il prospecting di Agria System. Il commerciale apre il sito ufficiale di
un prospect, apre Agria Scout nel pannello laterale e preme **Analizza pagina**: Scout legge la
pagina e propone i dati di **Azienda** e **Contatto**, ognuno con la sua fonte, in campi che si
correggono a mano. HubSpot resta il CRM: Scout prepara i dati, non li conserva.

Costo zero: nessun server, nessun database, nessuna API a pagamento o di Google, nessuna AI.

## Stato della V0: cosa è reale e cosa è MOCK

| | |
|---|---|
| **Reale** | Lettura della pagina attiva, estrazione dei dati, campi modificabili con controllo del formato, unione di più pagine dello stesso sito, scelta fra le persone trovate, bozza conservata alla riapertura del pannello, impostazioni. |
| **MOCK** | **Verifica HubSpot.** Risponde in base allo scenario scelto nelle Impostazioni (*Azienda non presente*, *Azienda già presente*, *Errore HubSpot*). Nessuna chiamata a HubSpot, nessuna lettura, nessuna scrittura, nessuna credenziale. Il badge **HubSpot MOCK** resta sempre visibile. |
| **Non ancora presente** | Creazione di Azienda e Contatto in HubSpot, invio email, follow-up, collegamento al Navigatore Chiamata. |

## Installazione (sviluppo)

1. Apri `chrome://extensions`.
2. Attiva **Modalità sviluppatore** (in alto a destra).
3. **Carica estensione non pacchettizzata** e scegli la cartella **`agria-scout/extension`**
   (quella che contiene `manifest.json`, non la cartella principale del progetto).
4. Fissa Agria Scout nella barra (icona del puzzle → puntina). Un clic sull'icona apre il pannello
   laterale.

Dopo una modifica al codice: in `chrome://extensions` premi ↻ sulla scheda di Agria Scout e
riapri il pannello. Serve Chrome 116 o successivo.

## Uso

1. Apri il sito del prospect nella scheda attiva.
2. Clic sull'icona di Agria Scout → **Analizza pagina**.
3. Controlla i campi. Sotto ognuno c'è la fonte («dati strutturati JSON-LD», «link email»,
   «testo del footer»…); **da verificare** indica una deduzione debole. I chip *Altri trovati*
   sostituiscono il valore con un clic.
4. Se mancano dati, apri la pagina **Contatti** dello stesso sito e premi di nuovo **Analizza
   pagina**: si riempiono solo i campi vuoti, le correzioni a mano restano. Un sito diverso è un
   nuovo prospect e sostituisce tutto.
5. **Verifica HubSpot** (MOCK) per provare il flusso di controllo dei doppioni.
6. **Svuota** chiede conferma con un secondo clic.

## Come vengono trovati i dati

Regola fissa: **ogni valore viene dalla pagina, mai inventato**. Se un dato non c'è, il campo
resta vuoto. Fonti, dalla più affidabile:

1. dati strutturati JSON-LD / schema.org (`Organization`, `LocalBusiness`, `Winery`, `Person`…) e microdati;
2. link `mailto:` e `tel:`, link a profili LinkedIn;
3. meta tag (`og:site_name`, `business:contact_data:*`) e titolo della pagina;
4. testo di footer e intestazione, poi il resto del testo visibile.

Accorgimenti principali:

- **Email.** Si preferiscono quelle del dominio del sito e quelle generiche (info@, commerciale@…).
  Le PEC, le noreply e quelle dell'agenzia web finiscono in fondo; immagini (`logo@2x.png`) ed
  esempi (`nome@example.com`) si scartano.
- **Telefono.** Nel testo libero conta solo dopo «Tel.», «Cell.», ☎… o con +39, quindi la partita
  IVA non viene scambiata per un numero. Il fax si esclude. I numeri sono scritti come
  `+39 0758123456` e `+39 333 123 4567`.
- **Regione.** Viene dal dato strutturato oppure si ricava dalla sigla della provincia
  (`06081 Assisi (PG)` → Umbria) o dal capoluogo. La fonte lo dice («dedotta dalla provincia (PG)»).
- **Contatto.** Viene da una `Person` nei dati strutturati (fondatore, dipendente) o da un
  nome con il ruolo accanto («Mario Rossi – Titolare»). Gli autori degli articoli e il «titolare
  del trattamento» della privacy non contano. L'email e il LinkedIn si associano a una persona
  solo se contengono il suo nome. Se trova più persone, propone per prima chi decide (titolare,
  fondatore, amministratore…) e mette le altre in elenco.

## Permessi e privacy

- `sidePanel`, `storage`, `scripting` e lettura dei siti `http`/`https`. L'accesso ai siti serve
  per leggere la pagina **solo quando si preme Analizza pagina**. Non c'è nessuno script fisso
  sulle pagine, e il pannello resta aperto mentre si naviga fra home e contatti.
- Il content script (`extension/content/collector.js`) **legge soltanto**: non modifica la
  pagina, non invia nulla. Un test lo verifica sia sul codice sia nel browser vero.
- I dati restano nel browser (`chrome.storage.session` per la bozza, `chrome.storage.local` per le
  impostazioni). L'unica richiesta esterna è il font Public Sans da Google Fonts, come nel
  Navigatore; se non si carica, si usa il font di sistema.

## Struttura

```
extension/                 ← la cartella da caricare in Chrome
  manifest.json
  background/service-worker.js   apre il pannello al clic sull'icona
  content/collector.js           content script: fotografia della pagina, sola lettura
  lib/parser.js                  estrattore: fotografia → campi Azienda e Contatto con fonte
  lib/validation.js              controllo e normalizzazione di email, telefono, URL, dominio, LinkedIn
  lib/italy.js                   province e regioni italiane
  lib/draft.js                   bozza del prospect: unione delle pagine, correzioni a mano
  lib/config.js                  impostazioni
  lib/hubspotClient.js           contratto HubSpot + client reale (non attivo nella V0)
  lib/mockHubspotClient.js       HubSpot simulato con i tre scenari
  sidepanel/                     pannello laterale (pageReader.js inietta il content script)
  options/                       pagina Impostazioni
  ui/agria.css                   stile Agria condiviso
  icons/                         generate da tools/make-icons.js
tests/                     test Node e pagine di prova
tools/                     e2e.js (prova nel browser), make-icons.js
```

Il contratto HubSpot (`findCompany({ domain, name })` → `{ found, companies, mock }`) è già
quello che userà il client reale: per collegare HubSpot cambierà `lib/hubspotClient.js`, non il
pannello.

## Controlli

Servono Node 20 o successivo. Nessuna dipendenza da installare per i test principali.

| Comando | Cosa fa |
|---|---|
| `npm test` | Estrattore, validazione, bozza, impostazioni e mock HubSpot. Controlla anche manifest, file citati, permessi, assenza di chiamate di rete, codice dinamico e credenziali, e che il content script non modifichi la pagina. |
| `npm run e2e` | Carica l'estensione vera in Chromium e ripercorre il lavoro del commerciale su tre pagine di prova (`tests/fixtures`): analisi, correzioni, pagina Contatti, i tre scenari MOCK, nuovo prospect, cambio contatto, riapertura, Svuota. Verifica che la pagina analizzata resti identica. Schermate in `.tmp/e2e/`. |
| `npm run check` | I due precedenti in fila. |
| `npm run icons` | Rigenera le icone. |

`npm run e2e` usa Playwright, che **non** è una dipendenza del progetto. Si installa al
momento con `npm i --no-save playwright && npx playwright install chromium`, oppure si indica
con `NODE_PATH` una cartella `node_modules` che lo contiene già.

## Limiti noti della V0

- Il riconoscimento delle persone dal testo è euristico: per questo è sempre segnato *da
  verificare*. Siti con impaginazioni insolite possono non dare un contatto, o darne uno
  sbagliato da correggere a mano.
- Si legge solo la pagina principale della scheda, non gli iframe (es. mappe o moduli incorporati).
- Pagine protette da Chrome (`chrome://`, Chrome Web Store, PDF) non si possono analizzare: il
  pannello lo dice.
