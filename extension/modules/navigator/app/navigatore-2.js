
(function(){
const D=window.AGRIA, F=window.AGRIA_FLOW, C=window.AGRIA_CORE, N=D.nodes;
const K=C.STORAGE_KEYS;
const now=()=>new Date();
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function store(){ try{ return window.localStorage; }catch(e){ return null; } }
function load(){ try{ const st=store(); const s=st&&C.restoreState(st.getItem(K.state)); if(s) return s; }catch(e){} return C.newState(); }
function save(){ try{ const st=store(); if(st) st.setItem(K.state,JSON.stringify(state)); }catch(e){} }
let state=load();

/* ── icone: il significato non sta mai nel solo colore ── */
const ICON={
  go:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  wait:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></svg>',
  stop:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  op:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h11M13 7l5 5-5 5"/></svg>',
  pause:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M9 7v10M15 7v10"/></svg>'
};
const TONE_LABEL={go:"Avanza",wait:"Rinvio o barriera",stop:"Stop",op:"Operativo"};
const TONE_ORDER=["go","wait","stop","op"];

/* ── segnaposto: un solo motore (C.fill), qui con l'HTML evidenziato ── */
function fillSpans(s){ return s.replace(/\[([^\]]+)\]/g,'<span class="fill">$1</span>'); }
function tpl(text){
  return C.fill(text,state,{now:now(),escape:esc,post:fillSpans,wrap:t=>{
    if(!t.missing) return `<span class="tok v">${esc(t.pre+t.value+t.suf)}</span>`;
    if(t.fallback!==undefined) return t.fallback===""?"":`<span class="tok fb">${esc(t.pre)}${fillSpans(t.fallback)}${esc(t.suf)}</span>`;
    return `<span class="tok ph">${esc(t.pre)}${esc(t.label)}${esc(t.suf)}</span>`;
  }});
}
const plain=text=>C.fill(text,state,{now:now()});
/* un blocco «Tu dici»: «\n\n» nel testo va a capo dentro lo stesso blocco (le righe con «alt» servono solo agli approfondimenti) */
function sayHTML(lines,extraCls){
  if(!lines||!lines.length) return "";
  const paras=html=>html.split(/\n{2,}/).map(p=>p.replace(/\n/g,"<br>"));
  return `<div class="say${extraCls?" "+extraCls:""}">${lines.map(l=>l.alt?`<p class="alt"><span class="al">${esc(l.alt)}</span>${tpl(l.text)}</p>`:paras(tpl(l.text)).map(p=>`<p${l.cls?` class="${l.cls}"`:""}>${p}</p>`).join("")).join("")}</div>`;
}

/* ── aggiornamenti mentre si scrive: ogni schermata registra cosa ricalcolare ── */
let refreshers=[];
function refresh(){ refreshers.forEach(f=>{ try{ f(); }catch(e){ console.error(e); } }); }
function set(path,value){ if(path==="contactName") C.setContactName(state,value); else C.setField(state,path,value); if(path==="company.analysisFinding") state.company.findingMigrated=false; save(); syncInputs(path); refresh(); }
function syncInputs(path){
  document.querySelectorAll(`[data-path="${path}"]`).forEach(el=>{ if(el===document.activeElement) return; const v=C.getField(state,path); const s=v==null?"":String(v); if(el.value!==s) el.value=s; });
  document.querySelectorAll(`[data-seg="${path}"] button`).forEach(b=>b.classList.toggle("on",String(C.getField(state,path))===b.dataset.val));
  document.querySelectorAll(`[data-chip-path="${path}"]`).forEach(b=>b.classList.toggle("on",String(C.getField(state,path)||"")===b.dataset.chip));
}

/* ── campi ── */
function dayNextOptions(sel){ const n=now(), out=[]; for(let i=0;i<42;i++){ const d=C.addDays(n,i); if(d.getDay()===0) continue; const iso=C.isoLocal(d); out.push(`<option value="${iso}"${iso===sel?" selected":""}>${i===0?"oggi · ":i===1?"domani · ":""}${C.dayLabel(iso)}</option>`); } if(sel&&!out.some(o=>o.includes(`value="${sel}"`))) out.unshift(`<option value="${sel}" selected>${C.dayLabel(sel)}</option>`); return `<option value="">giorno…</option>`+out.join(""); }
function dayPastOptions(sel){ const n=now(), out=[]; for(let i=0;i<=30;i++){ const iso=C.isoLocal(C.addDays(n,-i)); out.push(`<option value="${iso}"${iso===sel?" selected":""}>${i===0?"oggi · ":i===1?"ieri · ":""}${C.dayLabel(iso)}</option>`); } if(sel&&!out.some(o=>o.includes(`value="${sel}"`))) out.unshift(`<option value="${sel}" selected>${C.dayLabel(sel)}</option>`); return `<option value="">scegli il giorno…</option>`+out.join(""); }
function timeOptions(sel){ const out=[]; for(let h=8;h<=19;h++) for(const m of ["00","30"]){ const t=String(h).padStart(2,"0")+":"+m; out.push(`<option value="${t}"${t===sel?" selected":""}>${h}:${m}</option>`); } return `<option value="">ora…</option>`+out.join(""); }
const SITO={si:"Sito funzionante",ecommerce:"Sito + e-commerce",vecchio:"Sito vecchio o poco efficace",no:"Nessun sito"};
function segChoices(kind){
  if(kind==="channel") return [["email","Email"],["whatsapp","WhatsApp"]];
  if(kind==="appointmentType") return state.company.umbria==="si"?[["video","Videocall"],["in_person","Di persona"]]:[["video","Videocall"]];
  if(kind==="umbria") return [["si","Sì, in Umbria"],["no","No, fuori Umbria"]];
  if(kind==="sector") return Object.entries(D.sectors).map(([k,s])=>[k,s.label]);
  if(kind==="sito") return Object.entries(SITO);
  return [];
}
let uid=0;
function fieldHTML(f){
  const v=f.path?C.getField(state,f.path):null, val=v==null?"":String(v), id="fld"+(++uid);
  let ctl="";
  switch(f.kind){
    case "textarea": ctl=`<textarea id="${id}" data-path="${f.path}" placeholder="${esc(f.placeholder||"")}">${esc(val)}</textarea>`; break;
    case "dayNext": ctl=`<select id="${id}" data-path="${f.path}">${dayNextOptions(val)}</select>`; break;
    case "dayPast": ctl=`<select id="${id}" data-path="${f.path}">${dayPastOptions(val)}</select>`; break;
    case "time": ctl=`<select id="${id}" data-path="${f.path}">${timeOptions(val)}</select>`; break;
    case "date": ctl=`<input id="${id}" type="date" data-path="${f.path}" value="${esc(val)}" min="${C.isoLocal(now())}">`; break;
    case "period": { const chips=f.chips==="months"?C.monthChips(now()):(f.chips||[]); ctl=`<input id="${id}" type="text" data-path="${f.path}" value="${esc(val)}" placeholder="${esc(f.placeholder||"")}" autocomplete="off">${chips.length?`<div class="chips">${chips.map(c=>`<button type="button" class="chip-btn${c===val?" on":""}" data-chip="${esc(c)}" data-chip-path="${f.path}">${esc(c)}</button>`).join("")}</div>`:""}`; break; }
    case "channel": case "appointmentType": case "umbria": case "sector": case "sito":
      ctl=`<div class="seg" data-seg="${f.path}" role="group" aria-label="${esc(f.label)}">${segChoices(f.kind).map(([k,l])=>`<button type="button" data-val="${k}"${k===val?' class="on"':""}>${esc(l)}</button>`).join("")}</div>`; break;
    case "quick": ctl=`<div class="chips">${f.chips.map((c,i)=>`<button type="button" class="chip-btn" data-quickset="${i}">${esc(c.label)}</button>`).join("")}</div>`; break;
    default: ctl=`<input id="${id}" type="${f.kind==="tel"?"tel":f.kind==="email"?"email":"text"}" data-path="${f.path}" value="${esc(val)}" placeholder="${esc(f.placeholder||"")}" autocomplete="off">`;
  }
  const lab=f.label?`<label${f.kind==="quick"||segChoices(f.kind).length?"":` for="${id}"`}>${esc(f.label)}${f.required?' <span class="req">*</span>':""}${f.hint?` <span class="hint">· ${esc(f.hint)}</span>`:""}</label>`:"";
  return `<div class="field${f.wide?" wide":""}" data-field="${f.path||"quick"}">${lab}${ctl}${f.after||""}</div>`;
}
function bindInputs(root,quickSets){
  root.querySelectorAll("[data-path]").forEach(el=>{ if(el.dataset.bound) return; el.dataset.bound="1"; el.addEventListener(el.tagName==="SELECT"||el.type==="date"?"change":"input",()=>set(el.dataset.path,el.value)); });
  root.querySelectorAll("[data-seg]").forEach(seg=>seg.querySelectorAll("button").forEach(b=>{ if(b.dataset.bound) return; b.dataset.bound="1"; b.addEventListener("click",()=>set(seg.dataset.seg,b.dataset.val)); }));
  root.querySelectorAll("[data-chip]").forEach(b=>{ if(b.dataset.bound) return; b.dataset.bound="1"; b.addEventListener("click",()=>set(b.dataset.chipPath,b.dataset.chip)); });
  root.querySelectorAll("[data-quickset]").forEach(b=>{ if(b.dataset.bound) return; b.dataset.bound="1"; b.addEventListener("click",()=>{ const setMap=quickSets&&quickSets[+b.dataset.quickset]; if(!setMap) return; Object.entries(setMap).forEach(([p,v])=>{ C.setField(state,p,v==="@today"?C.isoLocal(now()):v==="@tomorrow"?C.isoLocal(C.addDays(now(),1)):v); syncInputs(p); }); save(); refresh(); }); });
}

/* ── navigazione ── */
const view=document.getElementById("view"), bottomIn=document.getElementById("bottomIn");
function render(flash){
  refreshers=[]; uid=0;
  if(state.screen==="prep") renderPrep(); else if(state.screen==="outcome") renderOutcome(); else renderCall();
  const card=document.getElementById("card"); if(card&&flash){ card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash"); }
  updateTop(); refresh(); window.scrollTo({top:0,behavior:"auto"});
}
function updateTop(){
  const inCall=state.screen!=="prep";
  document.getElementById("timer").hidden=!inCall; document.getElementById("btnData").hidden=!inCall;
  document.getElementById("brandN").textContent=inCall&&state.company.name?state.company.name:"Prima chiamata di follow-up";
  document.getElementById("brandK").textContent=inCall?`Agria System · ${[D.sectors[state.company.sector]&&D.sectors[state.company.sector].label,state.company.zone].filter(Boolean).join(" · ")}`:"Agria System · Navigatore chiamata";
  tick();
}

/* ── PREPARAZIONE ── */
function prepFormHTML(){
  return `<div class="form">
    ${fieldHTML({path:"operator.name",kind:"text",label:"Il tuo nome",placeholder:"Alessandro Poponi",required:true,hint:"resta per le prossime chiamate"})}
    ${fieldHTML({path:"company.name",kind:"text",label:"Azienda",placeholder:"Agriturismo …",required:true})}
    ${fieldHTML({path:"company.sector",kind:"sector",label:"Settore",required:true,wide:true})}
    ${fieldHTML({path:"company.zone",kind:"text",label:"Zona",placeholder:"Assisi (PG)",required:true})}
    ${fieldHTML({path:"company.umbria",kind:"umbria",label:"In Umbria?",required:true,hint:"con «Sì» si propone anche l'incontro di persona"})}
    ${fieldHTML({path:"company.emailDate",kind:"dayPast",label:"Prima email",required:true,after:`<div class="small" data-preview="email"></div>`})}
    ${fieldHTML({path:"company.analysisFinding",kind:"textarea",label:"Frase da dire dopo: «È emerso che…»",required:true,wide:true,hint:"la frase preparata dall'analisi, senza «è emerso che»",placeholder:"chi vuole prenotare direttamente deve inviare una richiesta e attendere una conferma, mentre sui portali può confermare subito; collegando disponibilità e pagamento al sito potremmo rendere diretto anche questo passaggio",after:`<div class="preview" data-preview="finding"></div><div class="notice info" data-preview="migrated" hidden></div>`})}
    <div class="field wide"><label>Disponibilità <span class="req">*</span> <span class="hint">· due momenti liberi in calendario: compaiono nei pulsanti durante la chiamata</span></label>
      <div class="slots">
        <div class="slot"><div class="sl">Disponibilità 1</div><div class="sr"><select data-path="slots.aDay" aria-label="Disponibilità 1, giorno">${dayNextOptions(state.slots.aDay)}</select><select data-path="slots.aTime" aria-label="Disponibilità 1, ora">${timeOptions(state.slots.aTime)}</select></div><div class="out" data-preview="slot1"></div></div>
        <div class="slot"><div class="sl">Disponibilità 2</div><div class="sr"><select data-path="slots.bDay" aria-label="Disponibilità 2, giorno">${dayNextOptions(state.slots.bDay)}</select><select data-path="slots.bTime" aria-label="Disponibilità 2, ora">${timeOptions(state.slots.bTime)}</select></div><div class="out" data-preview="slot2"></div></div>
      </div></div>
    <details class="more wide" style="grid-column:1/-1"><summary>Altri dettagli · facoltativi</summary><div class="form">
      ${fieldHTML({path:"company.contactName",kind:"text",label:"Titolare o referente, se lo conosci",placeholder:"signor Bianchi"})}
      ${fieldHTML({path:"company.sito",kind:"sito",label:"Sito attuale",wide:true,hint:"serve solo nelle schede di approfondimento"})}
    </div></details>
  </div>`;
}
function prepPreviews(root){
  root.querySelectorAll('[data-preview="email"]').forEach(el=>{ const l=C.emailWhen(state.company.emailDate,now()); el.textContent=l?`A voce: «…l'email che le ho inviato ${l}…»`:""; });
  root.querySelectorAll('[data-preview="finding"]').forEach(el=>{ const p=C.findingPhrase(state.company.analysisFinding,state.company.name); el.innerHTML=`<span class="small">Così durante la chiamata:</span><br>Dall'analisi della vostra azienda è emerso che ${p?esc(p):'<span class="fill">…</span>'}.`; });
  // chiamata preparata con la versione precedente: il vecchio intervento resta visibile finché serve integrarlo a mano
  root.querySelectorAll('[data-preview="migrated"]').forEach(el=>{ const c=state.company, parts=[];
    if(c.findingMigrated) parts.push("Frase ripresa dal vecchio campo «Cosa è emerso»: controlla che dica anche dove possiamo intervenire.");
    if(c.legacyIntervention) parts.push(`Nel vecchio campo «Come possiamo intervenire» avevi scritto: «${esc(c.legacyIntervention)}».`);
    el.hidden=!parts.length; el.innerHTML=parts.join(" "); });
  root.querySelectorAll('[data-preview="slot1"]').forEach(el=>{ el.textContent=C.slotLabel(state.slots.aDay,state.slots.aTime)||"—"; });
  root.querySelectorAll('[data-preview="slot2"]').forEach(el=>{ el.textContent=C.slotLabel(state.slots.bDay,state.slots.bTime)||"—"; });
}
function renderPrep(){
  const ls=state.lastSaved; const lab=ls&&F.outcomes[ls.outcome]?F.outcomes[ls.outcome].label:"";
  view.innerHTML=`<section class="card" id="card"><div class="eyebrow">Preparazione</div><h1>Prossima azienda</h1>
    ${ls?`<p class="lastsaved" id="lastSaved">Ultimo esito salvato: <b>${esc(ls.company)}</b> · ${esc(lab)}</p>`:""}
    ${prepFormHTML()}<div class="notice" id="missNote" hidden></div></section>`;
  bottomIn.innerHTML=`<span class="spacer"></span><button class="btn primary wide" id="startCall">Inizia chiamata →</button>`;
  bindInputs(view);
  refreshers.push(()=>{
    prepPreviews(view);
    const miss=C.prepMissing(state); const b=document.getElementById("startCall"); if(b) b.disabled=miss.length>0;
    const note=document.getElementById("missNote"); note.hidden=!miss.length; note.textContent=miss.length?"Da compilare: "+miss.map(m=>m.label).join(", ")+".":"";
    view.querySelectorAll("[data-field]").forEach(f=>f.classList.remove("miss"));
    miss.forEach(m=>{ const el=view.querySelector(`[data-field="${m.path}"]`); if(el) el.classList.add("miss"); });
  });
  document.getElementById("startCall").addEventListener("click",()=>{ if(!C.startCall(state,now())){ toast("Completa i dati della preparazione"); refresh(); return; } save(); render(true); });
}

/* ── CHIAMATA ── */
function optLabel(o){ return o.slot?tpl(o.slot===1?"{slot1}":"{slot2}"):tpl(o.label); }
function optHTML(o,attr){ return `<button class="opt t-${o.tone}" ${attr} title="${esc(TONE_LABEL[o.tone])}"><span class="ic" aria-hidden="true">${ICON[o.tone]}</span><span class="tx"><span class="l">${optLabel(o)}</span>${o.hint?`<span class="h">${esc(o.hint)}</span>`:""}</span></button>`; }
function optionsHTML(list,attrOf){
  if(list.length<=5) return `<div class="opts">${list.map(o=>optHTML(o,attrOf(o))).join("")}</div>`;
  return TONE_ORDER.map(t=>{ const g=list.filter(o=>o.tone===t); if(!g.length) return ""; return `<div class="ogroup"><div class="ghead t-${t}"><span class="ic" aria-hidden="true">${ICON[t]}</span>${esc(TONE_LABEL[t])}</div><div class="opts">${g.map(o=>optHTML(o,attrOf(o))).join("")}</div></div>`; }).join("");
}
function capturesHTML(node){
  const caps=(node.captures||[]).filter(c=>C.condOk(state,c.when,now())); if(!caps.length) return "";
  const soft=caps.every(c=>c.soft);
  return `<div class="cap${soft?" soft":""}"><div class="cl">${soft?"Se serve, segna":"Segna quello che dice"}</div><div class="capgrid">${caps.map(c=>fieldHTML(Object.assign({},c,{wide:c.kind==="quick"||c.kind==="period"}))).join("")}</div></div>`;
}
function renderCall(){
  const node=C.nodeOf(state.node);
  if(!node){ state.screen="prep"; save(); return renderPrep(); }
  if(node.v1) return renderDeep(node);
  const stage=F.stages[node.stage]||"";
  const opts=C.visibleOptions(state,node,now());
  /* la scheda chiede il nome: prima la domanda e il campo, poi (appena il nome è scritto) la battuta e le risposte */
  const asking=!!(node.askName&&state.flags.askingName);
  view.innerHTML=`<section class="card" id="card" data-node="${esc(state.node)}">
    <div class="eyebrow">${esc(stage)} <span class="trail">${esc(state.company.name)}</span></div>
    <h1>${esc(node.title)}</h1>
    ${node.hintBefore?`<p class="cue" data-cue>${esc(node.hintBefore)}</p>`:""}
    ${asking?`<div class="label">Tu dici</div><div data-ask>${sayHTML([{text:node.askName}])}</div>${nameCaptureHTML()}<div data-after>`:""}
    <div class="label">${asking?"Poi dici":"Tu dici"}</div><div data-say></div>
    ${node.pause?`<div class="pausecue" data-pause role="note"><span class="ic" aria-hidden="true">${ICON.pause}</span>Adesso ascolta la risposta</div>`:""}
    ${capturesHTML(node)}
    <div class="label">Il cliente risponde…</div>
    ${optionsHTML(opts,o=>`data-opt="${o.id}"`)}
    ${asking?"</div>":""}
  </section>`;
  const quickChips=(node.captures||[]).find(c=>c.kind==="quick");
  bindInputs(view,quickChips?quickChips.chips.map(c=>c.set):null);
  refreshers.push(()=>{
    view.querySelector("[data-say]").innerHTML=sayHTML(C.sayLines(state,node,now()));
    opts.forEach(o=>{ const b=view.querySelector(`[data-opt="${o.id}"]`); if(b) b.disabled=!C.optionEnabled(state,o); });
    const shown=C.nameRevealed(state), after=view.querySelector("[data-after]"), skip=view.querySelector("[data-skipname]");
    if(after) after.hidden=!shown; if(skip) skip.hidden=shown;
  });
  view.querySelectorAll("[data-opt]").forEach(b=>b.addEventListener("click",()=>{ const r=C.choose(state,b.dataset.opt,now()); if(r.sos){ openSos(); return; } if(r.blocked){ toast("Segna prima quello che ha detto"); return; } save(); render(true); }));
  if(asking){
    const input=document.getElementById("contactNameInput");
    input.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); nameProceed(); } });
    view.querySelector("[data-skipname]").addEventListener("click",nameProceed);
    if(!String(state.draft.contactName||"").trim()) input.focus({preventScroll:true});
  }
  renderCallBottom();
}
function nameCaptureHTML(){
  return `<div class="cap name" data-namecap><label class="cl" for="contactNameInput">Nome interlocutore</label>
    <input id="contactNameInput" type="text" data-path="contactName" value="${esc(state.draft.contactName||"")}" placeholder="Marco · signora Bianchi" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="done">
    <div class="namerow"><span class="small">Scrivilo mentre lo dice: la battuta compare subito sotto · Invio per proseguire</span><button type="button" class="linkbtn" data-skipname>Prosegui senza nome →</button></div></div>`;
}
/* Invio o «Prosegui senza nome»: la battuta compare anche senza nome (il nome non è mai obbligatorio), la tastiera si chiude */
function nameProceed(){
  if(!C.nameRevealed(state)){ C.skipName(state); save(); refresh(); }
  const input=document.getElementById("contactNameInput"); if(input) input.blur();
  const after=view.querySelector("[data-after]"); if(after) after.scrollIntoView({block:"nearest"});
}
function renderCallBottom(){
  bottomIn.innerHTML=`<button class="btn ghost" id="btnBack"${state.history.length?"":" disabled"}><span class="full">← Indietro</span><span class="short">←</span></button><span class="spacer"></span>
    <button class="btn sos" id="btnSos"><span class="full">SOS · altra risposta</span><span class="short">SOS</span></button>
    <button class="btn end" id="btnQuick"><span class="full">Termina · esito</span><span class="short">Esito</span></button>`;
  document.getElementById("btnBack").addEventListener("click",()=>{ if(C.back(state)){ save(); render(true); } });
  document.getElementById("btnSos").addEventListener("click",openSos);
  document.getElementById("btnQuick").addEventListener("click",openQuick);
}
/* uscite verso l'obiettivo: dopo ogni risposta SOS e in fondo a ogni approfondimento */
function returnsHTML(attr){ return `<div class="opts">${F.sos.returns.map(r=>optHTML(r,`${attr}="${r.id}"`)).join("")}</div>`; }
function doReturn(id){
  const r=F.sos.returns.find(x=>x.id===id); if(!r) return;
  if(r.quick){ openQuick(); return; }
  if(r.back){ if(!sosPanel.hidden){ closeSos(); return; } if(C.backToConversation(state)){ save(); render(true); } return; }   // dall'SOS chiude il pannello, da un approfondimento risale all'ultima scheda del flusso
  C.goTo(state,r.to); save(); render(true);
}

/* ── APPROFONDIMENTO: una scheda della versione precedente, consultabile senza uscire dalla chiamata ── */
function v1Lines(n){
  const L=[]; const add=(arr,alt)=>(arr||[]).forEach(l=>{ if(!l||!C.condOk(state,l.when,now())) return; if(l.t==="alt") L.push({text:l.text,alt:l.label}); else L.push({text:l.text,alt}); });
  add(n.say); add(n.say2); add(n.then);
  if(n.second) L.push({text:n.second.text,alt:n.second.label});
  if(n.mirror) L.push({text:n.mirror.text});
  if(n.areaText) Object.entries(n.areaText).forEach(([k,t])=>L.push({text:t,alt:(D.areas[k]||{}).name||k}));
  if(n.bridge) add(Array.isArray(n.bridge)?n.bridge:[n.bridge]);
  if(n.after){ add(n.after.say,"Poi"); add(n.after.say2,"Poi"); }
  return L;
}
function v1Links(n){
  const seen=new Set(), out=[];
  [].concat(n.primary||[],n.options||[],(n.after&&n.after.primary)||[],(n.after&&n.after.options)||[]).forEach(o=>{ if(!o.to||!N[o.to]||["f0","f1","f7"].includes(o.to)||C.isDeepHidden(o.to)||seen.has(o.to)||!C.condOk(state,o.when,now())) return; seen.add(o.to); out.push(o); });
  if(n.listen&&!seen.has("f5")) out.push({label:"Il valore e la proposta",to:"f5"});
  return out;
}
function renderDeep(node){
  const n=node.data, links=v1Links(n), lines=v1Lines(n);
  view.innerHTML=`<section class="card" id="card" data-deep="${esc(node.id)}">
    <div class="eyebrow">Approfondimento <span class="trail">${esc(state.company.name)}</span></div>
    <h1>${esc(n.title)}</h1>
    ${n.lead?`<p class="small">${esc(n.lead)}</p>`:""}
    ${lines.length?`<div class="label">Tu dici</div><div data-say></div>`:""}
    ${n.table?`<div class="tech">${n.table.map(r=>`<div><span>${esc(r.q)}</span><span>${tpl(r.a)}</span></div>`).join("")}</div>`:""}
    ${links.length?`<div class="label">Se risponde…</div><div class="opts">${links.map(o=>optHTML({tone:"op",label:o.label},`data-deeplink="${o.to}"`)).join("")}</div>`:""}
    <div class="label">Per tornare all'obiettivo</div>${returnsHTML("data-ret")}
  </section>`;
  refreshers.push(()=>{ const el=view.querySelector("[data-say]"); if(el) el.innerHTML=sayHTML(lines); });
  view.querySelectorAll("[data-deeplink]").forEach(b=>b.addEventListener("click",()=>{ C.openDeep(state,b.dataset.deeplink); save(); render(true); }));
  view.querySelectorAll("[data-ret]").forEach(b=>b.addEventListener("click",()=>doReturn(b.dataset.ret)));
  renderCallBottom();
}

/* ── ESITO ── */
function toneChip(code){ const o=F.outcomes[code]; return `<span class="ochip t-${o.tone}"><span class="ic" aria-hidden="true">${ICON[o.tone]}</span>${esc(o.label)}</span>`; }
function renderOutcome(){
  const code=state.draft.outcome, o=F.outcomes[code];
  if(!o){ state.screen="call"; save(); return renderCall(); }
  const fields=C.outcomeFields(code,state);
  const showContact=!["VOICEMAIL","UNREACHED","REFERRAL"].includes(code);
  view.innerHTML=`<section class="card" id="card" data-outcome-code="${code}">
    <div class="eyebrow">Esito <span class="trail">${esc(state.company.name)}</span></div>
    <h1>Esito chiamata</h1>
    <div id="closingWrap"><div class="label">Chiudi così</div><div id="closingSay"></div></div>
    ${o.hint?`<div class="notice info" id="outcomeHint">${esc(o.hint)}</div>`:""}
    <div class="label">Riepilogo</div>
    <dl class="sum">
      <div class="row2"><dt>Azienda</dt><dd>${esc(state.company.name)}</dd></div>
      <div class="row2"><dt>Esito</dt><dd>${toneChip(code)}<button class="linkbtn" id="changeOutcome">Cambia esito</button></dd></div>
      <div class="row2"><dt>Percorso</dt><dd>${esc(F.reasons[state.draft.reason]||"")}</dd></div>
      ${fields.length?`<div class="row2"><dt>Dati</dt><dd><div class="ofields">${fields.map(f=>fieldHTML(Object.assign({},f,{chips:f.kind==="period"?(code==="PROVIDER_CONTRACT"?"months":code==="TIMING_FUTURE"?["tra un mese","dopo la stagione","il prossimo anno"]:["in mattinata","nel pomeriggio"]):undefined}))).join("")}</div></dd></div>`:""}
      <div class="row2"><dt>Facoltativo</dt><dd><div class="ofields">
        ${showContact?fieldHTML({path:"contactName",kind:"text",label:"Parlato con",placeholder:"nome, se lo sai"}):""}
        ${fieldHTML({path:"note",kind:"text",label:"Nota",placeholder:"una riga, se serve"})}
      </div></dd></div>
    </dl>
    <div class="label">Azioni previste <span class="small">· solo un promemoria: gli aggiornamenti di HubSpot li deciderà Agria Commercial</span></div>
    <ul class="future" id="futureList"></ul>
    <div class="notice" id="missOutcome" hidden></div>
  </section>`;
  bottomIn.innerHTML=`<button class="btn ghost" id="btnBackCall"><span class="full">← Torna alla chiamata</span><span class="short">←</span></button><span class="spacer"></span><button class="btn primary" id="saveNext">Salva e prossima azienda</button>`;
  bindInputs(view);
  refreshers.push(()=>{
    const lines=C.closingLines(state,now());
    document.getElementById("closingWrap").hidden=!lines.length;
    document.getElementById("closingSay").innerHTML=sayHTML(lines);
    document.getElementById("futureList").innerHTML=C.plannedActions(state).map(a=>`<li data-action="${esc(a)}">${esc(plain(F.actions[a]||a))}</li>`).join("");
    const miss=C.missingFields(state); const mn=document.getElementById("missOutcome");
    mn.hidden=!miss.length; mn.textContent=miss.length?"Prima di salvare: "+miss.map(m=>m.label).join(", ")+".":"";
    view.querySelectorAll("[data-field]").forEach(f=>f.classList.remove("miss"));
    miss.forEach(m=>m.paths.forEach(p=>{ const el=view.querySelector(`[data-field="${p}"]`); if(el) el.classList.add("miss"); }));
  });
  document.getElementById("changeOutcome").addEventListener("click",openQuick);
  document.getElementById("btnBackCall").addEventListener("click",()=>{ if(C.back(state)){ save(); render(true); } else { state.screen="call"; save(); render(true); } });
  document.getElementById("saveNext").addEventListener("click",saveAndNext);
}
let lastOutcome=null;
function saveAndNext(){
  const r=C.finalize(state,store(),now());
  if(r.needsConfirm){ document.getElementById("dncPanel").hidden=false; document.getElementById("dncConfirm").focus(); return; }
  if(!r.ok){ refresh(); toast(r.missing&&r.missing.length?"Manca: "+r.missing.map(m=>m.label).join(", "):(r.errors||[]).some(e=>/analysisFinding/.test(e))?"Correggi la frase dopo «è emerso che» in Scheda":"Controlla i dati dell'esito"); if(r.errors) console.error("Esito non valido",r.errors); return; }
  lastOutcome=r.outcome; state=r.state; save(); render(true);
  toast(r.stored?"Esito salvato":"Esito pronto, ma il browser non ha potuto salvarlo");
}
document.getElementById("dncCancel").addEventListener("click",()=>{ document.getElementById("dncPanel").hidden=true; });
document.getElementById("dncConfirm").addEventListener("click",()=>{ document.getElementById("dncPanel").hidden=true; state.draft.dncConfirmed=true; saveAndNext(); });

/* ── ESITO RAPIDO: da qualsiasi scheda, anche dall'SOS ── */
const quickPanel=document.getElementById("quickPanel");
function openQuick(){
  document.getElementById("quickBody").innerHTML=F.quick.map(g=>`<div class="qgroup"><div class="ghead">${esc(g.title)}</div><div class="opts">${g.codes.map(c=>optHTML({tone:g.tone,label:F.outcomes[c].label},`data-quick="${c}"`)).join("")}</div></div>`).join("");
  document.getElementById("quickBody").querySelectorAll("[data-quick]").forEach(b=>b.addEventListener("click",()=>{ quickPanel.hidden=true; sosPanel.hidden=true; C.quickOutcome(state,b.dataset.quick,now()); save(); render(true); }));
  quickPanel.hidden=false;
}
document.getElementById("closeQuick").addEventListener("click",()=>{ quickPanel.hidden=true; });
quickPanel.addEventListener("click",e=>{ if(e.target===quickPanel) quickPanel.hidden=true; });

/* ── SOS ── */
const sosPanel=document.getElementById("sosPanel"), sosBody=document.getElementById("sosBody");
let sosTopic=null, sosQuery="";
function snorm(s){ return String(s||"").toLowerCase().replace(/\{[^}]*\}/g," ").replace(/\[\[([^\]]*)\]\]/g,(_,g)=>g.replace(/\|/g," ")).normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9\s]+/g," ").replace(/\s+/g," ").trim(); }
let SEARCH=null;
function buildSearch(){
  const inc={}; for(const [id,n] of Object.entries(N)){ [].concat(n.primary||[],n.options||[],(n.after&&n.after.primary)||[],(n.after&&n.after.options)||[]).forEach(o=>{ if(N[o.to]) (inc[o.to]=inc[o.to]||[]).push(o.label); }); }
  const ids=new Set(Object.keys(D.search||{})); for(const [id,n] of Object.entries(N)) if(n.kind==="objection") ids.add(id);
  SEARCH=[...ids].filter(id=>N[id]&&!["f0","f1","f7"].includes(id)&&!C.isDeepHidden(id)).map(id=>({id,title:N[id].title,t:snorm(N[id].title).split(" ").filter(Boolean),l:snorm((inc[id]||[]).join(" ")).split(" ").filter(Boolean),k:snorm((D.search||{})[id]||"").split(" ").filter(Boolean)}));
}
function searchDeep(q){
  if(!SEARCH) buildSearch();
  const words=snorm(q).split(" ").filter(Boolean); if(!words.length||words.join("").length<2) return null;
  const res=[];
  for(const e of SEARCH){ let score=0, ok=true; for(const w of words){ const inT=e.t.some(x=>x.startsWith(w)), inL=e.l.some(x=>x.startsWith(w)), inK=e.k.some(x=>x.startsWith(w)); if(!(inT||inL||inK)){ ok=false; break; } score+=inT?3:inL?2:1; if(e.t.includes(w)) score+=1; } if(ok) res.push({e,score}); }
  res.sort((a,b)=>b.score-a.score||a.e.title.localeCompare(b.e.title,"it"));
  return res.slice(0,8).map(r=>r.e);
}
function topicMatch(t,words){ const bag=snorm(t.title+" "+(t.keys||"")).split(" "); return words.every(w=>bag.some(x=>x.startsWith(w))); }
function renderSos(){
  const topics=C.sosTopics(); const tp=topics.find(t=>t.key===sosTopic);
  let h="";
  if(tp){
    // una risposta breve, poi si lascia rispondere il cliente: nessuna frase-ponte verso l'appuntamento; la nota (hint) non si dice
    h+=`<div class="ans"><div class="ans-title">Il cliente: ${esc(tp.title)} · tu rispondi</div><div id="sosAnswer">${sayHTML([{text:tp.text}])}</div>
      ${tp.hint?`<p class="cue" data-soshint>${esc(tp.hint)}</p>`:""}
      <h3>Dopo la risposta</h3>${returnsHTML("data-sosret")}
      <div class="row"><button class="btn ghost" data-sosback>← Altre domande</button></div></div>`;
  } else {
    const words=snorm(sosQuery).split(" ").filter(Boolean), filtering=words.length&&words.join("").length>=2;
    const vis=filtering?topics.filter(t=>topicMatch(t,words)):topics;
    h+=`<div class="search"><input type="search" id="sosSearch" placeholder="Cerca la frase del cliente… (es. costa, socio, contratto)" value="${esc(sosQuery)}" autocomplete="off" spellcheck="false" aria-label="Cerca la frase del cliente"></div>`;
    h+=`<h3>Il cliente ti ha detto…</h3>`;
    h+=vis.length?`<div class="topics">${vis.map(t=>`<button data-sostopic="${t.key}">${esc(t.title)}</button>`).join("")}</div>`:"";
    if(filtering){ const res=searchDeep(sosQuery)||[]; h+=res.length?`<h3>Schede complete</h3><div class="opts">${res.map(e=>optHTML({tone:"op",label:e.title},`data-sosdeep="${e.id}"`)).join("")}</div>`:(vis.length?"":`<p class="small">Nessuna risposta per «${esc(sosQuery.trim())}»: prova con un'altra parola, oppure usa «Altro».</p>`); }
    h+=`<details class="more"><summary>Approfondimenti</summary><div class="opts">${F.sos.deepPhases.filter(id=>N[id]).map(id=>optHTML({tone:"op",label:N[id].title},`data-sosdeep="${id}"`)).join("")}${Object.entries(N).filter(([id,n])=>n.kind==="objection"&&!C.isDeepHidden(id)).map(([id,n])=>optHTML({tone:"op",label:n.title},`data-sosdeep="${id}"`)).join("")}</div></details>`;
  }
  sosBody.innerHTML=h;
  const si=document.getElementById("sosSearch");
  if(si){ si.addEventListener("input",()=>{ sosQuery=si.value; const pos=si.selectionStart; renderSos(); const n=document.getElementById("sosSearch"); if(n){ n.focus({preventScroll:true}); try{ n.setSelectionRange(pos,pos); }catch(e){} } });
    si.addEventListener("keydown",e=>{ if(e.key==="Enter"){ const f=sosBody.querySelector("[data-sostopic],[data-sosdeep]"); if(f) f.click(); } if(e.key==="Escape"){ e.stopPropagation(); sosQuery=""; renderSos(); } }); }
  sosBody.querySelectorAll("[data-sostopic]").forEach(b=>b.addEventListener("click",()=>{ sosTopic=b.dataset.sostopic; renderSos(); sosPanel.querySelector(".sheet").scrollTop=0; }));
  sosBody.querySelectorAll("[data-sosback]").forEach(b=>b.addEventListener("click",()=>{ sosTopic=null; renderSos(); }));
  sosBody.querySelectorAll("[data-sosclose]").forEach(b=>b.addEventListener("click",closeSos));
  sosBody.querySelectorAll("[data-sosret]").forEach(b=>b.addEventListener("click",()=>{ const r=F.sos.returns.find(x=>x.id===b.dataset.sosret); if(!r) return; if(r.back){ closeSos(); return; } if(!r.quick) sosPanel.hidden=true; doReturn(r.id); }));
  sosBody.querySelectorAll("[data-sosdeep]").forEach(b=>b.addEventListener("click",()=>{ sosPanel.hidden=true; C.openDeep(state,b.dataset.sosdeep); save(); render(true); }));
}
function openSos(){ sosTopic=null; sosQuery=""; renderSos(); sosPanel.hidden=false; sosPanel.querySelector(".sheet").scrollTop=0; const si=document.getElementById("sosSearch"); if(si&&window.matchMedia("(min-width:761px)").matches) si.focus({preventScroll:true}); }
function closeSos(){ sosPanel.hidden=true; const card=document.getElementById("card"); if(card){ card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash"); } }
document.getElementById("closeSos").addEventListener("click",closeSos);
document.getElementById("sosQuick").addEventListener("click",openQuick);

/* ── scheda azienda durante la chiamata ── */
const dataPanel=document.getElementById("dataPanel");
function openData(){ const pf=document.getElementById("panelForm"); pf.innerHTML=prepFormHTML(); bindInputs(pf); prepPreviews(pf); const r=()=>prepPreviews(pf); refreshers.push(r); dataPanel.hidden=false; }
function closeData(){ dataPanel.hidden=true; render(false); }
document.getElementById("btnData").addEventListener("click",openData);
document.getElementById("closeData").addEventListener("click",closeData);
document.getElementById("saveData").addEventListener("click",closeData);
document.getElementById("cancelCall").addEventListener("click",()=>{ C.cancelCall(state); save(); dataPanel.hidden=true; render(true); toast("Chiamata annullata: nessun esito salvato"); });
dataPanel.addEventListener("click",e=>{ if(e.target===dataPanel) closeData(); });

/* ── guida ── */
const refPanel=document.getElementById("refPanel"), refTabs=document.getElementById("refTabs"), refBody=document.getElementById("refBody");
const TABS=[["uso","Come si usa"],["parole","Parole"],["fatti","Cosa è vero"],["settore","Il settore"],["chi","Chi fa cosa"]];
let refTab="uso";
function renderRef(){
  refTabs.innerHTML=TABS.map(([k,l])=>`<button class="${refTab===k?"on":""}" data-t="${k}">${l}</button>`).join("");
  refTabs.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{ refTab=b.dataset.t; renderRef(); }));
  const R=D.ref; let h="";
  if(refTab==="uso"){
    h+=`<h3>L'obiettivo</h3><ul><li>Il prossimo passo giusto, nel minor tempo possibile: videocall o incontro; altrimenti analisi accettata, richiamata, referente giusto, ricontatto futuro, oppure una chiusura ordinata.</li><li>La chiamata dura di solito tra 30 e 90 secondi. Al telefono non si vende e non si fa la demo: si richiama l'email, si dice il punto emerso, si fissa il passo successivo.</li></ul>`;
    h+=`<h3>Come si legge</h3><ul><li>Sotto «Tu dici» c'è una sola battuta: leggila tutta, poi fermati. Il cliente risponde: premi il pulsante con la sua risposta.</li><li>Quando la scheda chiede il nome («…con chi ho il piacere di parlare?»), scrivilo nel campo mentre lo dice: la battuta successiva compare subito sotto, già con il nome. Se non lo dice: Invio o «Prosegui senza nome». Il nome non si chiede due volte e torna nella chiusura.</li><li>Dopo la frase dell'analisi compare «Adesso ascolta la risposta»: non si dice, ricorda solo di lasciar parlare il cliente.</li><li>Verde con la spunta: si avanza. Arancione con l'orologio: rinvio o barriera recuperabile. Rosso con la croce: stop. Grigio con la freccia: passaggio operativo.</li><li>Si propone di approfondire solo quando il cliente si apre; le due disponibilità compaiono solo se accetta.</li><li>Se il cliente dice qualcosa che non vedi: <b>SOS · altra risposta</b>. Dopo la risposta puoi tornare alla conversazione o scegliere un'uscita.</li><li>In qualsiasi momento: <b>Termina · esito</b>. Scegli come è finita e segni solo i dati che servono.</li></ul>`;
    h+=`<h3>Dopo la chiamata</h3><ul><li>Una schermata sola: frase di chiusura, riepilogo, dati indispensabili. «Salva e prossima azienda» registra l'esito e prepara la chiamata successiva.</li><li>Gli aggiornamenti di HubSpot non si fanno da qui: l'esito e le azioni previste vengono registrati, e cosa cambiare in HubSpot lo deciderà Agria Commercial.</li></ul>`;
  } else if(refTab==="parole"){
    h+=`<h3>Connettori che rendono la voce naturale</h3><div class="rchips">${R.connectors.map(w=>`<span class="rchip ok">${esc(w)}</span>`).join("")}</div>`;
    h+=`<h3>Formule di fretta da evitare</h3><div class="rchips">${R.hurry.map(w=>`<span class="rchip bad">${esc(w)}</span>`).join("")}</div>`;
  } else if(refTab==="fatti"){
    h+=`<h3>Le uniche prove che usi, e bastano</h3><ul>${R.truths.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`;
    h+=`<h3>Da tenere fuori, sempre</h3><ul>${R.never.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`;
  } else if(refTab==="settore"){
    const s=R.sectorSheet[state.company.sector], sec=D.sectors[state.company.sector];
    h+=!sec?`<p class="small">Scegli prima il settore nella preparazione.</p>`:`<h3>${esc(sec.label)}</h3><ul><li><b>Chi risponde di solito:</b> ${esc(s.who)}</li><li><b>Momento giusto per chiamare:</b> ${esc(s.when)}</li></ul>`;
  } else {
    h+=`<h3>Chi fa cosa in Agria</h3><ul>${R.who.map(([n,d])=>`<li><b>${esc(n)}</b> · ${esc(d)}</li>`).join("")}</ul>`;
  }
  refBody.innerHTML=h;
}
document.getElementById("btnRef").addEventListener("click",()=>{ renderRef(); refPanel.hidden=false; });
document.getElementById("closeRef").addEventListener("click",()=>{ refPanel.hidden=true; });
refPanel.addEventListener("click",e=>{ if(e.target===refPanel) refPanel.hidden=true; });
document.addEventListener("keydown",e=>{ if(e.key!=="Escape") return; if(!document.getElementById("dncPanel").hidden){ document.getElementById("dncPanel").hidden=true; return; } if(!quickPanel.hidden){ quickPanel.hidden=true; return; } if(!sosPanel.hidden){ closeSos(); return; } if(!dataPanel.hidden){ closeData(); return; } refPanel.hidden=true; });

/* ── timer: verde durante la chiamata, arancione oltre i 2 minuti (solo un'indicazione) ── */
function fmt(ms){ const s=Math.max(0,Math.floor(ms/1000)); return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0"); }
function tick(){ const t=document.getElementById("timer"); t.classList.remove("live","warn"); if(state.call.startedAt){ const ms=(state.call.completedAt||Date.now())-state.call.startedAt; t.textContent=fmt(ms); if(!state.call.completedAt) t.classList.add(ms>120000?"warn":"live"); } else t.textContent="00:00"; }
setInterval(tick,1000);

/* ── toast ── */
let toastT; function toast(m){ const t=document.getElementById("toast"); t.textContent=m; t.classList.add("on"); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("on"),1800); }

/* lettura per i test e per il futuro collegamento: nessuna scrittura da fuori */
window.AGRIA_NAV={ state:()=>JSON.parse(JSON.stringify(state)), lastOutcome:()=>lastOutcome?JSON.parse(JSON.stringify(lastOutcome)):C.readOutcome(store()||{getItem:()=>null}) };
try{ if(window.claude&&window.claude.hot&&window.claude.hot.snapshot) window.claude.hot.snapshot(()=>state); }catch(e){}
render(false);
})();
