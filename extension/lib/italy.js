// Dati geografici italiani per ricavare la regione da sigla o nome della provincia.
// Solo tabelle fisse: nessun servizio esterno.

import { normKey } from './validation.js';

export const REGIONS = [
  'Abruzzo', 'Basilicata', 'Calabria', 'Campania', 'Emilia-Romagna', 'Friuli-Venezia Giulia',
  'Lazio', 'Liguria', 'Lombardia', 'Marche', 'Molise', 'Piemonte', 'Puglia', 'Sardegna',
  'Sicilia', 'Toscana', 'Trentino-Alto Adige', 'Umbria', "Valle d'Aosta", 'Veneto',
];

// sigla → [nome della provincia, regione]
const PROVINCES = {
  AG: ['Agrigento', 'Sicilia'], AL: ['Alessandria', 'Piemonte'], AN: ['Ancona', 'Marche'],
  AO: ['Aosta', "Valle d'Aosta"], AP: ['Ascoli Piceno', 'Marche'], AQ: ["L'Aquila", 'Abruzzo'],
  AR: ['Arezzo', 'Toscana'], AT: ['Asti', 'Piemonte'], AV: ['Avellino', 'Campania'],
  BA: ['Bari', 'Puglia'], BG: ['Bergamo', 'Lombardia'], BI: ['Biella', 'Piemonte'],
  BL: ['Belluno', 'Veneto'], BN: ['Benevento', 'Campania'], BO: ['Bologna', 'Emilia-Romagna'],
  BR: ['Brindisi', 'Puglia'], BS: ['Brescia', 'Lombardia'], BT: ['Barletta-Andria-Trani', 'Puglia'],
  BZ: ['Bolzano', 'Trentino-Alto Adige'], CA: ['Cagliari', 'Sardegna'], CB: ['Campobasso', 'Molise'],
  CE: ['Caserta', 'Campania'], CH: ['Chieti', 'Abruzzo'], CL: ['Caltanissetta', 'Sicilia'],
  CN: ['Cuneo', 'Piemonte'], CO: ['Como', 'Lombardia'], CR: ['Cremona', 'Lombardia'],
  CS: ['Cosenza', 'Calabria'], CT: ['Catania', 'Sicilia'], CZ: ['Catanzaro', 'Calabria'],
  EN: ['Enna', 'Sicilia'], FC: ['Forlì-Cesena', 'Emilia-Romagna'], FE: ['Ferrara', 'Emilia-Romagna'],
  FG: ['Foggia', 'Puglia'], FI: ['Firenze', 'Toscana'], FM: ['Fermo', 'Marche'],
  FR: ['Frosinone', 'Lazio'], GE: ['Genova', 'Liguria'], GO: ['Gorizia', 'Friuli-Venezia Giulia'],
  GR: ['Grosseto', 'Toscana'], IM: ['Imperia', 'Liguria'], IS: ['Isernia', 'Molise'],
  KR: ['Crotone', 'Calabria'], LC: ['Lecco', 'Lombardia'], LE: ['Lecce', 'Puglia'],
  LI: ['Livorno', 'Toscana'], LO: ['Lodi', 'Lombardia'], LT: ['Latina', 'Lazio'],
  LU: ['Lucca', 'Toscana'], MB: ['Monza e Brianza', 'Lombardia'], MC: ['Macerata', 'Marche'],
  ME: ['Messina', 'Sicilia'], MI: ['Milano', 'Lombardia'], MN: ['Mantova', 'Lombardia'],
  MO: ['Modena', 'Emilia-Romagna'], MS: ['Massa-Carrara', 'Toscana'], MT: ['Matera', 'Basilicata'],
  NA: ['Napoli', 'Campania'], NO: ['Novara', 'Piemonte'], NU: ['Nuoro', 'Sardegna'],
  OR: ['Oristano', 'Sardegna'], PA: ['Palermo', 'Sicilia'], PC: ['Piacenza', 'Emilia-Romagna'],
  PD: ['Padova', 'Veneto'], PE: ['Pescara', 'Abruzzo'], PG: ['Perugia', 'Umbria'],
  PI: ['Pisa', 'Toscana'], PN: ['Pordenone', 'Friuli-Venezia Giulia'], PO: ['Prato', 'Toscana'],
  PR: ['Parma', 'Emilia-Romagna'], PT: ['Pistoia', 'Toscana'], PU: ['Pesaro e Urbino', 'Marche'],
  PV: ['Pavia', 'Lombardia'], PZ: ['Potenza', 'Basilicata'], RA: ['Ravenna', 'Emilia-Romagna'],
  RC: ['Reggio Calabria', 'Calabria'], RE: ['Reggio Emilia', 'Emilia-Romagna'], RG: ['Ragusa', 'Sicilia'],
  RI: ['Rieti', 'Lazio'], RM: ['Roma', 'Lazio'], RN: ['Rimini', 'Emilia-Romagna'],
  RO: ['Rovigo', 'Veneto'], SA: ['Salerno', 'Campania'], SI: ['Siena', 'Toscana'],
  SO: ['Sondrio', 'Lombardia'], SP: ['La Spezia', 'Liguria'], SR: ['Siracusa', 'Sicilia'],
  SS: ['Sassari', 'Sardegna'], SU: ['Sud Sardegna', 'Sardegna'], SV: ['Savona', 'Liguria'],
  TA: ['Taranto', 'Puglia'], TE: ['Teramo', 'Abruzzo'], TN: ['Trento', 'Trentino-Alto Adige'],
  TO: ['Torino', 'Piemonte'], TP: ['Trapani', 'Sicilia'], TR: ['Terni', 'Umbria'],
  TS: ['Trieste', 'Friuli-Venezia Giulia'], TV: ['Treviso', 'Veneto'], UD: ['Udine', 'Friuli-Venezia Giulia'],
  VA: ['Varese', 'Lombardia'], VB: ['Verbano-Cusio-Ossola', 'Piemonte'], VC: ['Vercelli', 'Piemonte'],
  VE: ['Venezia', 'Veneto'], VI: ['Vicenza', 'Veneto'], VR: ['Verona', 'Veneto'],
  VT: ['Viterbo', 'Lazio'], VV: ['Vibo Valentia', 'Calabria'],
  // sigle sarde soppresse ma ancora presenti su molti siti
  CI: ['Carbonia-Iglesias', 'Sardegna'], VS: ['Medio Campidano', 'Sardegna'],
  OG: ['Ogliastra', 'Sardegna'], OT: ['Olbia-Tempio', 'Sardegna'],
};

// capoluoghi che non coincidono con il nome della provincia
const EXTRA_PROVINCE_NAMES = {
  aquila: 'AQ', pesaro: 'PU', urbino: 'PU', forli: 'FC', cesena: 'FC', massa: 'MS', carrara: 'MS',
  monza: 'MB', barletta: 'BT', andria: 'BT', trani: 'BT', verbania: 'VB', spezia: 'SP',
  carbonia: 'CI', iglesias: 'CI', olbia: 'OT', tempio: 'OT', tortoli: 'OG', lanusei: 'OG',
  sanluri: 'VS', villacidro: 'VS', bozen: 'BZ',
};

const REGION_ALIASES = {
  friuli: 'Friuli-Venezia Giulia', trentino: 'Trentino-Alto Adige',
  trentinoaltoadigesudtirol: 'Trentino-Alto Adige', trentinosudtirol: 'Trentino-Alto Adige',
  altoadige: 'Trentino-Alto Adige', sudtirol: 'Trentino-Alto Adige', suedtirol: 'Trentino-Alto Adige',
  valleedaoste: "Valle d'Aosta", aostavalley: "Valle d'Aosta",
  apulia: 'Puglia', sicily: 'Sicilia', sardinia: 'Sardegna', tuscany: 'Toscana',
  lombardy: 'Lombardia', piedmont: 'Piemonte', latium: 'Lazio',
};

const REGION_BY_KEY = new Map([
  ...REGIONS.map((r) => [normKey(r), r]),
  ...Object.entries(REGION_ALIASES),
]);
const PROVINCE_BY_NAME = new Map([
  ...Object.entries(PROVINCES).map(([code, [name]]) => [normKey(name), code]),
  ...Object.entries(EXTRA_PROVINCE_NAMES),
]);

export function isProvinceCode(code) {
  return typeof code === 'string' && Object.hasOwn(PROVINCES, code);
}

export function regionFromProvince(code) {
  return isProvinceCode(code) ? PROVINCES[code][1] : '';
}

/** "Perugia" → "PG"; '' se il nome non è una provincia o un capoluogo. */
export function provinceFromName(name) {
  return PROVINCE_BY_NAME.get(normKey(name)) || '';
}

/** Nome ufficiale della regione ("emilia romagna" → "Emilia-Romagna"); '' se non riconosciuta. */
export function normalizeRegion(text) {
  return REGION_BY_KEY.get(normKey(text)) || '';
}
