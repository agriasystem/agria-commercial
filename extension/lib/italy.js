// Dati geografici italiani per ricavare la regione da sigla o nome della provincia e il comune dai
// CAP dei capoluoghi. Solo tabelle fisse: nessun servizio esterno.

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

// CAP dei capoluoghi di provincia: [primo, ultimo, comune, sigla]. Nel sistema dei CAP italiani questi
// numeri (blocco del capoluogo: terza cifra 1, o 5/9 per le province più recenti) appartengono SOLO a quel
// comune, frazioni comprese: "Loc. Pieve Pagliaccia 06134 (PG)" è nel comune di Perugia. Gli altri comuni
// hanno CAP propri (terza cifra 0) che qui non ci sono: per quelli vale il comune scritto nel sito.
// Si elencano solo intervalli certi; un CAP non in tabella non decide nulla.
const CAPOLUOGHI_CAP = [
  ['00118', '00199', 'Roma', 'RM'], ['01100', '01100', 'Viterbo', 'VT'], ['02100', '02100', 'Rieti', 'RI'],
  ['03100', '03100', 'Frosinone', 'FR'], ['04100', '04100', 'Latina', 'LT'], ['05100', '05100', 'Terni', 'TR'],
  ['06121', '06135', 'Perugia', 'PG'], ['07100', '07100', 'Sassari', 'SS'], ['08100', '08100', 'Nuoro', 'NU'],
  ['09121', '09134', 'Cagliari', 'CA'], ['09170', '09170', 'Oristano', 'OR'], ['10121', '10156', 'Torino', 'TO'],
  ['11100', '11100', 'Aosta', 'AO'], ['12100', '12100', 'Cuneo', 'CN'], ['13100', '13100', 'Vercelli', 'VC'],
  ['13900', '13900', 'Biella', 'BI'], ['14100', '14100', 'Asti', 'AT'], ['15121', '15122', 'Alessandria', 'AL'],
  ['16121', '16167', 'Genova', 'GE'], ['17100', '17100', 'Savona', 'SV'], ['18100', '18100', 'Imperia', 'IM'],
  ['19121', '19137', 'La Spezia', 'SP'], ['20121', '20162', 'Milano', 'MI'], ['20900', '20900', 'Monza', 'MB'],
  ['21100', '21100', 'Varese', 'VA'], ['22100', '22100', 'Como', 'CO'], ['23100', '23100', 'Sondrio', 'SO'],
  ['23900', '23900', 'Lecco', 'LC'], ['24121', '24129', 'Bergamo', 'BG'], ['25121', '25136', 'Brescia', 'BS'],
  ['26100', '26100', 'Cremona', 'CR'], ['26900', '26900', 'Lodi', 'LO'], ['27100', '27100', 'Pavia', 'PV'],
  ['28100', '28100', 'Novara', 'NO'], ['28921', '28925', 'Verbania', 'VB'], ['29121', '29122', 'Piacenza', 'PC'],
  ['30121', '30176', 'Venezia', 'VE'], ['31100', '31100', 'Treviso', 'TV'], ['32100', '32100', 'Belluno', 'BL'],
  ['33100', '33100', 'Udine', 'UD'], ['33170', '33170', 'Pordenone', 'PN'], ['34121', '34151', 'Trieste', 'TS'],
  ['34170', '34170', 'Gorizia', 'GO'], ['35121', '35143', 'Padova', 'PD'], ['36100', '36100', 'Vicenza', 'VI'],
  ['37121', '37142', 'Verona', 'VR'], ['38121', '38123', 'Trento', 'TN'], ['39100', '39100', 'Bolzano', 'BZ'],
  ['40121', '40141', 'Bologna', 'BO'], ['41121', '41126', 'Modena', 'MO'], ['42121', '42124', 'Reggio Emilia', 'RE'],
  ['43121', '43126', 'Parma', 'PR'], ['44121', '44124', 'Ferrara', 'FE'], ['45100', '45100', 'Rovigo', 'RO'],
  ['46100', '46100', 'Mantova', 'MN'], ['47121', '47122', 'Forlì', 'FC'], ['47521', '47522', 'Cesena', 'FC'],
  ['47921', '47924', 'Rimini', 'RN'], ['48121', '48125', 'Ravenna', 'RA'], ['50121', '50145', 'Firenze', 'FI'],
  ['51100', '51100', 'Pistoia', 'PT'], ['52100', '52100', 'Arezzo', 'AR'], ['53100', '53100', 'Siena', 'SI'],
  ['54100', '54100', 'Massa', 'MS'], ['55100', '55100', 'Lucca', 'LU'], ['56121', '56128', 'Pisa', 'PI'],
  ['57121', '57128', 'Livorno', 'LI'], ['58100', '58100', 'Grosseto', 'GR'], ['59100', '59100', 'Prato', 'PO'],
  ['60121', '60131', 'Ancona', 'AN'], ['61121', '61122', 'Pesaro', 'PU'], ['62100', '62100', 'Macerata', 'MC'],
  ['63100', '63100', 'Ascoli Piceno', 'AP'], ['63900', '63900', 'Fermo', 'FM'], ['64100', '64100', 'Teramo', 'TE'],
  ['65121', '65129', 'Pescara', 'PE'], ['66100', '66100', 'Chieti', 'CH'], ['67100', '67100', "L'Aquila", 'AQ'],
  ['70121', '70132', 'Bari', 'BA'], ['71121', '71122', 'Foggia', 'FG'], ['72100', '72100', 'Brindisi', 'BR'],
  ['73100', '73100', 'Lecce', 'LE'], ['74121', '74123', 'Taranto', 'TA'], ['75100', '75100', 'Matera', 'MT'],
  ['76121', '76121', 'Barletta', 'BT'], ['76123', '76123', 'Andria', 'BT'], ['76125', '76125', 'Trani', 'BT'],
  ['80121', '80147', 'Napoli', 'NA'], ['81100', '81100', 'Caserta', 'CE'], ['82100', '82100', 'Benevento', 'BN'],
  ['83100', '83100', 'Avellino', 'AV'], ['84121', '84135', 'Salerno', 'SA'], ['85100', '85100', 'Potenza', 'PZ'],
  ['86100', '86100', 'Campobasso', 'CB'], ['86170', '86170', 'Isernia', 'IS'], ['87100', '87100', 'Cosenza', 'CS'],
  ['88100', '88100', 'Catanzaro', 'CZ'], ['88900', '88900', 'Crotone', 'KR'], ['89121', '89135', 'Reggio Calabria', 'RC'],
  ['89900', '89900', 'Vibo Valentia', 'VV'], ['90121', '90151', 'Palermo', 'PA'], ['91100', '91100', 'Trapani', 'TP'],
  ['92100', '92100', 'Agrigento', 'AG'], ['93100', '93100', 'Caltanissetta', 'CL'], ['94100', '94100', 'Enna', 'EN'],
  ['95121', '95131', 'Catania', 'CT'], ['96100', '96100', 'Siracusa', 'SR'], ['97100', '97100', 'Ragusa', 'RG'],
  ['98121', '98168', 'Messina', 'ME'],
];

/**
 * Comune dal CAP, solo per i CAP dei capoluoghi (vedi CAPOLUOGHI_CAP) → { comune, province } | null.
 * province: la sigla scritta accanto al CAP; se non coincide con quella del CAP i dati non sono
 * coerenti e il CAP non decide nulla.
 */
export function comuneFromCap(cap, province = '') {
  const c = String(cap ?? '').trim();
  if (!/^\d{5}$/.test(c)) return null;
  const hit = CAPOLUOGHI_CAP.find(([from, to]) => c >= from && c <= to);
  if (!hit || (province && province !== hit[3])) return null;
  return { comune: hit[2], province: hit[3] };
}

/** "ITALY", "Italy", "italia", "IT" → "Italia"; un altro paese resta com'è scritto (ripulito). */
export function normalizeCountry(text) {
  const v = String(text ?? '').replace(/\s+/g, ' ').trim();
  return /^(it|ita|italy|italia)$/i.test(v) ? 'Italia' : v;
}

/** Nome ufficiale della regione ("emilia romagna" → "Emilia-Romagna"); '' se non riconosciuta. */
export function normalizeRegion(text) {
  return REGION_BY_KEY.get(normKey(text)) || '';
}
