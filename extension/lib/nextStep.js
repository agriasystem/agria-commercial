// «Prossimo passo»: una sola indicazione, la più utile, a partire dallo stato che c'è già.
// Funzione pura: legge la bozza del prospect (Scout) e quello che il pannello sa di Outreach per
// quell'Azienda (ultima risposta del service worker); non tiene copie.
//
//   A  Azienda non ancora in HubSpot      → i passi di Scout (analizza, verifica, crea)
//   B  Azienda in HubSpot, non contattata → «Vai al primo contatto» · Apri Outreach
//   C  primo contatto registrato + task   → «Follow-up programmato» · {giorno} alle 14:30
//   D  Azienda già contattata             → il suo stato, senza fingere un nuovo primo contatto
//
// → { tone: 'info' | 'success' | 'warning' | 'blocked', title, detail, action: { label, target } | null }
//   target: 'scout' | 'outreach' | 'navigator'

import { contactReady, hubspotState, hubspotTarget, legalBasisEffective } from './draft.js';
import { CONTACTED_STATUSES, isAlreadyContacted, statusLabel } from './outreach.js';
import { formatDue, formatHubspotDate } from './outreachTime.js';

const OPEN_SCOUT = Object.freeze({ label: 'Apri Scout', target: 'scout' });
const OPEN_OUTREACH = Object.freeze({ label: 'Apri Outreach', target: 'outreach' });

/**
 * draft: bozza del prospect; mode: 'mock' | 'real'; sessionLegalBasis: base giuridica predefinita di
 * sessione; outreach: { companyId, operation, company, contacted } | null (vedi outreachPanel.snapshot).
 */
export function nextStep(draft, { mode = 'mock', sessionLegalBasis = false, outreach = null } = {}) {
  const name = draft?.company?.name?.value?.trim() || draft?.site?.domain || '';
  if (!draft?.site?.pages?.length) {
    return { tone: 'info', title: 'Analizza un nuovo prospect', detail: "Apri il sito dell'azienda e avvia la scansione in Scout.", action: OPEN_SCOUT };
  }
  const st = hubspotState(draft, mode);
  const target = hubspotTarget(st);
  if (target) return outreachStep(draft, st, target, outreach?.companyId === target.id ? outreach : null, sessionLegalBasis);
  const v = st.verification;
  if (!v) return { tone: 'info', title: `Verifica ${name} in HubSpot`, detail: "Prima di crearla, controlla che l'azienda non sia già presente.", action: OPEN_SCOUT };
  if (v.outcome === 'certain' || v.outcome === 'race') {
    return { tone: 'blocked', title: `${name} è già presente in HubSpot`, detail: 'Nessuna nuova azienda: lavora sul record esistente.', action: OPEN_SCOUT };
  }
  if (v.outcome === 'possible') {
    return { tone: 'warning', title: `Controlla il possibile duplicato di ${name}`, detail: 'Crea l\'azienda solo dopo averlo controllato in HubSpot.', action: OPEN_SCOUT };
  }
  return { tone: 'info', title: `Crea ${name} in HubSpot`, detail: 'Nessun duplicato trovato: controlla l\'anteprima e crea l\'Azienda.', action: OPEN_SCOUT };
}

function outreachStep(draft, st, target, outreach, sessionLegalBasis) {
  const name = target.name || draft?.company?.name?.value?.trim() || '';
  const op = outreach?.operation;
  if (op?.complete) {
    return { tone: 'success', title: 'Follow-up programmato', detail: `${name}: ${formatDue(op.dueAt)} · ${op.ownerName}.`, action: OPEN_OUTREACH };
  }
  if (op) {
    return op.steps.company === 'done'
      ? { tone: 'warning', title: 'Follow-up non creato', detail: `${name}: primo contatto registrato. Riprova la creazione del follow-up in Outreach.`, action: OPEN_OUTREACH }
      : { tone: 'warning', title: 'Primo contatto da verificare', detail: `${name}: HubSpot non ha confermato la registrazione. Riprova in Outreach.`, action: OPEN_OUTREACH };
  }
  const company = outreach?.company;
  const status = company ? company.leadStatus : target.leadStatus;
  if (company ? isAlreadyContacted(company) : CONTACTED_STATUSES.includes(target.leadStatus)) {
    const date = formatHubspotDate(company?.firstEmailAt);
    return { tone: 'info', title: `${name} risulta già contattata`, detail: `Stato: ${statusLabel(status)}${date ? ` · Primo invio: ${date}` : ''}.`, action: OPEN_OUTREACH };
  }
  // un Contatto pronto ma non ancora in HubSpot: per scrivergli serve prima crearlo (facoltativo)
  let hint = '';
  if (!st.contact && !st.contactMatches && contactReady(draft)) {
    const person = [draft.contact.firstname.value, draft.contact.lastname.value].filter(Boolean).join(' ');
    hint = ` Per scrivere a ${person}, crea prima il Contatto in Scout${legalBasisEffective(draft, sessionLegalBasis) ? '' : ' (serve la base giuridica)'}.`;
  }
  return {
    tone: 'info', title: 'Vai al primo contatto',
    detail: `${name} è in HubSpot: invia la prima email dal tuo account aziendale, poi registrala in Outreach.${hint}`,
    action: OPEN_OUTREACH,
  };
}
