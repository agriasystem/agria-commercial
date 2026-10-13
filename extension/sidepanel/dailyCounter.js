// Contatore «Oggi 7 / 20» in fondo al pannello (Home, Scout, Outreach; il Navigatore è a parte):
// aziende con il primo contatto registrato oggi dal commerciale attivo. Il numero vive nel service
// worker (lib/dailyOutreach.js, chrome.storage.local): qui si legge e si corregge con − e +, sempre
// con un messaggio, così un incremento automatico e una correzione a mano non si sovrascrivono.

import { MESSAGE } from '../lib/hubspotMessages.js';

const REFRESH_MS = 60 * 1000; // a mezzanotte (ora italiana) il contatore riparte da zero

/** getOperator: commerciale attivo (registro dei commerciali), oppure null. */
export function createDailyCounterBar({ $, getOperator }) {
  let state = null; // { ownerId, day, count, target } dall'ultima risposta
  let busy = false;

  const call = (action, payload = {}) => chrome.runtime.sendMessage({ type: MESSAGE, action, ...payload }).then((r) => r || { ok: false }, () => ({ ok: false }));
  const mine = () => (state && state.ownerId === getOperator()?.hubspotOwnerId ? state : null);

  function render() {
    const bar = $('#daily-counter');
    if (!bar) return;
    const operator = getOperator();
    const current = mine();
    bar.hidden = !operator || !$('#operator-picker')?.hidden; // non durante la scelta del commerciale
    $('#daily-count').textContent = current ? String(current.count) : '–';
    $('#daily-target').textContent = `/ ${current?.target ?? 20}`;
    $('#daily-minus').disabled = busy || !current || current.count <= 0;
    $('#daily-plus').disabled = busy || !current;
  }

  async function refresh() {
    if (!getOperator()) {
      render();
      return;
    }
    const res = await call('dailyCount');
    if (res.ok) state = { ownerId: res.ownerId, day: res.day, count: res.count, target: res.target };
    render();
  }

  async function adjust(delta) {
    if (busy || !mine()) return;
    busy = true;
    render();
    const res = await call('dailyCountAdjust', { delta });
    busy = false;
    if (res.ok) state = { ownerId: res.ownerId, day: res.day, count: res.count, target: res.target };
    render();
  }

  return {
    refresh,
    init() {
      $('#daily-minus').addEventListener('click', () => adjust(-1));
      $('#daily-plus').addEventListener('click', () => adjust(1));
      setInterval(refresh, REFRESH_MS);
      render();
    },
  };
}
