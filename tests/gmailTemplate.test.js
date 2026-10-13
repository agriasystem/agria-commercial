// Patch 0.4.1: email di primo contatto (config/outreachTemplates.js, unica fonte del testo) e URL di
// composizione di Gmail (lib/gmail.js) con l'account del commerciale attivo. Nessuna rete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_CONTACT_EMAIL, fillTemplate, firstContactEmail, PLACEHOLDERS } from '../extension/config/outreachTemplates.js';
import { GMAIL_COMPOSE, gmailComposeUrl } from '../extension/lib/gmail.js';
import { OPERATORS } from '../extension/lib/operators.js';

const [MATTEO, ALESSANDRO] = OPERATORS;
const BODY = (name, company) => [
  'Gentile Direzione,',
  '',
  `sono ${name} di Agria System.`,
  '',
  `A seguito di un'analisi sul mercato italiano dell'agroalimentare e dell'hospitality, settori su cui siamo focalizzati anche con uno sguardo internazionale, le scrivo per entrare in contatto con ${company}.`,
  '',
  'In Agria System supportiamo cantine e strutture ricettive attraverso la realizzazione di presenze web premium, piattaforme e-commerce e implementazioni AI volte ad automatizzare i processi interni e accelerare la crescita commerciale, aumentando vendite dirette e acquisizione clienti.',
  '',
  'Avrebbe disponibilità nei prossimi giorni per una call conoscitiva, così da valutare se ci sono i presupposti per una collaborazione?',
  '',
  'Nel frattempo, se desidera conoscere meglio la nostra realtà, può trovare maggiori informazioni su www.agriasystem.com.',
  '',
  'Un cordiale saluto,',
].join('\n');

test('template: segnaposto esatti, oggetto e testo definitivi', () => {
  assert.deepEqual(PLACEHOLDERS, { commerciale: '{{NOME_COMMERCIALE}}', azienda: '{{AZIENDA}}' });
  assert.equal(FIRST_CONTACT_EMAIL.subject, 'Gestione digitale e crescita commerciale per {{AZIENDA}}');
  assert.equal(FIRST_CONTACT_EMAIL.body, BODY('{{NOME_COMMERCIALE}}', '{{AZIENDA}}'));
  const mail = firstContactEmail({ operator: ALESSANDRO, companyName: 'Agriturismo Il Giardino degli Elfi' });
  assert.equal(mail.subject, 'Gestione digitale e crescita commerciale per Agriturismo Il Giardino degli Elfi');
  assert.equal(mail.body, BODY('Alessandro Poponi', 'Agriturismo Il Giardino degli Elfi'));
});

test('template: nessun segnaposto residuo, niente dopo «Un cordiale saluto,», niente Markdown', () => {
  const mail = firstContactEmail({ operator: MATTEO, companyName: 'Cantina Dionigi' });
  for (const text of [mail.subject, mail.body]) assert.ok(!/\{\{|\}\}/.test(text), text);
  assert.ok(mail.body.endsWith('Un cordiale saluto,'), 'la firma la aggiunge Gmail');
  assert.equal(mail.body.split('Un cordiale saluto,')[1], '', 'nessun nome, cognome, telefono o email dopo il saluto');
  assert.ok(!/Matteo Garuzzo\s*$|Agria System\s*$/.test(mail.body));
  assert.ok(mail.body.includes('www.agriasystem.com'));
  assert.ok(!/\[[^\]]*\]\(|\*\*|<a\s|<\/?[a-z]+>|https?:\/\//i.test(mail.body), 'testo semplice: niente Markdown, HTML o link espliciti');
  // segnaposto sconosciuto o valori mancanti: l'email non si prepara
  assert.throws(() => fillTemplate('Ciao {{ALTRO}}', { commerciale: 'X', azienda: 'Y' }), /segnaposto/);
  assert.throws(() => firstContactEmail({ operator: null, companyName: 'Cantina Dionigi' }), /Commerciale attivo mancante/);
  assert.throws(() => firstContactEmail({ operator: MATTEO, companyName: '  ' }), /nome dell'Azienda mancante/i);
});

test('multi-commerciale: nome nel testo dal registro, cambio commerciale immediato', () => {
  const company = 'Il Cantico delle Cicale';
  assert.ok(firstContactEmail({ operator: ALESSANDRO, companyName: company }).body.includes('sono Alessandro Poponi di Agria System.'));
  assert.ok(firstContactEmail({ operator: MATTEO, companyName: company }).body.includes('sono Matteo Garuzzo di Agria System.'));
  // un futuro commerciale: basta la sua voce nel registro
  const futuro = { name: 'Giulia Verdi', hubspotOwnerId: '1', email: 'giulia.verdi@agriasystem.com' };
  assert.ok(firstContactEmail({ operator: futuro, companyName: company }).body.includes('sono Giulia Verdi di Agria System.'));
});

const urlFor = (operator, { to = 'info@cantinadionigi.it', cc = ['carolina@cantinadionigi.it'], company = 'Cantina Dionigi' } = {}) => {
  const mail = firstContactEmail({ operator, companyName: company });
  return { url: gmailComposeUrl({ account: operator.email, to, cc, subject: mail.subject, body: mail.body }), mail };
};

test('Gmail: composizione con A, CC, oggetto, testo e account del commerciale attivo', () => {
  const { url, mail } = urlFor(ALESSANDRO, { cc: ['carolina@cantinadionigi.it', 'booking@cantinadionigi.it'] });
  assert.ok(url.startsWith(`${GMAIL_COMPOSE}?`));
  const params = new URL(url).searchParams;
  assert.equal(params.get('authuser'), 'alessandro.poponi@agriasystem.com');
  assert.deepEqual([params.get('view'), params.get('fs')], ['cm', '1']);
  assert.equal(params.get('to'), 'info@cantinadionigi.it');
  assert.equal(params.get('cc'), 'carolina@cantinadionigi.it,booking@cantinadionigi.it');
  assert.equal(params.get('su'), 'Gestione digitale e crescita commerciale per Cantina Dionigi');
  assert.equal(params.get('body'), mail.body);
  assert.ok(!/\/u\/\d+\//.test(url), 'nessun indice di account /u/0/');
  // Matteo attivo: stesso prospect, altro account e altro nome nel testo
  const matteo = new URL(urlFor(MATTEO).url).searchParams;
  assert.equal(matteo.get('authuser'), 'matteo.garuzzo@agriasystem.com');
  assert.ok(matteo.get('body').includes('sono Matteo Garuzzo di Agria System.'));
  // senza CC: nessun parametro cc
  assert.equal(new URL(urlFor(MATTEO, { cc: [] }).url).searchParams.has('cc'), false);
  assert.throws(() => gmailComposeUrl({ account: '', to: 'a@b.it' }), /commerciale attivo/);
});

test('Gmail: apostrofi, accenti, & e a capo codificati nell\'URL', () => {
  const { url, mail } = urlFor(ALESSANDRO, { company: "Locanda dell'Orso & Figli – Città di Castello" });
  const query = url.slice(url.indexOf('?') + 1);
  assert.ok(!/[ '\n"<>]/.test(query), 'nessuno spazio, apostrofo, a capo o virgoletta in chiaro');
  assert.equal(query.split('&').length, 7, 'la & del nome non spezza i parametri');
  assert.ok(query.includes('%27') && query.includes('%26') && query.includes('%0A') && query.includes('%C3%A0'), 'apostrofo, &, a capo, à');
  const params = new URL(url).searchParams;
  assert.equal(params.get('su'), "Gestione digitale e crescita commerciale per Locanda dell'Orso & Figli – Città di Castello");
  assert.equal(params.get('body'), mail.body);
  assert.ok(params.get('body').includes("le scrivo per entrare in contatto con Locanda dell'Orso & Figli – Città di Castello."));
});
