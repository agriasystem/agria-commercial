# Agria Commercial

Estensione Chrome di Agria System per il lavoro commerciale, in un solo pannello laterale con tre
moduli: **Scout** (trova, analizza e registra nuovi prospect), **Outreach** (registra il primo
contatto e programma il primo follow-up in HubSpot) e **Navigatore** (la guida durante le chiamate,
aperta in una scheda ampia). Vedi *Moduli e navigazione* e *Outreach*.

**Scout.** Il commerciale apre il sito ufficiale di un prospect, apre Agria Commercial nel
pannello laterale, entra in **Scout** e preme **Scansione approfondita**: Scout
legge le pagine informative dello stesso sito (Contatti, Chi siamo, Team, pagine legali…) e
prepara i form **Azienda** e **Contatto** con le proprietà HubSpot di Agria. Ogni valore porta
con sé la pagina da cui viene, il metodo di rilevazione e l'affidabilità, e si corregge a mano.
HubSpot resta il CRM: Scout prepara i dati, controlla i doppioni e, solo con un clic esplicito
del commerciale, crea in HubSpot la nuova Azienda e il suo Contatto.

Costo zero: nessun server, nessun database, nessuna API a pagamento o di Google, nessuna AI,
nessuno scraping di Google Maps. HubSpot si usa con le API gratuite del portale Agria.

## Stato: cosa è reale e cosa è MOCK

| | |
|---|---|
| **Reale** | Scelta del commerciale all'apertura, scansione approfondita del sito (link interni + sitemap, stesso dominio, una pagina alla volta, annullabile), analisi della sola pagina aperta, estrazione di tutti i dati pubblici, accumulo e deduplica tra pagine, form HubSpot Azienda e Contatto, persone rilevate, contesto rapido, correzioni a mano, bozza conservata alla riapertura del pannello, impostazioni. In modalità **HubSpot reale**: verifica dei doppioni, creazione di una nuova Azienda, creazione del Contatto e associazione all'Azienda (API HubSpot 2026-09). |
| **MOCK** | Modalità predefinita. Verifica e creazione rispondono in base allo scenario scelto nelle Impostazioni (*Azienda non presente*, *Azienda già presente*, *Errore HubSpot*): nessuna chiamata a HubSpot, nessuna credenziale. Il badge in alto dice sempre **HubSpot MOCK** o **HubSpot REALE**. |
| **Non presente** | Modifica di aziende o contatti già in HubSpot (solo lettura e visualizzazione), associazione di un contatto già esistente, trattative, invio o lettura di email, Gmail, follow-up successivi al primo, lettura generale dei task, festività nel calcolo dei giorni lavorativi. Il Navigatore non riceve dati da Scout né da Outreach. |

## Moduli e navigazione

Dopo la scelta del commerciale il pannello apre la **Home** («Da dove vuoi partire?»). In alto, sempre:
«Agria System / AGRIA COMMERCIAL», il badge HubSpot MOCK/REALE, *Impostazioni*, «Commerciale attivo:
{nome} · **Cambia**» e la navigazione **Home · Scout · Outreach · Navigatore ↗**.

- **Home**: il riquadro **Prossimo passo** (cosa fare ora, calcolato dallo stato di Scout: «Analizza un
  nuovo prospect», «Verifica {azienda} in HubSpot», «Crea {azienda} in HubSpot», «Controlla il possibile
  duplicato…», «{azienda} è già presente in HubSpot», «Crea il Contatto per…», «Azienda salvata in
  HubSpot»), le tre schede dei moduli e la **base giuridica predefinita** della sessione.
- **Scout**: il lavoro di sempre, identico (scansione, form, persone, HubSpot). Passare alla Home e
  tornare non perde nulla: la bozza resta una sola, in `chrome.storage.session`.
- **Outreach**: il primo contatto del prospect che Scout ha portato in HubSpot (vedi *Outreach*).
  Senza un prospect pronto: «Nessun prospect pronto per il primo contatto.» e **Vai a Scout**.
- **Navigatore ↗**: si apre in una **nuova scheda** dell'estensione, a tutta larghezza
  (`modules/navigator/app/navigatore.html`), non dentro il pannello. Il pannello resta dov'era.

Il pannello ricorda solo quale vista era aperta (`shellView` in `chrome.storage.session`); tutto il
resto ha una sola fonte: bozza e commerciale come prima, la modalità HubSpot dal service worker. Il
Prossimo passo non ha uno stato suo: si ricalcola ogni volta (`lib/nextStep.js`).

**Regole dell'interfaccia.** Una sola azione primaria per stato (prima *Scansione approfondita*, poi
*Verifica HubSpot*, poi *Crea Azienda* / *Crea Contatto*). Gli esiti usano un solo componente
(`ui/feedback.js`) con cinque toni — riuscito ✓, attenzione ⚠, bloccato ⛔, errore ✕, informazione ℹ —
sempre con icona e titolo, mai solo il colore. Etichette per il commerciale, non codici HubSpot
(«Lead Status: Da contattare», «Proprietario HubSpot: {nome} · ID …»; il nome tecnico della proprietà
resta nel suggerimento al passaggio del mouse). Navigazione da tastiera con focus visibile; durante
un'operazione il pulsante è disattivato (`aria-busy`), quindi niente doppi invii.

## Navigatore: fonte unica e aggiornamento

La **fonte** del Navigatore è il suo repository, `../navigatore-agria-sorgenti/navigatore-agria`, e
in particolare il file buildato `dist/navigatore-chiamata-agria.html`. Agria Commercial non lo modifica
e non ha una seconda versione da modificare: in `extension/modules/navigator/app/` c'è una **copia
generata**, da non toccare a mano.

- Baseline inclusa: commit **7c02185** (scritto in `app/navigatore.source.json` con l'impronta SHA-256
  del file buildato e di ogni file della copia).
- Unica trasformazione: Manifest V3 non esegue script inline nelle pagine di un'estensione, quindi i due
  blocchi `<script>` della pagina diventano `navigatore-1.js` (contenuti) e `navigatore-2.js` (motore),
  identici carattere per carattere e nello stesso punto. Il resto della pagina è invariato; il
  Navigatore gira com'è, con il suo `localStorage`.
- `tests/navigator.test.js` ricompone la pagina e verifica che sia identica byte per byte al file
  buildato registrato; se il repository del Navigatore è su questo PC controlla anche commit, pulizia
  del repository e allineamento.

**Aggiornare il Navigatore** (dopo un nuovo commit nel suo repository, con la sua build già fatta e
committata là):

1. `npm run navigator:check` — dice se la copia è allineata, senza scrivere nulla.
2. `npm run navigator:sync` — rifà la copia. Si rifiuta se il repository del Navigatore ha modifiche
   non registrate o se `dist/` non corrisponde ai sorgenti (ricompila i sorgenti in `.tmp/` di questo
   progetto e confronta: nel repository del Navigatore non scrive mai).
3. `npm test` e `npm run e2e`, poi un commit qui con il nuovo commit del Navigatore nel messaggio.

Cambi a testi, script o comportamento del Navigatore si fanno solo nel suo repository.

## Installazione

1. Apri `chrome://extensions` e attiva **Modalità sviluppatore** (in alto a destra).
2. **Carica estensione non pacchettizzata** e scegli la cartella **`agria-scout/extension`**
   (quella che contiene `manifest.json`).
3. Fissa Agria Commercial nella barra (icona del puzzle → puntina). Un clic sull'icona apre il pannello.
4. Alla prima apertura il pannello chiede **«Chi sta usando Agria Commercial?»**: scegli il tuo nome.
   Finché non scegli, non si vedono né i moduli né la navigazione. Poi si apre la Home.
5. Per usare HubSpot reale: Impostazioni → **Connessione HubSpot reale** (vedi sotto).

**Commerciali.** L'elenco è nel registro `extension/lib/operators.js`, l'unico punto in cui stanno
nomi e ID owner HubSpot (il README non li ripete). Per aggiungere un commerciale basta
una voce `{ name, hubspotOwnerId }`. Il commerciale attivo vale per la **sessione di Chrome**
(`chrome.storage.session`): resta se chiudi e riapri il pannello, si sceglie di nuovo quando Chrome
viene chiuso del tutto e riaperto. Non è una preferenza salvata e non si sincronizza. In alto nel
pannello: «Commerciale attivo: {nome} · **Cambia**»; *Cambia* riapre la scelta.

**Impostazioni** (limite pagine della scansione, modalità HubSpot MOCK o reale, scenario MOCK): si
salvano da sole mentre scrivi («✓ Salvato» accanto al campo), restano in questo browser
(`chrome.storage.local`, mai sincronizzate) e mostrano i **Commerciali disponibili** con il loro
Owner ID, in sola lettura. «← Torna ad Agria Commercial» chiude la pagina.

## HubSpot reale: Service Key e sicurezza

**La chiave.** Scout usa una **Service Key** del portale HubSpot Agria (account 149362651, EU1) con
**solo** questi permessi: `crm.objects.companies.read`, `crm.objects.companies.write`,
`crm.objects.contacts.read`, `crm.objects.contacts.write`. In HubSpot: **Sviluppo → Chiavi →
Service key** (la crea un super admin o chi ha l'accesso agli strumenti per sviluppatori).

**Configurarla.** Impostazioni → *Connessione HubSpot reale* → incolla la chiave nel campo
**Service Key HubSpot** (campo password) → **Salva chiave** → **Testa connessione**. Compare
«✓ Service Key configurata» e poi «✓ Connessione HubSpot riuscita». Infine, in *Connessione
HubSpot*, scegli **HubSpot reale**: il badge in alto diventa **HUBSPOT REALE**.
- Senza chiave: «Configura la Service Key nelle Impostazioni.»
- Il test fa **una sola lettura** innocua (la prima azienda), nessuna scrittura.
  401 → «Service Key non valida o ruotata.» · 403 → «Service Key valida ma permessi insufficienti.»
- Finché un test non è riuscito la modalità reale non lavora; se HubSpot rifiuta la chiave durante
  il lavoro (401/403) si ferma di nuovo finché non si ripete il test.

**Dove sta.** Solo in `chrome.storage.local` di questo browser (mai `chrome.storage.sync`), sotto una
voce che legge soltanto il service worker. Dopo il salvataggio non si rivede più, nemmeno in
parte. Tutte le richieste a HubSpot partono dal service worker: pannello e Impostazioni gli
mandano messaggi e ricevono solo risultati già ripuliti; la chiave non compare mai in risposte,
errori, log, URL o nel registro. Il pannello non ascolta gli eventi di `chrome.storage.local`
(che porterebbero con sé anche la chiave): le impostazioni cambiate arrivano con un messaggio.

> **Attenzione:** `chrome.storage.local` **non è un archivio cifrato**. Chi ha accesso al profilo
> Chrome del computer può leggere la chiave. È una scelta temporanea per l'MVP interno Agria a
> costo zero; in un'architettura futura la credenziale andrà spostata lato server.

**Ruotarla.** In HubSpot: Sviluppo → Chiavi → Service key → la chiave → **Rotate** («Rotate and
expire now» se è compromessa, altrimenti «Rotate and expire later»: la vecchia scade dopo 7 giorni).
Poi in Scout: incolla la nuova chiave → **Salva chiave** → **Testa connessione**. HubSpot consiglia
una rotazione ogni sei mesi.

**Rimuoverla.** Impostazioni → **Rimuovi chiave** → **Conferma rimozione**. Per revocarla davvero,
eliminala o ruotala anche in HubSpot.

## Flusso HubSpot: verifica, doppioni, creazione

1. **Scansione** del sito, controllo dei form.
2. **Verifica HubSpot** (sola lettura). HubSpot non garantisce la deduplica delle aziende create
   via API, quindi Scout controlla sempre prima:
   - **⛔ Azienda già presente in HubSpot** (duplicato certo: blocco assoluto, nessuna casella di
     conferma, nessun pulsante di creazione) se vale almeno una di queste:
     1. stesso **dominio** normalizzato (minuscolo, senza protocollo, `www.` e barre finali;
        sottodomini diversi restano diversi);
     2. almeno **due identificatori forti** in comune tra email aziendale (principale o
        secondaria), telefono normalizzato e sito web coerente col dominio;
     3. stessa **email** + nome fortemente coerente (stessa parte distintiva del nome, senza forme
        societarie e parole generiche come «Agriturismo», «Cantina», «S.r.l.»);
     4. stesso **telefono** + nome fortemente coerente;
     5. stesso **sito web** normalizzato + nome fortemente coerente.
     La prima ricerca cerca dominio, sito web (nelle forme più comuni), email e telefono.
   - **⚠ Possibile duplicato** (revisione manuale) solo per segnali più deboli: una sola email o un
     solo telefono (o solo il sito) in comune, stesso nome nella stessa città, nome simile nella
     stessa città. Solo qui compare «Ho controllato in HubSpot: è un'azienda diversa».

   Scout mostra i record trovati (nome, dominio, città, proprietario, Lead Status, Record ID, motivi)
   e non crea nulla senza conferma. Il blocco del duplicato certo vale anche nel service worker:
   nessun messaggio può sbloccarlo. Confronto deterministico, nessuna AI.

   Lead Status mostrato con le etichette del portale Agria (solo in interfaccia, i valori API restano
   quelli di HubSpot): `NEW` Da contattare · `ATTEMPTED_TO_CONTACT` Primo contatto inviato ·
   `CONNECTED` In contatto · `OPEN_DEAL` Opportunità aperta · `BAD_TIMING` Da ricontattare ·
   `UNQUALIFIED` Non da lavorare.
3. **Crea Azienda in HubSpot**: anteprima dei dati, poi un clic. **Pre-flight**: se un dato del
   modello finale (il form, e per un campo non corretto a mano anche la proposta ricavata dal sito,
   per esempio `state = Umbria`) non arriverebbe nel payload, la scrittura si blocca con «Alcuni dati
   rilevati non sono stati trasferiti correttamente al modello HubSpot.» e l'elenco dei campi. Un dato
   mai trovato o svuotato a mano non blocca. Solo proprietà compilate;
   `hubspot_owner_id` = commerciale attivo; `hs_lead_status` = `NEW`; niente
   `tipo_struttura_hospitality` fuori dall'Hospitality. **Subito prima della scrittura Scout ripete
   il controllo dei doppioni**: se nel frattempo un collega ha creato l'azienda → «L'azienda è stata
   aggiunta a HubSpot da un'altra operazione. Nessun duplicato è stato creato.» Il pulsante si
   disattiva al primo clic e il service worker blocca una seconda richiesta uguale.
   Se le regole di validazione del portale (applicate alle API dalla versione 2026-09) rifiutano i
   dati, Scout mostra il motivo in italiano e non riprova da solo.
4. **Crea Contatto e associa** (azienda appena creata) oppure **Crea Contatto e associa a questa
   Azienda** (azienda già presente, trovata con certezza). Prima Scout cerca il contatto per
   email, telefono, cellulare e LinkedIn: se esiste → «Contatto già presente in HubSpot», nessun
   nuovo contatto e nessuna modifica (owner, email, telefono e associazioni restano com'erano).
   Il Contatto riceve l'owner del commerciale attivo; `hs_legal_basis` solo se confermata.
   L'associazione usa l'endpoint ufficiale di associazione **predefinita** Contatto → Azienda.
5. **Operazioni a metà.** Azienda creata ma Contatto no → «✓ Azienda creata ⚠ Contatto non creato»
   e **Riprova creazione Contatto**: l'ID dell'azienda resta nella bozza, l'azienda non si ricrea.
   Contatto creato ma associazione non riuscita → **Riprova associazione**.

Scout legge e mostra soltanto i record già presenti: nessun aggiornamento. L'unica modifica di
record esistenti è quella di Outreach, dopo un clic esplicito e solo su Lead Status e date di primo
invio (vedi *Outreach*). Il link «Apri in HubSpot» compare solo se è HubSpot a fornirlo nella
risposta (campo `url`) e punta a quel record su hubspot.com; altrimenti si mostra il Record ID.

**Registro HubSpot di questa sessione** (in fondo alla sezione HubSpot): ora, commerciale,
operazione, azienda, Record ID, esito. Resta in `chrome.storage.session`, senza segreti.

**Concorrenza tra commerciali.** Senza un backend né un lock distribuito non si può garantire
l'atomicità assoluta: due commerciali che premono «Crea» nello stesso istante potrebbero ancora
creare due aziende. Il nuovo controllo subito prima della scrittura riduce molto il rischio; inoltre
le aziende create da Scout nella sessione contano come doppioni anche prima che la ricerca di
HubSpot le indicizzi (HubSpot avvisa che un record nuovo può impiegare qualche istante a comparire).

**API usate** (versione date-versioned `2026-09`, server `https://api.hubapi.com`):

| Operazione | Endpoint |
|---|---|
| Test connessione | `GET /crm/objects/2026-09/companies?limit=1` |
| Ricerca aziende | `POST /crm/objects/2026-09/companies/search` |
| Lettura azienda | `GET /crm/objects/2026-09/companies/{companyId}` |
| Creazione azienda | `POST /crm/objects/2026-09/companies` |
| Ricerca contatti | `POST /crm/objects/2026-09/contacts/search` |
| Creazione contatto | `POST /crm/objects/2026-09/contacts` |
| Associazione Contatto → Azienda | `PUT /crm/objects/2026-09/contact/{contactId}/associations/default/company/{companyId}` |
| Outreach: stato e date | `GET /crm/objects/2026-09/companies/{id}` · `GET /crm/objects/2026-09/contacts/{id}` (con `properties`) |
| Outreach: tipo delle proprietà | `GET /crm/properties/2026-09/{companies\|contacts}/{nome}` |
| Outreach: Lead Status e date | `PATCH /crm/objects/2026-09/companies/{id}` · `PATCH /crm/objects/2026-09/contacts/{id}` |
| Outreach: follow-up | `POST /crm/objects/2026-09/tasks` (con le associazioni) |
| Outreach: follow-up già creato? | `GET /crm/objects/2026-09/companies/{id}/associations/tasks` · `POST /crm/objects/2026-09/tasks/batch/read` |

Un unico wrapper HTTP gestisce Bearer, timeout, 401, 403, 404, 409, 429 (con `Retry-After`, al
massimo due nuovi tentativi), 5xx (si riprovano solo le letture), errori di rete ed errori di
validazione. Dopo un esito incerto su una creazione (5xx, timeout, rete) Scout non riprova da solo:
chiede una nuova verifica.

**Aggiornare dopo una nuova versione del codice:** in `chrome://extensions` premi ↻ sulla scheda
di Agria Commercial (prima «Agria Scout»), poi chiudi e riapri il pannello laterale e scegli di nuovo il commerciale. Le
impostazioni restano; la bozza in corso si azzera. Serve Chrome 116 o successivo.

## Outreach: primo contatto e follow-up

Outreach parte quando Scout ha **creato l'Azienda** in HubSpot oppure l'ha **trovata con certezza**
(un solo doppione certo). Legge tutto dalla stessa bozza di Scout (ID HubSpot, nome, email aziendali,
Contatto HubSpot se c'è) e dal commerciale attivo: nessuna copia. In Scout e nella Home il Prossimo
passo propone **Vai al primo contatto · Apri Outreach**.

1. **Aprendo Outreach** il service worker rilegge l'Azienda in HubSpot (Lead Status, data del primo
   invio) e, se c'è, il Contatto.
2. **Destinatario prima email**: l'email aziendale (principale o secondaria) oppure il Contatto
   HubSpot («Roberto Rossi — Titolare»). Il Contatto non è obbligatorio. Nessuna scelta predefinita.
3. «**Invia ora la prima email dal tuo account aziendale.**» Agria Commercial non invia email, non
   apre Gmail e non legge la posta.
4. **Cosa succederà**: stato lead → Primo contatto inviato · data primo invio Azienda · data del
   Contatto (solo se l'email è andata al Contatto) · follow-up per {giorno} alle 14:30 · assegnato al
   commerciale attivo.
5. **Conferma email inviata e crea follow-up** (l'unica azione primaria). Il service worker rilegge
   l'Azienda; se nel frattempo risulta già contattata si ferma senza scrivere nulla. Altrimenti:
   - Azienda: `hs_lead_status` = `ATTEMPTED_TO_CONTACT` e `data_del_primo_invio_email` = ora, **solo
     se vuota** (una data già presente non si riscrive mai);
   - Contatto (solo se destinatario): `data_primo_invio_email_al_contatto` = ora, solo se vuota;
   - un task «FOLLOW-UP | {Azienda}», tipo CALL, NOT_STARTED, priorità NONE, owner = commerciale
     attivo al momento della conferma, note «Primo follow-up dopo email commerciale Agria System.»
     (più «Contatto: {nome} — {qualifica}» se l'email è andata al Contatto), associato all'Azienda
     (tipo 192) e, se serve, al Contatto (tipo 204).

**Date.** Prima di scrivere si legge il tipo delle due proprietà nel portale: `datetime` → istante della
conferma in millisecondi Unix; `date` → il giorno in Italia, `YYYY-MM-DD` (documentazione HubSpot
Properties API). Un altro tipo, una proprietà assente o un Lead Status senza `ATTEMPTED_TO_CONTACT`
bloccano tutto prima di qualsiasi scrittura. A schermo: «13/10/2026, 10:42» (Europe/Rome).

**Scadenza del follow-up** (`lib/outreachTime.js`, funzione pura): +2 giorni lavorativi alle **14:30
Europe/Rome** (CET e CEST gestite), promemoria 30 minuti prima. Lavorativi = lunedì-venerdì, festività
escluse dal calcolo. Lunedì → mercoledì, martedì → giovedì, mercoledì → venerdì, giovedì → lunedì,
venerdì → martedì, sabato e domenica → martedì. `hs_timestamp` e `hs_task_reminders` in millisecondi
Unix (formato richiesto da HubSpot per i promemoria).

**Doppio clic e nuovi tentativi.** Il pulsante si disattiva subito; il service worker tiene un blocco
per Azienda e registra l'operazione in `chrome.storage.session` (`hubspotSession`). Una seconda
conferma per la stessa Azienda non scrive nulla. HubSpot non ha transazioni: se l'Azienda è aggiornata
ma il task fallisce, niente viene annullato e si vede «✓ Primo contatto registrato ⚠ Follow-up non
creato» con **Riprova creazione follow-up**, che crea solo il task (stessa scadenza, stesso owner,
nessuna data riscritta). Prima di ricrearlo cerca fra i task associati all'Azienda quello con lo
stesso titolo e la stessa scadenza: se la prima richiesta era arrivata, lo riusa invece di
duplicarlo. Se non riesce a controllare, non crea nulla.

**Azienda già contattata** (data del primo invio presente, oppure stato Primo contatto inviato, In
contatto, Opportunità aperta): niente flusso del primo contatto, niente follow-up automatico. Si
vedono «Questa Azienda risulta già contattata.», stato attuale, data del primo invio e prossimo passo
disponibile. Se c'è un Contatto HubSpot senza data, **Registra email inviata a {nome}** scrive solo la
data del Contatto: l'Azienda e la sua data non cambiano (Azienda e Contatto possono avere date diverse).

**Permessi.** Bastano gli scope della Service Key attuale: secondo la documentazione HubSpot i task
richiedono `crm.objects.contacts.read`/`write`, le definizioni delle proprietà e le associazioni si
leggono con `crm.objects.companies.read`/`crm.objects.contacts.read`.

## Uso

1. Apri il sito del prospect (qualunque pagina), clic sull'icona di Agria Commercial e poi **Scout**
   (navigazione, scheda Scout della Home o «Apri Scout» nel Prossimo passo).
2. **Scansione approfondita**: avanzamento «Analisi pagina 7 di 23…», si può annullare in ogni
   momento conservando quanto già trovato. Alla fine il riepilogo:
   «24 pagine · 4 email · 3 telefoni · 1 WhatsApp · 2 persone».
3. Controlla i form. Sotto ogni campo: **Alta affidabilità** o **Da verificare**, la pagina di
   origine (cliccabile) e il metodo. I chip *Altri trovati* sostituiscono il valore con un clic.
4. **Persone rilevate**: tutte le persone, anche parziali («Paolo — Host», *Persona parziale*,
   *Cognome non trovato*), con recapiti, pagina e testo da cui sono state ricavate. Diventa Contatto
   in automatico solo chi ha **nome + cognome + almeno uno tra email, telefono e LinkedIn**; con
   «Usa come contatto» il commerciale può scegliere un'altra persona. Il cognome non si inventa mai.
   Le schede sono in ordine di rilevanza commerciale e mostrano i **Segnali commerciali**:
   osservazioni verificabili, mai deduzioni («Numero coincidente con il telefono principale
   dell'azienda», «Numero coincidente con il WhatsApp aziendale», «Email coincidente con l'email
   principale/secondaria dell'azienda», «Persona citata in più sezioni del sito» — almeno due pagine,
   il footer ripetuto non conta —, «Ruolo commerciale esplicito: …» e «Ruolo decisionale esplicito: …»
   solo se il ruolo è scritto così nel sito). L'ordine usa un peso interno mai mostrato; la prima
   persona utilizzabile è il **Contatto suggerito**, ma il Contatto lo sceglie il commerciale e una
   scelta a mano non cambia con una nuova scansione. Lo stesso numero può stare nel telefono
   dell'Azienda e nel cellulare di una persona, se il sito lo pubblica in entrambi i contesti.
5. **Tutti i dati rilevati** (diagnostica, chiusa all'inizio): email, telefoni, WhatsApp, persone,
   indirizzi, social, P.IVA, poi gli altri dati; ragione sociale, codice fiscale, REA, CIN e SDI in
   fondo, in «Dati legali (non usati in HubSpot)».
6. La **base giuridica** compare quando il Contatto è valido: si conferma a mano, e va confermata
   di nuovo se cambia la persona o il contatto smette di essere valido. Per non ripeterla a ogni
   prospect, nella **Home** c'è **«Base giuridica predefinita per i nuovi prospect»**
   (Legitimate interest – prospect/lead) con la casella «Usa questa base giuridica per i nuovi contatti
   prospect in questa sessione»: ogni nuovo Contatto valido la eredita («Predefinita per questa
   sessione») e si può togliere o riconfermare per il singolo contatto. Vale solo per la sessione di
   Chrome (`chrome.storage.session`) e per il commerciale che l'ha confermata: cambiando commerciale va
   confermata di nuovo. Serve solo a **creare** un Contatto: «Verifica HubSpot» funziona sempre, e senza
   base giuridica confermata «Crea Contatto…» resta disattivato con «Conferma la base giuridica per
   poter creare il Contatto in HubSpot.» (il blocco vale anche nel service worker). Se serve,
   correggi il **contesto rapido**.
7. **Verifica HubSpot**, poi, se l'azienda non c'è, **Crea Azienda in HubSpot** e **Crea Contatto e
   associa** (vedi *Flusso HubSpot*). In MOCK tutto è simulato.

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
  Con un altro settore il campo è nascosto; se il commerciale sceglie Hospitality ricompare.
  Settore e tipo sono proposti dalle parole del sito e restano sempre *da verificare*.
- `hs_lead_status`: `NEW` («Da contattare») per un nuovo prospect.
- `hubspot_owner_id`: **solo** il commerciale attivo della sessione, mai dedotto dal sito e mai
  salvato nella bozza del prospect: cambiando commerciale, Azienda e Contatto mostrano subito il
  nuovo owner. `crmRecords(draft, commerciale)` (in `lib/draft.js`) prepara le proprietà da inviare
  a HubSpot con l'owner del commerciale attivo, solo i campi visibili e la base giuridica solo se
  confermata; senza commerciale attivo si ferma con un errore.
- `hs_legal_basis`: «Legitimate interest – prospect/lead», confermata per il singolo Contatto o
  come predefinita della sessione; senza conferma il Contatto non si crea e la proprietà non si invia.
- Nome azienda: la ragione sociale non viene proposta (resta tra i dati legali rilevati).
- Persone: un candidato che contiene parole del lessico privacy/legale (modalità, trattamento, dati
  personali, categorie, finalità, base giuridica, interessato, diritti, periodo di conservazione,
  protezione dei dati…) è il titolo di una sezione dell'informativa, non una persona: non compare tra
  le persone rilevate, nel contesto rapido o nel Contatto. Una persona vera dell'informativa resta
  («Il titolare del trattamento è Mario Rossi» → Mario Rossi, *Titolare del trattamento*), se supera
  la normale validazione del nome.
- Email: Scout propone una principale e una secondaria tra quelle aziendali; PEC, indirizzi di
  sistema ed email di una persona restano fuori, ma tutte le email restano selezionabili.
  Classificazione fissa: **aziendale generica** per gli alias funzionali (info, contact, visit,
  booking, prenotazioni, reception, sales, commerciale, amministrazione, office, segreteria,
  marketing, eventi, shop, store, hospitality, welcome, staff, support, assistenza…), mai prova
  dell'esistenza di una persona; **personale** solo con la forma di un nome (nome@, nome.cognome@,
  iniziale.cognome@, cognome.nome@) o se contiene il nome di una persona rilevata vicina;
  **aziendale** per le altre caselle (es. agriturismolamora@gmail.com).
- `hs_quick_context`: informazioni operative trovate che non hanno un campo dedicato, in
  quest'ordine: **WHATSAPP**, **P.IVA**, **ULTERIORI EMAIL** (oltre principale e secondaria),
  **ULTERIORI TELEFONI** (non il principale, non il WhatsApp ripetuto), **POTENZIALI CONTATTI**
  («Paolo — Host (cognome non trovato)», in ordine di rilevanza, con sotto i segnali in breve, per
  esempio «Ruolo decisionale esplicito»; niente punteggi), **ALTRI CANALI** (social, fax, PEC), **ALTRE INFORMAZIONI
  COMMERCIALI UTILI** (booking engine, portali, prenotazione ristorante, e-commerce). Niente
  ragione sociale, REA, CIN, SDI, codice fiscale o sede legale; nessun valore ripetuto.

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

**Località.** Indirizzi scritti «06081 Assisi (PG)» o «…, Magione - 06063 (PG) - ITALY». Se
all'indirizzo principale manca la provincia, Scout la prende — con fonte ed evidenza — da un altro
indirizzo della stessa città o con lo stesso CAP, da «Città (PR)» per la stessa città, oppure
dall'unica provincia citata da sola nel sito («(PG)», «Provincia di Perugia»); con province diverse
non sceglie, e la sede legale in un'altra città non conta. Regione dalla tabella fissa province →
regioni (`lib/italy.js`); paese «Italia» da provincia o regione italiane, oppure da «ITALY»/«Italy»/
«ITALIA» scritto nel sito. Niente geocoding, servizi esterni o AI.

**Persone.** Oltre ai ruoli dell'elenco («Titolare», «Sommelier», «Host»…), anche ruoli scritti dal sito
con parole proprie, in una scheda di contatto: «Export, vendite, acquisti, logistica: Giulio Brandelli
+39 349 5241724», «Ruolo - Nome Cognome telefono», «Nome Cognome — Ruolo — telefono», ruolo come
intestazione con nome e telefono sotto. Titoli come «Dott.» davanti al nome sono ammessi.

**Email attaccate ad altro testo.** Quando due elementi della pagina sono affiancati senza spazio,
il testo può diventare «+39 393 4363917agriturismolamora@gmail.com». Scout non taglia cifre a caso
(un'email può iniziare con delle cifre): scarta il candidato solo se è un'altra email già trovata
più un prefisso venuto dal testo vicino (cifre di un telefono, «E-mail», «Tel»…) e se l'email
pulita ha una fonte più affidabile (link email, JSON-LD, campo strutturato o scritta da sola nel
testo). Senza copia pulita il candidato resta, *da verificare*.

## Permessi e privacy

- `sidePanel`, `storage`, `scripting` e accesso ai siti `http`/`https`: serve per leggere la pagina
  aperta e per scaricare le pagine dello stesso sito **solo quando si avvia un'analisi**. Nessuno
  script fisso sulle pagine.
- Il content script (`extension/content/collector.js`) **legge soltanto**: non modifica la pagina.
  I test lo verificano sul codice e nel browser vero (nessuna mutazione del DOM).
- `https://api.hubapi.com/*`: le API HubSpot, chiamate solo dal service worker e solo in modalità
  HubSpot reale (o con «Testa connessione»).
- I dati restano nel browser (`chrome.storage.session` per la bozza, il commerciale attivo e il
  registro HubSpot; `chrome.storage.local` per impostazioni e Service Key). Richieste esterne:
  il sito analizzato, HubSpot (solo in modalità reale) e il font Public Sans da Google Fonts, come
  nel Navigatore.

## Struttura

```
extension/                 ← la cartella da caricare in Chrome
  manifest.json
  background/service-worker.js   apre il pannello; unico punto che parla con HubSpot (Service Key)
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
  lib/operators.js               registro dei commerciali e commerciale attivo della sessione
  lib/config.js                  impostazioni (modalità MOCK/reale, scenario, limite pagine)
  lib/hubspotService.js          operazioni HubSpot del service worker: chiave, verifica, creazione, registro
  lib/hubspotClient.js           client HubSpot reale (API 2026-09), un solo wrapper HTTP
  lib/hubspotDuplicates.js       ricerche e confronto dei doppioni (aziende e contatti)
  lib/hubspotPayload.js          proprietà da scrivere per una nuova Azienda / un nuovo Contatto
  lib/hubspotMessages.js         nomi dei messaggi pannello ↔ service worker
  lib/mockHubspotClient.js       HubSpot simulato con i tre scenari, stessa interfaccia del reale
  lib/nextStep.js                «Prossimo passo» della Home, calcolato dalla bozza (nessuno stato suo)
  shell/shell.js                 navigazione fra Home, Scout, Outreach; apertura del Navigatore
  modules/outreach/outreach.js   testi del modulo Outreach
  modules/outreach/outreachPanel.js  vista Outreach (destinatario, anteprima, conferma, nuovo tentativo)
  lib/outreach.js                regole del primo contatto: prospect dalla bozza, date una sola volta, task
  lib/outreachTime.js            Europe/Rome, +2 giorni lavorativi alle 14:30, date in italiano
  modules/navigator/navigator.js apre il Navigatore in una nuova scheda
  modules/navigator/app/         copia GENERATA del Navigatore (tools/sync-navigator.js): non modificare
  sidepanel/                     pannello laterale: Home, viste dei moduli e Scout (pageReader.js,
                                 render.js, hubspotPanel.js, sidepanel.js)
  options/                       pagina Impostazioni
  ui/agria.css                   stile Agria condiviso
  ui/dom.js · ui/feedback.js     costruzione del DOM senza HTML da stringhe; componente degli esiti
  icons/                         generate da tools/make-icons.js
tests/                     test Node, siti di prova (fixtures), support/fakeHubspot.js (HubSpot finto)
tools/                     e2e.js (prova nel browser), make-icons.js, sync-navigator.js (copia del Navigatore)
```

## Controlli

Servono Node 20 o successivo. Nessuna dipendenza da installare per i test principali.

| Comando | Cosa fa |
|---|---|
| `npm test` | Estrazione, scoperta delle pagine, sitemap, scansione (limite, dominio, errori, timeout, annullamento, niente doppioni), download contro un server locale, accumulo tra pagine, modello HubSpot, contesto rapido, bozza, impostazioni e salvataggio automatico, mock HubSpot e controlli statici su manifest, permessi e sicurezza. `tests/quality.test.js`: i casi dei test manuali (email attaccata al telefono, alias funzionali, persone parziali, contesto rapido La Mora e Perticaia, tipo struttura condizionale, titoli dell'informativa privacy che non sono persone). `tests/operators.test.js`: registro dei commerciali, scelta e cambio nella sessione, owner di Azienda e Contatto, nessun utilizzo senza commerciale. `tests/hubspotClient.test.js`, `hubspotDuplicates.test.js`, `hubspotFlow.test.js`: client 2026-09 (401, 403, 404, 409, 429, 5xx, rete, timeout, validazione), doppioni di aziende e contatti, Service Key (mai esposta), creazione, nuovo controllo prima della scrittura, race condition, doppio clic, owner, Lead Status, base giuridica, associazione, operazioni a metà. `tests/shell.test.js`: Prossimo passo A (Scout), B (primo contatto), C (follow-up programmato), D (già contattata), Home, navigazione, la shell che ricorda solo la vista. `tests/outreach.test.js`: +2 giorni lavorativi da lunedì a domenica, 14:30 Europe/Rome, CET, CEST, cambio d'ora, piano del primo contatto (date vuote valorizzate, date presenti invariate, email all'Azienda senza Contatto, Lead Status, owner, task e associazioni), prospect dalla bozza. `tests/outreachFlow.test.js`: lo stesso nel service worker contro un HubSpot finto, più doppio clic, task fallito e nuovo tentativo, task creato con risposta persa, esito incerto sull'Azienda, proprietà del portale, Azienda già contattata, Contatto scritto dopo. `tests/navigator.test.js`: copia del Navigatore identica byte per byte al file buildato, baseline, isolamento, repository del Navigatore invariato. |
| `npm run e2e` | Carica l'estensione vera in Chromium e ripercorre il lavoro del commerciale sui siti di prova (`tests/fixtures`): scelta del commerciale (blocco senza scelta, cambio durante la sessione, nuova sessione di Chrome), Home (tre moduli, Prossimo passo), navigazione con mouse e tastiera (Invio, Spazio, Tab, focus), Navigatore in una nuova scheda (contenuti, `localStorage`, nessun errore), Home ↔ Scout senza perdere dati, nessuno scroll orizzontale a 400 e 320 px, impostazioni con salvataggio automatico, analisi, correzioni, scansione approfondita con sitemap, pagine rotte, file non HTML, link esterni e blog lungo, persone, dati rilevati, base giuridica, MOCK, annullamento, nuovo prospect, riapertura, Svuota, i casi La Mora e Perticaia (`tests/fixtures/caso-*.html`) e HubSpot REALE contro un HubSpot finto: Service Key, test della connessione (401, 403, 200), 429, errore di validazione, race condition, azienda già presente, contatto già presente, Azienda + Contatto con errore e nuovo tentativo, associazione; Outreach: email all'Azienda, email al Contatto, data scritta da un collega prima della conferma, task fallito e nuovo tentativo (un solo task), doppio clic, Azienda già contattata, Contatto scritto dopo, Home → Outreach → Scout → Home e riapertura senza perdere nulla, MOCK. Verifica l'ordine esatto delle pagine scaricate e che le pagine analizzate restino identiche. Schermate in `.tmp/e2e/`. |
| `npm run check` | I due precedenti in fila. |
| `npm run navigator:check` | La copia del Navigatore è allineata al suo repository? (vedi *Navigatore*) |

`npm run e2e` usa Playwright, che **non** è una dipendenza del progetto: si installa al momento
con `npm i --no-save playwright && npx playwright install chromium`, oppure si indica con
`NODE_PATH` una cartella `node_modules` che lo contiene già. I test non usano mai siti reali.

**Nessun test automatico tocca il CRM reale.** I test unitari usano un `fetch` finto; l'e2e
intercetta con Playwright ogni richiesta del service worker verso `https://api.hubapi.com` e la
manda al finto HubSpot (`tests/support/fakeHubspot.js`), con chiavi finte. In più il browser di
prova risolve `api.hubapi.com` su 127.0.0.1: una richiesta sfuggita fallirebbe, non arriverebbe
a HubSpot. Le prove sul portale vero si fanno solo a mano (vedi la procedura nel report della
Milestone 2), prima in sola lettura.

## Limiti noti

- Il Navigatore dentro l'estensione salva i suoi dati nel `localStorage` dell'estensione: è separato da
  quello del file `navigatore-chiamata-agria.html` aperto con un doppio clic. Sono due archivi distinti.
- Il Navigatore non riceve ancora dati da Scout (azienda, persona): si compila a mano come sempre.

- Le pagine scaricate dalla scansione si leggono come HTML: i contenuti generati solo da
  JavaScript (alcuni siti Wix o app) non si vedono. La pagina aperta invece si legge com'è a schermo.
- Persone, settore e tipo di struttura sono riconosciuti con regole sul testo: per questo sono
  segnati *da verificare*. Impaginazioni insolite possono non dare un contatto o darne uno da correggere.
  Una persona citata col solo nome si riconosce se il nome è tra quelli comuni (`lib/names.js`)
  ed è vicino a un ruolo («Paolo, host di…», «Host: Paolo», «Il vostro host è Paolo»). Con un ruolo
  scritto con parole proprie (fuori elenco) servono un recapito subito dopo il nome e un nome di
  battesimo tra quelli comuni: nomi rari in quel formato possono sfuggire.
- Email attaccate ad altro testo: si riconosce il testo attaccato *davanti* (cifre di un telefono,
  etichette come «E-mail»); quello attaccato *dopo* il dominio («info@sito.itTel») non ancora.
- Informative privacy ospitate su servizi esterni (es. iubenda) non vengono lette: sono su un
  altro dominio. Il sistema viene comunque segnalato tra i sistemi esterni.
- Siti protetti da sistemi anti-bot possono rispondere con un errore: la pagina finisce tra quelle
  non raggiungibili.
- La scansione si ferma se si chiude il pannello laterale; i dati raccolti fino a quel momento restano.
- Il commerciale attivo si azzera anche quando l'estensione viene ricaricata o aggiornata (Chrome
  svuota `chrome.storage.session`): va scelto di nuovo.
- Il lessico privacy/legale è un elenco fisso (`LEGAL_WORDS` in `lib/parser.js`): titoli di sezione
  con parole non in elenco possono ancora sembrare un nome accanto a un ruolo.
- Pagine protette da Chrome (`chrome://`, Chrome Web Store, PDF) non si possono analizzare.
- HubSpot, doppioni: il telefono si cerca nelle forme di scrittura più comuni (con e senza +39,
  spazi, trattini); un numero salvato in HubSpot in una forma insolita può sfuggire alla ricerca.
  Il nome si confronta solo per uguaglianza della parte distintiva (niente somiglianze).
- HubSpot, contatti: un contatto che condivide il telefono dell'azienda con un collega già in
  HubSpot risulta «già presente» (regola prudente: nessun duplicato).
- HubSpot: «Associa contatto esistente a questa Azienda» non è ancora disponibile (prossimo passo):
  un contatto già presente si associa a mano in HubSpot.
- Outreach: «una data già presente non si riscrive» si basa su una rilettura subito prima della
  scrittura; HubSpot non offre una scrittura condizionata, quindi due conferme sulla stessa Azienda da
  due browser nello stesso istante non sono escluse del tutto.
- Outreach: l'operazione (e quindi «Follow-up programmato» nel Prossimo passo) vive nella sessione di
  Chrome. Dopo una chiusura completa di Chrome l'Azienda risulta «già contattata», che è vero, ma la
  data del follow-up si vede solo in HubSpot (la lettura dei task non è ancora implementata).
- Outreach: le festività non sono considerate nel calcolo dei giorni lavorativi.
- Outreach: il Contatto si può scegliere come destinatario solo se Scout lo ha creato o trovato in
  HubSpot per questo prospect.
- HubSpot: senza backend non c'è un lock tra commerciali (vedi *Concorrenza tra commerciali*).
- La Service Key in `chrome.storage.local` non è cifrata (vedi *HubSpot reale: Service Key e sicurezza*).
- Il link «Apri in HubSpot» dipende dal campo `url` restituito dall'API: se manca, si vede solo il
  Record ID.
