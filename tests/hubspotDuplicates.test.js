// Doppioni HubSpot: normalizzazione e confronto deterministico (nessuna rete, nessuna AI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCompanies, classifyContacts, companyCore, companyKeys, contactSearch, linkedinVariants, phoneVariants, safeRecordUrl,
} from '../extension/lib/hubspotDuplicates.js';
import { leadStatusLabel } from '../extension/lib/crmModel.js';

const rec = (id, properties) => ({ id, properties });

test('dominio normalizzato: minuscolo, senza protocollo, www. e barre finali; sottodomini distinti', () => {
  for (const raw of ['https://www.CantinaRossi.it/', 'http://cantinarossi.it', 'www.cantinarossi.it/contatti', 'CANTINAROSSI.IT']) {
    assert.equal(companyKeys({ domain: raw }).domain, 'cantinarossi.it', raw);
  }
  assert.equal(companyKeys({ domain: 'shop.cantinarossi.it' }).domain, 'shop.cantinarossi.it');
  assert.equal(classifyCompanies({ domain: 'cantinarossi.it' }, [rec('1', { domain: 'shop.cantinarossi.it' })]).outcome, 'none');
});

test('nome distintivo: senza forme societarie, tipo di attività e articoli', () => {
  assert.equal(companyCore('Perticaia Società Agricola S.r.l.'), 'perticaia');
  assert.equal(companyCore('Agriturismo La Mora'), 'mora');
  assert.equal(companyCore('AZ. AGR. Tenuta di Sopra s.s.'), 'sopra');
  assert.equal(companyCore('Frantoio'), 'frantoio', 'se resta vuoto si usa il nome intero');
  assert.equal(companyCore(''), '');
});

test('telefono: varianti scritte a mano, confronto sul numero normalizzato', () => {
  const values = phoneVariants('+39 0742 379014');
  for (const v of ['+390742379014', '0742379014', '0742 379014', '+39 0742379014', '0039 0742379014', '0742-379014']) assert.ok(values.includes(v), v);
  assert.ok(phoneVariants('+39 376 255 3216').includes('376 255 3216'));
  assert.deepEqual(phoneVariants('non è un numero'), []);
  assert.ok(phoneVariants('+41 44 123 45 67').every((v) => !/^0?44/.test(v)), 'numeri esteri sempre con il prefisso');
});

test('LinkedIn: varianti del profilo in minuscolo', () => {
  const values = linkedinVariants('https://it.linkedin.com/in/Mario-Rossi-Vino/');
  assert.ok(values.includes('https://www.linkedin.com/in/mario-rossi-vino'));
  assert.ok(values.includes('https://it.linkedin.com/in/mario-rossi-vino/'));
  assert.deepEqual(linkedinVariants('https://www.linkedin.com/company/cantina-rossi'), [], 'una pagina aziendale non è un contatto');
});

test('livelli: dominio = certo; email/telefono = forte; nome+città = possibile; ordinati dal più grave', () => {
  const company = { name: 'Cantina Rossi', domain: 'cantinarossi.it', email_aziendale_principale: 'info@cantinarossi.it', phone: '0742 123456', city: 'Foligno' };
  const res = classifyCompanies(company, [
    rec('3', { name: 'Rossi S.r.l.', city: 'foligno' }),
    rec('2', { name: 'Altro', phone: '+39 0742123456' }),
    rec('1', { name: 'Cantina Rossi', domain: 'www.cantinarossi.it' }),
    rec('4', { name: 'Senza legami', domain: 'x.it' }),
  ]);
  assert.equal(res.outcome, 'certain');
  assert.deepEqual(res.matches.map((m) => [m.id, m.level]), [['1', 'certain'], ['2', 'strong'], ['3', 'possible']]);
  assert.deepEqual(classifyCompanies(company, []), { outcome: 'none', matches: [] });
});

test('contatti: un solo controllo con email, telefono, cellulare e LinkedIn; motivo nell\'ordine stabilito', () => {
  const contact = { email: 'mario@cantina.it', phone: '0742 123456', mobilephone: '333 1234567', hs_linkedin_url: 'linkedin.com/in/mario' };
  const body = contactSearch(contact);
  assert.deepEqual(body.filterGroups.map((g) => g.filters[0].propertyName), ['email', 'phone', 'mobilephone', 'hs_linkedin_url']);
  assert.equal(contactSearch({ firstname: 'Mario' }), null, 'senza recapiti nessuna ricerca');
  const res = classifyContacts(contact, [
    rec('7', { hs_linkedin_url: 'https://www.linkedin.com/in/mario/' }),
    rec('8', { email: 'MARIO@cantina.it' }),
    rec('9', { mobilephone: '+39 0742 123456' }),
  ]);
  assert.deepEqual(res.matches.map((m) => [m.id, m.reasons[0]]), [['8', 'email'], ['9', 'mobilephone'], ['7', 'linkedin']]);
});

test("link al record: solo quello dato dall'API, su hubspot.com e per quel record", () => {
  assert.equal(safeRecordUrl('https://app-eu1.hubspot.com/contacts/149362651/record/0-2/123', '123'), 'https://app-eu1.hubspot.com/contacts/149362651/record/0-2/123');
  assert.equal(safeRecordUrl('https://app-eu1.hubspot.com/contacts/149362651/record/0-2/999', '123'), '', 'altro record');
  assert.equal(safeRecordUrl('https://evil.example/hubspot.com/123', '123'), '');
  assert.equal(safeRecordUrl('http://app.hubspot.com/contacts/1/record/0-2/123', '123'), '', 'solo https');
  assert.equal(safeRecordUrl('javascript:alert(1)//123', '123'), '');
  assert.equal(safeRecordUrl(undefined, '123'), '', 'nessun URL costruito a mano');
});

// ---------------------------------------------------------------------------------------------
// Patch 2.0.1: gravità dei doppioni

const OURS = Object.freeze({
  name: 'Agriturismo Il Poggio del Sole', domain: 'test-fallback-scout.invalid', email_aziendale_principale: 'info@poggiodelsole.it',
  phone: '+39 0577 123456', city: 'Siena',
});
const levelOf = (props, company = OURS) => {
  const { outcome, matches } = classifyCompanies(company, [rec('1', props)]);
  return [outcome, matches[0]?.level || '', matches[0]?.reasons || []];
};

test('stesso dominio => duplicato certo', () => {
  assert.deepEqual(levelOf({ name: 'Tutt\'altro nome', domain: 'www.test-fallback-scout.invalid' }), ['certain', 'certain', ['domain']]);
});

test('stessa email + stesso telefono => duplicato certo (caso reale: dominio diverso)', () => {
  const props = { name: 'Agriturismo Il Poggio del Sole', domain: 'poggiodelsole.it', email_aziendale_principale: 'INFO@poggiodelsole.it', phone: '0577 123456', city: 'Siena', hs_lead_status: 'ATTEMPTED_TO_CONTACT' };
  assert.deepEqual(levelOf(props), ['certain', 'certain', ['email', 'phone', 'name_city']]);
  // anche con un nome diverso: due identificatori forti bastano
  assert.deepEqual(levelOf({ ...props, name: 'Altra Insegna' }), ['certain', 'certain', ['email', 'phone']]);
});

test('stessa email + stesso nome => certo; stesso telefono + stesso nome => certo (anche in un\'altra città)', () => {
  assert.deepEqual(levelOf({ name: 'Il Poggio del Sole S.r.l.', email_aziendale_secondaria: 'info@poggiodelsole.it', city: 'Siena' }), ['certain', 'certain', ['email', 'name_city']]);
  assert.deepEqual(levelOf({ name: 'Poggio del Sole', phone: '+390577123456', city: 'Montalcino' }), ['certain', 'certain', ['phone', 'name']]);
});

test('sito web coerente col dominio: identificatore forte (da solo possibile, con l\'email certo)', () => {
  assert.deepEqual(levelOf({ name: 'Altro', domain: 'vecchio-dominio.it', website: 'https://www.test-fallback-scout.invalid/' }), ['possible', 'strong', ['website']]);
  assert.deepEqual(levelOf({ name: 'Altro', website: 'test-fallback-scout.invalid', email_aziendale_principale: 'info@poggiodelsole.it' }), ['certain', 'certain', ['website', 'email']]);
});

test('solo email => possibile; solo telefono => possibile; nome + città => possibile; nome simile => possibile', () => {
  assert.deepEqual(levelOf({ name: 'Altra Insegna', email_aziendale_principale: 'info@poggiodelsole.it' }), ['possible', 'strong', ['email']]);
  assert.deepEqual(levelOf({ name: 'Altra Insegna', phone: '0577-123456' }), ['possible', 'strong', ['phone']]);
  assert.deepEqual(levelOf({ name: 'POGGIO DEL SOLE', domain: 'altro.it', city: 'SIENA' }), ['possible', 'possible', ['name_city']]);
  assert.deepEqual(levelOf({ name: 'Relais Poggio del Sole Toscana', domain: 'altro.it', city: 'Siena' }), ['possible', 'possible', ['name_similar']]);
  // nomi simili in città diverse, o stesso nome in un'altra città senza altri segnali: niente
  assert.deepEqual(levelOf({ name: 'Relais Poggio del Sole Toscana', city: 'Pisa' }), ['none', '', []]);
  assert.deepEqual(levelOf({ name: 'Il Poggio del Sole', city: 'Pisa' }), ['none', '', []]);
});

test('un duplicato certo prevale: il risultato è «certo» anche se ci sono altri candidati deboli', () => {
  const res = classifyCompanies(OURS, [rec('2', { name: 'Altro', phone: '0577 123456' }), rec('3', { name: 'X', email_aziendale_principale: 'info@poggiodelsole.it', phone: '0577 123456' })]);
  assert.deepEqual([res.outcome, res.matches.map((m) => [m.id, m.level])], ['certain', [['3', 'certain'], ['2', 'strong']]]);
});

test('Lead Status: etichette del portale solo in interfaccia', () => {
  assert.equal(leadStatusLabel('ATTEMPTED_TO_CONTACT'), 'Primo contatto inviato');
  assert.deepEqual(['NEW', 'CONNECTED', 'OPEN_DEAL', 'BAD_TIMING', 'UNQUALIFIED'].map(leadStatusLabel),
    ['Da contattare', 'In contatto', 'Opportunità aperta', 'Da ricontattare', 'Non da lavorare']);
  assert.equal(leadStatusLabel('IN_PROGRESS'), 'IN_PROGRESS', 'un valore sconosciuto resta com\'è');
  assert.equal(leadStatusLabel(''), '');
});
