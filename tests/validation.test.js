import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  domainFromUrl, formatPhone, isValidEmail, isValidPhone, normalizeDomain, normalizeEmail,
  normalizeLinkedin, normalizePhone, normalizeUrl, normKey, sameSite,
} from '../extension/lib/validation.js';
import { normalizeRegion, provinceFromName, regionFromProvince } from '../extension/lib/italy.js';

test('email', () => {
  assert.equal(normalizeEmail('mailto:Info@Cantina.IT?subject=Ciao'), 'info@cantina.it');
  assert.equal(normalizeEmail('mailto:mario%2Erossi@cantina.it'), 'mario.rossi@cantina.it');
  assert.equal(normalizeEmail('<info@cantina.it>.'), 'info@cantina.it');
  assert.equal(normalizeEmail('logo@2x.png'), '');
  assert.equal(normalizeEmail('mario..rossi@cantina.it'), '');
  assert.equal(normalizeEmail('senza-chiocciola.it'), '');
  assert.equal(isValidEmail('a@b.it'), true);
  assert.equal(isValidEmail('a@b'), false);
});

test('telefono', () => {
  assert.equal(normalizePhone('tel:+39 075 812 3456'), '+390758123456');
  assert.equal(normalizePhone('075/8123456'), '+390758123456');
  assert.equal(normalizePhone('0039 333 1234567'), '+393331234567');
  assert.equal(normalizePhone('333-123.4567'), '+393331234567');
  assert.equal(normalizePhone('800 123456'), '+39800123456');
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizePhone('12345'), '');
  assert.equal(normalizePhone('2024'), '');
  assert.equal(normalizePhone('012345678901'), '', 'troppe cifre per un fisso italiano');
  assert.equal(normalizePhone('075 123456 int. 2'), '');
  assert.equal(formatPhone('+393331234567'), '+39 333 123 4567');
  assert.equal(formatPhone('+390758123456'), '+39 0758123456');
  assert.equal(formatPhone('+442079460958'), '+442079460958');
  assert.equal(isValidPhone('+39 0758123456'), true);
});

test('URL e dominio', () => {
  assert.equal(normalizeUrl('www.cantina.it'), 'https://www.cantina.it/');
  assert.equal(normalizeUrl('ftp://cantina.it'), '');
  assert.equal(normalizeUrl('javascript:alert(1)'), '');
  assert.equal(domainFromUrl('https://www.Cantina.it/contatti'), 'cantina.it');
  assert.equal(normalizeDomain('https://www.cantina.it/contatti'), 'cantina.it');
  assert.equal(normalizeDomain('WWW.cantina.it'), 'cantina.it');
  assert.equal(normalizeDomain('shop.cantina.it'), 'shop.cantina.it');
  assert.equal(normalizeDomain('cantina'), '');
  assert.equal(normalizeDomain('127.0.0.1'), '');
  assert.equal(sameSite('shop.cantina.it', 'cantina.it'), true);
  assert.equal(sameSite('altracantina.it', 'cantina.it'), false);
});

test('LinkedIn', () => {
  assert.deepEqual(normalizeLinkedin('https://it.linkedin.com/in/mario-rossi-123/?trk=x'), { kind: 'profile', url: 'https://www.linkedin.com/in/mario-rossi-123' });
  assert.deepEqual(normalizeLinkedin('linkedin.com/company/cantina-rossi/about'), { kind: 'company', url: 'https://www.linkedin.com/company/cantina-rossi' });
  assert.equal(normalizeLinkedin('https://www.linkedin.com/feed/'), null);
  assert.equal(normalizeLinkedin('https://linkedin.com.example.it/in/x'), null);
});

test('chiave di confronto e dati geografici', () => {
  assert.equal(normKey("Forlì-Cesena"), 'forlicesena');
  assert.equal(regionFromProvince('PG'), 'Umbria');
  assert.equal(regionFromProvince('XX'), '');
  assert.equal(provinceFromName("L'Aquila"), 'AQ');
  assert.equal(provinceFromName('Pesaro'), 'PU');
  assert.equal(normalizeRegion('emilia romagna'), 'Emilia-Romagna');
  assert.equal(normalizeRegion("Valle d’Aosta"), "Valle d'Aosta");
  assert.equal(normalizeRegion('Tuscany'), 'Toscana');
  assert.equal(normalizeRegion('Bayern'), '');
});
