// Nomi dei messaggi tra pannello, Impostazioni e service worker per HubSpot.
// Un file a sé: il pannello li usa senza importare il client HubSpot né il servizio del service worker.

export const MESSAGE = 'agria:hubspot'; // richiesta al service worker: { type, action, ... }
export const STATUS_CHANGED = 'agria:hubspot-status'; // avviso senza dati: chiave, modalità o connessione cambiate
export const AUDIT_ITEM = 'hubspotAudit'; // registro degli ultimi eventi in chrome.storage.session (nessun segreto)
