// Nuova email già compilata in Gmail (scheda nuova), con l'account del commerciale attivo.
//
// Agria Commercial non invia email e non usa le API di Gmail: apre la finestra di composizione di Gmail
// con destinatari, oggetto e testo; il commerciale la controlla e preme «Invia» in Gmail. Nessuna
// credenziale, nessun OAuth, nessun backend. Senza le API non si può sapere se l'email è partita.
//
//   https://mail.google.com/mail/?authuser={email del commerciale}&view=cm&fs=1&to=…&cc=…&su=…&body=…
//
// authuser = l'indirizzo del commerciale attivo (dal registro dei commerciali), non un indice di
// account come /u/0/: se quel profilo Chrome non ha l'account, Gmail chiede di sceglierlo o di accedere.

export const GMAIL_COMPOSE = 'https://mail.google.com/mail/';

// encodeURIComponent lascia ! ' ( ) * in chiaro: si codificano anche quelli (apostrofi del testo italiano)
const encode = (value) => encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * account: email del commerciale attivo; to: destinatario A; cc: [CC]; subject, body: testo semplice
 * (a capo con \n). → URL della composizione di Gmail, ogni valore codificato.
 */
export function gmailComposeUrl({ account, to = '', cc = [], subject = '', body = '' }) {
  if (!account) throw new Error('Email del commerciale attivo mancante: aggiungila nel registro dei commerciali.');
  const params = [
    ['authuser', account], ['view', 'cm'], ['fs', '1'],
    ['to', to], ['cc', (Array.isArray(cc) ? cc : []).join(',')], ['su', subject], ['body', body],
  ].filter(([, value]) => value);
  return `${GMAIL_COMPOSE}?${params.map(([key, value]) => `${key}=${encode(value)}`).join('&')}`;
}
