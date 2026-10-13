# Agria Commercial — installazione su un PC commerciale

Tempo: circa 5 minuti. Serve: Windows, Google Chrome, l'invito al repository privato di Agria
Commercial e la Service Key HubSpot: li fornisce il responsabile di Agria Commercial (la chiave di
persona o su un canale sicuro: mai via email, mai in un file).

**Regole di questo PC**

- Usa solo la **versione approvata**: il ramo `stable`. Su questo PC non si sviluppa e non si
  modificano i file del repository.
- La cartella del repository **non si sposta e non si rinomina**: Chrome riconosce l'estensione dal suo
  percorso. Una cartella diversa sarebbe una nuova estensione, con le impostazioni da rifare.

## Installazione

1. **Git.** Apri PowerShell e scrivi `git --version`. Se Git non c'è:
   `winget install --id Git.Git -e` (oppure scaricalo da https://git-scm.com/download/win e installalo
   con le opzioni predefinite). Chiudi e riapri PowerShell.
2. **Scarica il repository** (l'indirizzo lo dà il responsabile):

   ```powershell
   cd $env:USERPROFILE
   git clone --branch stable https://github.com/<account>/<repository>.git AgriaCommercial
   ```

   La prima volta Git apre il browser per l'accesso a GitHub: accedi con il tuo account. Nessun
   token da copiare o salvare.
3. **Ramo stable.** È già quello giusto grazie a `--branch stable`. Controllo:
   `git -C $env:USERPROFILE\AgriaCommercial branch --show-current` → `stable`.
4. In Chrome apri `chrome://extensions`.
5. Attiva **Modalità sviluppatore** (in alto a destra).
6. **Carica estensione non pacchettizzata**.
7. Scegli la cartella `C:\Users\<il tuo utente>\AgriaCommercial\extension` (quella che contiene
   `manifest.json`).
8. Icona del puzzle nella barra di Chrome → puntina su **Agria Commercial**.
9. **Service Key, una sola volta**: apri il pannello (clic sull'icona) → **Impostazioni** →
   *Connessione HubSpot reale* → incolla la Service Key → **Salva chiave** → **Testa connessione**
   («✓ Connessione HubSpot riuscita») → modalità **HubSpot reale**.
10. Clic sull'icona: alla domanda **«Chi sta usando Agria Commercial?»** scegli il tuo nome.

## Aggiornare

Quando il responsabile pubblica una nuova versione stabile:

1. Nella cartella `AgriaCommercial` fai doppio clic su **AGGIORNA-AGRIA-COMMERCIAL.cmd**.
2. La finestra mostra *Versione precedente*, *Nuova versione*, *Commit* ed *Esito aggiornamento*
   (oppure «Agria Commercial è già aggiornato.»).
3. Si apre `chrome://extensions`: premi **↻** (Ricarica) sulla scheda **Agria Commercial**.
   Non premere **Rimuovi**.
4. Riapri il pannello e scegli di nuovo il tuo nome.

Prima di aggiornare, finisci le operazioni in corso (per esempio un primo contatto da confermare).

**Cosa resta dopo un aggiornamento.** Gli aggiornamenti del codice **non eliminano le impostazioni
memorizzate nel profilo Chrome**: Service Key, esito del test di connessione, modalità HubSpot e
impostazioni restano (sono nel profilo di Chrome, non nei file del repository, e Git non le tocca).
Si azzerano solo i dati della sessione: commerciale attivo, prospect in lavorazione e registro della
sessione, come quando si chiude Chrome.

Le impostazioni si perdono solo se l'estensione viene **rimossa** da `chrome://extensions` o caricata da
un'altra cartella: in quel caso si ripetono i passi 6-10.

**Se l'aggiornamento si blocca** con «Aggiornamento bloccato: sono presenti modifiche locali.»: non
cancellare nulla e avvisa il responsabile di Agria Commercial. Lo script non tocca file né commit locali.

**Avviso di Chrome.** All'avvio Chrome può proporre di disattivare le estensioni in modalità
sviluppatore: chiudi l'avviso senza disattivarle.

## Rami

- `master` = sviluppo corrente, solo sul PC di sviluppo.
- `stable` = versione approvata per i commerciali, pubblicata con `PUBBLICA-AGRIA-COMMERCIAL.cmd` dopo
  tutti i controlli. I PC dei commerciali stanno sempre su `stable`.
