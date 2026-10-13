// Email di primo contatto Agria: l'UNICA fonte del testo. I componenti dell'interfaccia non ne tengono
// copie: leggono oggetto e testo da qui, già compilati con firstContactEmail().
//
// Segnaposto (esattamente questi):
//   {{NOME_COMMERCIALE}}  nome e cognome del commerciale attivo (dal registro dei commerciali)
//   {{AZIENDA}}           nome dell'Azienda del prospect
// Testo semplice, niente Markdown né HTML: Gmail rende cliccabile www.agriasystem.com da solo.
// Il testo finisce con «Un cordiale saluto,»: la firma la aggiunge Gmail, qui non si scrive altro.

export const PLACEHOLDERS = Object.freeze({ commerciale: '{{NOME_COMMERCIALE}}', azienda: '{{AZIENDA}}' });

export const FIRST_CONTACT_EMAIL = Object.freeze({
  subject: 'Gestione digitale e crescita commerciale per {{AZIENDA}}',
  body: [
    'Gentile Direzione,',
    '',
    'sono {{NOME_COMMERCIALE}} di Agria System.',
    '',
    "A seguito di un'analisi sul mercato italiano dell'agroalimentare e dell'hospitality, settori su cui siamo focalizzati anche con uno sguardo internazionale, le scrivo per entrare in contatto con {{AZIENDA}}.",
    '',
    'In Agria System supportiamo cantine e strutture ricettive attraverso la realizzazione di presenze web premium, piattaforme e-commerce e implementazioni AI volte ad automatizzare i processi interni e accelerare la crescita commerciale, aumentando vendite dirette e acquisizione clienti.',
    '',
    'Avrebbe disponibilità nei prossimi giorni per una call conoscitiva, così da valutare se ci sono i presupposti per una collaborazione?',
    '',
    'Nel frattempo, se desidera conoscere meglio la nostra realtà, può trovare maggiori informazioni su www.agriasystem.com.',
    '',
    'Un cordiale saluto,',
  ].join('\n'),
});

const LEFTOVER = /\{\{[^}]*\}\}/;

/** Sostituisce i segnaposto; si ferma se ne resta uno (mai un'email con «{{…}}» dentro). */
export function fillTemplate(text, { commerciale, azienda }) {
  const name = String(commerciale ?? '').trim();
  const company = String(azienda ?? '').trim();
  if (!name) throw new Error("Commerciale attivo mancante: impossibile preparare l'email.");
  if (!company) throw new Error("Nome dell'Azienda mancante: impossibile preparare l'email.");
  const out = String(text).split(PLACEHOLDERS.commerciale).join(name).split(PLACEHOLDERS.azienda).join(company);
  if (LEFTOVER.test(out)) throw new Error("Nel testo dell'email è rimasto un segnaposto da compilare.");
  return out;
}

/** Email di primo contatto per l'Azienda, firmata (nel testo) dal commerciale attivo → { subject, body }. */
export function firstContactEmail({ operator, companyName }) {
  const values = { commerciale: operator?.name, azienda: companyName };
  return { subject: fillTemplate(FIRST_CONTACT_EMAIL.subject, values), body: fillTemplate(FIRST_CONTACT_EMAIL.body, values) };
}
