// Nomi propri comuni (chiavi senza accenti, minuscole).
// Servono solo per riconoscere una persona citata col solo nome di battesimo accanto a un
// ruolo ("Paolo – Host"): senza questo elenco qualunque parola maiuscola diventerebbe una persona.

export const FIRST_NAMES = new Set([
  // italiani
  'achille', 'adriano', 'alberto', 'aldo', 'alessandro', 'alessio', 'alfredo', 'amedeo', 'andrea', 'angelo',
  'antonio', 'armando', 'arturo', 'augusto', 'bruno', 'carlo', 'cesare', 'christian', 'claudio', 'corrado',
  'cristian', 'cristiano', 'daniele', 'dario', 'davide', 'diego', 'domenico', 'edoardo', 'elia', 'emanuele',
  'emilio', 'enrico', 'enzo', 'ermanno', 'ernesto', 'ettore', 'fabio', 'fabrizio', 'federico', 'felice',
  'filippo', 'flavio', 'francesco', 'franco', 'gabriele', 'giacomo', 'giampaolo', 'giancarlo', 'gianfranco',
  'gianluca', 'gianluigi', 'gianmarco', 'gianni', 'gino', 'giordano', 'giorgio', 'giovanni', 'giuliano',
  'giulio', 'giuseppe', 'gregorio', 'guido', 'ivan', 'jacopo', 'leonardo', 'lorenzo', 'luca', 'luciano',
  'lucio', 'ludovico', 'luigi', 'manuel', 'marcello', 'marco', 'mario', 'massimiliano', 'massimo', 'matteo',
  'mattia', 'maurizio', 'mauro', 'michele', 'mirko', 'nicola', 'niccolo', 'nicolo', 'nino', 'oscar', 'paolo',
  'pasquale', 'piero', 'pierluigi', 'pietro', 'raffaele', 'renato', 'riccardo', 'roberto', 'rocco', 'romano',
  'salvatore', 'samuele', 'sandro', 'sebastiano', 'sergio', 'silvio', 'simone', 'stefano', 'tommaso', 'ugo',
  'umberto', 'valentino', 'valerio', 'vincenzo', 'vittorio', 'walter',
  'ada', 'adele', 'agnese', 'alba', 'alessandra', 'alessia', 'alice', 'angela', 'anna', 'annalisa', 'antonella',
  'arianna', 'aurora', 'barbara', 'beatrice', 'benedetta', 'bianca', 'camilla', 'carla', 'carlotta', 'carolina',
  'caterina', 'chiara', 'cinzia', 'claudia', 'cristina', 'daniela', 'debora', 'deborah', 'donatella', 'elena',
  'eleonora', 'elisa', 'elisabetta', 'emanuela', 'emma', 'erica', 'erika', 'federica', 'francesca', 'gabriella',
  'giada', 'gianna', 'ginevra', 'giorgia', 'giovanna', 'giulia', 'giuliana', 'giuseppina', 'gloria', 'grazia',
  'ilaria', 'ines', 'irene', 'laura', 'letizia', 'lia', 'licia', 'lidia', 'lisa', 'loredana', 'lorena', 'lucia',
  'luisa', 'manuela', 'margherita', 'maria', 'marina', 'marta', 'martina', 'matilde', 'michela', 'mirella',
  'monica', 'nadia', 'natalia', 'nicoletta', 'noemi', 'nora', 'ornella', 'paola', 'patrizia', 'raffaella',
  'rebecca', 'rita', 'roberta', 'rosa', 'rosanna', 'rossella', 'sabrina', 'sara', 'serena', 'silvia', 'simona',
  'sofia', 'stefania', 'susanna', 'teresa', 'tiziana', 'valentina', 'valeria', 'vanessa', 'veronica', 'viola',
  'virginia', 'vittoria',
  // stranieri frequenti
  'ana', 'anne', 'carlos', 'david', 'emily', 'george', 'hans', 'james', 'jean', 'john', 'jose', 'juan', 'julia',
  'kate', 'klaus', 'marie', 'mark', 'michael', 'pablo', 'paul', 'peter', 'pierre', 'richard', 'robert', 'sarah',
  'sophie', 'thomas', 'william',
]);
