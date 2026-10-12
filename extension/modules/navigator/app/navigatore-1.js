/* Copione follow-up telefonico — Agria System (v10 · script di Matteo, 8 ottobre 2026)
   Segnaposto nei testi:
   {azienda} {commerciale} {zona} {dataEmail} {dettaglio}   → compilati prima della chiamata (obbligatori)
   {azona}                → «a» o «ad» + zona, in base all'iniziale
   {slotA} {slotB}        → le due disponibilità scelte dai menu prima della chiamata (obbligatorie)
   {titolare} / {iltitolare|il titolare} → nome del titolare o del referente, se noto; «il/la» aggiunto in terza persona
   { nome|}               → nome di chi risponde, scritto nella scheda appena lo dice; se manca sparisce con lo spazio
   {richiamata} {fissato} {recapito} {whatsapp} {contatto} → scritti nella scheda nel momento in cui servono
   {richiamata} si compone da solo da «giorno» + «ora» (rgiorno / rora) quando il box unico è vuoto; {recapito} usa il numero WhatsApp se l'email manca
   [[hospitality|cantina|frantoio]] → variante per settore
   when:{titolare:true} {nome:false} {umbria:true} {sito:"si"|"ecommerce"|"vecchio"|"no" oppure ["si","vecchio"]} → la riga o il pulsante compare in base ai dati
   {gestionale} → nome del gestionale del cliente, scritto nella scheda della domanda tecnica
   when:{detto|visto|noto|sonoio|altro|presentato:true} → in base a cosa è già successo nella chiamata; set:{…} su un nodo (quando lo lasci) o su un pulsante accende il flag
   capture:{key,label,placeholder,go,goLabel,skip,outcome} → box nella scheda con il pulsante accanto: verde se compilato (→ go), rosso «skip» se vuoto (→ skipTo oppure go)
   capture:{…, soft:true} → box senza pulsante: la battuta in then:[…] si aggiorna mentre scrivi
   then:[…] → battute dette dopo il box (stesso formato di say)
   capture senza go + after:{say,captures,say2,primary,options} → il seguito compare quando il box è compilato (anyOf:true → basta uno); skipLabel → pulsante rosso che apre il seguito senza compilare
   listen:true → i tre pulsanti «di cosa ha parlato» → Fase 5 (zero scrittura delle parole del cliente)
   primary:[…] grandi · options:[…] «altre risposte» · copy:{fissato:"slotA"} copia un valore · loop:true → il collegamento all'indietro è voluto
   open:true → la scheda può chiudere senza domanda (il seguito è nei pulsanti)
*/
window.AGRIA = {

sectors: {
  hospitality: { label: "Agriturismo / struttura ricettiva" },
  cantina:     { label: "Cantina" },
  frantoio:    { label: "Frantoio / azienda olivicola" }
},

phases: ["f0","f1","f2","f3","f4","f5","f6","f7"],

areas:{
  presence:{ name:"Digital Presence", btn:"Parla del sito" },
  commerce:{ name:"Digital Commerce", btn:"Parla dell'e-commerce" },
  automation:{ name:"Digital Automation", btn:"Parla dei gestionali o di specifiche tecniche interne" }
},

nodes: {

/* ───────────── FASE 0 ───────────── */
f0: { kind:"phase", num:0, title:"Prima di chiamare", short:"Preparazione",
  checklist:[
    "Ho inviato l'email di primo contatto a questa azienda almeno 48 ore fa, e zero risposta",
    "Ho guardato il calendario: le due disponibilità qui sopra sono libere davvero",
    "Ho HubSpot aperto sul contatto di questa azienda"
  ]
},

/* ───────────── FASE 1 · APERTURA ───────────── */
f1: { kind:"phase", num:1, title:"Apertura", short:"Apertura",
  say:[{t:"you", text:"{saluto}, sono {commerciale} di Agria System. La contatto perché analizzando {azienda} sono emerse alcune mancanze sulla parte digitale che ci piacerebbe approfondire con voi... Consideri che siamo specializzati esclusivamente nel vostro settore. È lei che si occupa di questo?"}],
  primary:[
    {label:"Non ci interessa / Non è il momento", to:"o_interesse"},
    {label:"Sono impegnato ora", to:"r1_impegnato"},
    {label:"Sì, sono io", to:"r1_sonoio"},
    {label:"Sì, sono io… piacere, [dice il nome]", to:"r1_sonoio_nome"},
    {label:"Se ne occupa un'altra persona", to:"r1_altro"},
    {label:"Cosa avete rilevato?", to:"o_rilevato"},
    {label:"Chi siete? / Di cosa si tratta?", to:"r1_chi"},
    {label:"Abbiamo già un sito, siamo a posto", to:"o_sito"},
    {label:"Abbiamo già chi ci segue / Ho un'agenzia", to:"o_fornitore"},
    {label:"Abbiamo un contratto", to:"o_contratto"},
    {label:"Mandami una mail", to:"o_mail"}
  ]
},

r1_sonoio: { kind:"reply", title:"«Sì, sono io»", set:{sonoio:true, altro:false}, open:true,
  say:[
    {t:"you", text:"Perfetto. Con chi ho il piacere di parlare?", when:{presentato:false}},
    {t:"you", text:"Perfetto! Con chi ho il piacere di parlare innanzitutto?", when:{presentato:true}}
  ],
  capture:{key:"nome", label:"Nome di chi risponde · la battuta sotto si aggiorna mentre scrivi", placeholder:"Marco / signor Bianchi", soft:true, when:{presentato:false}},
  then:[
    {t:"you", text:"Piacere, {nome}. Le chiedo: è un buon momento?", when:{nome:true, presentato:false}},
    {t:"you", text:"Perfetto, le chiedo: è un buon momento?", when:{nome:false, presentato:false}}
  ],
  /* dopo «chi siete»: scrivi il nome e premi «Prosegui» (verde); se il nome resta fuori, il pulsante rosso prosegue senza */
  captures:[{key:"nome", label:"Il nome che dice · poi premi Prosegui", placeholder:"Marco / signor Bianchi", go:"r1_email", goLabel:"Prosegui con il nome", skip:"Prosegui senza nome", skipTo:"r1_email", when:{presentato:true}}],
  primary:[
    {label:"Sì, mi dica", to:"r1_pres", when:{presentato:false}},
    {label:"Non ci interessa / Non è il momento", to:"o_interesse"},
    {label:"Sono impegnato", to:"r1_impegnato"},
    {label:"Prima mi dica chi siete / di cosa si tratta", to:"r1_chi", when:{presentato:false}},
    {label:"Abbiamo già chi ci segue", to:"o_fornitore"},
    {label:"Mandami una mail", to:"o_mail"}
  ]
},
r1_sonoio_nome: { kind:"reply", title:"«Sì, sono io… piacere, [nome]»", set:{sonoio:true, altro:false},
  say:[{t:"you", text:"Piacere{, nome|}. Le chiedo: è un buon momento?"}],
  capture:{key:"nome", label:"Il nome che ha appena detto · la battuta si aggiorna mentre scrivi", placeholder:"Marco / signor Bianchi", soft:true},
  primary:[
    {label:"Sì, mi dica", to:"r1_pres", when:{presentato:false}},
    {label:"Sì, mi dica", to:"r1_email", when:{presentato:true}},
    {label:"Sono impegnato", to:"r1_impegnato"},
    {label:"Prima mi dica chi siete / di cosa si tratta", to:"r1_chi", when:{presentato:false}}
  ],
  options:[
    {label:"Non ci interessa / Non è il momento", to:"o_interesse"},
    {label:"Abbiamo già chi ci segue", to:"o_fornitore"},
    {label:"Mandami una mail", to:"o_mail"}
  ]
},

r1_pres: { kind:"reply", title:"«Sì, mi dica»: la presentazione e l'email", set:{presentato:true},
  say:[
    {t:"you", text:"Dunque{, nome|}. Consideri innanzitutto che operiamo da Perugia e all'estero. Volevo sapere se avesse ricevuto l'email che le ho inviato {dataEmail} con i punti emersi dall'analisi?", when:{umbria:true}},
    {t:"you", text:"Dunque{, nome|}. Consideri innanzitutto che lavoriamo in Italia e all'estero. Volevo sapere se avesse ricevuto l'email che le ho inviato {dataEmail} con i punti emersi dall'analisi?", when:{umbria:false}}
  ],
  primary:[
    {label:"Sì, l'ho vista", to:"f3", set:{visto:true, noto:true}},
    {label:"No, non l'ho vista", to:"f3"},
    {label:"Non ci interessa / Non è il momento", to:"o_interesse"},
    {label:"Cosa avete rilevato?", to:"o_rilevato"}
  ],
  options:[
    {label:"Non ho capito cosa fate", to:"o_noncapito"},
    {label:"Abbiamo già chi ci segue / Ho un'agenzia", to:"o_fornitore"},
    {label:"Abbiamo un'agenzia marketing / ADV in corso", to:"o_adv"},
    {label:"Abbiamo un contratto", to:"o_contratto"},
    {label:"Abbiamo già un sito, siamo a posto", to:"o_sito"},
    {label:"Mandami una mail", to:"o_mail"},
    {label:"Sono impegnato", to:"r1_impegnato"},
    {label:"Ci chiamano in tanti come voi", to:"o_tanti"},
    {label:"So già tutto, conosco il settore", to:"o_sapientone"},
    {label:"Siamo piccoli, a conduzione familiare", to:"o_piccoli"},
    {label:"Quanto costa?", to:"o_prezzo"}
  ]
},

r1_email: { kind:"reply", title:"L'email: l'ha vista?",
  say:[
    {t:"you", text:"Piacere, {nome}. Volevo sapere se avesse letto l'email che le ho inviato {dataEmail}, con i punti emersi dall'analisi?", when:{nome:true}},
    {t:"you", text:"Ok, volevo sapere se avesse letto l'email che le ho inviato {dataEmail}, con i punti emersi dall'analisi?", when:{nome:false}}
  ],
  primary:[
    {label:"Sì, l'ho vista", to:"f3", set:{visto:true, noto:true}},
    {label:"No, non l'ho vista", to:"f3"},
    {label:"No, cosa avete rilevato?", to:"o_rilevato"},
    {label:"Non ci interessa / Non è il momento", to:"o_interesse"},
    {label:"Ripete: «non ho capito cosa fate»", to:"o_noncapito"}
  ],
  options:[
    {label:"Abbiamo già chi ci segue / Ho un'agenzia", to:"o_fornitore"},
    {label:"Abbiamo un contratto", to:"o_contratto"},
    {label:"Abbiamo già un sito, siamo a posto", to:"o_sito"},
    {label:"Mandami una mail", to:"o_mail"},
    {label:"Sono impegnato", to:"r1_impegnato"}
  ]
},

o_noncapito: { kind:"reply", title:"«Non ho capito cosa fate»", open:true, set:{presentato:true},
  say:[{t:"you", text:"È semplicissimo.. Facciamo fare all'intelligenza artificiale il lavoro manuale all'interno di attività come la vostra e lavoriamo su siti ed e-commerce perché possano essere trovati e proposti anche dall'AI."}],
  primary:[
    {label:"Ok, ho capito / Mi dica", to:"f3"},
    {label:"Cosa avete rilevato?", to:"o_rilevato"},
    {label:"Non ci interessa / Non è il momento", to:"o_interesse"}
  ],
  options:[
    {label:"Abbiamo già chi ci segue", to:"o_fornitore"},
    {label:"Mandami una mail", to:"o_mail"},
    {label:"Sono impegnato", to:"r1_impegnato"}
  ]
},

o_rilevato: { kind:"reply", title:"«Cosa avete rilevato?»", set:{noto:true, detto:true},
  say:[
    {t:"you", text:"Allora, dall'analisi di {azienda} è emerso che {dettaglio}. Consideri che il nostro obiettivo è affiancare le aziende del vostro settore e farle rimanere al passo con i tempi. Inoltre, i vostri competitor soprattutto all'estero si stanno già muovendo su questi aspetti.. Eravate al corrente di questa cosa?"},
    {t:"alt", label:"Se vuole chiudere subito", text:"Ed è il primo dei punti emersi. Gli altri preferisco mostrarli insieme all'analisi completa, così li valutiamo nel contesto di {azienda}. Quando sarebbe disponibile?"}
  ],
  primary:[
    {label:"Sì, lo sapevamo", to:"f3_si"},
    {label:"No / Non proprio", to:"f3_no"},
    {label:"Non ci interessa / Non è il momento", to:"o_interesse"},
    {label:"Da noi funziona diversamente", to:"r_diverso"},
    {label:"Propone giorno / orario", to:"f6"}
  ],
  options:[
    {label:"Vuole prima il documento", to:"o_pres"},
    {label:"Abbiamo già chi ci segue", to:"o_fornitore"},
    {label:"Abbiamo un contratto", to:"o_contratto"},
    {label:"Mandami una mail", to:"o_mail"},
    {label:"Quanto costa?", to:"o_prezzo"}
  ]
},

r1_proposta: { kind:"reply", title:"Proporre la videocall / incontro",
  say:[
    {t:"you", text:"Pensandoci, visto che siete {azona}, potrei passare personalmente e parlarne a voce. In alternativa potremmo fissare una videocall. Mi dica pure un giorno o un orario che le torna comodo.", when:{umbria:true}},
    {t:"you", text:"A questo punto le propongo una videocall così le mostro quello che ho riscontrato.. Mi dica pure un giorno o un orario che le torna comodo.", when:{umbria:false}}
  ],
  capture:{key:"fissato", label:"Giorno e ora che propone", placeholder:"martedì 14 alle 15", go:"f6", goLabel:"Fissa"},
  primary:[
    {label:"Va bene, {slotA}", to:"f6", copy:{fissato:"slotA"}},
    {label:"Va bene, {slotB}", to:"f6", copy:{fissato:"slotB"}},
    {label:"Un altro momento", to:"r6_altro"},
    {label:"Niente call, mi mandi qualcosa", to:"o_pres"}
  ]
},

r1_altro: { kind:"reply", title:"«Se ne occupa un'altra persona»", set:{altro:true, sonoio:false},
  say:[{t:"you", text:"Chiarissimo. Posso chiederle come raggiungere questa persona ed eventualmente quando posso sentirla?"}],
  primary:[
    {label:"Mi dà nome / contatto (e magari anche quando)", to:"r1_altro_nome"},
    {label:"Mi dice quando richiamare: «provi in [giorno]»", to:"r1_altro_quando"},
    {label:"«Mandi una email a…»", to:"r1_mail2"},
    {label:"«Glielo riferisco io»", to:"r1_riferisco"},
    {label:"«Se ne occupa mio figlio / mio padre… non so quanto interessi»", to:"r1_altro_dubbio"},
    {label:"«Non ho capito bene chi siete»", to:"r1_chi"},
    {label:"Non ci interessa / Non è il momento", to:"o_interesse"}
  ]
},

r1_altro_dubbio: { kind:"reply", title:"«Se ne occupa mio figlio / mio padre… non so quanto interessi»",
  say:[{t:"you", text:"Capisco. Dall'analisi di {azienda} sono emersi punti concreti sulla parte digitale, per questo preferirei sentirlo direttamente. Posso chiederle il nome e quando riesco a trovarlo?"}],
  primary:[
    {label:"Mi dà nome / contatto (e magari anche quando)", to:"r1_altro_nome"},
    {label:"Mi dice quando richiamare", to:"r1_altro_quando"},
    {label:"«Glielo riferisco io»", to:"r1_riferisco"},
    {label:"Non ci interessa / Non è il momento", to:"o_interesse"}
  ]
},

r1_altro_nome: { kind:"reply", title:"Il nome del referente (e quello che ti dice)",
  /* Scrivi quello che dice, in qualsiasi ordine: nome, telefono, email, quando. Le domande sotto compaiono solo per quello che manca; la chiusura è sempre pronta. */
  say:[{t:"you", text:"Perfetto, grazie."}],
  captures:[
    {key:"titolare", label:"Nome del referente", placeholder:"signor Bianchi / Marco"},
    {key:"contatto", label:"Numero di telefono", placeholder:"333 …"},
    {key:"recapito", label:"Email", placeholder:"marco@…"},
    {key:"rgiorno", label:"Giorno in cui trovarlo", placeholder:"giovedì"},
    {key:"rora", label:"Ora o fascia oraria", placeholder:"verso le 9 / mattina"}
  ],
  anyOf:true,
  after:{
    say:[
      {t:"you", text:"E quando riesco a trovare {iltitolare|la persona che se ne occupa}?", when:{rgiorno:false, rora:false}},
      {t:"you", text:"Per contattarla richiamo questo numero oppure ha un recapito diretto?", when:{contatto:false, recapito:false}},
      {t:"you", text:"Benissimo. Mi rivolgo direttamente a {iltitolare|chi se ne occupa}… Grazie del tempo dedicato. Buon lavoro e arrivederci."}
    ],
    primary:[{label:"Chiamata conclusa → task HubSpot", to:"f7", outcome:"filtro"}]
  }
},

r1_altro_quando: { kind:"reply", title:"«Mi indica quando trovarla»",
  say:[{t:"you", text:"Ok… lo segno subito. Per contattarla richiamo questo numero oppure ha un contatto diretto?"}],
  captures:[
    {key:"rgiorno", label:"Giorno che ha appena detto", placeholder:"giovedì"},
    {key:"rora", label:"Ora o fascia oraria", placeholder:"verso le 9 / mattina"},
    {key:"contatto", label:"Numero di telefono", placeholder:"333 …"},
    {key:"recapito", label:"Email", placeholder:"marco@…"}
  ],
  anyOf:true,
  after:{
    say:[{t:"you", text:"Perfetto. Posso chiederle anche il nome, così quando richiamo chiedo direttamente di lei?"}],
    captures:[{key:"titolare", label:"Nome referente · la chiusura sotto si aggiorna mentre scrivi", placeholder:"signor Bianchi / Marco", soft:true}],
    say2:[{t:"you", text:"Benissimo. Mi rivolgo direttamente a {iltitolare|chi se ne occupa}… Grazie del tempo dedicato. Buon lavoro e arrivederci."}],
    primary:[{label:"Chiamata conclusa → task HubSpot", to:"f7", outcome:"filtro"}]
  }
},

r1_chi: { kind:"reply", title:"«Chi siete?» / «Di cosa si tratta?»", set:{presentato:true}, open:true,
  say:[
    {t:"you", text:"{nome, |}in sostanza siamo una tech company specializzata esclusivamente nel settore [[delle strutture ricettive|delle cantine|dei frantoi]], in Italia e all'estero. Usiamo l'Intelligenza Artificiale per azzerare il vostro lavoro manuale, moltiplicare la vostra presenza sul web e rendere il business scalabile e autonomo."},
    {t:"you", text:"Abbiamo analizzato la vostra attività e vorrei confrontarmi un attimo con chi gestisce questi aspetti...", when:{sonoio:false, altro:false}},
    {t:"you", text:"Abbiamo fatto una prima analisi di {azienda}: ha ricevuto l'email che le ho inviato {dataEmail} con i punti emersi?", when:{sonoio:true}},
    {t:"you", text:"Abbiamo fatto una prima analisi di {azienda} e sarebbe importante confrontarsi con chi segue questi aspetti. Qual è il modo migliore per raggiungere chi se ne occupa?", when:{altro:true, sonoio:false}}
  ],
  primary:[
    {label:"Sì, sono io", to:"r1_sonoio", when:{sonoio:false, altro:false}},
    {label:"Non ci interessa / Non è il momento", to:"o_interesse", when:{sonoio:false, altro:false}},
    {label:"Se ne occupa un'altra persona", to:"r1_altro", when:{sonoio:false, altro:false}},
    {label:"Sì, l'ho vista", to:"f3", set:{visto:true, noto:true}, when:{sonoio:true}},
    {label:"No, non l'ho vista", to:"f3", when:{sonoio:true}},
    {label:"Non ci interessa / Non è il momento", to:"o_interesse", when:{sonoio:true}},
    {label:"Mi dà nome / contatto", to:"r1_altro_nome", when:{altro:true, sonoio:false}},
    {label:"Mi indica quando trovarla", to:"r1_altro_quando", when:{altro:true, sonoio:false}},
    {label:"Glielo riferisco io / mandate una mail", to:"r1_riferisco", when:{altro:true, sonoio:false}},
    {label:"Non ci interessa / Non è il momento", to:"o_interesse", when:{altro:true, sonoio:false}},
    {label:"Cosa avete rilevato?", to:"o_rilevato", when:{altro:false}}
  ],
  options:[
    {label:"Abbiamo già chi ci segue", to:"o_fornitore"},
    {label:"Abbiamo un contratto", to:"o_contratto"},
    {label:"Mandami una mail", to:"o_mail"},
    {label:"Sono impegnato", to:"r1_impegnato"}
  ]
},

r1_impegnato: { kind:"reply", title:"«Sono impegnato»",
  say:[{t:"you", text:"Va bene, allora ci organizziamo diversamente.. Mi indichi un momento più comodo per lei e lo segno."}],
  captures:[
    {key:"rgiorno", label:"Giorno che indica", placeholder:"giovedì 9 ottobre"},
    {key:"rora", label:"Ora", placeholder:"15"}
  ],
  anyOf:true,
  after:{ say:[{t:"you", text:"Segnato tutto. Ci risentiamo {richiamata}. Grazie ancora del tempo dedicato e buon lavoro, arrivederci."}], primary:[{label:"Crea task HubSpot", to:"f7", outcome:"richiamata"}] },
  primary:[
    {label:"Va bene, {slotA}", to:"r1_imp_ok", copy:{richiamata:"slotA"}, outcome:"richiamata"},
    {label:"Prima però: chi siete / di cosa si tratta?", to:"r1_chi_breve", when:{presentato:false}}
  ],
  options:[
    {label:"Non ci interessa / Non è il momento", to:"o_interesse"},
    {label:"Mandami una mail", to:"o_mail"}
  ]
},

r1_imp_ok: { kind:"reply", title:"Richiamata fissata",
  say:[{t:"you", text:"Segnato tutto. Ci risentiamo {richiamata}. Grazie ancora del tempo dedicato e buon lavoro, arrivederci."}],
  primary:[{label:"Crea task HubSpot", to:"f7", outcome:"richiamata"}]
},

r1_impegnato_altro: { kind:"reply", title:"Propone un altro momento",
  say:[{t:"you", text:"Va benissimo, mi dia una sua disponibilità e lo segno."}],
  captures:[
    {key:"rgiorno", label:"Data concordata", placeholder:"giovedì 9 ottobre"},
    {key:"rora", label:"Ora", placeholder:"15"}
  ],
  anyOf:true,
  after:{ say:[{t:"you", text:"Segnato tutto. Ci risentiamo {richiamata}. Grazie ancora del tempo dedicato e buon lavoro, arrivederci."}], primary:[{label:"Crea task HubSpot", to:"f7", outcome:"richiamata"}] }
},

r1_chi_breve: { kind:"reply", title:"«Chi siete?» mentre è impegnato", set:{presentato:true, detto:true, noto:true},
  say:[
    {t:"you", text:"Gliela dico in modo semplice: siamo una tech company che opera da Perugia, anche all'estero. Usiamo l'intelligenza artificiale per ridurre il lavoro manuale e lavoriamo su siti ed e-commerce perché possano essere proposti dall'AI a chi cerca attività come la vostra. Analizzando {azienda} abbiamo riscontrato delle mancanze… è emerso che {dettaglio}.", when:{umbria:true}},
    {t:"you", text:"Volentieri… siamo una tech company che lavora in Italia e all'estero. Usiamo l'intelligenza artificiale per ridurre il lavoro manuale e lavoriamo su siti ed e-commerce perché possano essere proposti dall'AI a chi cerca attività come la vostra. Analizzando {azienda} abbiamo riscontrato queste mancanze… è emerso che {dettaglio}.", when:{umbria:false}},
    {t:"you", text:"Quando preferisce che la richiami, per valutare insieme con calma?"}
  ],
  primary:[
    {label:"Propone un momento", to:"r1_impegnato_altro"},
    {label:"Va bene, {slotA}", to:"r1_imp_ok", copy:{richiamata:"slotA"}, outcome:"richiamata"},
    {label:"Non ci interessa", to:"o_interesse"}
  ]
},

r_fine_richiamo_filtro: { kind:"reply", title:"Richiamata fissata (con chi filtra)",
  say:[{t:"you", text:"Segnato tutto: {richiamata}. La ringrazio ancora per il tempo dedicato, buon lavoro e arrivederci."}],
  primary:[{label:"Chiamata conclusa → HubSpot", to:"f7"}]
},

r1_riferisco: { kind:"reply", title:"«Glielo riferisco io» / «Mandate una mail»",
  say:[{t:"you", text:"La ringrazio di cuore… Gli dica che ha chiamato {commerciale} di Agria System, come da email. Eventualmente quand'è che posso ritrovarlo?"}],
  capture:{key:"richiamata", label:"Giorno e ora che ti dice", placeholder:"lunedì alle 10", go:"r_fine_richiamo_filtro", goLabel:"Conferma", outcome:"filtro"},
  primary:[{label:"Preferisce una mail", to:"r1_mail2"}]
},

r1_mail2: { kind:"reply", title:"«Mandate una mail»: a quale indirizzo",
  say:[{t:"you", text:"Volentieri! A quale indirizzo la legge {iltitolare|la persona che se ne occupa}?"}],
  capture:{key:"recapito", label:"Email che ti dà", placeholder:"marco@…", go:"r_fine_mail", goLabel:"Conferma", outcome:"mail", skip:"Resta l'indirizzo generico"}
},

r_fine_mail: { kind:"reply", title:"Email da inviare",
  say:[{t:"you", text:"D'accordo: le invio tutto oggi stesso e la risento {richiamata|dopodomani}. Grazie{ nome|} del tempo dedicato. Buon lavoro e arrivederci."}],
  primary:[{label:"Chiamata conclusa → HubSpot", to:"f7"}]
},

/* ───────────── FASE 2 · EMAIL ───────────── */
f2: { kind:"phase", num:2, title:"L'email e il motivo", short:"Email",
  say:[{t:"you", text:"Dunque{ nome|}, le ho inviato {dataEmail} un'email con alcune mancanze riscontrate dall'analisi di {azienda}. Ha avuto modo di leggerla?"}],
  primary:[
    {label:"«Sì, l'ho vista»", to:"f3", set:{visto:true, noto:true}},
    {label:"«No» / «Non mi pare» / «Ne ricevo tante»", to:"r2_no"},
    {label:"«Non ci interessa»", to:"o_interesse"},
    {label:"«Quali mancanze?»", to:"o_rilevato"}
  ],
  options:[
    {label:"«Mandami una mail»", to:"o_mail"},
    {label:"«Abbiamo già chi ci segue»", to:"o_fornitore"},
    {label:"«Ma chi siete? Cosa fate?»", to:"o_chi"}
  ]
},

r2_no: { kind:"reply", title:"«No, l'email non l'ho vista»", set:{detto:true, noto:true},
  say:[{t:"you", text:"Posso immaginare… Le dico che, avendo analizzato {azienda}, è emerso che {dettaglio}. È ancora così?"}],
  primary:[
    {label:"«Sì, è così»", to:"f3", set:{detto:true, noto:true}},
    {label:"«Non ci interessa»", to:"o_interesse"},
    {label:"«È cambiato qualcosa» / «Funziona diversamente»", to:"r_diverso"}
  ],
  options:[
    {label:"«Quanto costa?»", to:"o_prezzo"},
    {label:"«Abbiamo già chi ci segue»", to:"o_fornitore"}
  ]
},

/* ───────────── FASE 3 · PERCHÉ VOI ───────────── */
f3: { kind:"phase", num:3, title:"Perché proprio voi", short:"Perché voi", set:{noto:true, detto:true},
  say:[
    {t:"you", text:"Ok. Guardi, la tengo al corrente dicendole che dall'analisi è emerso che {dettaglio}. Consideri che il nostro obiettivo è affiancare le aziende del vostro settore e farle rimanere al passo con i tempi. Inoltre, i vostri competitor soprattutto all'estero si stanno già muovendo su questi aspetti.. Eravate al corrente di questa cosa?", when:{visto:false, detto:false}},
    {t:"you", text:"Mi fa piacere. Come le scrivevo, dall'analisi di {azienda} è emerso che {dettaglio}. È un aspetto su cui altre realtà del settore, soprattutto all'estero, si stanno già muovendo. Ne eravate al corrente?", when:{visto:true}},
    {t:"you", text:"È un aspetto su cui altre realtà del settore, soprattutto all'estero, si stanno già muovendo. Ne eravate al corrente?", when:{visto:false, detto:true}}
  ],
  primary:[
    {label:"Sì, lo sapevamo", to:"f3_si"},
    {label:"No / Non proprio", to:"f3_no"},
    {label:"Non ci interessa / Non è il momento", to:"o_interesse"},
    {label:"Da noi funziona diversamente", to:"r_diverso"},
    {label:"Ci chiamano in tanti come voi", to:"o_tanti"},
    {label:"Devo parlarne con mio padre / il socio", to:"r6_socio"},
    {label:"Abbiamo già chi ci segue / Ho un'agenzia", to:"o_fornitore"},
    {label:"Abbiamo un contratto", to:"o_contratto"}
  ],
  options:[
    {label:"Abbiamo un'agenzia marketing / ADV in corso", to:"o_adv"},
    {label:"Abbiamo già un sito, siamo a posto così", to:"o_sito"},
    {label:"Siamo piccoli, a conduzione familiare", to:"o_piccoli"},
    {label:"So già tutto, conosco il settore", to:"o_sapientone"},
    {label:"Interessante, mi dica di più", to:"r5_dipiu"},
    {label:"Quanto costa?", to:"o_prezzo"},
    {label:"Preferisco di persona", to:"r6_persona"}
  ]
},

f3_si: { kind:"reply", title:"«Sì, lo sapevamo»",
  say:[
    {t:"you", text:"Bene, allora credo che avrebbe senso approfondire insieme anche gli altri punti emersi dall'analisi… Così ci confrontiamo su come si stanno muovendo realtà simili alla vostra. Che ne pensa?"},
    {t:"alt", label:"Se è d'accordo", text:"Benissimo… Visto che siete {azona}, potrei venire da voi di persona così da approfondire il discorso. In alternativa possiamo fissare una videocall.. Mi dica lei un giorno o un orario che le torna comodo.", when:{umbria:true}},
    {t:"alt", label:"Se è d'accordo", text:"Benissimo… A questo punto per approfondire tutti i dettagli del caso potremmo fissare una videocall.. Mi dia pure un giorno o un orario che le torna comodo.", when:{umbria:false}}
  ],
  primary:[
    {label:"Propone giorno / orario", to:"f6"},
    {label:"Mi mandi prima l'analisi", to:"f3_documento"},
    {label:"Preferisco guardarmela da solo", to:"f3_documento"},
    {label:"Adesso non voglio fissare nulla", to:"o_interesse"}
  ],
  options:[
    {label:"Un altro momento", to:"r6_altro"},
    {label:"Quanto costa?", to:"o_prezzo"},
    {label:"Devo parlarne con mio padre / il socio", to:"r6_socio"},
    {label:"Abbiamo già chi ci segue", to:"o_fornitore"}
  ]
},

f3_no: { kind:"reply", title:"«No, non lo sapevamo»", open:true,
  say:[
    {t:"you", text:"Ecco, è proprio per questo che volevo parlarne a voce e magari valutare di approfondire tutti i dettagli del caso insieme. Per evitare di dilungarci troppo in chiamata potremmo fissare una videocall, o in alternativa verrei io da voi per discuterne insieme.", when:{umbria:true}},
    {t:"you", text:"Ecco, è proprio per questo che volevo parlarne a voce e magari valutare di approfondire tutti i dettagli del caso insieme. Per evitare di dilungarci troppo in chiamata potremmo fissare una videocall.", when:{umbria:false}}
  ],
  primary:[
    {label:"Propone giorno / orario", to:"f6"},
    {label:"Mi mandi prima l'analisi", to:"f3_documento"},
    {label:"Preferisco guardarmela da solo", to:"f3_documento"},
    {label:"Adesso non voglio fissare nulla", to:"o_interesse"}
  ],
  options:[
    {label:"Un altro momento", to:"r6_altro"},
    {label:"Quanto costa?", to:"o_prezzo"},
    {label:"Devo parlarne con mio padre / il socio", to:"r6_socio"},
    {label:"Abbiamo già chi ci segue", to:"o_fornitore"}
  ]
},

f3_documento: { kind:"reply", title:"«Invio analisi» (dalla Fase 3)", skipLabel:"Usa il recapito che già hai",
  say:[{t:"you", text:"Va bene. Allora le mando direttamente l'analisi, così può guardare con calma e valutare come far ripartire il digitale dell'attività. Preferisce riceverla via email o WhatsApp?"}],
  captures:[
    {key:"recapito", label:"Email", placeholder:"info@… / marco@…"},
    {key:"whatsapp", label:"Numero WhatsApp", placeholder:"333 …"}
  ],
  anyOf:true,
  after:{
    say:[{t:"you", text:"Perfetto, gliela mando oggi stesso… Poi la ricontatto per esaminarla insieme. Le torna meglio {slotA} oppure preferisce indicarmi lei un momento più adatto?"}],
    captures:[{key:"richiamata", label:"Se propone un altro momento: giorno e ora", placeholder:"martedì alle 15", go:"f3_documento_ok", goLabel:"Fissa la richiamata", outcome:"email"}],
    primary:[
      {label:"Va bene, {slotA}", to:"f3_documento_ok", copy:{richiamata:"slotA"}, outcome:"email"},
      {label:"Le faccio sapere io", to:"f3_fare_sapere"},
      {label:"Preferisco che non mi richiami", to:"o_no_fine"}
    ]
  }
},

f3_fare_sapere: { kind:"reply", title:"«Le faccio sapere» (dalla Fase 3)",
  say:[{t:"you", text:"Benissimo… Per evitare che rimanga lì.. tra le altre mille.. Gliela mando oggi e la risento io {slotA}. Se preferisce un altro momento me lo dica pure."}],
  capture:{key:"richiamata", label:"Se propone un altro momento: giorno e ora", placeholder:"martedì alle 15", go:"f3_documento_ok", goLabel:"Fissa la richiamata", outcome:"email"},
  primary:[
    {label:"Va bene", to:"f3_documento_ok", copy:{richiamata:"slotA"}, outcome:"email"},
    {label:"No, preferisco non essere richiamato", to:"o_no_fine"}
  ]
},

f3_documento_ok: { kind:"reply", title:"Analisi inviata · richiamata fissata",
  say:[
    {t:"you", text:"Ottimo. Le mando l'analisi oggi e ci sentiamo {richiamata}, così vediamo come riprendere in mano il digitale dell'attività, va bene?"},
    {t:"alt", label:"Quando risponde «sì, grazie»", text:"Grazie ancora{ nome|} del tempo dedicato, buon lavoro e arrivederci."}
  ],
  primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"email"}]
},

r_diverso: { kind:"reply", title:"«Da noi funziona diversamente»",
  say:[{t:"you", text:"Ah.. Interessante, mi racconti pure: com'è la situazione oggi?"}],
  listen:true
},

/* ───────────── FASE 4 · VERIFICA GUIDATA ───────────── */
f4: { kind:"phase", num:4, title:"Verifica guidata", short:"Verifica",
  lead:"Se il cliente ha già fatto emergere un problema, premi l'ambito di cui ha parlato: compare la battuta della Fase 5. Se dice che va tutto bene, usa il pulsante qui sotto.",
  listen:true,
  options:[{label:"«Va tutto bene così»", to:"r4_bene"}]
},

r4_bene: { kind:"reply", title:"«Va tutto bene così»",
  say:[
    {t:"you", text:"Ok, mi permetto di farle una domanda in quanto dall'analisi fatta sono emersi alcuni punti da sistemare.."},
    {t:"you", text:"[[Quando arriva una prenotazione qualcuno deve ancora riportare dei dati a mano?|Quando arriva un ordine qualcuno deve ancora riportarlo a mano?|Quando arriva un ordine qualcuno deve ancora riportarlo a mano?]]"}
  ],
  primary:[
    {label:"Sì, qualcosa facciamo ancora a mano", to:"r4_manuale"},
    {label:"No, entra tutto automaticamente", to:"r4_automatico"},
    {label:"Non saprei / Se ne occupa un'altra persona", to:"r4_non_sa"}
  ]
},

r4_manuale: { kind:"reply", title:"«C'è ancora lavoro manuale»", open:true,
  say:[
    {t:"you", text:"Ecco, è proprio questo il punto: oggi quel passaggio può farlo direttamente il sistema, in maniera intelligente senza impegnare una persona ogni volta."},
    {t:"alt", label:"Breve pausa, poi", text:"È uno degli aspetti che secondo me vale la pena approfondire insieme."}
  ],
  primary:[
    {label:"Prosegui → proposta appuntamento", to:"r4_proposta"},
    {label:"Mi mandi prima l'analisi", to:"r4_documento"},
    {label:"Non ci interessa / Non è il momento", to:"o_interesse"}
  ]
},

r4_automatico: { kind:"reply", title:"«È già automatizzato»",
  say:[
    {t:"you", text:"Bene, questo è sicuramente positivo. C'è però un altro punto che abbiamo verificato."},
    {t:"you", text:"Nell'analisi però sono emersi altri punti su cui avrebbe senso confrontarci, anche rispetto a come si stanno muovendo realtà simili alla vostra. Preferisce approfondirli insieme oppure le mando prima l'analisi?"}
  ],
  primary:[
    {label:"Approfondiamoli insieme", to:"r4_proposta"},
    {label:"Mi mandi l'analisi", to:"r4_documento"},
    {label:"Non ci interessa", to:"o_interesse"}
  ]
},


r4_ai_si: { kind:"reply", title:"«Sì, anche questo»",
  say:[
    {t:"you", text:"Meglio così.. allora su questi aspetti siete già avanti. Nell'analisi però sono emersi altri punti su cui avrebbe senso confrontarci, anche rispetto a come si stanno muovendo realtà simili alla vostra."},
    {t:"you", text:"Preferisce approfondirli insieme oppure le mando prima l'analisi?"}
  ],
  primary:[
    {label:"Approfondiamoli insieme", to:"r4_proposta"},
    {label:"Mi mandi l'analisi", to:"r4_documento"},
    {label:"Adesso non è il momento", to:"r4_documento"},
    {label:"Non ci interessa", to:"o_interesse"}
  ]
},


r4_non_sa: { kind:"reply", title:"«Non sa rispondere»",
  say:[
    {t:"you", text:"Va benissimo, resto fuori dagli aspetti tecnici, che sono di competenza del team… Per quello si interfaccerà direttamente con il nostro sviluppatore Matteo. Nell'analisi abbiamo comunque raccolto i punti che abbiamo potuto verificare direttamente."},
    {t:"you", text:"Preferisce che li vediamo insieme oppure le mando prima il documento?"}
  ],
  primary:[
    {label:"Vediamoli insieme", to:"r4_proposta"},
    {label:"Mi mandi il documento", to:"r4_documento"}
  ],
  options:[{label:"Non ci interessa", to:"o_interesse"}]
},

r4_proposta: { kind:"reply", title:"Proposta appuntamento", open:true,
  say:[
    {t:"you", text:"Allora, visto che siete {azona}, potrei passare di persona oppure fissiamo una videocall e approfondiamo punto per punto. Mi dia pure un giorno o un orario che le torna comodo.", when:{umbria:true}},
    {t:"you", text:"Potremmo fissare una videocall così approfondiamo insieme punto per punto ciò che è emerso dall'analisi. Mi dia pure un giorno o un orario che le torna comodo.", when:{umbria:false}}
  ],
  primary:[
    {label:"Propone giorno / orario", to:"f6"},
    {label:"Mi mandi prima l'analisi", to:"r4_documento"},
    {label:"Adesso non voglio fissare", to:"r4_documento"},
    {label:"Devo parlarne con mio padre / socio", to:"r6_socio"}
  ],
  options:[
    {label:"Un altro momento", to:"r6_altro"},
    {label:"Quanto costa?", to:"o_prezzo"},
    {label:"Non ci interessa", to:"o_interesse"}
  ]
},

r4_documento: { kind:"reply", title:"«Invio analisi» (dalla verifica)", skipLabel:"Usa recapito già presente",
  say:[{t:"you", text:"Ottimo… Le mando direttamente l'analisi così può guardare con calma tutti i punti emersi. Preferisce riceverla via email o WhatsApp?"}],
  captures:[
    {key:"recapito", label:"Email", placeholder:"info@… / marco@…"},
    {key:"whatsapp", label:"Numero WhatsApp", placeholder:"333 …"}
  ],
  anyOf:true,
  after:{
    say:[{t:"you", text:"Ho segnato tutto. Gliela mando oggi stesso e poi la risento così valutiamo come farvi restare al passo con i tempi. Le propongo {slotA} oppure preferisce indicarmi lei un momento adatto?"}],
    captures:[{key:"richiamata", label:"Se propone un altro giorno / ora", placeholder:"martedì alle 15", go:"r4_documento_ok", goLabel:"Fissa la richiamata", outcome:"email"}],
    primary:[
      {label:"Va bene, {slotA}", to:"r4_documento_ok", copy:{richiamata:"slotA"}, outcome:"email"},
      {label:"Le faccio sapere io", to:"r4_fare_sapere"},
      {label:"Preferisco non essere ricontattato", to:"o_no_fine"}
    ]
  }
},

r4_fare_sapere: { kind:"reply", title:"«Le faccio sapere» (dalla verifica)",
  say:[{t:"you", text:"Ok.. ok. Facciamo così: gliela mando oggi e la risento io {slotA}. Se preferisce un altro momento me lo dica pure."}],
  capture:{key:"richiamata", label:"Se propone un altro momento: giorno e ora", placeholder:"martedì alle 15", go:"r4_documento_ok", goLabel:"Fissa la richiamata", outcome:"email"},
  primary:[
    {label:"Va bene", to:"r4_documento_ok", copy:{richiamata:"slotA"}, outcome:"email"},
    {label:"Preferisco non essere richiamato", to:"o_no_fine"}
  ]
},

r4_documento_ok: { kind:"reply", title:"Richiamata fissata (analisi in arrivo)",
  say:[
    {t:"you", text:"Perfetto… Le mando l'analisi oggi e ci sentiamo {richiamata}, così valutiamo come farvi restare al passo con i tempi, va bene?"},
    {t:"alt", label:"Quando risponde «va bene, grazie»", text:"Benissimo{, nome|}, grazie ancora per il tempo dedicato e buon lavoro."}
  ],
  primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"email"}]
},

/* ───────────── FASE 5 · IL VALORE E LA PROPOSTA ───────────── */
f5: { kind:"phase", num:5, title:"Il valore e la proposta", short:"Proposta",
  areaText:{
    presence:"Da quello che mi dice, il punto è fare in modo che la presenza online di {azienda} rappresenti meglio il vostro valore e generi richieste dirette: è l'area Agria Digital Presence, il sito da vetrina a strumento commerciale. Possiamo tranquillamente partire dal sito che avete già, oppure rifarlo quando serve, [[per renderlo più efficace sulla vendita diretta e fare in modo che possa essere trovato e proposto anche da sistemi come ChatGPT o Gemini, anche da chi cerca dall'estero|per aumentare le opportunità di vendita diretta e fare in modo che la cantina possa essere trovata e proposta anche da sistemi come ChatGPT o Gemini, anche all'estero|per aumentare le opportunità di vendita diretta e fare in modo che il frantoio possa essere trovato e proposto anche da sistemi come ChatGPT o Gemini]].",
    commerce:"Da quello che mi descrive, l'opportunità è sviluppare il rapporto diretto con il cliente finale, con meno dipendenza da terzi: è l'area Agria Digital Commerce. L'obiettivo è far arrivare più [[prenotazioni direttamente a voi e gestire in modo più semplice prenotazioni, pagamenti e conferme, eliminando i passaggi manuali e la dipendenza dai portali|ordini direttamente a voi e rendere più semplice la gestione di pagamenti, spedizioni e clienti, riducendo i passaggi tra telefono, WhatsApp, email e così via…|ordini direttamente a voi e semplificare la gestione di pagamenti, spedizioni e clienti, riducendo i passaggi tra telefono, WhatsApp, email e così via…]]",
    automation:"Una parte del tempo dello staff oggi va in attività manuali: è l'area Agria Digital Automation, automazioni e AI per restituire ore di lavoro al vostro personale. Gli strumenti che già utilizzate possono essere collegati tra loro, così il dato entra una volta e arriva dove serve, riducendo inserimenti manuali, passaggi ripetuti e tempo perso."
  },
  bridge:[
    {t:"you", text:"È uno degli aspetti che secondo me avrebbe senso approfondire."},
    {t:"you", text:"Pensandoci, visto che siete {azona}, potrei passare di persona oppure fissiamo una videocall e analizziamo insieme quello che ho riscontrato. Mi dia pure un giorno o un orario che le torna comodo.", when:{umbria:true}},
    {t:"you", text:"Per me.. potremmo fissare una videocall e analizzare insieme quello che ho riscontrato. Mi dia pure un giorno o un orario che le torna comodo.", when:{umbria:false}}
  ],
  primary:[
    {label:"Propone giorno / orario", to:"f6"},
    {label:"Mi mandi prima l'analisi", to:"r5_documento"},
    {label:"Preferisco guardarmela prima", to:"r5_documento"},
    {label:"Interessante, mi dica di più", to:"r5_dipiu"},
    {label:"Un altro momento", to:"r6_altro"}
  ],
  options:[
    {label:"Ci penso / Risentiamoci più avanti", to:"o_piuavanti"},
    {label:"Devo parlarne con mio padre / socio", to:"r6_socio"},
    {label:"Preferisco di persona", to:"r6_persona"},
    {label:"Quanto costa?", to:"o_prezzo"},
    {label:"Zero budget / Costa troppo", to:"o_budget"},
    {label:"Vincolate? / Fate dei contratti?", to:"o_vincoli"},
    {label:"Abbiamo già chi ci segue", to:"o_fornitore"},
    {label:"Abbiamo un'agenzia marketing / ADV in corso", to:"o_adv"},
    {label:"Abbiamo un contratto", to:"o_contratto"},
    {label:"Poco tempo / Poco pratici", to:"o_tempo"},
    {label:"L'AI a noi serve poco / Siamo contro", to:"o_ai"},
    {label:"Domanda tecnica", hint:"gestionale, tecnologia, dati, tempi…", to:"o_tecnico"},
    {label:"Ci servirebbe un gestionale fatto per noi", to:"o_gestionale"},
    {label:"Non ci interessa", to:"o_interesse"}
  ]
},

r5_dipiu: { kind:"reply", title:"«Interessante, mi dica di più»", open:true,
  say:[
    {t:"you", text:"Volentieri! Per farle capire meglio… le faccio un esempio: [[una richiesta o una prenotazione può entrare una volta e arrivare direttamente negli strumenti che già utilizzate, evitando di dover riportare gli stessi dati più volte|un contatto o un ordine può essere gestito in modo molto più diretto, dalla richiesta fino alla vendita, evitando diversi passaggi manuali tra gli strumenti che già utilizzate|un ordine può entrare una volta e arrivare dove serve, evitando di doverlo riscrivere tra telefono, WhatsApp, email, gestionale o altri portali]]."},
    {t:"you", text:"Il punto è capire come realizzare tutto ciò per {azienda}, ed è quello che possiamo affrontare insieme sull'analisi."},
    {t:"you", text:"Pensandoci, visto che siete {azona}, potrei passare di persona oppure fissiamo una videocall e analizziamo insieme quello che ho riscontrato. Mi dia pure un giorno o un orario che le torna comodo.", when:{umbria:true}},
    {t:"you", text:"Per me.. potremmo fissare una videocall e analizzare insieme quello che ho riscontrato. Mi dia pure un giorno o un orario che le torna comodo.", when:{umbria:false}}
  ],
  primary:[
    {label:"Propone giorno / orario", to:"f6"},
    {label:"Mi mandi prima l'analisi", to:"r5_documento"},
    {label:"Adesso non voglio fissare", to:"r5_documento"},
    {label:"Quanto costa?", to:"o_prezzo"},
    {label:"Domanda tecnica", to:"o_tecnico"}
  ]
},

r5_documento: { kind:"reply", title:"«Invio analisi» (dalla proposta)", skipLabel:"Usa recapito già presente",
  say:[{t:"you", text:"Benissimo. Le mando l'analisi così può guardare con calma tutti i punti emersi. Preferisce riceverla via email o WhatsApp?"}],
  captures:[
    {key:"recapito", label:"Email", placeholder:"info@… / marco@…"},
    {key:"whatsapp", label:"Numero WhatsApp", placeholder:"333 …"}
  ],
  anyOf:true,
  after:{
    say:[{t:"you", text:"Perfetto, gliela mando oggi stesso. Poi la richiamo e cerchiamo di capire come farvi rimanere al passo con i tempi: le torna meglio {slotA} oppure preferisce darmi una sua disponibilità?"}],
    captures:[{key:"richiamata", label:"Se propone un altro momento: giorno e ora", placeholder:"martedì alle 15", go:"r5_documento_ok", goLabel:"Fissa la richiamata", outcome:"email"}],
    primary:[
      {label:"Va bene, {slotA}", to:"r5_documento_ok", copy:{richiamata:"slotA"}, outcome:"email"},
      {label:"Le faccio sapere io", to:"r6_fare_sapere"},
      {label:"Preferisco non essere ricontattato", to:"o_no_fine"}
    ]
  }
},

r5_documento_ok: { kind:"reply", title:"Richiamata fissata (analisi in arrivo)",
  say:[
    {t:"you", text:"Tutto segnato. Le mando l'analisi e ci sentiamo {richiamata}, così valutiamo come farvi rimanere al passo con i tempi. Va bene?"},
    {t:"alt", label:"Quando risponde «sì, va bene, grazie»", text:"Perfetto, grazie ancora{ nome|} per il tempo dedicato e a presto, buon lavoro."}
  ],
  primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"email"}]
},

/* ───────────── FASE 6 · FISSARE E SALUTARE ───────────── */
f6: { kind:"phase", num:6, title:"Fissare e salutare", short:"Chiusura",
  capture:{key:"fissato", label:"Giorno e ora concordati", placeholder:"giovedì 9 ottobre alle 10"},
  after:{
    say:[
      {t:"you", text:"Perfetto, allora ci vediamo {fissato}. Le mando subito la conferma: preferisce riceverla via email o WhatsApp?"},
      {t:"you", text:"A chi la intesto? …Mi darebbe un nome e cognome?", when:{nome:false}}
    ],
    captures:[
      {key:"nome", label:"Nome e cognome", placeholder:"Marco Bianchi", when:{nome:false}},
      {key:"recapito", label:"Email / numero WhatsApp · se già verificato, resta quello che c'è", placeholder:"info@… / 333 …"}
    ],
    say2:[{t:"you", text:"Ci siamo. Nel frattempo preparo il materiale su {azienda}, con i punti emersi dall'analisi e il confronto con realtà simili alla vostra. Ne parliamo {fissato}. Grazie ancora{ nome|} per il tempo dedicato. Buon lavoro e arrivederci."}],
    primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"fissato"}]
  }
},

r6_altro: { kind:"reply", title:"«Un altro momento»",
  say:[{t:"you", text:"Certo. Mi dica pure quando le torna più comodo."}],
  capture:{key:"fissato", label:"Giorno e ora che ti dice", placeholder:"martedì 14 alle 15", go:"f6", goLabel:"Fissa"},
  options:[{label:"«Le faccio sapere io»", to:"r6_fare_sapere"}]
},

o_pres: { kind:"reply", title:"«Mi mandi il documento»", skipLabel:"Usa recapito già presente",
  say:[{t:"you", text:"D'accordo. Le mando direttamente l'analisi fatta su {azienda}, così può guardarla con calma. Preferisce riceverla via email o WhatsApp?"}],
  captures:[
    {key:"recapito", label:"Email", placeholder:"info@… / marco@…"},
    {key:"whatsapp", label:"Numero WhatsApp", placeholder:"333 …"}
  ],
  anyOf:true,
  after:{
    say:[{t:"you", text:"Perfetto, gliela mando oggi stesso.. Poi la risento per esaminarla insieme. Le torna meglio {slotA} oppure preferisce indicarmi lei un momento?"}],
    captures:[{key:"richiamata", label:"Se propone un altro momento: giorno e ora", placeholder:"martedì alle 15", go:"r_fine_pres", goLabel:"Fissa la richiamata", outcome:"email"}],
    primary:[
      {label:"Va bene, {slotA}", to:"r_fine_pres", copy:{richiamata:"slotA"}, outcome:"email"},
      {label:"Prima la leggo, poi vediamo", to:"o_invio_quando"},
      {label:"Le faccio sapere io", to:"r6_fare_sapere"},
      {label:"Preferisco non essere ricontattato", to:"o_no_fine"}
    ]
  }
},

o_invio_quando: { kind:"reply", title:"«Prima la leggo»",
  say:[{t:"you", text:"D'accordo. Gliela mando oggi e la risento dopo che ha avuto modo di leggerla. Le va bene {slotA} oppure mi dica lei quando preferisce."}],
  capture:{key:"richiamata", label:"Se propone un altro momento: giorno e ora", placeholder:"martedì alle 15", go:"r_fine_pres", goLabel:"Fissa la richiamata", outcome:"email"},
  primary:[
    {label:"Va bene, {slotA}", to:"r_fine_pres", copy:{richiamata:"slotA"}, outcome:"email"},
    {label:"Le faccio sapere io", to:"r6_fare_sapere"},
    {label:"Preferisco non essere ricontattato", to:"o_no_fine"}
  ]
},

r6_fare_sapere: { kind:"reply", title:"«Le faccio sapere»",
  say:[{t:"you", text:"Va bene. Facciamo così: la risento io {slotA}, così mi dice cosa ne pensa. Se preferisce un altro momento me lo dica pure."}],
  capture:{key:"richiamata", label:"Se propone un altro momento: giorno e ora", placeholder:"martedì alle 15", go:"r_fine_pres", goLabel:"Fissa la richiamata", outcome:"email"},
  primary:[
    {label:"Va bene", to:"r_fine_pres", copy:{richiamata:"slotA"}, outcome:"email"},
    {label:"Preferisco non essere ricontattato", to:"o_no_fine"}
  ]
},

r_fine_pres: { kind:"reply", title:"Materiale in arrivo, richiamata fissata",
  say:[{t:"you", text:"Ottimo. Le mando tutto oggi e ci sentiamo {richiamata}, così mi dice cosa ne pensa. Grazie{ nome|}, buon lavoro e arrivederci."}],
  primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"email"}]
},

r_richiamo_altro: { kind:"reply", title:"«Preferisco un altro momento» (richiamata)",
  say:[{t:"you", text:"Va bene. Quando le torna più comodo?"}],
  capture:{key:"richiamata", label:"Giorno e ora che ti dice", placeholder:"martedì alle 15", go:"r_fine_pres", goLabel:"Fissa la richiamata", outcome:"email"},
  options:[{label:"«Le faccio sapere io»", to:"r6_fare_sapere"}]
},

r6_socio: { kind:"reply", title:"«Devo parlarne con mio padre / il socio»",
  say:[
    {t:"you", text:"Certo. Anzi, avrebbe senso coinvolgerlo direttamente, così vediamo insieme tutti i punti emersi dall'analisi."},
    {t:"you", text:"Quando le torna più comodo sentirci insieme?"}
  ],
  capture:{key:"fissato", label:"Giorno e ora che propone", placeholder:"martedì 14 alle 15", go:"f6", goLabel:"Fissa"},
  primary:[
    {label:"Prima ne parlo con lui", to:"r6_socio_richiamo"},
    {label:"Glielo chiedo e le faccio sapere", to:"r6_socio_richiamo"}
  ]
},

r6_socio_richiamo: { kind:"reply", title:"«Prima ne parlo»",
  say:[{t:"you", text:"D'accordo… Quando posso risentirla dopo che ne avrà parlato con lui?"}],
  captures:[
    {key:"rgiorno", label:"Giorno", placeholder:"lunedì"},
    {key:"rora", label:"Ora", placeholder:"10"}
  ],
  anyOf:true,
  after:{ say:[{t:"you", text:"Perfetto, allora la risento {richiamata}. Grazie{ nome|} del tempo dedicato, buon lavoro."}], primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"richiamata"}] }
},

r6_persona: { kind:"reply", title:"«Preferisco di persona»",
  say:[
    {t:"you", text:"Volentieri. Visto che siete {azona}, posso raggiungervi direttamente e ne parliamo di persona. Mi dica pure quando le torna più comodo.", when:{umbria:true}},
    {t:"you", text:"D'accordo.. Direi di fissare una videocall, così le mostro direttamente l'analisi e i punti emersi. Mi dica pure quando le torna più comodo.", when:{umbria:false}}
  ],
  capture:{key:"fissato", label:"Giorno e ora che propone", placeholder:"martedì 14 alle 15", go:"f6", goLabel:"Fissa"},
  options:[{label:"«Un altro momento» / «Le faccio sapere»", to:"r6_fare_sapere"}]
},

/* ───────────── FASE 7 · HUBSPOT ───────────── */
f7: { kind:"phase", num:7, title:"Dopo la chiamata", short:"HubSpot",
  outcomes:[
    {key:"fissato", o:"Videocall o incontro fissato", stage:"Trattativa aperta · Appuntamento Fissato",
      checks:[
        {t:"Ho aperto la trattativa in HubSpot per {azienda}, fase «Appuntamento Fissato»"},
        {t:"Ho salvato giorno e ora dell'appuntamento: {fissato}"},
        {t:"Ho creato il task/promemoria per {fissato}: videocall o incontro con {nome|il referente}"},
        {t:"Ho inviato la conferma con i dettagli a {recapito|il recapito indicato}"},
        {t:"Ho messo in agenda la preparazione della presentazione dedicata a {azienda}"},
        {t:"Ho salvato la nota della chiamata sul contatto"}
      ]},
    {key:"richiamata", o:"Richiamata concordata con il cliente", stage:"Zero trattative · nota sul contatto",
      checks:[
        {t:"Ho salvato {richiamata}"},
        {t:"Ho creato il task di richiamata per {richiamata}"},
        {t:"Ho salvato la nota della chiamata sul contatto"}
      ]},
    {key:"email", o:"Documento / analisi da inviare + richiamata concordata", stage:"Zero trattative · nota sul contatto",
      checks:[
        {t:"Ho verificato il recapito indicato dal cliente: {recapito|quello già presente}"},
        {t:"Ho inviato il documento con l'analisi a {recapito|il recapito indicato}"},
        {t:"Ho salvato {richiamata|il momento concordato}"},
        {t:"Ho creato il task di richiamata per {richiamata|il momento concordato}"},
        {t:"Ho salvato la nota della chiamata sul contatto"}
      ]},
    {key:"filtro", o:"Parlato con chi filtra · referente da ricontattare", stage:"Zero trattative · nota sul contatto",
      checks:[
        {t:"Ho salvato il nome del referente, se disponibile: {titolare|—}"},
        {t:"Ho salvato il recapito diretto, se disponibile: {contatto|—}"},
        {t:"Ho creato il task per ricontattarlo {richiamata|nel momento indicato}"},
        {t:"Ho salvato la nota con il nome di chi ha risposto e le informazioni raccolte"}
      ]},
    {key:"mail", o:"«Mandami una mail» · nessuna data concordata", stage:"Zero trattative · nota sul contatto",
      checks:[
        {t:"Ho inviato l'email con il documento dell'analisi a {recapito|l'indirizzo indicato}, con «Come da telefonata di oggi» in testa"},
        {t:"Ho creato un task interno di follow-up per dopodomani, in una fascia oraria diversa"},
        {t:"Ho salvato la nota della chiamata sul contatto"}
      ]},
    {key:"silenzio", o:"Segreteria / occupato / impossibile raggiungere il referente", stage:"Zero trattative · nota sul contatto",
      checks:[
        {t:"Ho creato il task di richiamata a 2 giorni, in una fascia oraria diversa"},
        {t:"Ho salvato la nota della chiamata sul contatto"}
      ]},
    {key:"no", o:"Rifiuto definitivo / «Non ricontattatemi»", stage:"Zero trattative · nessun task futuro",
      checks:[
        {t:"Ho salvato la nota con il motivo del rifiuto"},
        {t:"Non ho creato ulteriori attività di follow-up"}
      ]},
    {key:"fuori", o:"Fuori settore / progetto senza senso per Agria", stage:"Zero trattative · nota con il motivo",
      checks:[
        {t:"Ho salvato la nota con il motivo, in una riga"},
        {t:"Nessuna trattativa, nessun task futuro"}
      ]}
  ]
},

/* ───────────── OBIEZIONI ───────────── */
o_chi: { kind:"objection", title:"«Ma chi siete? Cosa fate?»", set:{presentato:true},
  say:[
    {t:"you", text:"{nome, |}in sostanza siamo una tech company specializzata esclusivamente nel settore [[delle strutture ricettive|delle cantine|dei frantoi]], in Italia e all'estero. Usiamo l'Intelligenza Artificiale per azzerare il vostro lavoro manuale, moltiplicare la vostra presenza sul web e rendere il business scalabile e autonomo."},
    {t:"you", text:"Ho inviato l'email perché dall'analisi di {azienda} è emerso che {dettaglio}: mi conferma che è ancora così?", when:{noto:false}},
    {t:"you", text:"Per questo le propongo di vedere l'analisi di {azienda} insieme, in videocall: {slotA} oppure {slotB}, le andrebbe bene?", when:{noto:true}}
  ],
  primary:[
    {label:"«Sì, è così»", to:"f3", set:{detto:true, noto:true}, when:{noto:false}},
    {label:"«Non ci interessa»", to:"o_interesse"},
    {label:"«Funziona diversamente»", to:"r_diverso", when:{noto:false}},
    {label:"«Va bene, {slotA}»", to:"f6", copy:{fissato:"slotA"}, when:{noto:true}},
    {label:"«Va bene, {slotB}»", to:"f6", copy:{fissato:"slotB"}, when:{noto:true}},
    {label:"«Un altro momento»", to:"r6_altro", when:{noto:true}}
  ],
  options:[
    {label:"«Quanto costa?»", to:"o_prezzo"},
    {label:"«Abbiamo già chi ci segue»", to:"o_fornitore"},
    {label:"«Mi mandi prima l'analisi»", to:"o_pres"}
  ]
},

o_mail: { kind:"objection", title:"«Mandami una mail»",
  say:[{t:"you", text:"Volentieri. Le invio l'analisi tramite email così valuta con calma dove potrebbe essere utile muoversi prima che lo faccia la concorrenza. A quale indirizzo posso inviarle il documento?"}],
  capture:{key:"recapito", label:"Email che ti dà", placeholder:"info@… / marco@…", go:"o_invio_quando", goLabel:"Prosegui", skip:"Usa l'indirizzo che già hai"},
  options:[{label:"Insiste: «mi mandi la mail e basta»", to:"o_mail_fine"}]
},

o_mail_fine: { kind:"reply", title:"Insiste: «mi mandi la mail e basta»",
  say:[{t:"you", text:"D'accordo. Le invio tutto oggi stesso… Per sentirci dopo che ha avuto modo di guardarlo le andrebbe bene {slotA} oppure preferisce un altro momento?"}],
  capture:{key:"richiamata", label:"Se indica un altro momento: giorno e ora", placeholder:"martedì alle 15", go:"r_fine_pres", goLabel:"Fissa la richiamata", outcome:"email"},
  primary:[
    {label:"«Va bene, {slotA}»", to:"r_fine_pres", copy:{richiamata:"slotA"}, outcome:"email"},
    {label:"«Mi mandi la mail e basta, poi vediamo»", to:"f7", outcome:"mail"}
  ]
},

o_sito: { kind:"objection", title:"«Abbiamo già un sito, siamo a posto»",
  say:[{t:"you", text:"Ottimo.. allora partiamo già da una base. Il punto è capire quanto quel sito sta lavorando davvero per voi: possiamo migliorarlo, renderlo intelligente e aumentare vendite e visibilità anche su ChatGPT o.. Gemini. Mi conferma che oggi il sito vi porta [[prenotazioni|ordini|ordini]] con continuità?"}],
  primary:[
    {label:"«No» / «Poco» / «Non saprei»", to:"f5", area:"presence"},
    {label:"«Sì, funziona bene»", to:"o_sito_ok"},
    {label:"«Non ci interessa»", to:"o_interesse"},
    {label:"«Quanto costa?»", to:"o_prezzo"}
  ]
},

o_sito_ok: { kind:"reply", title:"«Il sito funziona»",
  say:[{t:"you", text:"Sì sì, questo è chiaro… Sicuramente avere un sito è la base! I nostri dubbi, comunque, sono altri: quando poi arriva [[una prenotazione|un ordine|un ordine]], rimane ancora qualche passaggio manuale oppure è già tutto collegato?"}],
  primary:[
    {label:"«C'è ancora qualcosa di manuale»", to:"f5", area:"automation"},
    {label:"«È già tutto collegato»", to:"r4_automatico"},
    {label:"«Non saprei»", to:"o_sito_nonsa"}
  ]
},

o_sito_nonsa: { kind:"reply", title:"«Non saprei» (sul sito)",
  say:[
    {t:"you", text:"Okay.. è proprio uno dei punti che potremmo tranquillamente verificare sull'analisi."},
    {t:"you", text:"Preferisce che li approfondiamo insieme oppure le mando prima il documento con tutti i punti emersi?"}
  ],
  primary:[
    {label:"Vediamoli insieme", to:"r4_proposta"},
    {label:"Mi mandi il documento", to:"r4_documento"}
  ],
  options:[{label:"Non ci interessa", to:"o_interesse"}]
},

o_fornitore: { kind:"objection", title:"«Abbiamo già chi ci segue» / «Ho un'agenzia»",
  say:[{t:"you", text:"Meglio ancora, significa che avete già una struttura attiva! Chi vi segue può tranquillamente continuare a farlo: noi ci affianchiamo come partner tecnologico per implementare quello che manca. Per capire se sono coperti tutti i punti: il sito che avete oggi vi genera già contatti e vendite dirette ogni settimana, in automatico?"},
    {t:"alt", label:"Oppure, se parla di assistenza clienti", text:"Perfetto, quindi avete già un assistente basato su intelligenza artificiale che gestisce le richieste dei clienti e solleva lo staff, anche di notte?"}],
  primary:[
    {label:"«No» / «Non proprio»", to:"o_fornitore_no"},
    {label:"«Sì, anche su questo»", to:"o_fornitore_si"},
    {label:"«Non ci interessa»", to:"o_interesse"},
    {label:"«Abbiamo un contratto»", to:"o_contratto"},
    {label:"«Quanto costa?»", to:"o_prezzo"}
  ]
},

o_fornitore_no: { kind:"reply", title:"«No, non su questa parte»",
  say:[{t:"you", text:"Immaginavo.. accade praticamente a tutti.. È proprio lì che interveniamo: ci affianchiamo a chi vi segue già per implementare quello che manca. Ed è uno dei motivi per cui ho deciso di contattarla. Secondo me avrebbe senso confrontarci sui punti emersi, che ne pensa?"}],
  primary:[
    {label:"Sì, approfondiamo", to:"r1_proposta"},
    {label:"Non ci interessa", to:"o_interesse"},
    {label:"Mi mandi prima l'analisi", to:"o_pres"},
    {label:"Preferisco guardarmela prima", to:"o_pres"},
    {label:"Non voglio fissare nulla adesso", to:"o_pres"}
  ]
},

o_fornitore_si: { kind:"reply", title:"«Sì, anche su questo»",
  say:[
    {t:"you", text:"Ottimo, ottimo.. allora siete già strutturati. A maggior ragione avrebbe senso confrontare quello che state già facendo con ciò che abbiamo rilevato su {azienda}."},
    {t:"you", text:"Preferisce approfondirlo insieme oppure le mando prima l'analisi?"}
  ],
  primary:[
    {label:"Approfondiamolo insieme", to:"r1_proposta"},
    {label:"Mi mandi l'analisi", to:"o_pres"},
    {label:"Adesso non è il momento", to:"o_pres"},
    {label:"Non ci interessa", to:"o_interesse"}
  ]
},

o_adv: { kind:"objection", title:"«Abbiamo già un'agenzia marketing» / «Abbiamo ADV in corso»",
  say:[
    {t:"you", text:"Questo è ottimo! Avete anche chi vi segue sul marketing. Consideri che noi lavoriamo sul digitale per farvi perdere meno tempo nella gestione e aumentare [[prenotazioni|ordini|ordini]] diretti, intervenendo sul sito che avete già o rifacendolo quando serve, anche tramite l'AI. Chi vi segue oggi lavora anche su questo?", when:{sito:["si","vecchio"]}},
    {t:"you", text:"Questo è ottimo! Avete anche chi vi segue sul marketing. Consideri che noi lavoriamo sul digitale per ridurre il lavoro interno e aumentare gli ordini diretti, intervenendo su sito ed e-commerce dove serve e sfruttando anche l'AI. Chi vi segue oggi lavora anche su questo?", when:{sito:"ecommerce"}},
    {t:"you", text:"Questo è ottimo! Avete anche chi vi segue sul marketing. Consideri che noi lavoriamo sul digitale per ridurre il lavoro interno e portarvi più clienti diretti, realizzando ciò che serve e lavorando anche sulla presenza nei sistemi AI. Chi vi segue oggi si occupa anche di questo?", when:{sito:"no"}}
  ],
  primary:[
    {label:"«No» / «Non proprio»", to:"o_adv_no"},
    {label:"«Sì, anche su questo»", to:"o_adv_si"},
    {label:"«Non ci interessa»", to:"o_interesse"},
    {label:"«Abbiamo un contratto»", to:"o_contratto"},
    {label:"«Quanto costa?»", to:"o_prezzo"}
  ]
},

o_adv_no: { kind:"reply", title:"«No, non su questa parte» (agenzia marketing)",
  say:[{t:"you", text:"Ecco, è proprio lì che possiamo affiancare chi vi segue già. Ed è uno dei motivi per cui ho deciso di contattarla. Secondo me avrebbe senso confrontarci sui punti emersi, che ne pensa?"}],
  primary:[
    {label:"Sì, approfondiamo", to:"r1_proposta"},
    {label:"Non ci interessa", to:"o_interesse"},
    {label:"Mi mandi prima l'analisi", to:"o_pres"},
    {label:"Adesso non voglio fissare", to:"o_pres"}
  ]
},

o_adv_si: { kind:"reply", title:"«Sì, anche su questo» (agenzia marketing)",
  say:[
    {t:"you", text:"Ottimo, allora siete già strutturati... A mio parere avrebbe senso confrontare quello che state già facendo con le mancanze rilevate sulla vostra attività."},
    {t:"you", text:"Preferisce approfondirlo insieme oppure vedere prima l'analisi?"}
  ],
  primary:[
    {label:"Approfondiamolo insieme", to:"r1_proposta"},
    {label:"Mi mandi l'analisi", to:"o_pres"},
    {label:"Non è il momento", to:"o_pres"},
    {label:"Non ci interessa", to:"o_interesse"}
  ]
},

o_contratto: { kind:"objection", title:"«Abbiamo un contratto di uno o due anni»",
  say:[{t:"you", text:"Guardi, il contratto può tranquillamente restare. Il punto è capire se oggi chi vi segue sta realmente portando meno lavoro manuale e soprattutto più clienti diretti.. Su questo siete già coperti?"}],
  primary:[
    {label:"«No» / «Non proprio»", to:"o_contratto_no"},
    {label:"«Sì, anche su questo»", to:"o_contratto_si"},
    {label:"«Non ci interessa»", to:"o_interesse"},
    {label:"«Aspettiamo la scadenza»", to:"o_contratto_scad"},
    {label:"«Quanto costa?»", to:"o_prezzo"}
  ]
},

o_contratto_no: { kind:"reply", title:"«Non siamo coperti su questa parte»",
  say:[
    {t:"you", text:"Mhm, ho capito… Mi ascolti: senza toccare ciò che avete già, possiamo affiancarvi proprio sulla parte che oggi manca, per farvi perdere meno tempo e aumentare [[prenotazioni|ordini|ordini]] diretti. Per questo ha senso confrontarci secondo me sui punti emersi dall'analisi: quando sarebbe disponibile eventualmente?"}
  ],
  primary:[
    {label:"Propone giorno / orario", to:"f6"},
    {label:"Vuole prima il documento", to:"o_pres"},
    {label:"Un altro momento", to:"r6_altro"},
    {label:"Non ci interessa", to:"o_interesse"}
  ]
},

o_contratto_si: { kind:"reply", title:"«Siamo coperti anche su questo»",
  say:[
    {t:"you", text:"Ahah, direi che siete ben strutturati. A questo punto vediamo se dall'analisi è emerso qualcosa in più rispetto a quello che state già facendo: preferisce approfondirlo insieme o vedere prima l'analisi?"}
  ],
  primary:[
    {label:"Approfondiamo insieme", to:"r1_proposta"},
    {label:"Mi mandi l'analisi", to:"o_pres"},
    {label:"Non ci interessa", to:"o_interesse"}
  ]
},

o_contratto_scad: { kind:"reply", title:"«Aspettiamo la scadenza»",
  say:[{t:"you", text:"Va benissimo.. Posso chiederle più o meno quando scade? Così mi segno di risentirla nel momento giusto, quando avrà senso fare un confronto."}],
  capture:{key:"richiamata", label:"Mese della scadenza", placeholder:"a settembre"},
  after:{
    say:[
      {t:"you", text:"D'accordissimo, allora mi segno di risentirla in quel periodo."},
      {t:"alt", label:"Per chiudere", text:"Grazie{ nome|} del tempo dedicato, buon lavoro e arrivederci."}
    ],
    primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"richiamata"}]
  }
},

o_interesse: { kind:"objection", title:"«Non ci interessa» / «Non è il momento»", open:true,
  say:[
    {t:"you", text:"Guardi… da imprenditore le dico che oggi restare indietro sul digitale significa lasciare spazio ai concorrenti. Se mi dà la possibilità le invio l'analisi su {azienda}, così può approfondire con calma le mancanze che le ho anticipato.", when:{visto:false}},
    {t:"you", text:"Guardi… da imprenditore le dico che oggi restare indietro sul digitale significa lasciare spazio ai concorrenti. Se mi dà la possibilità, le invio tranquillamente l'analisi completa su {azienda}, così può approfondire con calma i punti che le ho anticipato.", when:{visto:true}},
  ],
  primary:[
    {label:"«Va bene, me la mandi»", to:"o_interesse_accetta"},
    {label:"«In realtà possiamo approfondire»", to:"r1_proposta"},
    {label:"«Risentiamoci più avanti»", to:"o_piuavanti"},
    {label:"«No, grazie» / «Lasci stare»", to:"o_interesse_fine"}
  ]
},

o_interesse_accetta: { kind:"reply", title:"«Accetta l'analisi»", skipLabel:"Usa email già presente",
  say:[{t:"you", text:"Ottima scelta.. A quale indirizzo preferisce riceverla?"}],
  captures:[{key:"recapito", label:"Email", placeholder:"info@… / marco@…"}],
  anyOf:true,
  after:{
    say:[{t:"you", text:"D'accordo, gliela invio oggi stesso. Se mi dà un giorno o un orario per risentirci e confrontarci sui punti dell'analisi me lo segno."}],
    captures:[
      {key:"rgiorno", label:"Giorno", placeholder:"martedì"},
      {key:"rora", label:"Ora / fascia oraria", placeholder:"15 / tardo pomeriggio"}
    ],
    say2:[{t:"you", text:"Benissimo. Ci risentiamo {richiamata}, dopo che avrà avuto modo di vedere l'analisi. Grazie{ nome|} del tempo dedicato, buon lavoro e arrivederci."}],
    primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"email"}]
  }
},

o_interesse_fine: { kind:"reply", title:"«No, grazie»", open:true,
  say:[
    {t:"you", text:"Capisco, capisco… {nome}, consideri che restare fermi su questi aspetti significa lasciare spazio a chi si muove prima. Se mi dà un ok le invio l'analisi che abbiamo fatto su {azienda}, così può valutare con calma i punti emersi.", when:{nome:true}},
    {t:"you", text:"Capisco, capisco… consideri che restare fermi su questi aspetti significa lasciare spazio a chi si muove prima. Se mi dà un ok le invio l'analisi che abbiamo fatto su {azienda}, così può valutare con calma i punti emersi.", when:{nome:false}}
  ],
  primary:[
    {label:"«Va bene, me la mandi»", to:"o_interesse_invio"},
    {label:"«No, lasci stare»", to:"o_interesse_no"}
  ]
},

o_interesse_no: { kind:"reply", title:"Secondo «no»: chiusura cordiale",
  say:[
    {t:"you", text:"{nome}, la ringrazio per il tempo dedicato e rimango a disposizione qualora più avanti volesse aggiornare il lato digitale dell'attività. Buon lavoro e arrivederci.", when:{nome:true}},
    {t:"you", text:"La ringrazio per il tempo dedicato e rimango a disposizione qualora più avanti volesse aggiornare il lato digitale dell'attività. Buon lavoro e arrivederci.", when:{nome:false}}
  ],
  primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"no"}]
},

o_interesse_invio: { kind:"reply", title:"«Invio analisi» (dopo il no)", skipLabel:"Usa recapito già presente",
  say:[{t:"you", text:"Benissimo. A quale indirizzo preferisce riceverla?"}],
  captures:[{key:"recapito", label:"Email", placeholder:"info@… / marco@…"}],
  anyOf:true,
  after:{
    say:[{t:"you", text:"Segnato tutto. Gliela invio oggi e la risento {slotA}, così mi dice come intende proseguire, va bene?"}],
    primary:[
      {label:"«Va bene»", to:"o_interesse_ok", copy:{richiamata:"slotA"}, outcome:"email"},
      {label:"«Preferisco un altro momento»", to:"o_interesse_altro"},
      {label:"«Le faccio sapere io»", to:"r6_fare_sapere"},
      {label:"«Preferisco non essere ricontattato»", to:"o_no_fine"}
    ]
  }
},

o_interesse_altro: { kind:"reply", title:"«Un altro momento» (dopo il no)",
  say:[{t:"you", text:"Per sentirci nel momento giusto le chiedo una disponibilità e lo appunto."}],
  capture:{key:"richiamata", label:"Giorno e ora che ti dice", placeholder:"martedì alle 15", go:"o_interesse_ok", goLabel:"Fissa la richiamata", outcome:"email"}
},

o_interesse_ok: { kind:"reply", title:"Richiamata fissata (analisi in arrivo)",
  say:[{t:"you", text:"Segnato. Le invio l'analisi oggi e ci sentiamo {richiamata}. Grazie ancora{ nome|} del tempo dedicato, le auguro buon lavoro e arrivederci."}],
  primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"email"}]
},

o_no_fine: { kind:"reply", title:"«No, lasci stare» / «Non mi ricontatti»",
  say:[
    {t:"you", text:"Va benissimo... Le lascio comunque i miei contatti: {commerciale} di Agria System. {nome}, grazie del tempo dedicato, le auguro buon lavoro e arrivederci.", when:{nome:true}},
    {t:"you", text:"Va benissimo... Le lascio comunque i miei contatti: {commerciale} di Agria System. Grazie del tempo dedicato, le auguro buon lavoro e arrivederci.", when:{nome:false}}
  ],
  primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"no"}]
},

o_budget: { kind:"objection", title:"«Zero budget» / «Costa troppo»",
  say:[
    {t:"you", text:"Dunque{, nome|}, consideri che tra lavoro manuale, tempo perso nella gestione e un sito che potrebbe portarvi più [[prenotazioni|ordini|ordini]] diretti, un costo lo state già sostenendo. E nel frattempo chi si muove prima prende spazio… Inoltre con noi siete liberi: si continua perché il lavoro funziona.", when:{sito:["si","vecchio"]}},
    {t:"you", text:"Dunque{, nome|}, consideri che tra lavoro manuale, tempo perso nella gestione e sito ed e-commerce che potrebbero generare più ordini diretti, un costo lo state già sostenendo. E nel frattempo chi si muove prima prende spazio. Inoltre con noi siete liberi: si continua perché il lavoro funziona.", when:{sito:"ecommerce"}},
    {t:"you", text:"Dunque{, nome|}, consideri una cosa: tra lavoro manuale, tempo perso nella gestione e opportunità che oggi vi sfuggono sul web, un costo lo state già sostenendo. E nel frattempo chi si muove prima prende spazio. Inoltre con noi siete liberi: si continua perché il lavoro funziona.", when:{sito:"no"}},
    {t:"you", text:"Prima di parlare di investimenti direi di approfondire le mancanze emerse per {azienda}. Se può interessarle mi dia pure una sua disponibilità."}
  ],
  primary:[
    {label:"Propone giorno / orario", to:"f6"},
    {label:"«Preferisce un altro momento»", to:"r6_altro"},
    {label:"«Davvero non abbiamo budget»", to:"o_budget_zero"},
    {label:"«Quanto costa, più o meno?»", to:"o_prezzo"}
  ],
  options:[
    {label:"«Mi mandi prima l'analisi»", to:"o_pres"},
    {label:"«Devo parlarne con il socio / titolare»", to:"r6_socio"},
    {label:"«Vincolate?» / «Fate dei contratti?»", to:"o_vincoli"},
    {label:"«Non è il momento»", to:"o_piuavanti"},
    {label:"«Non ci interessa»", to:"o_interesse"},
    {label:"«No, grazie»", to:"o_interesse_fine"}
  ]
},

o_budget_zero: { kind:"reply", title:"«Davvero zero fondi»", open:true,
  say:[{t:"you", text:"Dato che si parla di un investimento secondo me ha senso capire se ci sono punti su cui state già perdendo altri soldi o tempo. Se mi dà l'ok, le invio l'analisi e poi ci confrontiamo su quello che emerge."}],
  primary:[
    {label:"«Va bene»", to:"o_budget_invio"},
    {label:"«Preferisco risentirci più avanti»", to:"o_budget_altro"},
    {label:"«No, grazie»", to:"o_interesse_fine"},
    {label:"«Preferisco non essere ricontattato»", to:"o_no_fine"}
  ]
},

o_budget_invio: { kind:"reply", title:"«Invio analisi» (zero budget)", skipLabel:"Usa email già presente",
  say:[{t:"you", text:"Perfetto.. a quale indirizzo email preferisce che gliela invii?"}],
  captures:[{key:"recapito", label:"Email", placeholder:"info@… / marco@…"}],
  anyOf:true,
  after:{
    say:[{t:"you", text:"Benissimo, gliela invio oggi. Quando sarebbe disponibile per risentirci e valutare la situazione insieme?"}],
    captures:[
      {key:"rgiorno", label:"Giorno", placeholder:"martedì"},
      {key:"rora", label:"Ora / fascia oraria", placeholder:"15 / mattina"}
    ],
    say2:[{t:"you", text:"D'accordo, allora ci risentiamo {richiamata}. Nel frattempo avrà modo di vedere l'analisi con calma. Grazie ancora{ nome|} del tempo dedicato, buon lavoro e arrivederla."}],
    primary:[{label:"Chiamata conclusa → HubSpot (nota: budget al momento fermo)", to:"f7", outcome:"email"}]
  }
},

o_budget_altro: { kind:"reply", title:"«Un altro momento» (zero budget)",
  say:[{t:"you", text:"D'accordo. Quando le torna più comodo?"}],
  captures:[
    {key:"rgiorno", label:"Giorno", placeholder:"martedì"},
    {key:"rora", label:"Ora", placeholder:"15"}
  ],
  anyOf:true,
  after:{
    say:[{t:"you", text:"Benissimo, ho segnato tutto. Le invio l'analisi oggi e ci sentiamo {richiamata}. Grazie{ nome|} del tempo dedicato, buon lavoro e arrivederla."}],
    captures:[{key:"recapito", label:"Recapito per l'analisi · se lo hai già, resta quello", placeholder:"info@… / 333 …"}],
    primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"email"}]
  }
},

o_prezzo: { kind:"objection", title:"«Quanto costa?»",
  say:[
    {t:"you", text:"Mhh{, nome|}… il punto è capire quanto può crescere l'azienda: meno lavoro manuale, più clienti e vendite dirette dal sito. Da lì definiamo l'investimento giusto."},
    {t:"you", text:"Le mostro l'analisi che abbiamo fatto su {azienda} e valutiamo cosa ha realmente senso fare. Le torna meglio {slotA} o {slotB}?"}
  ],
  primary:[
    {label:"«Va bene, {slotA}»", to:"f6", copy:{fissato:"slotA"}},
    {label:"«Va bene, {slotB}»", to:"f6", copy:{fissato:"slotB"}},
    {label:"«Quanto costa più o meno?»", to:"o_prezzo_insiste"},
    {label:"«Senza una cifra lascio stare»", to:"o_prezzo_fine"},
    {label:"«Zero budget» / «Non abbiamo fondi»", to:"o_budget_zero"}
  ],
  options:[
    {label:"«Mi mandi prima l'analisi»", to:"o_pres"},
    {label:"«Un altro momento»", to:"r6_altro"}
  ]
},

o_prezzo_insiste: { kind:"reply", title:"«Insiste sul prezzo»",
  say:[
    {t:"you", text:"Capisco che voglia una cifra esatta.. Farlo significherebbe parlare senza sapere quanto possiamo realmente migliorare la situazione. Prima vediamo l'analisi, poi le do un investimento preciso."},
    {t:"you", text:"Le torna meglio {slotA} o {slotB}?"}
  ],
  primary:[
    {label:"«Va bene, {slotA}»", to:"f6", copy:{fissato:"slotA"}},
    {label:"«Va bene, {slotB}»", to:"f6", copy:{fissato:"slotB"}},
    {label:"«Senza una cifra lascio stare»", to:"o_prezzo_fine"},
    {label:"«Mi mandi prima l'analisi»", to:"o_pres"},
    {label:"«Zero budget»", to:"o_budget_zero"}
  ]
},

o_prezzo_fine: { kind:"reply", title:"«Senza una cifra lascio stare»", skipLabel:"Usa recapito già presente",
  say:[
    {t:"you", text:"Mi è chiaro.. facciamo una cosa: le invio l'analisi su {azienda}, così vede dove c'è margine di crescita. Quando mi richiama, parleremo di investimenti."},
    {t:"you", text:"A quale indirizzo posso inviarla eventualmente?"}
  ],
  captures:[{key:"recapito", label:"Email", placeholder:"info@… / marco@…"}],
  anyOf:true,
  after:{
    say:[{t:"you", text:"Tutto segnato. Gliela invio oggi e, se per lei va bene, la risento {slotA} così mi dice come intende investire per rinnovare il lato digitale, d'accordo?"}],
    primary:[
      {label:"«Va bene»", to:"r_fine_pres", copy:{richiamata:"slotA"}, outcome:"email"},
      {label:"«Preferisco un altro momento»", to:"r_richiamo_altro"},
      {label:"«Le faccio sapere io»", to:"r6_fare_sapere"},
      {label:"«No, lasci stare»", to:"o_no_fine"}
    ]
  }
},

o_tempo: { kind:"objection", title:"«Poco tempo» / «Poco pratici con la tecnologia»",
  say:[
    {t:"you", text:"Mi ascolti: la tecnologia deve togliervi lavoro e semplificarlo. AI e automazioni servono proprio a questo. Se mi dà conferma le mostro l'analisi e insieme valutiamo come rivoluzionare {azienda}. Quando sarebbe disponibile?"}
  ],
  primary:[
    {label:"Propone giorno / orario", to:"f6"},
    {label:"«Va bene, {slotA}»", to:"f6", copy:{fissato:"slotA"}},
    {label:"«Va bene, {slotB}»", to:"f6", copy:{fissato:"slotB"}},
    {label:"«Adesso siamo in stagione»", to:"o_stagione"},
    {label:"«Mi mandi prima l'analisi»", to:"o_pres"}
  ],
  options:[
    {label:"«Un altro momento»", to:"r6_altro"},
    {label:"«Non ci interessa»", to:"o_interesse"}
  ]
},

o_stagione: { kind:"reply", title:"«Adesso siamo in stagione»",
  say:[{t:"you", text:"Beh, è proprio quando il lavoro aumenta che automazioni ed intelligenza artificiale possono fare la differenza. Le mando l'analisi e se per lei va bene ci risentiamo appena siete più liberi, d'accordo?"}],
  primary:[
    {label:"«Va bene» → indica il periodo", to:"o_pa_stagione"},
    {label:"«Mi mandi solo l'analisi»", to:"o_pa_invio"},
    {label:"«No, grazie»", to:"o_interesse_fine"}
  ]
},

o_ai: { kind:"objection", title:"«L'AI a noi serve poco» / «Siamo contro»",
  say:[
    {t:"you", text:"Infatti noi la usiamo per aiutare le aziende a ridurre il lavoro manuale e generare più clienti diretti. Il punto è che oggi il vantaggio va a chi sfrutta questi strumenti per primo…"},
    {t:"you", text:"Sull'analisi di {azienda} le mostro dove poter intervenire per ottenere questi risultati. Quando le torna più comodo?"}
  ],
  primary:[
    {label:"Propone giorno / orario", to:"f6"},
    {label:"«Mi mandi prima l'analisi»", to:"o_pres"},
    {label:"«Non ci interessa comunque»", to:"o_interesse"},
    {label:"Ho dubbi su dati / privacy / funzionamento", to:"o_tecnico"},
    {label:"«Un altro momento»", to:"r6_altro"}
  ]
},

o_tecnico: { kind:"objection", title:"Domanda tecnica", open:true,
  say:[{t:"you", text:"Su questo preferisco che la risposta precisa gliela dia il team, perché la parte tecnica è di loro competenza. Dietro ogni progetto c'è un team che segue lo sviluppo. Durante il lavoro avrete comunque un unico referente che coordina tutto e vi segue passo passo."}],
  primary:[
    {label:"«Si collega al mio gestionale?»", to:"o_tec_gestionale"},
    {label:"«Che tecnologia usate?»", to:"o_tec_tecnologia"},
    {label:"«I dati e il sito restano miei?»", to:"o_tec_dati"},
    {label:"«Quanto ci mettete?»", to:"o_tec_tempi"},
    {label:"«Fate anche loghi, foto, social?»", to:"o_tec_loghi"}
  ],
  options:[
    {label:"Qualsiasi altra domanda tecnica", to:"o_tec_altro"},
    {label:"«Quanto costa?»", to:"o_prezzo"}
  ]
},

o_tec_gestionale: { kind:"reply", title:"«Si collega al mio gestionale?»",
  say:[{t:"you", text:"Su questo le confermo che partiamo da quello che avete già, teniamo ciò che funziona e colleghiamo quello che serve. Che gestionale utilizzate?"}],
  capture:{key:"gestionale", label:"Nome gestionale", placeholder:"es. Scrigno / Beddy / Danea…"},
  after:{
    say:[
      {t:"you", text:"Interessante, interessante… Me lo segno e faccio verificare tutto al team su come possiamo lavorarci in simultanea."},
      {t:"you", text:"Direi di approfondire questo concetto insieme ai punti emersi dall'analisi della vostra azienda. Se mi dà una disponibilità me lo segno subito."}
    ],
    primary:[
      {label:"Propone giorno / orario", to:"f6"},
      {label:"Prima voglio sapere se si collega davvero", to:"o_tec_gest_verifica"},
      {label:"Non voglio cambiare gestionale", to:"o_tec_gest_no"},
      {label:"Come funzionerebbe?", to:"o_tec_gest_come"}
    ],
    options:[
      {label:"Quanto costa?", to:"o_prezzo"},
      {label:"Mi mandi prima qualcosa", to:"o_pres"}
    ]
  }
},

o_tec_gest_verifica: { kind:"reply", title:"«Prima voglio sapere se si collega davvero»",
  say:[{t:"you", text:"È giusto che me lo chieda. Prima faccio verificare direttamente {gestionale|il vostro gestionale} dal team, così la ricontatto con una risposta precisa. Se mi dà una disponibilità mi segno di ricontattarla e nel frattempo le invio l'analisi fatta così può studiarsela."}],
  captures:[
    {key:"rgiorno", label:"Giorno", placeholder:"martedì"},
    {key:"rora", label:"Ora / fascia", placeholder:"15 / mattina"}
  ],
  anyOf:true,
  after:{
    say:[
      {t:"you", text:"D'accordo, allora la ricontatto {richiamata} con il riscontro del team e riprendiamo da lì."},
      {t:"alt", label:"Per chiudere", text:"Grazie{ nome|} del tempo dedicato, buon lavoro e arrivederci."}
    ],
    captures:[{key:"recapito", label:"Recapito per l'analisi · se lo hai già, resta quello", placeholder:"info@… / 333 …"}],
    primary:[{label:"Chiamata conclusa → HubSpot (verifica interna + analisi)", to:"f7", outcome:"email"}]
  }
},

o_tec_gest_no: { kind:"reply", title:"«Non voglio cambiare gestionale»", open:true,
  say:[
    {t:"you", text:"{nome}, se quello che avete funziona, resta esattamente com'è. Noi interveniamo dove serve, collegando meglio gli strumenti e togliendo passaggi manuali.", when:{nome:true}},
    {t:"you", text:"Se quello che avete funziona, resta esattamente com'è. Noi interveniamo dove serve, collegando meglio gli strumenti e togliendo passaggi manuali.", when:{nome:false}},
    {t:"you", text:"Se mi dà conferma, le invio intanto l'analisi con i punti emersi. Poi mi indica quando sarebbe disponibile per risentirci e valutiamo insieme ciò che ha davvero senso migliorare."}
  ],
  primary:[
    {label:"Va bene, me la mandi", to:"o_pres"},
    {label:"Non ci interessa", to:"o_interesse"},
    {label:"Propone giorno / orario", to:"f6"}
  ]
},

o_tec_gest_come: { kind:"reply", title:"«Come funzionerebbe?»", open:true,
  say:[{t:"you", text:"Qui preferisco restare fuori dal tecnico, per evitare una risposta approssimativa. Faccio verificare il gestionale al team e nell'approfondimento le mostriamo esattamente cosa si può collegare e cosa no."}],
  primary:[{label:"Prosegui → approfondire con il team", to:"o_tecnico_proposta"}]
},

o_tec_tecnologia: { kind:"reply", title:"«Che tecnologia usate?»", open:true,
  say:[
    {t:"you", text:"Usiamo tecnologie moderne, solide e performanti. Il team tecnico sceglie quelle più adatte al progetto, puntando su velocità, stabilità e possibilità di crescita."},
    {t:"you", text:"Nell'approfondimento possiamo mostrarle anche cosa utilizzeremmo concretamente per {azienda}."}
  ],
  primary:[{label:"Prosegui → approfondire con il team", to:"o_tecnico_proposta"}]
},

o_tec_dati: { kind:"reply", title:"«I dati e il sito restano miei?»", open:true,
  say:[
    {t:"you", text:"Assolutamente sì. Sito, codice, dati, account e accessi restano vostri: tutto rimane intestato a voi. Lavoriamo con i permessi necessari e il controllo rimane sempre vostro."},
    {t:"you", text:"Quindi su questo può stare tranquillo. A quel punto possiamo concentrarci esclusivamente su cosa vale la pena migliorare su {azienda}."}
  ],
  primary:[{label:"Prosegui → approfondire con il team", to:"o_tecnico_proposta"}]
},

o_tec_tempi: { kind:"reply", title:"«Quanto ci mettete?»", open:true,
  say:[
    {t:"you", text:"Guardi, la tempistica la definiamo con precisione nell'approfondimento. In genere parliamo di 2–3 settimane per interventi web e 4–8 settimane per progetti più complessi, in base al lavoro da fare."},
    {t:"you", text:"Sull'analisi di {azienda} possiamo darle una tempistica più precisa."}
  ],
  primary:[{label:"Prosegui → approfondire con il team", to:"o_tecnico_proposta"}]
},

o_tec_loghi: { kind:"reply", title:"«Fate anche loghi, foto, social?»", open:true,
  say:[
    {t:"you", text:"I social li lasciamo a chi fa comunicazione: il nostro lavoro è un altro. Per logo, foto e parte visiva valutiamo invece cosa serve davvero all'interno del progetto e lo definiamo insieme nella videocall o nell'incontro conoscitivo."},
    {t:"you", text:"Così le diciamo subito cosa ha senso includere per {azienda} e cosa invece sarebbe inutile."}
  ],
  primary:[{label:"Prosegui → approfondire con il team", to:"o_tecnico_proposta"}]
},

o_tec_altro: { kind:"reply", title:"Qualsiasi altra domanda tecnica", open:true,
  say:[{t:"you", text:"Su questo preferisco essere preciso, perché è l'area del team tecnico: me la segno e la faccio verificare direttamente da loro, così le diamo una risposta certa."}],
  capture:{key:"appunti", label:"Domanda tecnica del cliente", placeholder:"vuole sapere se…"},
  after:{
    say:[{t:"you", text:"Perfetto, me la sono segnata. La approfondiamo insieme durante l'analisi di {azienda}."}],
    primary:[{label:"Prosegui → approfondire con il team", to:"o_tecnico_proposta"}]
  }
},

o_tecnico_proposta: { kind:"reply", title:"Approfondire con il team",
  say:[
    {t:"you", text:"A questo punto direi che ha senso approfondire direttamente questi punti. Visto che siete {azona}, possiamo anche vederci di persona; in alternativa fissiamo una videocall. Quando le torna più comodo?", when:{umbria:true}},
    {t:"you", text:"A questo punto direi che ha senso approfondire direttamente questi punti fissando una videocall, analizzando i punti che ho riscontrato su {azienda}. Quando le sarebbe più comodo?", when:{umbria:false}}
  ],
  primary:[
    {label:"Propone giorno / orario", to:"f6"},
    {label:"Preferisce un altro momento", to:"r6_altro"},
    {label:"Mi mandi prima l'analisi", to:"o_pres"},
    {label:"Prima voglio parlarne con il socio / titolare", to:"r6_socio"},
    {label:"Fa un'altra domanda tecnica", to:"o_tecnico", loop:true}
  ],
  options:[
    {label:"Quanto costa?", to:"o_prezzo"},
    {label:"Vincolate? / Fate dei contratti?", to:"o_vincoli"},
    {label:"Non ci interessa / Non è il momento", to:"o_interesse"}
  ]
},

o_gestionale: { kind:"objection", title:"«Ci servirebbe un gestionale fatto per noi»",
  say:[
    {t:"you", text:"Possiamo valutarlo, e partiamo sempre da quello che serve davvero prima di costruire un gestionale da zero. Prima capiamo cosa manca: spesso riusciamo a ottenere il risultato lavorando sugli strumenti che avete già. Se invece c'è un progetto più importante da sviluppare, lo valutiamo con il team."},
    {t:"you", text:"Mi dica in una frase cosa dovrebbe fare per voi."}
  ],
  capture:{key:"appunti", label:"Esigenza del cliente", placeholder:"gestire ordini dei ristoranti / listini diversi / prenotazioni / clienti / spedizioni…"},
  after:{
    say:[
      {t:"you", text:"Ok, lo farò valutare dal team così capiamo se ha senso sviluppare qualcosa di dedicato oppure se possiamo arrivare allo stesso risultato in modo più semplice."},
      {t:"you", text:"Direi che vale la pena approfondirlo insieme agli altri punti emersi sull'attività. Quando le sarebbe più comodo?"}
    ],
    primary:[
      {label:"Propone giorno / orario", to:"f6"},
      {label:"Prima voglio sapere se è fattibile", to:"o_gest_verifica"},
      {label:"Mi mandi prima l'analisi", to:"o_pres"},
      {label:"Preferisco un altro momento", to:"r6_altro"}
    ]
  }
},

o_gest_verifica: { kind:"reply", title:"«Verifica tecnica»",
  say:[{t:"you", text:"Dunque{, nome|}, questo punto lo farei verificare direttamente al team, così le diamo una risposta precisa. Nel frattempo se mi dà l'ok e una disponibilità direi di fissare una videocall così da analizzare insieme le mancanze riscontrate.. Cosa ne pensa?"}],
  primary:[
    {label:"Propone giorno / orario", to:"f6"},
    {label:"Prima voglio la risposta tecnica", to:"o_gest_prima"},
    {label:"Mi mandi prima l'analisi", to:"o_pres"},
    {label:"Preferisco un altro momento", to:"r6_altro"},
    {label:"Fa un'altra domanda tecnica", to:"o_tecnico", loop:true}
  ],
  options:[
    {label:"Quanto costa?", to:"o_prezzo"},
    {label:"Non è il momento", to:"o_piuavanti"}
  ]
},

o_gest_prima: { kind:"reply", title:"«Prima la verifica»",
  say:[{t:"you", text:"Allora ascolti: faccio verificare prima questo punto e, quando la ricontatto, le porto direttamente il riscontro insieme ai punti dell'analisi, così valutiamo tutto in una volta. Se mi dà una disponibilità me lo segno subito."}],
  captures:[
    {key:"rgiorno", label:"Giorno", placeholder:"martedì"},
    {key:"rora", label:"Ora / fascia oraria", placeholder:"15 / mattina"}
  ],
  anyOf:true,
  after:{
    say:[
      {t:"you", text:"D'accordo, allora la ricontatto {richiamata} con il riscontro del team e riprendiamo da lì."},
      {t:"alt", label:"Per chiudere", text:"Grazie{ nome|} del tempo dedicato, buon lavoro e arrivederci."}
    ],
    primary:[{label:"Chiamata conclusa → HubSpot (verifica interna)", to:"f7", outcome:"richiamata"}]
  }
},

o_piuavanti: { kind:"objection", title:"«Ci penso» / «Risentiamoci più avanti»", open:true,
  say:[
    {t:"you", text:"Mmh, va bene. Le dico una cosa: aspettare significa lasciare spazio a chi si muove prima. Se mi dà l'ok, le invio l'analisi via email, così può valutare con calma i punti su cui oggi {azienda} può fare un passo avanti."},
    {t:"alt", label:"Se accetta di ricevere l'analisi", text:"Bene. Quando sarebbe disponibile per risentirci e valutare insieme i punti dell'analisi su {azienda}?"}
  ],
  primary:[
    {label:"Indica giorno / orario", to:"o_pa_data"},
    {label:"Mi richiami dopo la stagione", to:"o_pa_stagione"},
    {label:"Prima mi mandi l'analisi", to:"o_pa_invio"},
    {label:"Non so, più avanti", to:"o_pa_periodo"},
    {label:"Guardi, lasci stare", to:"o_no_fine"}
  ]
},

o_pa_data: { kind:"reply", title:"«Data concordata»",
  say:[{t:"alt", label:"Segna quello che dice", text:"Il cliente indica giorno e ora: scrivili qui sotto."}],
  captures:[
    {key:"rgiorno", label:"Giorno", placeholder:"martedì 21"},
    {key:"rora", label:"Ora", placeholder:"10"}
  ],
  anyOf:true,
  after:{
    say:[{t:"you", text:"D'accordo. A quale indirizzo email preferisce che invii l'analisi?"}],
    captures:[{key:"recapito", label:"Email · se la hai già, resta quella", placeholder:"info@… / marco@…"}],
    say2:[{t:"you", text:"Ok, gliela invio oggi. Allora la ricontatto {richiamata}, così riprendiamo direttamente i punti dell'analisi e li valutiamo insieme. Grazie{ nome|}, buon lavoro e arrivederla."}],
    primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"email"}]
  }
},

o_pa_stagione: { kind:"reply", title:"«Dopo la stagione» / periodo concordato",
  say:[{t:"you", text:"Va benissimo, mi indica gentilmente più o meno da quale settimana o mese preferisce che la ricontatti?"}],
  capture:{key:"richiamata", label:"Periodo concordato", placeholder:"da metà novembre"},
  after:{
    say:[{t:"you", text:"D'accordo. Le invio intanto l'analisi via email così quando ci risentiamo avrà già avuto modo di valutarla… Le chiedo un recapito o un indirizzo email."}],
    captures:[{key:"recapito", label:"Email · se la hai già, resta quella", placeholder:"info@… / marco@…"}],
    say2:[{t:"you", text:"Segnato tutto. Gliela invio oggi e mi segno di ricontattarla a partire da {richiamata}, così riprendiamo i punti dell'analisi su {azienda}. Grazie{ nome|}, buon lavoro e arrivederla."}],
    primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"email"}]
  }
},

o_pa_periodo: { kind:"reply", title:"«Periodo da definire»",
  say:[{t:"you", text:"Allora{, nome|}, mi dia una disponibilità: preferisce in questi giorni, prossima settimana oppure il prossimo mese?"}],
  primary:[
    {label:"Indica un periodo", to:"o_pa_stagione"},
    {label:"Continua: «non lo so, più avanti»", to:"o_pa_insiste"}
  ]
},

o_pa_insiste: { kind:"reply", title:"Insiste: «non lo so, più avanti»",
  say:[{t:"you", text:"Ok, facciamo così: le invio l'analisi e lascio a lei un po' di tempo per valutarla. Eventualmente posso ricontattarla tra qualche settimana per capire se vale la pena approfondire?"}],
  primary:[
    {label:"Sì → definisci la settimana", to:"o_pa_stagione"},
    {label:"No", to:"o_pa_solo"}
  ]
},

o_pa_solo: { kind:"reply", title:"Solo l'analisi, senza richiamo",
  say:[{t:"you", text:"D'accordissimo.. Se mi dà un indirizzo email le invio l'analisi così valuta con calma, va bene?"}],
  capture:{key:"recapito", label:"Email", placeholder:"info@… / marco@…"},
  after:{
    say:[
      {t:"you", text:"Perfetto, gliela invio oggi. Consideri che questo numero rimane il mio riferimento qualora vorrà approfondire."},
      {t:"alt", label:"Per chiudere", text:"Grazie{ nome|}, buon lavoro e arrivederci."}
    ],
    primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"mail"}]
  }
},

o_pa_invio: { kind:"reply", title:"«Invio analisi» (più avanti)", skipLabel:"Usa email già presente",
  say:[{t:"you", text:"D'accordo. A quale indirizzo email preferisce che gliela invii?"}],
  captures:[{key:"recapito", label:"Email", placeholder:"info@… / marco@…"}],
  anyOf:true,
  after:{
    say:[{t:"you", text:"Benissimo, segnato tutto, gliela invio oggi stesso.. Se poi gentilmente mi lascia un recapito per risentirci e valutare insieme.. me lo segno."}],
    captures:[{key:"richiamata", label:"Giorno e ora che propone", placeholder:"martedì 21 alle 10", go:"o_pa_ok", goLabel:"Fissa la richiamata", outcome:"email"}],
    primary:[
      {label:"Mi richiami più avanti", to:"o_pa_periodo"},
      {label:"Dopo la stagione", to:"o_pa_stagione"},
      {label:"Preferisco farmi vivo io", to:"o_pa_vivo"},
      {label:"Guardi, lasci stare", to:"o_no_fine"}
    ]
  }
},

o_pa_ok: { kind:"reply", title:"Analisi in arrivo, richiamata fissata",
  say:[{t:"you", text:"Ok{, nome|}, gliela invio oggi e la ricontatterò {richiamata}, così riprendiamo direttamente i punti dell'analisi e li valutiamo insieme. Grazie ancora del tempo dedicato, buon lavoro e arrivederla."}],
  primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"email"}]
},

o_pa_vivo: { kind:"reply", title:"«Preferisco farmi vivo io»",
  say:[
    {t:"you", text:"D'accordo{, nome|}. Io le invio comunque l'analisi all'indirizzo indicato, così ha tutti gli elementi per valutarla con calma, va bene? Poi, qualsiasi cosa, questo con cui chiamo è il mio numero ed io sono {commerciale} di Agria System."},
    {t:"alt", label:"Per chiudere", text:"Grazie{ nome|}, buon lavoro e arrivederci."}
  ],
  primary:[{label:"Chiamata conclusa → HubSpot", to:"f7", outcome:"mail"}]
},

o_sapientone: { kind:"objection", title:"«So già tutto, conosco il settore»", set:{noto:true, detto:true},
  say:[{t:"you", text:"Ahah, finalmente uno che mi capisce.. Allora vado subito al punto: dall'analisi di {azienda} è emerso che {dettaglio}. È un aspetto su cui realtà simili si stanno già muovendo. Ne era al corrente?"}],
  primary:[
    {label:"No / Non ancora", to:"o_sap_no"},
    {label:"Sì, anche questo", to:"o_sap_si"},
    {label:"In realtà da noi funziona diversamente", to:"r_diverso"}
  ],
  options:[{label:"Non ci interessa", to:"o_interesse"}]
},

o_sap_no: { kind:"reply", title:"«No, non ancora»", open:true,
  say:[{t:"you", text:"Ecco{, nome|}, è proprio uno dei punti che vale la pena approfondire secondo me... Consideri che dall'analisi ne sono emersi altri. Se mi dà una disponibilità potremmo fissare una videocall e analizzarli insieme."}],
  primary:[
    {label:"Propone giorno / orario", to:"f6"},
    {label:"Vuole prima l'analisi", to:"o_pres"},
    {label:"Un altro momento", to:"r6_altro"}
  ]
},

o_sap_si: { kind:"reply", title:"«Sì, anche questo» (conosce il settore)", open:true,
  say:[{t:"you", text:"Ottimo, ottimo. Allora confrontiamo gli altri punti dell'analisi con quello che state già facendo e vediamo se c'è qualcosa che possa portarvi maggiori risultati. Se mi dà una disponibilità potrei ricontattarla tranquillamente."}],
  primary:[
    {label:"Propone giorno / orario", to:"f6"},
    {label:"Vuole prima l'analisi", to:"o_pres"},
    {label:"Dice che è già coperto su tutto", to:"r4_ai_si"}
  ]
},

o_tanti: { kind:"objection", title:"«Ci chiamano in tanti come voi»", open:true,
  say:[
    {t:"you", text:"Mi creda… siamo specializzati nel vostro settore e ne conosciamo bene dinamiche e processi. Lavoriamo per ridurre il lavoro interno e aumentare [[prenotazioni|ordini|ordini]] diretti, intervenendo sul sito che avete già e sulla presenza nei sistemi AI. Abbiamo analizzato {azienda}: se mi dà l'ok, le mostro i punti emersi e poi valuta lei.", when:{sito:"si"}},
    {t:"you", text:"Mi creda… siamo specializzati nel vostro settore e ne conosciamo bene dinamiche e processi. Lavoriamo per ridurre il lavoro interno e aumentare gli ordini diretti, facendo rendere di più sito, e-commerce e presenza nei sistemi AI. Abbiamo analizzato {azienda}: se mi dà l'ok, le mostro i punti emersi e poi valuta lei.", when:{sito:"ecommerce"}},
    {t:"you", text:"Mi creda… siamo specializzati nel vostro settore e ne conosciamo bene dinamiche e processi. Lavoriamo per ridurre il lavoro interno e creare più [[prenotazioni|ordini|ordini]] diretti attraverso il digitale, facendovi trovare anche dai sistemi AI. Abbiamo analizzato {azienda}: se mi dà l'ok, le mostro da dove potremmo partire.", when:{sito:"no"}},
    {t:"you", text:"Mi creda… siamo specializzati nel vostro settore e ne conosciamo bene dinamiche e processi. Lavoriamo per ridurre il lavoro interno e aumentare [[prenotazioni|ordini|ordini]] diretti, sistemando o rifacendo ciò che oggi limita il vostro digitale, anche sui sistemi AI. Abbiamo analizzato {azienda}: se mi dà l'ok, le mostro i punti emersi e poi valuta lei.", when:{sito:"vecchio"}}
  ],
  primary:[
    {label:"Va bene, mi mostri", to:"o_tanti_fissa"},
    {label:"Propone giorno / orario", to:"f6"},
    {label:"Mi mandi prima l'analisi", to:"o_pres"},
    {label:"Sì, ma queste cose le dicono tutti", to:"o_tanti_tutti"},
    {label:"Prima voglio capire cosa avete visto", to:"o_rilevato"}
  ],
  options:[
    {label:"Abbiamo già qualcuno che ci segue", to:"o_adv"},
    {label:"E quindi concretamente cosa fate?", to:"o_chi"},
    {label:"Quanto costa?", to:"o_prezzo"},
    {label:"Adesso non è il momento", to:"o_piuavanti"},
    {label:"Non ci interessa", to:"o_interesse_fine"}
  ]
},

o_tanti_fissa: { kind:"reply", title:"Fissare l'appuntamento",
  say:[
    {t:"you", text:"Benissimo… Visto che siete {azona}, potrei passare di persona, altrimenti fissiamo una videocall. Mi dica lei cosa preferisce fare.", when:{umbria:true}},
    {t:"you", text:"Va bene. Fissiamo una videocall così le mostro direttamente l'analisi di {azienda}. Mi dia una disponibilità e lo segno.", when:{umbria:false}}
  ],
  capture:{key:"fissato", label:"Giorno e ora (incontro o videocall)", placeholder:"martedì 14 alle 15", go:"f6", goLabel:"Fissa"},
  options:[
    {label:"Un altro momento", to:"r6_altro"},
    {label:"Mi mandi prima l'analisi", to:"o_pres"}
  ]
},

o_tanti_tutti: { kind:"reply", title:"«Tutti dicono così»",
  say:[
    {t:"you", text:"{nome}, se fossimo come gli altri, le starei già vendendo un sito, ADV o qualche pacchetto standard… Noi facciamo l'opposto: partiamo da come lavora oggi l'azienda, togliamo le attività manuali e interveniamo dove c'è un vantaggio reale..", when:{nome:true}},
    {t:"you", text:"Se fossimo come gli altri, le starei già vendendo un sito, ADV o qualche pacchetto standard… Noi facciamo l'opposto: partiamo da come lavora oggi l'azienda, togliamo le attività manuali e interveniamo dove c'è un vantaggio reale..", when:{nome:false}},
    {t:"you", text:"Quando sarebbe disponibile per analizzare insieme l'analisi che abbiamo svolto sulla vostra situazione digitale? Confrontiamo l'analisi con quello che fate già e vediamo dove risparmiare tempo e creare più opportunità."}
  ],
  primary:[
    {label:"Propone giorno / orario", to:"f6"},
    {label:"Mi mandi prima l'analisi", to:"o_pres"},
    {label:"Abbiamo già chi ci segue", to:"o_adv"},
    {label:"Quanto costa?", to:"o_prezzo"},
    {label:"Non è il momento", to:"o_piuavanti"}
  ],
  options:[{label:"No, lasci stare", to:"o_no_fine"}]
},

o_vincoli: { kind:"objection", title:"«Vincolate?» / «Fate dei contratti?»", open:true,
  say:[
    {t:"you", text:"Su questo la rassicuro. Consideri che mettiamo tutto per iscritto, sempre: attività, tempi, costi e responsabilità. Preferiamo che il rapporto continui perché si lavora bene insieme e perché i risultati arrivano."},
    {t:"alt", label:"Se chiede «quindi posso interrompere?»", text:"Sì, naturalmente vanno rispettati gli accordi presi sul singolo progetto. Per il resto siete liberi: preferiamo continuare a lavorare insieme perché il cliente si trova bene e perché il lavoro sta funzionando."},
    {t:"alt", label:"Se mostra interesse", text:"Nell'incontro possiamo chiarire anche bene come impostiamo la collaborazione e cosa rimane completamente vostro."}
  ],
  primary:[
    {label:"Propone giorno / orario", to:"f6"},
    {label:"Mi mandi prima l'analisi", to:"o_pres"},
    {label:"Quanto costa?", to:"o_prezzo"},
    {label:"Ha un'altra domanda tecnica", to:"o_tecnico", loop:true},
    {label:"Non ci interessa", to:"o_interesse"}
  ]
},

o_piccoli: { kind:"objection", title:"«Siamo piccoli, a conduzione familiare»",
  say:[{t:"you", text:"Il nostro lavoro è pensato proprio per aziende così, a conduzione familiare, con poco tempo e tante cose da seguire: il sistema fa il lavoro ripetitivo al posto vostro. Le chiedo: [[quando arriva una prenotazione da Booking o dal telefono, oggi chi la inserisce nel gestionale, a mano?|gli ordini dei ristoranti e le spedizioni, oggi li gestite a mano tra telefono, WhatsApp ed email?|gli ordini che arrivano tra telefono e WhatsApp, oggi li riscrivete a mano, con i listini tenuti a memoria?]]"}],
  listen:true
}

},
/* ───────────── SOS · MI SONO PERSO ───────────── */
/* Pannello di emergenza: obiezioni in versione corta (stesso concetto delle schede complete, accorciate e aperte con il nome del cliente
   quando c'è: il token {nome, |} mette «Marco, » se il nome è noto, altrimenti sparisce e la frase parte con la maiuscola),
   script di salvataggio per tornare dove si era, obiettivo della chiamata e uscite rapide. Le schede delle obiezioni restano quelle complete. */
sos: {
  bridge:"Detto questo, torniamo a dove eravamo prima…",
  /* Uscite rapide: label = cosa dice il cliente, hint = cosa succede premendo (l'SOS si chiude e si apre quella scheda) */
  exits:[
    {label:"Mi dice un giorno o un orario", hint:"Apre «Fissare e salutare»: segni la data e chiudi la chiamata", to:"f6"},
    {label:"Vuole prima l'analisi / il documento", hint:"Apre «Mi mandi il documento»: prendi il recapito e fissi la richiamata", to:"o_pres"},
    {label:"Ha fretta, vuole essere richiamato", hint:"Apre «Sono impegnato»: proponi le tue due disponibilità per risentirvi", to:"r1_impegnato"},
    {label:"Dice di no, vuole chiudere", hint:"Apre «Non ci interessa»: l'ultima proposta prima di salutare", to:"o_interesse"}
  ],
  topics:[
    {key:"chi", title:"Chi siete?", keys:"chi siete cosa fate societa azienda presentatevi", text:"{nome, |}in sostanza siamo una tech company specializzata esclusivamente nel settore [[delle strutture ricettive|delle cantine|dei frantoi]], in Italia e all'estero. Usiamo l'Intelligenza Artificiale per azzerare il vostro lavoro manuale, moltiplicare la vostra presenza sul web e rendere il business scalabile e autonomo."},
    {key:"cosa", title:"Cosa fate?", keys:"cosa fate servizi facciamo sito commerce automazione", text:"{nome, |}facciamo tre cose: rendiamo il sito, anche quello che avete già, più efficace sulla vendita diretta e trovabile su Google, ChatGPT e Gemini; portiamo più [[prenotazioni|ordini|ordini]] diretti a voi, con pagamenti e clienti gestiti in modo semplice; colleghiamo tra loro gli strumenti che già usate, così il dato entra una volta e arriva dove serve."},
    {key:"perche", title:"Perché proprio noi?", keys:"perche noi proprio voi motivo analisi emerso", text:"{nome, |}dall'analisi di {azienda} è emerso che {dettaglio}. È un aspetto su cui altre realtà del settore, soprattutto all'estero, si stanno già muovendo. Gli altri punti preferisco mostrarli insieme all'analisi completa."},
    {key:"tecnico", title:"Domanda tecnica", keys:"tecnica tecnico domanda privacy funzionamento team sviluppatori", text:"{nome, |}su questo preferisco che la risposta precisa gliela dia il team: la parte tecnica è di loro competenza. Per sito, e-commerce e visibilità risponde Matteo Garuzzo, per AI e automazioni Matteo De Pilla: li coinvolgiamo in videocall. Durante il lavoro avrete comunque un unico referente che coordina tutto."},
    {key:"prezzo", title:"Quanto costa?", keys:"costo costa prezzo cifra quanto preventivo budget soldi euro investimento", text:"{nome, |}il punto è capire quanto può crescere l'azienda: meno lavoro manuale, più clienti dal sito e più vendite dirette. Da lì definiamo l'investimento giusto, dopo l'analisi e per iscritto, con ambito e tempi.", hint:"Zero cifre a voce."},
    {key:"tempi", title:"Quanto ci mettete?", keys:"tempi tempistiche tempo settimane mesi durata quando pronto", text:"{nome, |}la tempistica la definiamo con precisione nell'approfondimento. In genere parliamo di 2–3 settimane per interventi web e 4–8 settimane per progetti più complessi, in base al lavoro da fare."},
    {key:"dati", title:"I dati restano miei?", keys:"dati proprieta privacy codice accessi dominio restano miei", text:"{nome, |}sito, codice, dati, account e accessi restano vostri: tutto rimane intestato a voi. Lavoriamo con i permessi necessari e il controllo rimane sempre vostro."},
    {key:"vincoli", title:"Vincoli? Contratti?", keys:"vincoli contratti vincolate legare durata firmare contratto scadenza", text:"{nome, |}mettiamo tutto per iscritto: attività, tempi, costi e responsabilità. Vanno rispettati gli accordi presi sul singolo progetto; per il resto siete liberi. Si continua perché il lavoro funziona."},
    {key:"gestionale", title:"Gestionale, loghi, social?", keys:"gestionale loghi logo foto social instagram facebook software programma integrazione", text:"{nome, |}partiamo da quello che avete già: il vostro gestionale resta e noi ci lavoriamo sopra collegandolo. I social li lasciamo a chi fa comunicazione; per logo, foto e parte visiva valutiamo cosa serve davvero dentro il progetto."}
  ]
},

/* ───────────── RICERCA OBIEZIONI ───────────── */
/* La barra «Cerca un'obiezione» (su ogni scheda e nell'SOS) cerca tra: tutte le schede di tipo obiezione + le schede elencate qui.
   Per ogni scheda si confrontano titolo, frasi del cliente che ci portano (i pulsanti) e queste parole chiave: basta l'inizio di una parola
   («cost» trova «costa», «costo»). Aggiungi qui i sinonimi con cui i commerciali potrebbero cercarla. */
search: {
  o_chi:"chi siete cosa fate concretamente societa azienda presentatevi spiegare chi e lei",
  o_noncapito:"capito spiegare chiaro confuso cosa fate ripetere",
  o_rilevato:"rilevato trovato visto emerso mancanze errori analisi notato cosa avete",
  o_mail:"mail email mandare mandi inviare scrivere posta pec messaggio",
  o_pres:"documento analisi pdf materiale brochure presentazione mandi prima inviare leggere",
  o_invio_quando:"leggo leggere guardare vedere calma poi vediamo",
  o_sito:"sito web gia abbiamo posto funziona internet pagina online",
  o_fornitore:"fornitore agenzia chi ci segue web agency webmaster nipote cugino amico qualcuno gia",
  o_adv:"marketing pubblicita adv ads campagne sponsorizzate social agenzia google facebook instagram",
  o_contratto:"contratto vincolo scadenza anni legati firmato abbonamento rinnovo",
  o_interesse:"interessa interesse momento lasci perdere no grazie basta",
  o_no_fine:"lasci stare richiami ricontattare cancellare elenco chiamate basta",
  o_budget:"budget soldi costa troppo caro fondi zero spesa investimento risorse",
  o_prezzo:"prezzo costo costa quanto cifra preventivo tariffa euro listino spesa viene",
  o_tempo:"tempo poco pratici tecnologia complicato capaci difficile computer anziani",
  o_stagione:"stagione vendemmia raccolta frangitura raccolto estate alta pieno lavoro impegnati",
  o_ai:"ai intelligenza artificiale chatgpt contro serve poco scettici crediamo robot",
  o_tecnico:"tecnica tecnico domanda privacy dati funzionamento dubbi sicurezza",
  o_tec_gestionale:"gestionale collega integrazione software programma pms booking danea zucchetti teamsystem excel compatibile",
  o_tec_gest_no:"cambiare gestionale tenere sistema attuale",
  o_tec_gest_come:"come funzionerebbe funziona praticamente",
  o_tec_tecnologia:"tecnologia wordpress shopify piattaforma linguaggio strumenti usate",
  o_tec_dati:"dati proprieta privacy codice accessi dominio restano miei intestato",
  o_tec_tempi:"tempi tempistiche tempo settimane mesi durata quando pronto",
  o_tec_loghi:"logo loghi foto video social instagram facebook grafica comunicazione fotografo",
  o_tec_altro:"altra domanda tecnica",
  o_gestionale:"gestionale fatto per noi personalizzato software nostro programma",
  o_piuavanti:"ci penso avanti risentiamoci richiamare dopo momento prossimo anno rimandare pensarci",
  o_pa_stagione:"dopo la stagione periodo settimana mese richiami",
  o_pa_vivo:"mi faccio vivo richiamo io chiamo io sentire",
  o_sapientone:"so gia tutto conosco settore esperto come funziona lo so",
  o_tanti:"tanti chiamate telefonate tutti giorni call center venditori proposte simili rompete",
  o_vincoli:"vincoli contratti vincolate legare durata firmare impegno",
  o_piccoli:"piccoli conduzione familiare famiglia piccola realta serve pochi",
  r1_impegnato:"impegnato occupato fretta tempo richiami lavorando momento sbagliato",
  r6_altro:"altro momento tardi richiami dopo",
  r6_socio:"socio padre madre moglie marito figlio titolare famiglia parlarne decidere insieme consultare",
  r6_persona:"di persona incontro vederci venire dal vivo",
  r6_fare_sapere:"faccio sapere faro sapere mi sento io",
  r1_altro:"altra persona non sono io se ne occupa referente responsabile collega figlio",
  r2_no:"email vista visto non mi pare spam arrivata ricevo tante",
  r_diverso:"diversamente sbagliato cosi cambiato errore vero"
},

/* ───────────── GUIDA ───────────── */
ref: {
  banned:["passione","eccellenza","su misura","a 360 gradi","soluzioni innovative","partner ideale","giovani e dinamici","agenzia"],
  negatives:["non","mai","niente","nessuno","problema","rubare","disturbo","scusi"],
  hurry:["ci metto un minuto","le rubo poco tempo","mezz'ora","due parole","in breve","gliela riassumo"],
  connectors:["Chiarissimo…","Ottimo…","Certo…","Perfetto…","Va benissimo…","Mi è chiaro…","Posso immaginare…","Giusto…"],
  truths:[
    "Sviluppiamo tutto internamente, nella nostra sede di Perugia, zero subappalti.",
    "Lavoriamo esclusivamente con agriturismi e strutture ricettive, cantine e frantoi, in Italia e all'estero.",
    "Portiamo in Italia l'innovazione che all'estero, Stati Uniti in testa, è già la normalità.",
    "Il codice e i dati restano del cliente.",
    "Facciamo un'analisi prima di proporre qualsiasi cosa.",
    "Diciamo un no chiaro quando un progetto ha poco senso."
  ],
  never:["numeri e percentuali","nomi di clienti, casi di successo, testimonianze","anni di esperienza","prezzi, range, «a partire da», «costa meno di quanto pensa»","scadenze inventate per creare fretta","promesse di guadagno","complimenti al cliente per ingraziarselo"],
  who:[
    ["Il commerciale","Fissa la videocall, prepara la presentazione dedicata al cliente e la tiene lui. Poi la proposta, fino alla firma e al primo pagamento."],
    ["Matteo Garuzzo","CEO & CTO. Entra in videocall solo per domande tecniche su sito, e-commerce, visibilità su Google e ChatGPT. Prepara il preventivo con il commerciale."],
    ["Matteo De Pilla","Co-Founder, Head of Engineering & AI. Entra in videocall solo per domande tecniche su intelligenza artificiale, integrazioni e automazioni."]
  ],
  sectorSheet:{
    hospitality:{ who:"Il titolare, spesso tra un ospite e l'altro; la moglie o il marito; un figlio che segue le prenotazioni.", when:"Metà mattina o metà pomeriggio, fuori da colazione e check-in." },
    cantina:{ who:"Il titolare o il figlio che segue la parte commerciale; la persona delle degustazioni.", when:"Mattina presto o primo pomeriggio; lontano da vendemmia e weekend di degustazioni." },
    frantoio:{ who:"Il titolare, spesso al telefono dal frantoio o dal campo; in campagna (ottobre–dicembre) il tempo è quasi zero.", when:"Gennaio–settembre; in campagna su appuntamento già preso." }
  }
}
};
