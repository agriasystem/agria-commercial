// Patch 0.4.1: destinatari della prima email in Outreach. Fonte strutturata companyEmails (dalla bozza di
// Scout, mai dal testo del Contesto rapido): A = email aziendale principale, CC = secondaria e le altre
// email aziendali utilizzabili; PEC, privacy, indirizzi tecnici, fornitori e domini estranei esclusi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshot } from '../extension/lib/parser.js';
import { companyEmails, EMAIL_EXCLUSION } from '../extension/lib/crmModel.js';
import { applyFindings, editField, emptyDraft, updateHubspot } from '../extension/lib/draft.js';
import { cleanCc, outreachProspect, outreachRecipients, recipientOptions } from '../extension/lib/outreach.js';
import { OPERATORS } from '../extension/lib/operators.js';

const [MATTEO] = OPERATORS;
const ORIGIN = 'https://www.ilpoggio.test';
const mailto = (email, zone = 'page', text = email) => ({ kind: 'mailto', href: `mailto:${email}`, text, zone });
const snap = (path, { title = 'Agriturismo Il Poggio', page = '', footer = '', links = [], headings = [] } = {}) => ({
  url: `${ORIGIN}${path}`, title, meta: {}, jsonld: [], links, resources: [], microdata: [], addresses: [], headings,
  text: { header: '', footer, page: [page, footer].filter(Boolean).join('\n') },
});
const FOOTER = 'Agriturismo Il Poggio · Via Roma 1, 06063 Magione (PG) · info@ilpoggio.test\nPEC: ilpoggio@pec.it · Privacy: privacy@ilpoggio.test\nSito realizzato da WebStudio – info@webstudio.test';
const HOME = analyzeSnapshot(snap('/', {
  page: 'Agriturismo Il Poggio: camere e piscina.\nScrivici: INFO@ilpoggio.test',
  footer: FOOTER,
  links: [mailto('info@ilpoggio.test', 'footer'), mailto('info@webstudio.test', 'footer', 'WebStudio')],
}), { pageType: 'home' });
const CONTATTI = analyzeSnapshot(snap('/contatti', {
  page: [
    'Contatti', 'Prenotazioni: prenotazioni@ilpoggio.test', 'Ufficio commerciale: commerciale@ilpoggio.test', 'Sales: sales@ilpoggio.test',
    'Booking: booking@ilpoggio.test', 'Amministrazione: amministrazione@ilpoggio.test', 'Webmaster: webmaster@ilpoggio.test',
    'Non rispondere a noreply@ilpoggio.test', 'DPO: dpo@ilpoggio.test', 'Prenota anche da agriturismoilpoggio@gmail.com',
    'Fornitore: ordini@cartoleria-rossi.test', 'Maria Rossi – Titolare · maria.rossi@ilpoggio.test',
  ].join('\n'),
  footer: FOOTER,
  links: [mailto('prenotazioni@ilpoggio.test'), mailto('commerciale@ilpoggio.test')],
}), { pageType: 'contact' });
const scanned = (...pages) => pages.reduce((d, p) => applyFindings(d, p).draft, emptyDraft());
const inHubspot = (draft) => updateHubspot(draft, 'real', { company: { id: '9001', name: 'Agriturismo Il Poggio', url: '', createdAt: '', ownerId: MATTEO.hubspotOwnerId, ownerName: MATTEO.name } });
const values = (draft) => Object.fromEntries(Object.entries(draft.company).map(([k, f]) => [k, f.value]));

test('companyEmails: tutte le email aziendali trovate, normalizzate, deduplicate, con l\'esito', () => {
  const draft = scanned(HOME, CONTATTI);
  const list = companyEmails(draft.site, values(draft));
  const byEmail = Object.fromEntries(list.map((e) => [e.email, e]));
  assert.equal(list.filter((e) => e.email === 'info@ilpoggio.test').length, 1, 'INFO@ e info@ sono la stessa email');
  assert.deepEqual(list.slice(0, 2).map((e) => [e.email, e.role]), [['info@ilpoggio.test', 'principale'], ['prenotazioni@ilpoggio.test', 'secondaria']]);
  const usable = list.filter((e) => e.usable).map((e) => e.email).sort();
  assert.deepEqual(usable, ['agriturismoilpoggio@gmail.com', 'booking@ilpoggio.test', 'commerciale@ilpoggio.test', 'info@ilpoggio.test', 'prenotazioni@ilpoggio.test', 'sales@ilpoggio.test']);
  assert.equal(byEmail['ilpoggio@pec.it'].reason, EMAIL_EXCLUSION.pec);
  assert.equal(byEmail['privacy@ilpoggio.test'].reason, EMAIL_EXCLUSION.privacy);
  assert.equal(byEmail['dpo@ilpoggio.test'].reason, EMAIL_EXCLUSION.privacy);
  assert.equal(byEmail['noreply@ilpoggio.test'].reason, EMAIL_EXCLUSION.noreply);
  assert.equal(byEmail['webmaster@ilpoggio.test'].reason, EMAIL_EXCLUSION.technical);
  assert.equal(byEmail['amministrazione@ilpoggio.test'].reason, EMAIL_EXCLUSION.notCommercial);
  assert.equal(byEmail['maria.rossi@ilpoggio.test'].reason, EMAIL_EXCLUSION.person);
  assert.equal(byEmail['info@webstudio.test'].reason, EMAIL_EXCLUSION.provider);
  assert.equal(byEmail['ordini@cartoleria-rossi.test'].reason, EMAIL_EXCLUSION.external);
  for (const e of list) assert.equal(e.email, e.email.toLowerCase());
});

test('Outreach «Azienda»: A = principale, CC = secondaria + altre idonee, nessun doppione', () => {
  const p = outreachProspect(inHubspot(scanned(HOME, CONTATTI)), 'real');
  const [company] = recipientOptions(p);
  assert.deepEqual([company.key, company.type, company.label, company.to], ['company', 'company', 'Azienda — info@ilpoggio.test', 'info@ilpoggio.test']);
  assert.deepEqual([...company.cc].sort(), ['agriturismoilpoggio@gmail.com', 'booking@ilpoggio.test', 'commerciale@ilpoggio.test', 'prenotazioni@ilpoggio.test', 'sales@ilpoggio.test']);
  assert.equal(company.cc[0], 'prenotazioni@ilpoggio.test', 'prima la secondaria');
  assert.equal(new Set([company.to, ...company.cc]).size, company.cc.length + 1, 'nessun doppione, A non è in CC');
  for (const excluded of ['ilpoggio@pec.it', 'privacy@ilpoggio.test', 'dpo@ilpoggio.test', 'webmaster@ilpoggio.test', 'noreply@ilpoggio.test', 'info@webstudio.test', 'ordini@cartoleria-rossi.test', 'amministrazione@ilpoggio.test', 'maria.rossi@ilpoggio.test']) {
    assert.ok(!company.cc.includes(excluded), `${excluded} non suggerita`);
    assert.ok(p.excluded.some((e) => e.email === excluded), `${excluded} elencata come non suggerita, col motivo`);
  }
  const plan = outreachRecipients(p, 'company');
  assert.deepEqual([plan.type, plan.to, plan.cc, plan.removed], ['company', 'info@ilpoggio.test', company.cc, []]);
});

test('CC tolto a mano: resta tolto (e si può rimettere); un CC sconosciuto non cambia nulla', () => {
  const p = outreachProspect(inHubspot(scanned(HOME, CONTATTI)), 'real');
  const all = recipientOptions(p)[0].cc;
  const plan = outreachRecipients(p, 'company', ['sales@ilpoggio.test', 'booking@ilpoggio.test', 'altro@esterno.test']);
  assert.deepEqual(plan.cc, all.filter((e) => !['sales@ilpoggio.test', 'booking@ilpoggio.test'].includes(e)));
  assert.deepEqual(plan.removed, ['sales@ilpoggio.test', 'booking@ilpoggio.test']);
  assert.equal(plan.to, 'info@ilpoggio.test', 'A non si tocca');
  // la stessa scelta, ricalcolata (nuovo disegno della vista, nuova scansione): stessa rimozione
  const again = outreachRecipients(outreachProspect(inHubspot(scanned(HOME, CONTATTI, CONTATTI)), 'real'), 'company', plan.removed);
  assert.deepEqual([again.cc, again.removed], [plan.cc, plan.removed]);
  // rimesso in CC
  assert.ok(outreachRecipients(p, 'company', ['booking@ilpoggio.test']).cc.includes('sales@ilpoggio.test'));
  // scelta che non esiste più: niente destinatari
  assert.equal(outreachRecipients(p, 'company:vecchia@ilpoggio.test'), null);
});

test('nessuna email in più: solo A, nessun CC', () => {
  const only = analyzeSnapshot(snap('/', { footer: 'Agriturismo Il Poggio · info@ilpoggio.test · PEC: ilpoggio@pec.it' }), { pageType: 'home' });
  const p = outreachProspect(inHubspot(scanned(only)), 'real');
  const [company] = recipientOptions(p);
  assert.deepEqual([company.to, company.cc], ['info@ilpoggio.test', []]);
  assert.deepEqual(outreachRecipients(p, 'company').cc, []);
  // nessuna email aziendale trovata: l'Azienda resta selezionabile, senza indirizzi inventati
  const none = outreachProspect(inHubspot(scanned(analyzeSnapshot(snap('/', { footer: 'Agriturismo Il Poggio' }), { pageType: 'home' }))), 'real');
  assert.deepEqual(recipientOptions(none).map((o) => [o.label, o.to, o.cc]), [['Azienda — email aziendale', '', []]]);
});

test('scelte a mano del commerciale: valgono come riconosciute (salvo PEC e indirizzi automatici)', () => {
  let draft = scanned(HOME, CONTATTI);
  draft = editField(draft, 'company', 'email_aziendale_secondaria', 'direzione@gruppopoggio.test'); // altro dominio, scelto a mano
  let p = outreachProspect(inHubspot(draft), 'real');
  assert.equal(recipientOptions(p)[0].cc[0], 'direzione@gruppopoggio.test');
  draft = editField(draft, 'company', 'email_aziendale_secondaria', 'ilpoggio@pec.it');
  p = outreachProspect(inHubspot(draft), 'real');
  assert.ok(!recipientOptions(p)[0].cc.includes('ilpoggio@pec.it'), 'la PEC resta esclusa anche se scelta a mano');
  // la principale cambiata a mano diventa A
  draft = editField(draft, 'company', 'email_aziendale_principale', 'Booking@ilpoggio.test');
  p = outreachProspect(inHubspot(draft), 'real');
  assert.deepEqual([recipientOptions(p)[0].to, recipientOptions(p)[0].cc.includes('booking@ilpoggio.test')], ['booking@ilpoggio.test', false]);
});

test('Contatto HubSpot: A = il Contatto, nessun CC suggerito', () => {
  const draft = updateHubspot(inHubspot(scanned(HOME, CONTATTI)), 'real', { contact: { id: '888', name: 'Maria Rossi', companyId: '9001', associated: true, url: '', createdAt: '' } });
  const p = outreachProspect(draft, 'real');
  const contact = recipientOptions(p).at(-1);
  assert.deepEqual([contact.type, contact.label, contact.to, contact.cc], ['contact', 'Maria Rossi — Titolare', 'maria.rossi@ilpoggio.test', []]);
  assert.deepEqual(outreachRecipients(p, contact.key), { key: 'contact:888', type: 'contact', contactId: '888', label: 'Maria Rossi — Titolare', to: 'maria.rossi@ilpoggio.test', cc: [], removed: [] });
});

test('casella gratuita del prospect accanto ai crediti del sito: resta del prospect (caso La Mora)', () => {
  const footer = 'Agriturismo La Mora · Via Roma 1, 06081 Assisi (PG) · +39 393 4363917 agriturismolamora@gmail.com\nSito realizzato da Studio Web Esempio S.r.l. – info@studiowebesempio.test';
  const f = analyzeSnapshot({ ...snap('/', { title: 'Agriturismo La Mora', footer }), url: 'https://lamora-caso.test/' }, { pageType: 'home' });
  const p = outreachProspect(inHubspot(scanned(f)), 'real');
  assert.deepEqual([recipientOptions(p)[0].to, recipientOptions(p)[0].cc], ['agriturismolamora@gmail.com', []]);
  assert.deepEqual(p.excluded, [{ email: 'info@studiowebesempio.test', reason: EMAIL_EXCLUSION.provider }]);
});

test('cleanCc: solo indirizzi validi, minuscoli, senza doppioni e senza A', () => {
  assert.deepEqual(cleanCc(['B@x.it', 'b@x.it', 'a@x.it', 'non-email', 42, null, ' c@x.it '], 'a@x.it'), ['b@x.it', 'c@x.it']);
  assert.deepEqual(cleanCc('a@x.it'), []);
});
