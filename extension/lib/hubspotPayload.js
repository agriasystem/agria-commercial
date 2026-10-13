// Proprietà da scrivere in HubSpot per una NUOVA Azienda o un NUOVO Contatto.
// La stessa funzione prepara l'anteprima nel pannello e la richiesta nel service worker: quello che
// il commerciale vede è esattamente quello che si invia.
//
// Regole: solo proprietà del modello Agria (internal name esatti), nessun valore vuoto,
// hubspot_owner_id SOLO dal commerciale attivo, hs_lead_status sempre NEW per un'azienda nuova,
// tipo_struttura_hospitality solo con settore Hospitality, hs_legal_basis solo se confermata.

import { COMPANY_PROPS, CONTACT_PROPS, isContactReady, isPropVisible, LEAD_STATUS, LEGAL_BASIS, OUTREACH_LABELS } from './crmModel.js';
import { requireOperator } from './operators.js';
import { normalizeDomain, normalizeEmail, normalizeLinkedin, normalizePhone, normalizeUrl } from './validation.js';

const MAX_TEXT = 65000; // limite di una proprietà di testo HubSpot (65.536 caratteri)

const text = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));

// valore pronto per HubSpot oppure { error } se non valido
function cleanValue(prop, raw) {
  const value = prop.input === 'textarea' ? text(raw).trim().slice(0, MAX_TEXT) : text(raw).replace(/\s+/g, ' ').trim();
  if (!value) return { value: '' };
  switch (prop.check) {
    case 'domain': return normalizeDomain(value) ? { value: normalizeDomain(value) } : { error: 'dominio non valido' };
    case 'url': return normalizeUrl(value) ? { value: normalizeUrl(value) } : { error: 'indirizzo web non valido' };
    case 'email': return normalizeEmail(value) ? { value: normalizeEmail(value) } : { error: 'email non valida' };
    case 'phone': return normalizePhone(value) ? { value } : { error: 'numero non riconosciuto' };
    case 'linkedinCompany': return normalizeLinkedin(value)?.kind === 'company' ? { value: normalizeLinkedin(value).url } : { error: 'serve una pagina aziendale LinkedIn' };
    case 'linkedinProfile': return normalizeLinkedin(value)?.kind === 'profile' ? { value: normalizeLinkedin(value).url } : { error: 'serve un profilo LinkedIn personale' };
    default: break;
  }
  if (prop.input === 'select' && !prop.options.includes(value)) return { error: 'valore non previsto' };
  return { value };
}

function build(props, record, skip) {
  const properties = {};
  const errors = [];
  const invalid = [];
  for (const prop of props) {
    if (skip(prop) || !isPropVisible(prop, record)) continue;
    const { value, error } = cleanValue(prop, record?.[prop.name]);
    if (error) {
      errors.push(`${prop.label}: ${error}.`);
      invalid.push(prop.name);
    } else if (value) properties[prop.name] = value;
  }
  return { properties, errors, invalid };
}

export const PREFLIGHT_MESSAGE = 'Alcuni dati rilevati non sono stati trasferiti correttamente al modello HubSpot.';

/**
 * Pre-flight: proprietà dell'Azienda compilate (e visibili) che il payload non contiene, come etichette.
 * Un valore non valido ha già il suo errore; un campo nascosto (tipo struttura fuori dall'Hospitality)
 * è escluso per regola. Il proprietario deve essere il commerciale, il Lead Status NEW.
 */
export function lostFields(record, properties, { invalid = [], ownerId = '' } = {}) {
  const lost = COMPANY_PROPS
    .filter((p) => p.input !== 'owner' && p.input !== 'fixed' && isPropVisible(p, record || {}) && !invalid.includes(p.name))
    .filter((p) => text(record?.[p.name]).trim() && !properties[p.name])
    .map((p) => p.label);
  if (ownerId && properties.hubspot_owner_id !== ownerId) lost.push(propertyLabel('hubspot_owner_id'));
  if (properties.hs_lead_status !== LEAD_STATUS.value) lost.push(propertyLabel('hs_lead_status'));
  return lost;
}

/**
 * record: valori del form Azienda { proprietà: testo } (es. crmRecords(draft, commerciale).company).
 * → { properties, errors }: con errori non si scrive nulla.
 */
export function companyPayload(record, operator) {
  const { hubspotOwnerId } = requireOperator(operator);
  const { properties, errors, invalid } = build(COMPANY_PROPS, record || {}, (p) => p.input === 'owner' || p.input === 'fixed');
  if (!properties.name) errors.push('Nome azienda mancante.');
  if (!properties.domain) errors.push('Dominio mancante.');
  properties.hubspot_owner_id = hubspotOwnerId;
  properties.hs_lead_status = LEAD_STATUS.value;
  return { properties, errors, invalid };
}

/**
 * record: valori del form Contatto. legalBasisConfirmed: la conferma esplicita del commerciale.
 * → { properties, errors }. Un Contatto si crea solo con nome, cognome e un recapito.
 */
export function contactPayload(record, operator, { legalBasisConfirmed = false } = {}) {
  const { hubspotOwnerId } = requireOperator(operator);
  const { properties, errors } = build(CONTACT_PROPS, record || {}, (p) => p.input === 'owner' || p.input === 'legalBasis');
  if (!isContactReady(properties)) errors.push('Contatto non valido: servono nome, cognome e almeno uno tra email, telefono e LinkedIn.');
  properties.hubspot_owner_id = hubspotOwnerId;
  if (legalBasisConfirmed === true) properties.hs_legal_basis = LEGAL_BASIS;
  return { properties, errors };
}

/** Etichetta leggibile di una proprietà ("Settore Agria"), per l'anteprima e i messaggi di errore. */
export function propertyLabel(name) {
  const prop = [...COMPANY_PROPS, ...CONTACT_PROPS].find((p) => p.name === name);
  return prop ? prop.label : OUTREACH_LABELS[name] || name;
}
