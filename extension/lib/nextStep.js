// «Prossimo passo»: una sola indicazione, la più utile, a partire dallo stato che c'è già.
// Funzione pura: legge la bozza del prospect e l'esito HubSpot (non ne tiene una copia).
//
// Oggi gli stati vengono da Scout. Gli stati di Outreach (primo contatto, follow-up programmato,
// follow-up da eseguire → Apri Navigatore) si aggiungeranno qui quando Outreach esisterà: il
// componente che li mostra (shell/shell.js) resta lo stesso.
//
// → { tone: 'info' | 'success' | 'warning' | 'blocked', title, detail, action: { label, target } | null }
//   target: 'scout' (apre il modulo Scout) — in futuro anche 'outreach' e 'navigator'

import { hubspotState, hubspotTarget, legalBasisEffective, contactReady } from './draft.js';

const OPEN_SCOUT = Object.freeze({ label: 'Apri Scout', target: 'scout' });

/** draft: bozza del prospect; mode: 'mock' | 'real'; sessionLegalBasis: base giuridica predefinita di sessione. */
export function scoutNextStep(draft, { mode = 'mock', sessionLegalBasis = false } = {}) {
  const name = draft?.company?.name?.value?.trim() || draft?.site?.domain || '';
  if (!draft?.site?.pages?.length) {
    return { tone: 'info', title: 'Analizza un nuovo prospect', detail: "Apri il sito dell'azienda e avvia la scansione in Scout.", action: OPEN_SCOUT };
  }
  const st = hubspotState(draft, mode);
  const v = st.verification;
  if (st.company) {
    const target = hubspotTarget(st);
    if (!st.contact && !st.contactMatches && target && contactReady(draft)) {
      const detail = legalBasisEffective(draft, sessionLegalBasis) ? 'Il Contatto è pronto per essere creato e associato.' : 'Conferma prima la base giuridica del Contatto.';
      return { tone: 'info', title: `Crea il Contatto per ${name}`, detail, action: OPEN_SCOUT };
    }
    return {
      tone: 'success', title: 'Azienda salvata in HubSpot',
      detail: `${name}: ${st.contact ? 'Azienda e Contatto creati' : 'Azienda creata'}. Il primo contatto arriverà con Outreach.`,
      action: null,
    };
  }
  if (!v) return { tone: 'info', title: `Verifica ${name} in HubSpot`, detail: "Prima di crearla, controlla che l'azienda non sia già presente.", action: OPEN_SCOUT };
  if (v.outcome === 'certain' || v.outcome === 'race') {
    return { tone: 'blocked', title: `${name} è già presente in HubSpot`, detail: 'Nessuna nuova azienda: lavora sul record esistente.', action: OPEN_SCOUT };
  }
  if (v.outcome === 'possible') {
    return { tone: 'warning', title: `Controlla il possibile duplicato di ${name}`, detail: 'Crea l\'azienda solo dopo averlo controllato in HubSpot.', action: OPEN_SCOUT };
  }
  return { tone: 'info', title: `Crea ${name} in HubSpot`, detail: 'Nessun duplicato trovato: controlla l\'anteprima e crea l\'Azienda.', action: OPEN_SCOUT };
}
