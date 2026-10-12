
(function(){
const D=window.AGRIA, N=D.nodes;
const KEY='agria-nav-v6';
const LABELS={saluto:"saluto",commerciale:"tuo nome",azienda:"nome azienda",titolare:"nome del titolare",iltitolare:"il titolare",nome:"nome di chi risponde",zona:"zona",azona:"a [zona]",dataEmail:"giorno dell'email",dettaglio:"cosa è emerso dall'analisi",slotA:"prima disponibilità",slotB:"seconda disponibilità",fissato:"giorno e ora concordati",richiamata:"giorno e ora della richiamata",rgiorno:"giorno",rora:"ora",recapito:"email o WhatsApp",whatsapp:"numero WhatsApp",gestionale:"nome del gestionale",contatto:"recapito",appunti:"quello che ha detto, con le sue parole"};
const SI={hospitality:0,cantina:1,frantoio:2};
const PHASE_SHORT={f0:"Preparazione",f1:"Apertura",f2:"Email",f3:"Perché voi",f4:"Verifica",f5:"Proposta",f6:"Chiusura",f7:"HubSpot"};
const REQ=[["settore","Settore"],["commerciale","Il tuo nome"],["azienda","Nome azienda"],["zona","Zona"],["dataEmail","Giorno dell'email"],["dettaglio","Cosa è emerso dall'analisi"],["sito","Sito esistente"],["umbria","L'azienda è in Umbria?"],["slotAday","Prima disponibilità: giorno"],["slotAtime","Prima disponibilità: ora"],["slotBday","Seconda disponibilità: giorno"],["slotBtime","Seconda disponibilità: ora"]];
const SITO={si:"Sito funzionante",ecommerce:"Sito + e-commerce",vecchio:"Sito vecchio, rotto o poco efficace",no:"Zero sito"};
const KEEP=["commerciale","slotAday","slotAtime","slotBday","slotBtime"];

function blank(){ return {settore:"",sito:"",commerciale:"",azienda:"",titolare:"",nome:"",zona:"",dataEmail:"",dettaglio:"",slotAday:"",slotAtime:"",slotBday:"",slotBtime:"",richiamata:"",rgiorno:"",rora:"",fissato:"",recapito:"",whatsapp:"",contatto:"",appunti:"",gestionale:"",umbria:""}; }
function fresh(keep){ return {fields:Object.assign(blank(),keep||{}),flags:{detto:false},skip:{},pre:{},phase:"f0",stack:[],area:null,outcome:null,checks:{},started:null,ended:null,note:""}; }
let state=fresh();
function load(){ try{ const s=localStorage.getItem(KEY); if(s){ const o=JSON.parse(s); state=Object.assign(fresh(),o); state.fields=Object.assign(blank(),o.fields||{}); if(typeof state.fields.umbria==="boolean") state.fields.umbria=state.fields.umbria?"si":"no"; Object.keys(state.pre).forEach(k=>{ if(typeof state.pre[k]==="boolean") state.pre[k]=state.pre[k]?"si":""; }); state.flags=Object.assign({detto:false},o.flags||{}); state.pre=o.pre||{}; } }catch(e){} }
function save(){ try{ localStorage.setItem(KEY,JSON.stringify(state)); }catch(e){} }

const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ── date e orari ── */
const GIORNI=["domenica","lunedì","martedì","mercoledì","giovedì","venerdì","sabato"];
const MESI=["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
function isoLocal(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function dayLabel(iso){ if(!iso) return ""; const [y,m,d]=iso.split("-").map(Number); const dt=new Date(y,m-1,d); return `${GIORNI[dt.getDay()]} ${d} ${MESI[m-1]}`; }
function timeLabel(t){ if(!t) return ""; const [h,m]=t.split(":"); return m==="00"?String(+h):`${+h}:${m}`; }
function dayOptions(selected){ const out=[]; const now=new Date(); for(let i=0;i<42;i++){ const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()+i); if(d.getDay()===0) continue; const iso=isoLocal(d); out.push(`<option value="${iso}"${iso===selected?" selected":""}>${dayLabel(iso)}</option>`); } if(selected&&!out.some(o=>o.includes(`value="${selected}"`))) out.unshift(`<option value="${selected}" selected>${dayLabel(selected)}</option>`); return `<option value="">giorno…</option>`+out.join(""); }
function timeOptions(selected){ const out=[]; for(let h=8;h<=19;h++){ for(const m of ["00","30"]){ const t=String(h).padStart(2,"0")+":"+m; out.push(`<option value="${t}"${t===selected?" selected":""}>${h}:${m}</option>`); } } return `<option value="">ora…</option>`+out.join(""); }
function slotText(which){ const d=state.fields["slot"+which+"day"], t=state.fields["slot"+which+"time"]; if(!d||!t) return ""; return `${dayLabel(d)} alle ${timeLabel(t)}`; }

/* ── valori e segnaposto ── */
function val(k){
  if(k==="iltitolare"){ const t=(state.fields.titolare||"").trim(); if(!t) return ""; const m=t.match(/^(signora|sig\.ra|dottoressa|signor|sig\.|dottor|dott\.|ing\.|avv\.)\s+/i); if(!m) return t; const w=m[1].toLowerCase(); if(/^[aeiou]/.test(w)) return "l'"+t; return (/^(signora|sig\.ra|dottoressa)$/.test(w)?"la ":"il ")+t; }
  if(k==="richiamata"){ const r=(state.fields.richiamata||"").trim(); if(r) return r; const g=(state.fields.rgiorno||"").trim(), o=(state.fields.rora||"").trim(); if(!g&&!o) return ""; if(g&&o) return /^\d/.test(o)?`${g} alle ${o}`:`${g} ${o}`; return g||o; }
  if(k==="azona"){ const z=(state.fields.zona||"").trim(); if(!z) return ""; return (/^[aeiouàèéìòù]/i.test(z)?"ad ":"a ")+z; }
  if(k==="recapito"){ const r=(state.fields.recapito||"").trim(); return r||(state.fields.whatsapp||"").trim(); }
  if(k==="saluto"){ const d=new Date(); return (d.getHours()+d.getMinutes()/60)<14?"Buongiorno":"Buonasera"; }
  if(k==="slotA") return slotText("A");
  if(k==="slotB") return slotText("B");
  if(k==="disponibilita"){ const a=slotText("A"), b=slotText("B"); return a&&b?a+" oppure "+b:(a||b); }
  if(k==="dettaglio"){ let d=(state.fields.dettaglio||"").trim().replace(/[.\s]+$/,""); if(/^(Non|Il|La|Le|Gli|Lo|I|L'|Un|Una|Uno|Hanno|Manca|Mancano|Sul|Sulla|Sulle|Sui|Nel|Nella|Nelle|C'è|Ci|Vendono|Lavorano|Usano|Gestiscono|Prenotano|Ricevono|Spediscono|Oggi|Quasi|Tutto|Tutte|Tutti|Chi|Gran)\b/.test(d)) d=d[0].toLowerCase()+d.slice(1); return d; }
  return (state.fields[k]||"").trim();
}
let TOKS=[];
function tokHTML(id){
  const {pre,k,suf,fb}=TOKS[id]; const v=val(k);
  const bind=k==="iltitolare"?"titolare":(k==="slotA"||k==="slotB"||k==="disponibilita")?"slots":(k==="rgiorno"||k==="rora")?"richiamata":k==="azona"?"zona":k==="whatsapp"?"recapito":k;
  if(v){ const cls=k==="appunti"?"tok v quote":"tok v"; return `<span class="${cls}" data-bind="${bind}" data-ti="${id}">${esc(pre)}${esc(v)}${esc(suf)}</span>`; }
  if(fb!==undefined){ if(fb==="") return `<span class="tok" data-bind="${bind}" data-ti="${id}"></span>`; return `<span class="tok fb" data-bind="${bind}" data-ti="${id}">${esc(pre)}${fillSpans(esc(fb))}${esc(suf)}</span>`; }
  return `<span class="tok ph" data-bind="${bind}" data-ti="${id}">${esc(pre)}${esc(LABELS[k]||k)}${esc(suf)}</span>`;
}
function fillSpans(s){ return s.replace(/\[([^\]]+)\]/g,'<span class="fill">$1</span>'); }
function tpl(s){
  if(!s) return "";
  const si=SI[state.fields.settore]??0;
  s=s.replace(/\[\[([^\]]*)\]\]/g,(_,g)=>g.split("|")[si]??"");
  // token in testa alla frase con suffisso e fallback vuoto, es. «{nome, |}siamo…»: se il valore manca sparisce e la frase parte con la maiuscola
  s=s.replace(/^\{([\s,]*)(\w+)([\s,]+)\|\}(\p{Ll})/u,(m,pre,k,suf,c)=>val(k)?m:c.toUpperCase());
  s=esc(s);
  s=s.replace(/\{([\s,]*)(\w+)([\s,]*)(?:\|([^}]*))?\}/g,(_,pre,k,suf,fb)=>{ const id=TOKS.push({pre,k,suf,fb})-1; return `\u0001${id}\u0002`; });
  s=fillSpans(s);
  return s.replace(/\u0001(\d+)\u0002/g,(_,id)=>tokHTML(+id));
}
function updateTokens(k){ const bind=k==="iltitolare"?"titolare":/^slot/.test(k)?"slots":(k==="rgiorno"||k==="rora")?"richiamata":k==="whatsapp"?"recapito":k; document.querySelectorAll(`[data-bind="${bind}"]`).forEach(el=>{ const id=+el.dataset.ti; if(TOKS[id]) el.outerHTML=tokHTML(id); }); }
const FLAGS=["detto","visto","noto","sonoio","altro","presentato"];
function condOk(when){ if(!when) return true; return Object.entries(when).every(([k,want])=>{ if(k==="umbria") return (state.fields.umbria==="si")===!!want; if(FLAGS.includes(k)) return !!state.flags[k]===!!want; if(k==="sito") return Array.isArray(want)?want.includes(state.fields.sito):state.fields.sito===want; return !!val(k)===!!want; }); }
function whenAttr(w){ return w?` data-when="${Object.entries(w).map(([k,v])=>k+":"+(typeof v==="boolean"?(v?"true":"false"):Array.isArray(v)?v.join("|"):v)).join(",")}"`:""; }
function updateConditionals(){ document.querySelectorAll("[data-when]").forEach(el=>{ const w={}; el.dataset.when.split(",").forEach(c=>{ const [k,v]=c.split(":"); w[k]=(v==="true")?true:(v==="false")?false:(v.includes("|")?v.split("|"):v); }); el.hidden=!condOk(w); }); }
function setField(k,v,src){
  state.fields[k]=v;
  save();
  document.querySelectorAll(`[data-k="${k}"]`).forEach(el=>{ if(el===src) return; if(el.type==="checkbox") el.checked=!!v; else if(el.value!==v) el.value=v; });
  updateTokens(k); updateConditionals(); updateGates(); updateStartGate(); updatePreviews();
}
function setSeg(k,v){ state.fields[k]=v; save(); document.querySelectorAll(`[data-seg="${k}"] button`).forEach(b=>b.classList.toggle("on",b.dataset.val===v)); document.querySelectorAll(`[data-seg="${k}"]`).forEach(s=>s.classList.remove("miss")); updateConditionals(); updateStartGate(); if(k==="settore") render(false); }
function bindInputs(root){
  root.querySelectorAll("[data-k]").forEach(el=>{
    if(el.dataset.bound) return; el.dataset.bound="1";
    const k=el.dataset.k;
    if(el.type==="checkbox"){ el.checked=!!state.fields[k]; el.addEventListener("change",()=>setField(k,el.checked,el)); }
    else if(el.tagName==="SELECT"){ el.value=state.fields[k]||""; el.addEventListener("change",()=>setField(k,el.value,el)); }
    else { el.value=state.fields[k]||""; el.addEventListener("input",()=>setField(k,el.value,el)); }
  });
  root.querySelectorAll("[data-seg]").forEach(seg=>{ if(seg.dataset.bound) return; seg.dataset.bound="1"; const k=seg.dataset.seg; seg.querySelectorAll("button").forEach(b=>{ b.classList.toggle("on",state.fields[k]===b.dataset.val); b.addEventListener("click",()=>setSeg(k,b.dataset.val)); }); });
}

/* ── modulo dati ── */
function formHTML(p){
  return `<div class="form">
    <div class="field wide"><label>Settore dell'azienda <span class="req">*</span></label><div class="seg" data-seg="settore">${Object.entries(D.sectors).map(([k,s])=>`<button type="button" data-val="${k}">${s.label}</button>`).join("")}</div></div>
    <div class="field"><label for="${p}commerciale">Il tuo nome e cognome <span class="req">*</span></label><input id="${p}commerciale" data-k="commerciale" placeholder="Alessandro Poponi"></div>
    <div class="field"><label for="${p}azienda">Nome azienda <span class="req">*</span></label><input id="${p}azienda" data-k="azienda" placeholder="Agriturismo …"></div>
    <div class="field"><label for="${p}zona">Zona <span class="req">*</span></label><input id="${p}zona" data-k="zona" placeholder="Assisi / Montefalco / Trevi"></div>
    <div class="field"><label for="${p}dataEmail">Giorno dell'email <span class="req">*</span></label><input id="${p}dataEmail" data-k="dataEmail" placeholder="giovedì / due giorni fa"></div>
    <div class="field wide"><label for="${p}dettaglio">Cosa è emerso dall'analisi della loro rete digitale? <span class="req">*</span> <span class="hint">· scrivi solo la parte che viene dopo «è emerso che», in minuscolo e senza punto finale</span></label>
      <div class="stem"><span class="pre">…è emerso che</span><textarea id="${p}dettaglio" data-k="dettaglio" placeholder="le prenotazioni passano ancora soprattutto dai portali e il sito è disponibile solo in italiano"></textarea></div>
      <div class="preview" data-preview="dettaglio"></div></div>
    <div class="field wide"><label>Hanno già un sito? <span class="req">*</span> <span class="hint">· cambia la battuta della Fase 3</span></label><div class="seg" data-seg="sito">${Object.entries(SITO).map(([k,l])=>`<button type="button" data-val="${k}">${l}</button>`).join("")}</div></div>
    <div class="field wide"><label>Le tue due disponibilità per la videocall <span class="req">*</span> <span class="hint">· dal calendario; le proponi al cliente così come sono scritte sotto</span></label>
      <div class="slots">
        <div class="slot"><div class="sl">Prima disponibilità</div><div class="sr"><select data-k="slotAday">${dayOptions(state.fields.slotAday)}</select><select data-k="slotAtime">${timeOptions(state.fields.slotAtime)}</select></div><div class="out" data-preview="slotA"></div></div>
        <div class="slot"><div class="sl">Seconda disponibilità</div><div class="sr"><select data-k="slotBday">${dayOptions(state.fields.slotBday)}</select><select data-k="slotBtime">${timeOptions(state.fields.slotBtime)}</select></div><div class="out" data-preview="slotB"></div></div>
      </div></div>
    <div class="field wide"><label for="${p}titolare">Nome del titolare o del referente, se lo conosci <span class="hint">· come lo diresti al telefono: «signor Bianchi» oppure «Marco»</span></label><input id="${p}titolare" data-k="titolare" placeholder="signor Bianchi"></div>
    <div class="field wide"><label for="${p}umbria">L'azienda è in Umbria? <span class="req">*</span> <span class="hint">· con «Sì» le battute propongono anche l'incontro dal vivo</span></label><select id="${p}umbria" data-k="umbria"><option value="">Scegli…</option><option value="si">Sì, è in Umbria</option><option value="no">No, è fuori Umbria</option></select></div>
  </div>`;
}
function updatePreviews(){
  document.querySelectorAll('[data-preview="dettaglio"]').forEach(el=>{ const d=val("dettaglio"); el.innerHTML=`<span class="small">Così verrà detto durante la chiamata:</span><br>Dalla prima analisi di <b>${esc(state.fields.azienda||"[Nome Azienda]")}</b> è emerso che ${d?esc(d):"<span class=\"fill\">…</span>"}.`; });
  document.querySelectorAll('[data-preview="slotA"]').forEach(el=>{ el.textContent=val("slotA")||"—"; });
  document.querySelectorAll('[data-preview="slotB"]').forEach(el=>{ el.textContent=val("slotB")||"—"; });
}
function missing(){ return REQ.filter(([k])=>!(state.fields[k]||"").trim()).map(([,l])=>l); }
function preOk(){ return N.f0.checklist.every((c,i)=>state.pre[i]==="si"); }
function selHTML(attr,i,val,yes,no){ return `<select ${attr}="${i}"><option value=""${val===""?" selected":""}>Scegli…</option><option value="si"${val==="si"?" selected":""}>${yes}</option><option value="no"${val==="no"?" selected":""}>${no}</option></select>`; }
function updateStartGate(){
  const m=missing();
  const btn=document.getElementById("startCall"); if(btn) btn.disabled=m.length>0||!preOk();
  const note=document.getElementById("missNote"); if(note){ const msgs=[]; if(m.length) msgs.push("Da compilare: "+m.join(", ")+"."); if(!preOk()) msgs.push("Rispondi «Sì, fatto» ai tre controlli qui sotto."); note.hidden=msgs.length===0; note.textContent=msgs.join(" "); }
  document.querySelectorAll("#view [data-k]").forEach(el=>{ const r=REQ.find(([k])=>k===el.dataset.k); if(r) el.classList.toggle("miss",!(state.fields[el.dataset.k]||"").trim()); });
  document.querySelectorAll('#view [data-seg="sito"]').forEach(s=>s.classList.toggle("miss",!state.fields.sito));
  document.querySelectorAll('#view [data-seg="settore"]').forEach(s=>s.classList.toggle("miss",!state.fields.settore));
}

/* ── navigazione ── */
const view=document.getElementById("view"), bottomIn=document.getElementById("bottomIn"), stepsEl=document.getElementById("steps");
function current(){ return state.stack.length?N[state.stack[state.stack.length-1]]:N[state.phase]; }
function curId(){ return state.stack.length?state.stack[state.stack.length-1]:state.phase; }
function go(to,opt){
  if(opt&&opt.area) state.area=opt.area;
  if(to!=="back"){ const cur=current(); if(cur&&cur.set) Object.assign(state.flags,cur.set); }
  if(opt&&opt.set) Object.assign(state.flags,opt.set);
  if(opt&&opt.outcome) state.outcome=opt.outcome;
  if(opt&&opt.copy) Object.entries(opt.copy).forEach(([k,src])=>{ state.fields[k]=val(src); });
  if(N[to]&&N[to].nameFromTitolare&&!val("nome")&&val("titolare")) state.fields.nome=val("titolare");
  if(to==="back"){ state.stack=[]; }
  else if(N[to]&&N[to].kind==="phase"){ state.phase=to; state.stack=[]; if(to==="f7"&&state.started&&!state.ended) state.ended=Date.now(); }
  else { state.stack.push(to); }
  save(); render(true);
}
function back(){ state.stack.pop(); save(); render(true); }
function setPhase(p){ state.phase=p; state.stack=[]; save(); render(true); }

function render(flash){
  TOKS=[];
  const node=current();
  const html=node.kind==="phase"?renderPhase(node):renderReply(node);
  view.innerHTML=`<section class="card${flash?" flash":""}" id="card">${html}</section>`;
  renderSteps(); renderBottom(node); bindView(); updateConditionals(); updateGates(); updateStartGate(); updatePreviews();
  window.scrollTo({top:0,behavior:"auto"});
  const cap=view.querySelector(".cap:not(.soft):not([hidden]) input, .cap:not(.soft):not([hidden]) textarea"); if(cap&&flash&&!cap.value) cap.focus({preventScroll:true});
}
/* Barra delle fasi: cliccabile (si può saltare a qualsiasi fase). Durante la chiamata la Fase 0 sparisce: i dati si correggono da «Modifica dati». */
function renderSteps(){
  const phases=D.phases.filter(p=>p!=="f0"||!state.started);
  stepsEl.innerHTML=phases.map(p=>{ const n=N[p]; const cls=p===state.phase?"cur":(n.num<N[state.phase].num?"done":""); return `<button class="step ${cls}" data-phase="${p}"${cls==="cur"?' aria-current="step"':""}><span class="n">${n.num}</span>${PHASE_SHORT[p]}</button>`; }).join("");
  stepsEl.querySelectorAll(".step").forEach(b=>b.addEventListener("click",()=>{ if(b.dataset.phase===state.phase) return; if(b.dataset.phase!=="f0"&&missing().length){ toast("Prima compila i dati della chiamata"); return; } setPhase(b.dataset.phase); }));
  const cur=stepsEl.querySelector(".step.cur"); if(cur&&cur.scrollIntoView){ try{cur.scrollIntoView({inline:"center",block:"nearest",behavior:"auto"});}catch(e){} }
}
function renderBottom(node){
  const ph=N[state.phase];
  if(node.kind==="phase"){
    const i=D.phases.indexOf(state.phase); const prev=D.phases[i-1], next=D.phases[i+1];
    let h="";
    if(prev&&prev!=="f0"&&state.phase!=="f7") h+=`<button class="btn ghost" data-go="${prev}">← Fase ${N[prev].num}</button>`;
    h+=`<span class="spacer"></span>`;
    if(state.phase==="f0") h+=`<button class="btn primary" id="startCall">Inizia la chiamata →</button>`;
    else if(state.phase==="f7") h+=`<button class="btn primary" id="newCall">Nuova chiamata</button>`;
    else if(next&&state.phase!=="f6"&&state.phase!=="f5") h+=`<button class="btn ghost" data-go="${next}"><span class="t">Avanti → Fase ${N[next].num} · ${PHASE_SHORT[next]}</span></button>`;
    bottomIn.innerHTML=h;
  } else {
    bottomIn.innerHTML=`<button class="btn ghost" id="btnBack">← Indietro</button><span class="spacer"></span><button class="btn primary" data-go="back"><span class="t">↩ Torna a Fase ${ph.num} · ${PHASE_SHORT[state.phase]}</span></button>`;
  }
  bottomIn.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.go)));
  const bb=document.getElementById("btnBack"); if(bb) bb.addEventListener("click",back);
  const sc=document.getElementById("startCall"); if(sc) sc.addEventListener("click",startCall);
  const nc=document.getElementById("newCall"); if(nc){ nc.addEventListener("click",newCall); updateHubGate(); }
}

/* ── blocchi ── */
function sayBlock(lines,cls){
  if(!lines||!lines.length) return "";
  return `<div class="say${cls?" "+cls:""}">${lines.map(l=>{
    const w=whenAttr(l.when);
    if(l.t==="alt") return `<p class="alt"${w}><span class="al">${esc(l.label)}</span>${tpl(l.text)}</p>`;
    return `<p${w}>${tpl(l.text)}</p>`;
  }).join("")}</div>`;
}
function capHTML(c,nodeId,soft){
  const w=whenAttr(c.when);
  const isArea=c.key==="appunti";
  const field=isArea?`<textarea data-k="${c.key}" placeholder="${esc(c.placeholder||"")}"></textarea>`:`<input data-k="${c.key}" placeholder="${esc(c.placeholder||"")}" autocomplete="off">`;
  const btn=c.go&&!c.soft?`<button class="btn capgo" data-capgo="${c.key}" data-go="${c.go}"${c.skipTo?` data-skipto="${c.skipTo}"`:""}${c.outcome?` data-outcome="${c.outcome}"`:""}${c.skip?` data-skip="${esc(c.skip)}"`:""} data-golabel="${esc(c.goLabel||"Prosegui")}"></button>`:"";
  return `<div class="cap${soft?" soft":""}" data-cap="${c.key}" data-req="${soft?"0":"1"}"${w}><div class="cl">${esc(c.label)}</div><div class="caprow">${field}${btn}</div></div>`;
}
function optsHTML(list,cls,label,scope){
  if(!list) return "";
  const vis=list.map((o,i)=>({o,i})).filter(({o})=>condOk(o.when));
  if(!vis.length) return "";
  return `${label?`<div class="label">${label}</div>`:""}<div class="opts${cls?" "+cls:""}">${vis.map(({o,i})=>`<button class="opt" data-scope="${scope}" data-i="${i}"><span class="l">${tpl(o.label)}</span>${o.hint?`<span class="h">${esc(o.hint)}</span>`:""}</button>`).join("")}</div>`;
}
function moreHTML(list,scope,withSearch=true){
  const vis=(list||[]).filter(o=>condOk(o.when));
  const det=vis.length?`<details class="more"><summary>Altre risposte · ${vis.length}</summary>${optsHTML(list,"","",scope)}</details>`:"";
  if(!withSearch) return det;
  return `<div class="morerow">${searchHTML()}${det}</div><div class="sres" data-sres hidden></div>`;
}
/* ── ricerca obiezioni: titolo + frasi del cliente + parole chiave (D.search); basta l'inizio di ogni parola digitata ── */
function searchHTML(){ return `<div class="search"><input type="search" data-search placeholder="Cerca un'obiezione… (es. costa, AI, socio)" autocomplete="off" spellcheck="false" aria-label="Cerca un'obiezione"></div>`; }
function snorm(s){ return String(s||"").toLowerCase().replace(/\{[^}]*\}/g," ").replace(/\[\[([^\]]*)\]\]/g,(_,g)=>g.replace(/\|/g," ")).normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9\s]+/g," ").replace(/\s+/g," ").trim(); }
let SEARCH=null;
function buildSearch(){
  const inc={}; for(const [id,n] of Object.entries(N)){ [].concat(n.primary||[],n.options||[],(n.after&&n.after.primary)||[],(n.after&&n.after.options)||[]).forEach(o=>{ if(N[o.to]) (inc[o.to]=inc[o.to]||[]).push(o.label); }); }
  const ids=new Set(Object.keys(D.search||{})); for(const [id,n] of Object.entries(N)) if(n.kind==="objection") ids.add(id);
  SEARCH=[...ids].filter(id=>N[id]).map(id=>({id,title:N[id].title,t:snorm(N[id].title).split(" ").filter(Boolean),l:snorm((inc[id]||[]).join(" ")).split(" ").filter(Boolean),k:snorm((D.search||{})[id]||"").split(" ").filter(Boolean)}));
}
function searchObjections(q){
  if(!SEARCH) buildSearch();
  const words=snorm(q).split(" ").filter(Boolean); if(!words.length||words.join("").length<2) return null;
  const res=[];
  for(const e of SEARCH){ let score=0, ok=true; for(const w of words){ const inT=e.t.some(x=>x.startsWith(w)), inL=e.l.some(x=>x.startsWith(w)), inK=e.k.some(x=>x.startsWith(w)); if(!(inT||inL||inK)){ ok=false; break; } score+=inT?3:inL?2:1; if(e.t.includes(w)) score+=1; } if(ok) res.push({e,score}); }
  res.sort((a,b)=>b.score-a.score||a.e.title.localeCompare(b.e.title,"it"));
  return res.slice(0,8).map(r=>r.e);
}
function sresHTML(q,res){
  if(res===null) return "";
  if(!res.length) return `<div class="small">Nessuna scheda per «${esc(q.trim())}»: prova con un'altra parola, oppure apri «Altre risposte».</div>`;
  return `<div class="label">Schede trovate <span class="small">· premi quella giusta</span></div><div class="opts">${res.map(e=>`<button class="opt" data-sgo="${e.id}"><span class="l">${esc(e.title)}</span>${N[e.id].kind==="objection"?"":`<span class="h">${esc(PHASE_SHORT[phaseOf(e.id)]||"")}</span>`}</button>`).join("")}</div>`;
}
function phaseOf(id){ const m=id.match(/^r(\d)_/); return m?"f"+m[1]:""; }
function bindSearch(root,onPick){
  root.querySelectorAll("[data-search]").forEach(inp=>{
    const box=inp.closest(".morerow").nextElementSibling;
    const run=()=>{ const q=inp.value; const res=searchObjections(q); box.innerHTML=sresHTML(q,res); box.hidden=res===null; box.querySelectorAll("[data-sgo]").forEach(b=>b.addEventListener("click",()=>onPick(b.dataset.sgo))); };
    inp.addEventListener("input",run);
    inp.addEventListener("keydown",e=>{ if(e.key==="Enter"){ const f=box.querySelector("[data-sgo]"); if(f) f.click(); } if(e.key==="Escape"){ inp.value=""; run(); inp.blur(); } });
  });
}
function listenHTML(){
  return `<div class="listen"><div class="cl">Di cosa ha parlato? <span class="small">· premi l'ambito: compare la battuta della Fase 5</span></div><div class="areas">${Object.entries(D.areas).map(([k,a])=>`<button class="area" data-area-go="${k}"><span class="l">${a.btn}</span><span class="n">${a.name}</span></button>`).join("")}</div></div>`;
}
function afterHTML(n,id){
  const a=n.after; if(!a) return "";
  return `<div class="after" id="after" hidden>${sayBlock(a.say)}${(a.captures||[]).map(c=>capHTML(c,id,true)).join("")}${sayBlock(a.say2)}${optsHTML(a.primary,"big","Poi",'ap')}${moreHTML(a.options,'ao',false)}</div>`;
}
function bodyHTML(n,id){
  let h=n.say?`<div class="label">Tu dici</div>${sayBlock(n.say)}`:"";
  if(n.table) h+=`<div class="tech">${n.table.map(r=>`<div><span>${esc(r.q)}</span><span>${tpl(r.a)}</span></div>`).join("")}</div>`;
  if(n.say2) h+=sayBlock(n.say2);
  if(n.capture) h+=capHTML(n.capture,id,!!n.capture.soft);
  if(n.then) h+=sayBlock(n.then);
  (n.captures||[]).forEach(c=>h+=capHTML(c,id,n.anyOf?false:true));
  if(n.after&&n.skipLabel) h+=`<div class="row" style="margin-top:8px"><button class="btn capgo danger" data-skipafter="1">${esc(n.skipLabel)}</button></div>`;
  if(n.listen) h+=listenHTML();
  if(n.second) h+=`<div class="say" style="margin-top:12px"><p class="alt" style="border:0;padding:0"><span class="al">${esc(n.second.label)}</span>${tpl(n.second.text)}</p></div>`;
  h+=afterHTML(n,id);
  h+=optsHTML(n.primary,"big",n.after||n.listen?"":"Il cliente dice…",'p');
  h+=moreHTML(n.options,'o');
  return h;
}
function renderPhase(n){
  let h=`<div class="eyebrow">Fase ${n.num} di 7</div><h1>${esc(n.title)}</h1>`;
  if(n.num===0) return h+renderF0(n);
  if(n.num===4) return h+renderF4(n);
  if(n.num===5) return h+renderF5(n);
  if(n.num===7) return h+renderF7(n);
  return h+bodyHTML(n,curId());
}
function renderReply(n){
  const ph=N[state.phase]; const trail=state.stack.map(id=>N[id].title).join(" › ");
  let h=`<div class="eyebrow">Dalla Fase ${ph.num} <span class="trail">${esc(PHASE_SHORT[state.phase])} › ${esc(trail)}</span></div><h1>${esc(n.title)}</h1>`;
  return h+bodyHTML(n,curId());
}
function renderF0(n){
  return `${formHTML("f_")}<div class="notice" id="missNote" hidden></div>
  <div class="label">Prima di comporre il numero <span class="small">· tre controlli obbligatori</span></div><ul class="check">${n.checklist.map((c,i)=>`<li class="req${state.pre[i]==="si"?" done":""}"><span class="ct">${esc(c)}</span>${selHTML("data-c",i,state.pre[i]||"","Sì, fatto","No, non ancora")}</li>`).join("")}</ul>`;
}
function renderF4(n){
  let h=`<p class="lead">${esc(n.lead||"Se il cliente ha già fatto emergere un problema, premi l'ambito di cui ha parlato. Se dice che va tutto bene, usa il pulsante sotto.")}</p>`;
  h+=listenHTML();
  if(n.second) h+=`<div class="say" style="margin-top:12px"><p class="alt" style="border:0;padding:0"><span class="al">${esc(n.second.label)}</span>${tpl(n.second.text)}</p></div>`;
  if(n.options&&n.options.length) h+=`<div class="row">${n.options.map((o,i)=>`<button class="btn ghost small" data-scope="o" data-i="${i}">${tpl(o.label)}</button>`).join("")}</div>`;
  h+=`<div class="morerow">${searchHTML()}</div><div class="sres" data-sres hidden></div>`;
  return h;
}
function renderF5(n){
  const a=state.area;
  let h=n.mirror?`<div class="label">Tu dici</div><div class="say"><p>${tpl(n.mirror.text)}</p></div>`:"";
  h+=`<div class="label">${n.mirror?"Poi l'area":"L'ambito"} <span class="small">· quella di cui ha parlato</span></div><div class="areasel">${Object.keys(n.areaText).map(k=>`<button class="${a===k?"on":""}" data-area="${k}">${D.areas[k].name}</button>`).join("")}</div>`;
  if(a&&n.areaText[a]) h+=`<div class="label">Tu dici</div><div class="say"><p>${tpl(n.areaText[a])}</p></div>${sayBlock(Array.isArray(n.bridge)?n.bridge:[n.bridge])}`;
  else h+=`<div class="notice">Scegli l'area qui sopra: compare la battuta da dire, con la proposta della videocall.</div>`;
  h+=optsHTML(n.primary,"big","Il cliente dice…",'p')+moreHTML(n.options,'o');
  return h;
}
function outcomeByKey(k){ return N.f7.outcomes.find(o=>o.key===k); }
function renderF7(n){
  let h=`<div class="label">Com'è finita?</div><div class="outs">${n.outcomes.map(o=>`<button class="opt${state.outcome===o.key?" go":""}" data-out="${o.key}"><span class="l">${esc(o.o)}</span></button>`).join("")}</div>`;
  const o=outcomeByKey(state.outcome);
  if(o){
    const done=state.checks[o.key]||[];
    h+=`<div class="outcome"><div class="st">In HubSpot</div><div class="stage">${esc(o.stage)}</div><ul class="check">${o.checks.map((c,i)=>`<li class="req${done[i]?" done":""}"><span class="ct">${tpl(c.t)}</span>${selHTML("data-hub",i,done[i]?"si":(done[i]===false?"no":""),"Fatto in HubSpot","Non ancora")}</li>`).join("")}</ul><div class="notice" id="hubNote"></div></div>`;
    h+=`<div class="label">Nota per HubSpot <span class="small">· copiala nel contatto</span></div><textarea class="notearea" id="noteArea">${esc(state.note||defaultNote(o))}</textarea><div class="row"><button class="btn" id="copyNote">Copia la nota</button><button class="btn ghost" id="resetNote">Rigenera la nota</button></div>`;
  } else {
    h+=`<div class="notice">Scegli l'esito: compaiono i passi da fare in HubSpot prima della prossima chiamata.</div>`;
  }
  return h;
}
function defaultNote(o){
  const f=state.fields; const dur=state.started?fmt((state.ended||Date.now())-state.started):"";
  const L=[`Follow-up telefonico ${new Date().toLocaleDateString("it-IT")}${dur?" · durata "+dur:""} · ${f.commerciale}`,
    `Azienda: ${f.azienda} · ${f.zona} · settore: ${D.sectors[f.settore].label}`,
    `Parlato con: ${f.nome||f.titolare||"nome da recuperare"}`,
    `Esito: ${o.o}`];
  if(f.fissato) L.push(`Videocall / incontro: ${f.fissato}`);
  if(f.richiamata) L.push(`Richiamata: ${f.richiamata}`);
  if(f.recapito) L.push(`Recapito per la conferma: ${f.recapito}`);
  if(f.contatto) L.push(`Recapito diretto: ${f.contatto}`);
  if(f.gestionale) L.push(`Gestionale del cliente: ${f.gestionale} (verifica tecnica da fare)`);
  if(state.area) L.push(`Area: ${D.areas[state.area].name}`);
  L.push(`Emerso dall'analisi: ${val("dettaglio")}`);
  if(f.appunti) L.push(`Parole del cliente: ${f.appunti}`);
  L.push(`Obiezioni e come è finita: `);
  L.push(`Domande tecniche per Matteo Garuzzo / Matteo De Pilla: `);
  return L.join("\n");
}
let hubPending=null;
function hubCommit(c,checked){ const o=outcomeByKey(state.outcome); if(!o) return; state.checks[o.key]=state.checks[o.key]||[]; state.checks[o.key][+c.dataset.hub]=checked; c.value=checked?"si":"no"; c.closest("li").classList.toggle("done",checked); save(); updateHubGate(); }
function hubClose(ok){ const c=hubPending; hubPending=null; document.getElementById("hubConfirmPanel").hidden=true; if(!c) return; if(ok) hubCommit(c,true); else { c.value=""; hubCommit(c,false); c.value=""; } }
function updateHubGate(){
  const o=outcomeByKey(state.outcome); const nc=document.getElementById("newCall"); const note=document.getElementById("hubNote");
  if(!o){ if(nc) nc.disabled=true; return; }
  const done=state.checks[o.key]||[]; const left=o.checks.filter((c,i)=>!done[i]).length;
  if(nc) nc.disabled=left>0;
  if(note){ note.className="notice"+(left?"":" ok"); note.textContent=left?`Prima di chiamare un'altra persona: ${left} ${left===1?"passo":"passi"} da fare in HubSpot.`:"Fatto: puoi passare alla prossima chiamata."; }
}
function updateGates(){
  const id=curId(); const n=current();
  // pulsanti accanto ai box: verde se compilato, rosso «salta» se vuoto e previsto, altrimenti spento
  view.querySelectorAll(".capgo[data-capgo]").forEach(b=>{ const k=b.dataset.capgo; const has=!!val(k); b.className="btn capgo "+(has?"primary":(b.dataset.skip?"danger":"primary")); b.textContent=has?b.dataset.golabel+" →":(b.dataset.skip||b.dataset.golabel+" →"); b.disabled=!has&&!b.dataset.skip; });
  const after=document.getElementById("after"); if(!after) return;
  const caps=[...view.querySelectorAll('.cap[data-req="1"]')].filter(c=>!c.hidden);
  const filled=caps.map(c=>{ const k=c.dataset.cap; return !!val(k)||state.skip[id+":"+k]; });
  const ok=caps.length===0?true:(n.anyOf?filled.some(Boolean):filled.every(Boolean))||!!state.skip[id+":after"];
  after.hidden=!ok; const sa=view.querySelector("[data-skipafter]"); if(sa) sa.hidden=ok;
}

function bindView(){
  const node=current(); const id=curId();
  view.querySelectorAll("[data-scope][data-i]").forEach(b=>b.addEventListener("click",()=>{ const s=b.dataset.scope; const list=s==="p"?node.primary:s==="o"?node.options:s==="ap"?node.after.primary:node.after.options; const o=list[+b.dataset.i]; go(o.to,o); }));
  bindSearch(view,to=>go(to));
  view.querySelectorAll("[data-skipafter]").forEach(b=>b.addEventListener("click",()=>{ state.skip[id+":after"]=true; save(); updateGates(); }));
  view.querySelectorAll(".capgo[data-capgo]").forEach(b=>b.addEventListener("click",()=>{ const k=b.dataset.capgo; let to=b.dataset.go; if(!val(k)){ if(!b.dataset.skip) return; state.skip[id+":"+k]=true; if(b.dataset.skipto) to=b.dataset.skipto; } go(to,{outcome:b.dataset.outcome||undefined}); }));
  view.querySelectorAll("[data-area-go]").forEach(b=>b.addEventListener("click",()=>{ go("f5",{area:b.dataset.areaGo}); }));
  view.querySelectorAll("[data-area]").forEach(b=>b.addEventListener("click",()=>{ state.area=b.dataset.area; save(); render(false); }));
  view.querySelectorAll("[data-out]").forEach(b=>b.addEventListener("click",()=>{ state.outcome=b.dataset.out; state.note=""; save(); render(false); }));
  view.querySelectorAll("select[data-c]").forEach(c=>c.addEventListener("change",()=>{ state.pre[c.dataset.c]=c.value; c.closest("li").classList.toggle("done",c.value==="si"); save(); updateStartGate(); }));
  view.querySelectorAll("select[data-hub]").forEach(c=>c.addEventListener("change",()=>{ if(c.value==="si"){ hubPending=c; document.getElementById("hubConfirmBody").innerHTML=`<p>${c.closest("li").querySelector(".ct").innerHTML}</p><p class="small">Spunta solo quello che hai già fatto in HubSpot: la prossima chiamata si sblocca da qui.</p>`; document.getElementById("hubConfirmPanel").hidden=false; } else hubCommit(c,false); }));
  bindInputs(view);
  view.querySelectorAll(".cap input").forEach(inp=>inp.addEventListener("keydown",e=>{ if(e.key==="Enter"){ const b=inp.parentElement.querySelector(".capgo"); if(b&&!b.disabled) b.click(); } }));
  const na=document.getElementById("noteArea"); if(na) na.addEventListener("input",()=>{ state.note=na.value; save(); });
  const cp=document.getElementById("copyNote"); if(cp) cp.addEventListener("click",()=>{ const ta=document.getElementById("noteArea"); const txt=ta.value; if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(()=>toast("Nota copiata")).catch(()=>{ ta.select(); toast("Seleziona e copia con Ctrl+C"); }); } else { ta.select(); toast("Seleziona e copia con Ctrl+C"); } });
  const rn=document.getElementById("resetNote"); if(rn) rn.addEventListener("click",()=>{ state.note=""; save(); render(false); });
}

/* ── timer ── */
function fmt(ms){ const s=Math.max(0,Math.floor(ms/1000)); return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0"); }
function updateSosBtn(){ const on=!!(state.started&&!state.ended&&state.phase!=="f0"&&state.phase!=="f7"); const b=document.getElementById("btnSos"); if(b) b.hidden=!on; document.querySelectorAll("[data-sosfab]").forEach(f=>f.hidden=!on); const d=document.getElementById("btnData"); if(d) d.hidden=state.phase==="f0"; }
function tick(){ updateSosBtn(); const t=document.getElementById("timer"); t.classList.remove("live","warn","over"); if(state.started){ const ms=(state.ended||Date.now())-state.started; t.textContent=fmt(ms); if(!state.ended){ t.classList.add(ms>180000?"over":ms>150000?"warn":"live"); } } else t.textContent="00:00"; }
setInterval(tick,1000);
function startCall(){ if(missing().length||!preOk()){ toast("Compila i campi e spunta i controlli"); updateStartGate(); return; } openConfirm(); }
function openConfirm(){
  const f=state.fields; const c=document.getElementById("confirmPanel");
  document.getElementById("confirmBody").innerHTML=`<dl class="sum">
    <div><dt>Azienda</dt><dd>${esc(f.azienda)} · ${esc(D.sectors[f.settore]?D.sectors[f.settore].label:"")} · ${esc(f.zona)}</dd></div>
    <div><dt>Email di primo contatto</dt><dd>inviata ${esc(f.dataEmail)}, almeno 48 ore fa</dd></div>
    <div><dt>Cosa dirai che è emerso</dt><dd>«Dalla prima analisi di ${esc(f.azienda)} è emerso che ${esc(val("dettaglio"))}.»</dd></div>
    <div><dt>Disponibilità che proporrai</dt><dd>${esc(val("slotA"))} oppure ${esc(val("slotB"))}</dd></div>
    ${f.titolare?`<div><dt>Chiedi di</dt><dd>${esc(val("iltitolare"))}</dd></div>`:""}
  </dl>`;
  c.hidden=false;
}
function reallyStart(){ document.getElementById("confirmPanel").hidden=true; state.started=Date.now(); state.ended=null; state.outcome=null; state.note=""; state.area=null; state.flags={detto:false}; state.skip={}; state.checks={}; save(); setPhase("f1"); tick(); }
function newCall(){ const keep={}; KEEP.forEach(k=>keep[k]=state.fields[k]); state=fresh(keep); save(); syncAllInputs(); render(true); tick(); }
function syncAllInputs(){ document.querySelectorAll("[data-k]").forEach(el=>{ const k=el.dataset.k; if(el.type==="checkbox") el.checked=!!state.fields[k]; else el.value=state.fields[k]||""; }); document.querySelectorAll("[data-seg] button").forEach(b=>{ const k=b.closest("[data-seg]").dataset.seg; b.classList.toggle("on",state.fields[k]===b.dataset.val); }); updatePreviews(); }

/* ── pannello dati ── */
const dataPanel=document.getElementById("dataPanel");
function openData(){ document.getElementById("panelForm").innerHTML=formHTML("p_"); bindInputs(dataPanel); updatePreviews(); dataPanel.hidden=false; }
function closeData(){ dataPanel.hidden=true; render(false); }
document.getElementById("btnData").addEventListener("click",openData);
document.getElementById("closeData").addEventListener("click",closeData);
document.getElementById("saveData").addEventListener("click",closeData);
dataPanel.addEventListener("click",e=>{ if(e.target===dataPanel) closeData(); });

/* ── guida ── */
/* ── SOS ── */
const sosPanel=document.getElementById("sosPanel"), sosBody=document.getElementById("sosBody");
let sosTopic=null;
/* Ordine fisso, zero premesse: 1) le obiezioni (tocchi quella del cliente e sotto compare la risposta corta, con il nome del cliente se lo sai)
   2) lo script di salvataggio per tornare dove eri  3) l'obiettivo della chiamata con le uscite rapide. Chiudendo, la scheda dov'eri lampeggia. */
let sosQuery="";
function sosTopicMatch(t,words){ const bag=snorm(t.title+" "+(t.keys||"")).split(" "); return words.every(w=>bag.some(x=>x.startsWith(w))); }
function renderSos(){
  TOKS=TOKS||[];
  const tp=D.sos.topics.find(t=>t.key===sosTopic);
  const words=snorm(sosQuery).split(" ").filter(Boolean); const filtering=words.length&&words.join("").length>=2;
  const topics=filtering?D.sos.topics.filter(t=>sosTopicMatch(t,words)):D.sos.topics;
  let h="";
  if(tp){
    h+=`<div class="ans"><div class="ans-title">Il cliente: ${esc(tp.title)} · tu rispondi</div><div class="say" id="sosAnswer"><p>${tpl(tp.text)}</p>${tp.hint?`<p class="note">${esc(tp.hint)}</p>`:""}<p class="bridge">${tpl(D.sos.bridge)}</p></div>`;
    h+=`<div class="row"><button class="btn primary big" data-sosclose>Torna dov'ero →</button><button class="btn ghost big" data-sosback>← Altre obiezioni</button></div></div>`;
  } else {
    h+=`<div class="morerow sos-top"><div class="search"><input type="search" data-sossearch placeholder="Cerca un'obiezione… (es. costa, AI, socio)" value="${esc(sosQuery)}" autocomplete="off" spellcheck="false" aria-label="Cerca un'obiezione"></div></div>`;
    h+=`<h3>Il cliente ti ha detto… <span class="hint">tocca: compare cosa rispondere</span></h3>`;
    h+=topics.length?`<div class="topics">${topics.map(t=>`<button data-sostopic="${t.key}">${esc(t.title)}</button>`).join("")}</div>`:"";
    if(filtering){ const res=searchObjections(sosQuery)||[]; h+=`<div class="sres">${res.length?`<div class="label">Schede complete <span class="small">· premi: chiude l'SOS e apre la scheda</span></div><div class="opts">${res.map(e=>`<button class="opt" data-sosgo="${e.id}"><span class="l">${esc(e.title)}</span></button>`).join("")}</div>`:(topics.length?"":`<div class="small">Nessuna scheda per «${esc(sosQuery.trim())}»: prova con un'altra parola.</div>`)}</div>`; }
    h+=`<h3 class="exits-h">Se invece il cliente… <span class="hint">premi la frase: l'SOS si chiude e si apre la scheda giusta</span></h3>`;
    h+=`<div class="opts exits">${D.sos.exits.map(e=>`<button class="opt" data-sosgo="${e.to}"><span class="l">${esc(e.label)}</span><span class="h">${esc(e.hint)}</span></button>`).join("")}</div>`;
  }
  sosBody.innerHTML=h; updateConditionals();
  const si=sosBody.querySelector("[data-sossearch]");
  if(si){ si.addEventListener("input",()=>{ sosQuery=si.value; const pos=si.selectionStart; renderSos(); const n=sosBody.querySelector("[data-sossearch]"); if(n){ n.focus({preventScroll:true}); try{ n.setSelectionRange(pos,pos); }catch(e){} } });
    si.addEventListener("keydown",e=>{ if(e.key==="Enter"){ const f=sosBody.querySelector("[data-sostopic]")||sosBody.querySelector("[data-sosgo].opt"); if(f) f.click(); } if(e.key==="Escape"){ e.stopPropagation(); sosQuery=""; renderSos(); } }); }
  sosBody.querySelectorAll("[data-sostopic]").forEach(b=>b.addEventListener("click",()=>{ sosTopic=b.dataset.sostopic; renderSos(); sosPanel.querySelector(".sheet").scrollTop=0; }));
  sosBody.querySelectorAll("[data-sosback]").forEach(b=>b.addEventListener("click",()=>{ sosTopic=null; renderSos(); sosPanel.querySelector(".sheet").scrollTop=0; }));
  sosBody.querySelectorAll("[data-sosgo]").forEach(b=>b.addEventListener("click",()=>{ sosPanel.hidden=true; go(b.dataset.sosgo); }));
  sosBody.querySelectorAll("[data-sosclose]").forEach(b=>b.addEventListener("click",closeSos));
}
function closeSos(){
  sosPanel.hidden=true;
  const card=document.getElementById("card"); if(!card) return;
  card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
  const ps=[...view.querySelectorAll(".say p")].filter(e=>!e.classList.contains("alt")&&!e.hidden&&!e.closest("[hidden]")); const last=ps[ps.length-1];
  if(last){ try{ last.scrollIntoView({block:"center",behavior:"smooth"}); }catch(e){} }
}
document.querySelectorAll("[data-sosfab]").forEach(f=>f.addEventListener("click",()=>document.getElementById("btnSos").click()));
document.getElementById("btnSos").addEventListener("click",()=>{ sosTopic=null; sosQuery=""; renderSos(); sosPanel.hidden=false; sosPanel.querySelector(".sheet").scrollTop=0; });
document.getElementById("closeSos").addEventListener("click",closeSos);
sosPanel.addEventListener("click",e=>{ if(e.target===sosPanel) closeSos(); });

const refPanel=document.getElementById("refPanel"), refTabs=document.getElementById("refTabs"), refBody=document.getElementById("refBody");
const TABS=[["uso","Come si usa"],["parole","Parole"],["fatti","Cosa è vero"],["settore","Il settore"],["chi","Chi fa cosa"]];
let refTab="uso";
function renderRef(){
  refTabs.innerHTML=TABS.map(([k,l])=>`<button class="${refTab===k?"on":""}" data-t="${k}">${l}</button>`).join("");
  refTabs.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{ refTab=b.dataset.t; renderRef(); }));
  const R=D.ref; let h="";
  if(refTab==="uso"){
    h+=`<h3>L'obiettivo</h3><ul><li>Uno: fissare la videocall o l'incontro. La tiene il commerciale, con una presentazione preparata su quel cliente. Il preventivo viene dopo, se interessa.</li><li>Durata: tre minuti al massimo. Il timer diventa arancione a 2:30 e rosso a 3:00.</li></ul>`;
    h+=`<h3>Come si legge</h3><ul><li>Leggi la battuta in verde. Il cliente risponde: premi il pulsante con la sua frase. Le due o tre risposte grandi sono le più frequenti; «Altre risposte» apre il resto. Se il cliente dice qualcosa che qui non vedi, scrivi una parola nella casella «Cerca un'obiezione» (anche solo l'inizio: «cost», «AI», «socio»): compaiono le schede giuste, premi quella e ci vai.</li><li>I box con il bordo verde si compilano nel momento in cui il cliente dice la cosa. Il pulsante accanto è verde quando il box è pieno; rosso quando è vuoto e si può proseguire senza.</li><li>Nei momenti di ascolto il cliente parla e tu premi il pulsante dell'ambito di cui ha parlato: compare la battuta giusta con la proposta della videocall. Le sue parole restano sue: zero scrittura durante la chiamata.</li><li>Le due disponibilità le scegli prima della chiamata dai menu: nelle battute compaiono già scritte, e con «Va bene» la data passa da sola alla chiusura.</li><li>«Torna a Fase», in basso, ti riporta dov'eri. Dalla barra in alto puoi saltare a una fase; durante la chiamata la Fase 0 sparisce e i dati si correggono dal pulsante verde «Modifica dati».</li></ul>`;
    h+=`<h3>Dopo la chiamata</h3><ul><li>Scegli l'esito. Con la videocall fissata: trattativa in HubSpot, task per il giorno dell'appuntamento, conferma inviata, presentazione in agenda, nota. Finché le spunte restano vuote, «Nuova chiamata» resta chiuso.</li><li>Negli altri casi: nota sul contatto e task di richiamata. Zero trattative senza appuntamento.</li></ul>`;
    h+=`<h3>Nomi e articoli</h3><ul><li>Scrivi il nome come lo diresti al telefono: «signor Bianchi» oppure «Marco». Al vocativo resta così; in terza persona la pagina aggiunge «il/la» da sola.</li><li>Le battute usano il maschile: con una titolare donna cambia la desinenza a voce («trovarla», «riferirle»).</li></ul>`;
  } else if(refTab==="parole"){
    h+=`<h3>Connettori che rendono la voce naturale</h3><div class="chips">${R.connectors.map(w=>`<span class="chip ok">${esc(w)}</span>`).join("")}</div>`;
    h+=`<h3>Parole vietate dal brand</h3><div class="chips">${R.banned.map(w=>`<span class="chip bad">${esc(w)}</span>`).join("")}</div>`;
    h+=`<h3>Negazioni da tenere fuori dalla bocca</h3><div class="chips">${R.negatives.map(w=>`<span class="chip bad">${esc(w)}</span>`).join("")}</div>`;
    h+=`<h3>Formule di fretta</h3><div class="chips">${R.hurry.map(w=>`<span class="chip bad">${esc(w)}</span>`).join("")}</div>`;
  } else if(refTab==="fatti"){
    h+=`<h3>Le uniche prove che usi, e bastano</h3><ul>${R.truths.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`;
    h+=`<h3>Da tenere fuori, sempre</h3><ul>${R.never.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`;
  } else if(refTab==="settore"){
    const s=R.sectorSheet[state.fields.settore]; const sec=D.sectors[state.fields.settore];
    if(!sec) h+=`<p class="small">Scegli prima il settore nei dati della chiamata.</p>`;
    else h+=`<h3>${esc(sec.label)}</h3><ul><li><b>Chi risponde di solito:</b> ${esc(s.who)}</li><li><b>Momento giusto per chiamare:</b> ${esc(s.when)}</li></ul>`;
  } else {
    h+=`<h3>Chi fa cosa in Agria</h3><ul>${R.who.map(([n,d])=>`<li><b>${esc(n)}</b> · ${esc(d)}</li>`).join("")}</ul>`;
    h+=`<h3>Al telefono</h3><ul><li>Il commerciale vende il risultato e fissa la videocall. Le domande tecniche si parcheggiano: «su questo le risponde chi lo realizza», Garuzzo per sito, e-commerce e visibilità, De Pilla per AI e automazioni, e si coinvolgono in videocall.</li></ul>`;
  }
  refBody.innerHTML=h;
}
document.getElementById("btnRef").addEventListener("click",()=>{ renderRef(); refPanel.hidden=false; });
document.getElementById("confirmGo").addEventListener("click",reallyStart);
document.getElementById("confirmBack").addEventListener("click",()=>{ document.getElementById("confirmPanel").hidden=true; });
document.getElementById("hubConfirmYes").addEventListener("click",()=>hubClose(true));
document.getElementById("hubConfirmNo").addEventListener("click",()=>hubClose(false));
document.getElementById("closeRef").addEventListener("click",()=>{ refPanel.hidden=true; });
refPanel.addEventListener("click",e=>{ if(e.target===refPanel) refPanel.hidden=true; });
document.addEventListener("keydown",e=>{ if(e.key==="Escape"){ dataPanel.hidden=true; refPanel.hidden=true; sosPanel.hidden=true; document.getElementById("confirmPanel").hidden=true; if(!document.getElementById("hubConfirmPanel").hidden) hubClose(false); } });

/* ── toast ── */
let toastT; function toast(m){ const t=document.getElementById("toast"); t.textContent=m; t.classList.add("on"); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("on"),1800); }

/* ── avvio ── */
function start(){ load(); if(!N[state.phase]) state.phase="f0"; if(state.phase==="f0"&&!state.started){ state.fields.settore=""; } state.stack=(state.stack||[]).filter(id=>N[id]); if(state.phase!=="f0"&&missing().length){ state.phase="f0"; state.stack=[]; } render(false); tick(); }
try{ if(window.claude&&window.claude.hot&&window.claude.hot.snapshot) window.claude.hot.snapshot(()=>state); }catch(e){}
start();
})();
