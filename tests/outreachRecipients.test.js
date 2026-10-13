// Destinatari della prima email in Outreach (Patch 0.4.1). La prima email è un'operazione dell'AZIENDA:
// una sola email aziendale, A = email aziendale principale, CC = tutte le altre email valide del prospect,
// anche nominative. Fonte strutturata companyEmails (dalla bozza di Scout, mai dal Contesto rapido).
// Escluse: PEC, privacy/dpo, noreply, indirizzi tecnici, hosting, fornitori del sito, domini estranei.
// Casi reali riprodotti con dati di prova: Cantina Dionigi (carolina@ in CC), Il Cantico delle Cicale
// (casella dell'hosting esclusa). Nessun sito reale, nessuna rete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshot } from '../extension/lib/parser.js';
import { companyEmails, EMAIL_EXCLUSION, isHostingEmail, proposeCompany } from '../extension/lib/crmModel.js';
import { applyFindings, editField, emptyDraft, updateHubspot } from '../extension/lib/draft.js';
import { addPageFindings, emptySite } from '../extension/lib/siteData.js';
import { cleanCc, outreachProspect, outreachRecipients } from '../extension/lib/outreach.js';
import { OPERATORS } from '../extension/lib/operators.js';

const [MATTEO] = OPERATORS;
const mailto = (email, zone = 'page', text = email) => ({ kind: 'mailto', href: `mailto:${email}`, text, zone });
const snap = (url, { title = 'Agriturismo Il Poggio', page = '', footer = '', links = [], headings = [] } = {}) => ({
  url, title, meta: {}, jsonld: [], links, resources: [], microdata: [], addresses: [], headings,
  text: { header: '', footer, page: [page, footer].filter(Boolean).join('\n') },
});
const scanned = (...pages) => pages.reduce((d, p) => applyFindings(d, p).draft, emptyDraft());
const inHubspot = (draft, name = 'Agriturismo Il Poggio') => updateHubspot(draft, 'real', { company: { id: '9001', name, url: '', createdAt: '', ownerId: MATTEO.hubspotOwnerId, ownerName: MATTEO.name } });
const values = (draft) => Object.fromEntries(Object.entries(draft.company).map(([k, f]) => [k, f.value]));

// ---- Cantina Dionigi: info@ e carolina@ sullo stesso dominio (footer: «OSPITALITA' … carolina@…») ----

const DIONIGI = 'https://www.cantinadionigi.test';
const DIONIGI_FOOTER = [
  'Cantina Dionigi', 'Via Madonna della Pia, 44 06031 Bevagna PG', 'Email:', 'info@cantinadionigi.test',
  'Mob.: +39 347 0000001 · +39 333 0000002', "OSPITALITA'", '+39 347 0000001', 'carolina@cantinadionigi.test',
  '© 2022 Cantina Dionigi - Realizzazione Agenzia Web Esempio',
].join('\n');
const dionigi = () => analyzeSnapshot(snap(`${DIONIGI}/`, {
  title: 'Vendita On-line Sagrantino di Montefalco Cantina Dionigi',
  page: 'Cantina Dionigi: Sagrantino di Montefalco, vini e degustazioni.\n+39 347 0000001 +39 333 0000002\ninfo@cantinadionigi.test',
  footer: DIONIGI_FOOTER,
  links: [mailto('info@cantinadionigi.test', 'footer'), mailto('carolina@cantinadionigi.test', 'footer')],
}), { pageType: 'home' });

test('Cantina Dionigi: info@ in A, carolina@ in CC (nominativa ma dello stesso dominio): una sola email aziendale', () => {
  const p = outreachProspect(inHubspot(scanned(dionigi()), 'Cantina Dionigi'), 'real');
  const plan = outreachRecipients(p);
  assert.deepEqual([plan.type, plan.to, plan.cc, plan.removed], ['company', 'info@cantinadionigi.test', ['carolina@cantinadionigi.test'], []]);
  assert.deepEqual(p.excluded, [], 'carolina@ non è esclusa perché nominativa');
  // Togli / Rimetti
  const off = outreachRecipients(p, ['carolina@cantinadionigi.test']);
  assert.deepEqual([off.to, off.cc, off.removed], ['info@cantinadionigi.test', [], ['carolina@cantinadionigi.test']]);
  assert.deepEqual(outreachRecipients(p, []).cc, ['carolina@cantinadionigi.test'], 'rimessa in CC');
});

test('nessuna regola sul nome: la decisione viene da dominio, fonte e appartenenza al prospect', () => {
  const site = (footer) => addPageFindings(emptySite(), analyzeSnapshot(snap(`${DIONIGI}/`, { title: 'Cantina Dionigi', footer }), { pageType: 'home' }));
  const usable = (footer) => companyEmails(site(footer), { name: 'Cantina Dionigi', email_aziendale_principale: 'info@cantinadionigi.test' }).filter((e) => e.usable).map((e) => e.email);
  // qualunque nome sul dominio del prospect: valido
  for (const local of ['carolina', 'marco.rossi', 'giulia']) assert.ok(usable(`info@cantinadionigi.test\n${local}@cantinadionigi.test`).includes(`${local}@cantinadionigi.test`), local);
  // lo stesso nome su un dominio estraneo: no
  assert.ok(!usable('info@cantinadionigi.test\ncarolina@altrastruttura.test').includes('carolina@altrastruttura.test'));
  // persona presentata dal sito con un ruolo, casella gratuita: recapito del prospect
  assert.ok(usable('info@cantinadionigi.test\nTitolare: Carolina Bianchi · carolinabianchi1970@gmail.com').includes('carolinabianchi1970@gmail.com'));
});

// ---- Il Cantico delle Cicale: la casella dell'hosting (SiteGround) non è del prospect ----

const CICALE = 'https://ilcanticodellecicale.test';
const cicale = () => analyzeSnapshot(snap(`${CICALE}/`, {
  title: 'Agriturismo Il Cantico delle Cicale, con ristorante – Alle porte della città di Perugia',
  headings: ['Il Cantico delle Cicale'],
  page: 'Modulo di contatto: le richieste arrivano a info@pietrofl11.sg-host.com',
  footer: 'Strada per Fratticiola Selvatica, 1 | località Piccione | 06134 Perugia IT\ninfo@ilcanticodellecicale.test\nP. Iva 12345678903 | PEC: ilcanticodellecicale@pec.test',
  links: [mailto('info@ilcanticodellecicale.test', 'footer'), mailto('ilcanticodellecicale@pec.test', 'footer')],
}), { pageType: 'home' });

test('Il Cantico delle Cicale: info@ valido; casella dell\'hosting e PEC escluse, anche dalle proposte di Scout', () => {
  const draft = scanned(cicale());
  assert.equal(draft.company.email_aziendale_principale.value, 'info@ilcanticodellecicale.test');
  assert.notEqual(draft.company.email_aziendale_secondaria.value, 'info@pietrofl11.sg-host.com', 'l\'hosting non diventa l\'email secondaria');
  const p = outreachProspect(inHubspot(draft, 'Il Cantico delle Cicale'), 'real');
  const plan = outreachRecipients(p);
  assert.deepEqual([plan.to, plan.cc], ['info@ilcanticodellecicale.test', []]);
  assert.deepEqual([...p.excluded].sort((a, b) => a.email.localeCompare(b.email)), [
    { email: 'ilcanticodellecicale@pec.test', reason: EMAIL_EXCLUSION.pec },
    { email: 'info@pietrofl11.sg-host.com', reason: EMAIL_EXCLUSION.provider },
  ]);
  for (const email of ['info@pietrofl11.sg-host.com', 'web@x.siteground.it', 'a@b.hostinger.com', 'x@myshop.myshopify.com']) assert.ok(isHostingEmail(email), email);
  for (const email of ['info@ilcanticodellecicale.test', 'agriturismo@gmail.com']) assert.ok(!isHostingEmail(email), email);
  // anche scelta a mano, la casella dell'hosting non va in copia
  const manual = editField(draft, 'company', 'email_aziendale_secondaria', 'info@pietrofl11.sg-host.com');
  assert.ok(!outreachRecipients(outreachProspect(inHubspot(manual), 'real')).cc.includes('info@pietrofl11.sg-host.com'));
  assert.ok(!proposeCompany(addPageFindings(emptySite(), cicale())).email_aziendale_secondaria.value.includes('sg-host'));
});

// ---- regole generali ----

const ORIGIN = 'https://www.ilpoggio.test';
const FOOTER = 'Agriturismo Il Poggio · Via Roma 1, 06063 Magione (PG) · info@ilpoggio.test\nPEC: ilpoggio@pec.it · Privacy: privacy@ilpoggio.test\nSito realizzato da WebStudio – info@webstudio.test';
const HOME = analyzeSnapshot(snap(`${ORIGIN}/`, {
  page: 'Agriturismo Il Poggio: camere e piscina.\nScrivici: INFO@ilpoggio.test',
  footer: FOOTER,
  links: [mailto('info@ilpoggio.test', 'footer'), mailto('info@webstudio.test', 'footer', 'WebStudio')],
}), { pageType: 'home' });
const CONTATTI = analyzeSnapshot(snap(`${ORIGIN}/contatti`, {
  page: [
    'Contatti', 'Prenotazioni: prenotazioni@ilpoggio.test', 'Ufficio commerciale: commerciale@ilpoggio.test', 'Sales: sales@ilpoggio.test',
    'Booking: booking@ilpoggio.test', 'Amministrazione: amministrazione@ilpoggio.test', 'Webmaster: webmaster@ilpoggio.test',
    'Non rispondere a noreply@ilpoggio.test', 'DPO: dpo@ilpoggio.test', 'Prenota anche da agriturismoilpoggio@gmail.com',
    'Fornitore: ordini@cartoleria-rossi.test', 'Maria Rossi – Titolare · maria.rossi@ilpoggio.test',
  ].join('\n'),
  footer: FOOTER,
  links: [mailto('prenotazioni@ilpoggio.test'), mailto('commerciale@ilpoggio.test')],
}), { pageType: 'contact' });

test('companyEmails: tutte le email trovate, normalizzate, deduplicate, con l\'esito', () => {
  const draft = scanned(HOME, CONTATTI);
  const list = companyEmails(draft.site, values(draft));
  const byEmail = Object.fromEntries(list.map((e) => [e.email, e]));
  assert.equal(list.filter((e) => e.email === 'info@ilpoggio.test').length, 1, 'INFO@ e info@ sono la stessa email');
  assert.deepEqual(list.slice(0, 2).map((e) => [e.email, e.role]), [['info@ilpoggio.test', 'principale'], ['prenotazioni@ilpoggio.test', 'secondaria']]);
  assert.deepEqual(list.filter((e) => e.usable).map((e) => e.email).sort(), [
    'agriturismoilpoggio@gmail.com', 'booking@ilpoggio.test', 'commerciale@ilpoggio.test', 'info@ilpoggio.test', 'maria.rossi@ilpoggio.test',
    'prenotazioni@ilpoggio.test', 'sales@ilpoggio.test',
  ]);
  assert.equal(byEmail['ilpoggio@pec.it'].reason, EMAIL_EXCLUSION.pec);
  assert.equal(byEmail['privacy@ilpoggio.test'].reason, EMAIL_EXCLUSION.privacy);
  assert.equal(byEmail['dpo@ilpoggio.test'].reason, EMAIL_EXCLUSION.privacy);
  assert.equal(byEmail['noreply@ilpoggio.test'].reason, EMAIL_EXCLUSION.noreply);
  assert.equal(byEmail['webmaster@ilpoggio.test'].reason, EMAIL_EXCLUSION.technical);
  assert.equal(byEmail['amministrazione@ilpoggio.test'].reason, EMAIL_EXCLUSION.notCommercial);
  assert.equal(byEmail['info@webstudio.test'].reason, EMAIL_EXCLUSION.provider);
  assert.equal(byEmail['ordini@cartoleria-rossi.test'].reason, EMAIL_EXCLUSION.external);
  assert.equal(byEmail['maria.rossi@ilpoggio.test'].usable, true, 'nominativa, dello stesso dominio: valida');
  for (const e of list) assert.equal(e.email, e.email.toLowerCase());
});

test('A = principale, CC = secondaria + altre valide, nessun doppione, A mai in CC', () => {
  const p = outreachProspect(inHubspot(scanned(HOME, CONTATTI)), 'real');
  const plan = outreachRecipients(p);
  assert.deepEqual([plan.type, plan.label, plan.to], ['company', 'Azienda — info@ilpoggio.test', 'info@ilpoggio.test']);
  assert.equal(plan.cc[0], 'prenotazioni@ilpoggio.test', 'prima la secondaria');
  assert.deepEqual([...plan.cc].sort(), ['agriturismoilpoggio@gmail.com', 'booking@ilpoggio.test', 'commerciale@ilpoggio.test', 'maria.rossi@ilpoggio.test', 'prenotazioni@ilpoggio.test', 'sales@ilpoggio.test']);
  assert.equal(new Set([plan.to, ...plan.cc]).size, plan.cc.length + 1);
  for (const excluded of ['ilpoggio@pec.it', 'privacy@ilpoggio.test', 'dpo@ilpoggio.test', 'webmaster@ilpoggio.test', 'noreply@ilpoggio.test', 'info@webstudio.test', 'ordini@cartoleria-rossi.test', 'amministrazione@ilpoggio.test']) {
    assert.ok(!plan.cc.includes(excluded), `${excluded} non suggerita`);
    assert.ok(p.excluded.some((e) => e.email === excluded), `${excluded} elencata come non suggerita, col motivo`);
  }
});

test('CC tolti a mano: restano tolti (e si possono rimettere); A non si tocca', () => {
  const p = outreachProspect(inHubspot(scanned(HOME, CONTATTI)), 'real');
  const all = outreachRecipients(p).cc;
  const plan = outreachRecipients(p, ['sales@ilpoggio.test', 'booking@ilpoggio.test', 'altro@esterno.test']);
  assert.deepEqual(plan.cc, all.filter((e) => !['sales@ilpoggio.test', 'booking@ilpoggio.test'].includes(e)));
  assert.deepEqual(plan.removed, ['sales@ilpoggio.test', 'booking@ilpoggio.test']);
  assert.equal(plan.to, 'info@ilpoggio.test');
  const again = outreachRecipients(outreachProspect(inHubspot(scanned(HOME, CONTATTI, CONTATTI)), 'real'), plan.removed);
  assert.deepEqual([again.cc, again.removed], [plan.cc, plan.removed], 'stessa scelta dopo una nuova scansione');
  assert.ok(outreachRecipients(p, ['booking@ilpoggio.test']).cc.includes('sales@ilpoggio.test'), 'rimessa in CC');
});

test('nessuna altra email: solo A, CC vuoto; nessuna email: A vuota, niente inventato', () => {
  const only = analyzeSnapshot(snap(`${ORIGIN}/`, { footer: 'Agriturismo Il Poggio · info@ilpoggio.test · PEC: ilpoggio@pec.it' }), { pageType: 'home' });
  const plan = outreachRecipients(outreachProspect(inHubspot(scanned(only)), 'real'));
  assert.deepEqual([plan.to, plan.cc], ['info@ilpoggio.test', []]);
  const none = outreachRecipients(outreachProspect(inHubspot(scanned(analyzeSnapshot(snap(`${ORIGIN}/`, { footer: 'Agriturismo Il Poggio' }), { pageType: 'home' }))), 'real'));
  assert.deepEqual([none.label, none.to, none.cc], ['Azienda', '', []]);
});

test('scelte a mano del commerciale: valgono come riconosciute (salvo PEC, indirizzi automatici, hosting)', () => {
  let draft = scanned(HOME, CONTATTI);
  draft = editField(draft, 'company', 'email_aziendale_secondaria', 'direzione@gruppopoggio.test');
  assert.equal(outreachRecipients(outreachProspect(inHubspot(draft), 'real')).cc[0], 'direzione@gruppopoggio.test');
  draft = editField(draft, 'company', 'email_aziendale_secondaria', 'ilpoggio@pec.it');
  assert.ok(!outreachRecipients(outreachProspect(inHubspot(draft), 'real')).cc.includes('ilpoggio@pec.it'));
  draft = editField(draft, 'company', 'email_aziendale_principale', 'Booking@ilpoggio.test');
  const plan = outreachRecipients(outreachProspect(inHubspot(draft), 'real'));
  assert.deepEqual([plan.to, plan.cc.includes('booking@ilpoggio.test')], ['booking@ilpoggio.test', false]);
});

test('casella gratuita del prospect accanto ai crediti del sito: resta del prospect (caso La Mora)', () => {
  const footer = 'Agriturismo La Mora · Via Roma 1, 06081 Assisi (PG) · +39 393 4363917 agriturismolamora@gmail.com\nSito realizzato da Studio Web Esempio S.r.l. – info@studiowebesempio.test';
  const f = analyzeSnapshot(snap('https://lamora-caso.test/', { title: 'Agriturismo La Mora', footer }), { pageType: 'home' });
  const p = outreachProspect(inHubspot(scanned(f)), 'real');
  assert.deepEqual([outreachRecipients(p).to, outreachRecipients(p).cc], ['agriturismolamora@gmail.com', []]);
  assert.deepEqual(p.excluded, [{ email: 'info@studiowebesempio.test', reason: EMAIL_EXCLUSION.provider }]);
});

test('cleanCc: solo indirizzi validi, minuscoli, senza doppioni e senza A', () => {
  assert.deepEqual(cleanCc(['B@x.it', 'b@x.it', 'a@x.it', 'non-email', 42, null, ' c@x.it '], 'a@x.it'), ['b@x.it', 'c@x.it']);
  assert.deepEqual(cleanCc('a@x.it'), []);
});
