/* Banco di prova: piu' client jsdom con un broker MQTT finto in-process.
   I client giocano davvero, cliccando sulle carte come farebbe un dito. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

/* ---- broker finto ---- */
function nuovoBroker() {
  const retained = {}, subs = [];
  return {
    retained, subs,
    client() {
      const mie = new Set(); const h = {};
      const c = {
        on(ev, cb) { (h[ev] = h[ev] || []).push(cb); if (ev === 'connect') setTimeout(() => cb(), 0); return c; },
        /* Le finestre si chiudono a fine partita, ma un messaggio puo'
           essere ancora per aria: consegnarlo a un jsdom chiuso fa esplodere
           il processo per un errore che non c'entra con quello che si prova. */
        emit(ev, ...a) { (h[ev] || []).forEach(f => { try { f(...a); } catch (e) { if (!/activeElement|document/.test(e.message)) throw e; } }); },
        subscribe(t, cb) {
          mie.add(t); subs.push({ t, c });
          if (Object.prototype.hasOwnProperty.call(retained, t) && retained[t] !== '')
            setTimeout(() => c.emit('message', t, Buffer.from(retained[t])), 0);
          if (cb) setTimeout(() => cb(null), 0);
          return c;
        },
        unsubscribe(t) { mie.delete(t); for (let i = subs.length - 1; i >= 0; i--) if (subs[i].c === c && subs[i].t === t) subs.splice(i, 1); return c; },
        publish(t, p, o) {
          const s = typeof p === 'string' ? p : String(p);
          if (o && o.retain) { if (s === '') delete retained[t]; else retained[t] = s; }
          setTimeout(() => subs.filter(x => x.t === t).forEach(x => x.c.emit('message', t, Buffer.from(s))), 0);
          return c;
        },
        end() { for (let i = subs.length - 1; i >= 0; i--) if (subs[i].c === c) subs.splice(i, 1); }
      };
      return c;
    }
  };
}

/* ---- un client ---- */
function apriClient(broker, nome, errori) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errori.push(nome + ': ' + (e.stack || e.message)));
  vc.on('error', (...a) => errori.push(nome + ': ' + a.join(' ')));
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    url: 'https://esempio.test/',
    beforeParse(w) {
      w.mqtt = { connect: () => broker.client() };
      w.QRCode = function () { }; w.QRCode.CorrectLevel = { M: 0 };
      /* Web Animations API: jsdom non ce l'ha. Basta che onfinish arrivi. */
      w.Element.prototype.animate = function (k, o) {
        const a = { onfinish: null, cancel() { }, finish() { } };
        const d = (o && o.duration || 0) + (o && o.delay || 0);
        setTimeout(() => { if (a.onfinish) a.onfinish(); }, Math.min(d, 50));
        return a;
      };
      w.matchMedia = w.matchMedia || (q => ({ matches: false, media: q, addListener() { }, removeListener() { }, addEventListener() { }, removeEventListener() { } }));
      w.HTMLElement.prototype.scrollIntoView = function () { };
      w.name_ = nome;
    }
  });
  const w = dom.window;
  w.addEventListener('error', e => errori.push(nome + ': ' + (e.error && e.error.stack || e.message)));
  w.addEventListener('unhandledrejection', e => errori.push(nome + ': rifiuto ' + (e.reason && e.reason.stack || e.reason)));
  return { dom, w, nome };
}

const attesa = ms => new Promise(r => setTimeout(r, ms));
const $ = (c, s) => c.w.document.querySelector(s);
const $$ = (c, s) => [...c.w.document.querySelectorAll(s)];
const testo = (c, s) => { const e = $(c, s); return e ? e.textContent.trim() : ''; };

async function finoA(cond, ms, cosa) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await attesa(25); }
  throw new Error('scaduto: ' + (cosa || 'condizione'));
}

async function scriviNome(c, nome) {
  const i = $(c, '#nm'); i.value = nome;
  i.dispatchEvent(new c.w.Event('input', { bubbles: true }));
}

module.exports = { nuovoBroker, apriClient, attesa, $, $$, testo, finoA, scriviNome };
