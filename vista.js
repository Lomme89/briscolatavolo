/* Controllo in Chromium: le rifiniture nuove si vedono davvero, e la pagina
   non prende a scrollare. Il broker MQTT e' finto e sta qui in node, i due
   client sono due schede vere. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const RADICE = __dirname;
const SCATTI = path.join(__dirname, 'scatti');
fs.mkdirSync(SCATTI, { recursive: true });

const FINTO = `
window.__subs=[];
window.__btDeliver=(t,p)=>window.__subs.filter(s=>s.t===t).forEach(s=>s.c.emit('message',t,{toString:()=>p}));
window.mqtt={connect(){
  const h={},c={
    on(e,f){(h[e]=h[e]||[]).push(f); if(e==='connect')setTimeout(()=>f(),0); return c;},
    emit(e,...a){(h[e]||[]).forEach(f=>f(...a));},
    subscribe(t,cb){window.__subs.push({t,c}); window.btSub(t).then(r=>{
      if(r) c.emit('message',t,{toString:()=>r}); if(cb) cb(null);}); return c;},
    unsubscribe(t){window.__subs=window.__subs.filter(s=>!(s.t===t&&s.c===c)); return c;},
    publish(t,p,o){window.btPub(t,String(p),!!(o&&o.retain)); return c;},
    end(){}
  }; return c;}};
window.QRCode=function(el,o){ el.innerHTML='<canvas width="'+(o.width||100)+'" height="'+(o.height||100)+'" style="background:'+(o.colorLight||'#fff')+'"></canvas>'; };
window.QRCode.CorrectLevel={M:0};
`;

const attesa = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = http.createServer((q, s) => {
    const f = path.join(RADICE, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
    fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); s.end(d); } });
  }).listen(8731);

  const retained = {}; const pagine = [];
  const b = await chromium.launch({ executablePath: process.env.BT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const guai = [];

  async function nuovaScheda(ctx, nome) {
    const p = await ctx.newPage();
    p.on('pageerror', e => guai.push(nome + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error') guai.push(nome + ' console: ' + m.text()); });
    await p.exposeFunction('btSub', t => retained[t] || null);
    await p.exposeFunction('btPub', async (t, payload, retain) => {
      if (retain) { if (payload === '') delete retained[t]; else retained[t] = payload; }
      for (const q of pagine) { try { await q.evaluate(([t, p]) => window.__btDeliver(t, p), [t, payload]); } catch (e) { } }
    });
    await p.addInitScript(FINTO);
    await p.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    pagine.push(p);
    return p;
  }

  /* Un contesto per client: due schede dello stesso browser condividono il
     localStorage, cioe' lo stesso me.id, e per il mazziere sono la stessa
     persona. Al tavolo sono due telefoni. */
  const contesto = async () => {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8731' });
    return c;
  };
  const A = await nuovaScheda(await contesto(), 'mazziere');
  const B = await nuovaScheda(await contesto(), 'ospite');
  await A.goto('http://localhost:8731/'); await B.goto('http://localhost:8731/');
  await A.waitForSelector('#crea');

  const dice = globalThis.__dice = [];
  const ok = (c, t) => dice.push((c ? 'ok  ' : 'KO  ') + t);

  /* Il tema si cambia dalle pastiglie, e un tocco qualunque non deve
     ri-applicarlo: `[data-tema]` prendeva anche <html>, e legaTemi finiva per
     attaccare un onclick alla radice, cioe' a ogni tocco della pagina. */
  await B.click('.temi .t-scuro'); await attesa(200);
  ok(await B.evaluate(() => document.documentElement.dataset.tema) === 'scuro', 'la pastiglia cambia tema');
  await B.evaluate(() => { document.querySelector('.brand').dataset.segno = 'x'; });
  await B.click('.brand h1'); await attesa(200);
  ok(await B.evaluate(() => document.querySelector('.brand').dataset.segno === 'x'),
    'un tocco qualsiasi non ridisegna la pagina');
  await B.click('.temi .t-classico'); await attesa(200);
  ok(await B.evaluate(() => document.documentElement.dataset.tema) === 'classico', 'e si torna indietro');

  await A.fill('#nm', 'Ada'); await A.click('#crea');
  await A.waitForSelector('.roomcode');
  const code = (await A.textContent('.roomcode')).trim();
  ok(/^[A-Z]{4}$/.test(code), 'il tavolo si apre (' + code + ')');

  // il codice e il QR si toccano
  await A.click('#cod'); await attesa(200);
  ok(await A.isVisible('#toast .msg'), 'toccando il codice arriva l\'avviso');
  const copiato = await A.evaluate(() => navigator.clipboard.readText());
  ok(copiato === code, 'il codice finisce davvero negli appunti (' + copiato + ')');
  await A.screenshot({ path: path.join(SCATTI, '1-codice-copiato.png') });

  await A.click('#qrtap'); await A.waitForSelector('.qrfull', { timeout: 2000 });
  ok(true, 'il QR si apre a tutto schermo');
  await A.screenshot({ path: path.join(SCATTI, '2-qr-grande.png') });
  await A.click('.qrfull'); await attesa(250);
  ok(!(await A.isVisible('.qrfull')), 'e si chiude toccandolo');

  // il bottone spento spiega perche'
  await A.click('#via', { force: true }); await attesa(250);
  const avvNo = await A.textContent('#toast');
  ok(/inquadrare il codice/.test(avvNo || ''), 'il bottone spento dice perche\' non si puo\' [' + (avvNo || '').slice(0, 60) + ']');
  await A.screenshot({ path: path.join(SCATTI, '3-non-si-puo.png') });

  // arriva l'ospite
  await B.fill('#nm', 'Bino'); await B.fill('#cd', code); await B.click('#go');
  await A.waitForFunction(() => document.querySelectorAll('.seatlist li:not(.empty)').length >= 2, null, { timeout: 8000 });
  await attesa(400);
  const avvEntra = await A.textContent('#toast');
  ok(/Bino/.test(avvEntra || ''), 'al mazziere arriva l\'avviso che Bino si e\' seduto');
  await A.screenshot({ path: path.join(SCATTI, '4-bino-si-siede.png') });

  // l'invito
  await A.click('#link'); await attesa(400);
  ok(/copiato/i.test(await A.textContent('#link') || ''), 'il bottone dell\'invito conferma');
  const linkCop = await A.evaluate(() => navigator.clipboard.readText());
  ok(linkCop.endsWith('#' + code), 'e negli appunti c\'e\' il link giusto (' + linkCop + ')');
  await A.screenshot({ path: path.join(SCATTI, '5-link-copiato.png') });

  // uscita del mazziere: due tocchi
  await A.click('#x'); await attesa(250);
  ok(await A.isVisible('.roomcode'), 'il primo tocco su Esci non smonta il tavolo');
  ok(/smonta/.test(await A.textContent('#toast') || ''), 'e avvisa che smonterebbe il tavolo di tutti');
  await A.screenshot({ path: path.join(SCATTI, '6-esci-chiede.png') });
  await A.evaluate(() => { const b = document.getElementById('x'); b.classList.remove('chiede'); });
  await attesa(4400); // si disarma da solo
  ok(await A.isVisible('.roomcode'), 'e dopo un po\' si disarma da solo');

  // si gioca a scopa
  await A.click('#gm button[data-v=scopa]'); await attesa(300);
  await A.click('#via');
  await A.waitForSelector('.board .bc', { timeout: 5000 });
  ok(true, 'la scopa parte');

  // una carta non giocabile risponde
  const fermo = (await A.$('.slot.muta')) ? A : B;
  await fermo.click('.slot.muta', { force: true }); await attesa(250);
  ok(/Aspetta|finita|momento/.test(await fermo.textContent('#toast') || ''), 'la carta non giocabile dice perche\'');
  await fermo.screenshot({ path: path.join(SCATTI, '7-non-tocca-a-te.png') });

  // il timbro della scopa
  await A.evaluate(() => timbroScopa(true, 'Bino'));
  await attesa(420);
  ok(await A.isVisible('.timbro'), 'il timbro della scopa compare');
  await A.screenshot({ path: path.join(SCATTI, '8-timbro-scopa.png') });

  /* La stanza ci deve stare senza scrollare anche col notch: `max-height` non
     vede la safe-area, e con viewport-fit=cover se ne va fino a 93px. Qui la
     safe-area si simula col padding, che in headless vale zero. */
  const TEL = [['iPhone SE 1', 320, 568, 0, 0], ['iPhone 14', 390, 844, 47, 34],
               ['iPhone 15 ProMax', 430, 932, 59, 34], ['Galaxy S8', 360, 740, 24, 24]];
  const finge = n => `
    code='ABCD'; isHost=true; mySeat=0; connected=true;
    S={code:'ABCD',phase:'attesa',game:'briscola',teams:true,first:0,albo:{},mano:0,
       seats:Array.from({length:${n}},(_,i)=>({id:i?'x'+i:me.id,
         name:['Bartolomeo','Concetta','Gennaro','Assunta','Pasqualino','Rosaria'][i]}))};
    paint();`;
  for (const [tel, w, h, alto, basso] of TEL) {
    for (const n of [2, 4, 6]) {
      const c = await contesto();
      const p = await nuovaScheda(c, 'stanza');
      await p.setViewportSize({ width: w, height: h });
      await p.goto('http://localhost:8731/');
      await p.waitForSelector('#crea', { timeout: 4000 });
      await p.addStyleTag({
        content: `.wrap{padding-top:${14 + alto}px !important;padding-bottom:${20 + basso}px !important}`
          + `.sonda{padding-top:${alto}px !important;padding-bottom:${basso}px !important}`
      });
      await p.evaluate(s => window.eval(s), finge(n));
      await attesa(300);
      const m = await p.evaluate(() => {
        const wr = document.querySelector('.wrap');
        const prima = wr.style.minHeight; wr.style.minHeight = '0';
        const nat = Math.ceil(wr.getBoundingClientRect().height);
        wr.style.minHeight = prima;
        return { nat, i: innerHeight };
      });
      ok(m.nat <= m.i, `stanza in ${n} su ${tel}: ci sta senza scrollare (${m.nat} su ${m.i})`);
      pagine.splice(pagine.indexOf(p), 1);
      await c.close();
    }
  }

  /* Home e schermata d'invito, con gli incavi: il ventaglio di copertina cede
     quanto serve invece di far scrollare il resto. */
  for (const [tel, w, h, alto, basso] of TEL) {
    for (const [dove, hash] of [['home', ''], ['invito', '#ABCD']]) {
      const c = await contesto();
      const p = await nuovaScheda(c, dove);
      await p.setViewportSize({ width: w, height: h });
      await p.goto('http://localhost:8731/' + hash);
      await p.waitForSelector(hash ? '#go' : '#crea', { timeout: 4000 });
      await p.addStyleTag({
        content: `.wrap{padding-top:${14 + alto}px !important;padding-bottom:${20 + basso}px !important}`
          + `.sonda{padding-top:${alto}px !important;padding-bottom:${basso}px !important}`
      });
      await p.evaluate(() => { misuraSchermo(); paint(); });
      await attesa(250);
      const m = await p.evaluate(() => {
        const wr = document.querySelector('.wrap');
        const prima = wr.style.minHeight; wr.style.minHeight = '0';
        const nat = Math.ceil(wr.getBoundingClientRect().height);
        wr.style.minHeight = prima;
        return { nat, i: innerHeight };
      });
      ok(m.nat <= m.i, `${dove} su ${tel}: ci sta senza scrollare (${m.nat} su ${m.i})`);
      pagine.splice(pagine.indexOf(p), 1);
      await c.close();
    }
  }

  /* Il tavolo e la fine mano, con gli incavi: sono le due schermate che
     crescono col numero di giocatori. Lo stato se lo piazza a mano. */
  const NOMI = ['Bartolomeo', 'Concetta', 'Gennaro', 'Assunta', 'Pasqualino', 'Rosaria'];
  const posti = n => `Array.from({length:${n}},(_,i)=>({id:i?'x'+i:me.id,name:${JSON.stringify(NOMI)}[i]}))`;
  const inGioco = (n, inTav, mazzo) => `
    code='ABCD'; isHost=true; mySeat=0; connected=true;
    const carte=[];for(let s=0;s<4;s++)for(let r=1;r<=10;r++)carte.push({s,r});
    const mani={}; for(let i=0;i<${n};i++) mani[i]=carte.slice(i*3,i*3+3);
    S={code:'ABCD',phase:'gioco',game:'briscola',teams:${n % 2 === 0},first:0,albo:{},mano:1,n:${n},
       seats:${posti(n)},trump:{s:0,r:1},trumpSuit:0,hands:mani,deck:carte.slice(20,20+${mazzo}),
       table:Array.from({length:${inTav}},(_,i)=>({seat:(i+1)%${n},c:carte[25+i*3]})),
       turn:0,points:Array(${n % 2 === 0 ? 2 : n}).fill(0),tr:Array(${n}).fill(2),pp:Array(${n}).fill(11)};
    misuraSchermo(); paint();`;
  const aFine = (n, gioco, vinco) => `
    code='ABCD'; isHost=true; mySeat=0; connected=true;
    const carte=[];for(let s=0;s<4;s++)for(let r=1;r<=10;r++)carte.push({s,r});
    const G=${n % 2 === 0 ? 2 : n};
    S={code:'ABCD',phase:'fine',game:'${gioco}',teams:${n % 2 === 0},first:0,mano:3,n:${n},albo:{},
       seats:${posti(n)},trump:{s:0,r:1},trumpSuit:0,hands:{},deck:[],table:[],turn:-1,
       points:Array.from({length:G},(_,g)=>g===${vinco}?('${gioco}'==='scopa'?5:72):('${gioco}'==='scopa'?2:48)),
       tr:Array.from({length:${n}},(_,i)=>3+i),pp:Array.from({length:${n}},(_,i)=>20+i*7),
       taken:Array.from({length:${n}},()=>carte.slice(0,6)),scope:Array.from({length:${n}},(_,i)=>i%2),
       esito:{vCarte:0,vDen:1,vPrim:0,sette:0,primT:[76,68]}};
    misuraSchermo(); paint();`;

  const conStato = async ([tel, w, h, alto, basso], codice, attesaMs) => {
    const c = await contesto();
    const p = await nuovaScheda(c, 'schermata');
    await p.setViewportSize({ width: w, height: h });
    await p.goto('http://localhost:8731/');
    await p.waitForSelector('#crea', { timeout: 4000 });
    await p.addStyleTag({
      content: `.wrap{padding-top:${14 + alto}px !important;padding-bottom:${20 + basso}px !important}`
        + `.sonda{padding-top:${alto}px !important;padding-bottom:${basso}px !important}`
    });
    await p.evaluate(s => window.eval(s), codice);
    await attesa(attesaMs || 320);
    /* Si misura a animazioni ferme: le carte entrano da 40px più in basso e
       la mano ondeggia di continuo, quindi misurare a caso dà numeri a caso. */
    await p.addStyleTag({ content: '*{animation:none !important;transition:none !important}' });
    await attesa(60);
    const m = await p.evaluate(() => ({
      vero: document.documentElement.scrollHeight, i: innerHeight,
      cnt: (document.querySelector('.cnt') || {}).textContent || '',
      briscolaLi: !!document.querySelector('.trumpslot'),
      titolo: (document.querySelector('.esitone') || {}).textContent || '',
      coriandoli: document.querySelectorAll('.coriandolo').length
    }));
    pagine.splice(pagine.indexOf(p), 1);
    await c.close();
    return m;
  };

  for (const tel of TEL) {
    for (const [n, inTav, mazzo] of [[2, 1, 14], [3, 2, 10], [4, 3, 8], [6, 5, 0]]) {
      const m = await conStato(tel, inGioco(n, inTav, mazzo));
      ok(m.vero <= m.i + 1, `tavolo in ${n} su ${tel[0]}: non scrolla (${m.vero} su ${m.i})`);
      if (tel[0] === 'iPhone 14') {
        /* Quante altre mani dà il mazzo, non quante ne restano da giocare. */
        const atteso = mazzo ? Math.ceil(mazzo / n) + ' man' + (Math.ceil(mazzo / n) > 1 ? 'i' : 'o') : 'mazzo finito';
        ok(m.cnt === atteso, `in ${n} con ${mazzo} carte nel mazzo dice "${m.cnt}" (atteso "${atteso}")`);
        /* A mazzo finito la briscola se l'è pescata qualcuno: non può restare lì. */
        ok(m.briscolaLi === (mazzo > 0),
          mazzo ? `in ${n} la briscola è ancora nel mazzo` : `in ${n} a mazzo finito la briscola non resta sul tavolo`);
      }
    }
  }
  for (const [n, gioco, vinco, vinta] of [[2, 'briscola', 0, true], [4, 'briscola', 1, false], [6, 'scopa', 0, true]]) {
    const m = await conStato(TEL[1], aFine(n, gioco, vinco), 900);
    ok(m.vero <= m.i + 1, `fine ${gioco} in ${n}: la pagina sta ferma (${m.vero} su ${m.i})`);
    ok(!!m.titolo, `fine ${gioco} in ${n}: dice com'è finita ("${m.titolo}")`);
    ok(vinta ? m.coriandoli > 20 : m.coriandoli === 0,
      `fine ${gioco} in ${n}: ${vinta ? 'i coriandoli ci sono (' + m.coriandoli + ')' : 'nessun coriandolo per chi perde'}`);
  }

  // niente deve scrollare, a nessuna misura
  for (const [w, h] of [[320, 568], [390, 844], [430, 932], [768, 1024]]) {
    for (const q of [A, B]) await q.setViewportSize({ width: w, height: h });
    await attesa(350);
    for (const q of [A, B]) {
      const m = await q.evaluate(() => ({ s: document.documentElement.scrollHeight, i: innerHeight }));
      ok(m.s <= m.i + 1, `${w}x${h}: la pagina non scrolla (${m.s} su ${m.i})`);
    }
  }
  await A.setViewportSize({ width: 390, height: 844 }); await attesa(300);
  await A.screenshot({ path: path.join(SCATTI, '9-tavolo-scopa.png') });

  console.log(dice.join('\n'));
  const veri = guai.filter(g => !/favicon|ERR_/.test(g));
  if (veri.length) { console.log('\nGUAI:'); veri.slice(0, 10).forEach(g => console.log(' - ' + g)); }
  const ko = dice.filter(d => d.startsWith('KO')).length;
  console.log(ko || veri.length ? '\nFALLITO' : '\nTUTTO A POSTO');
  await b.close(); srv.close();
  process.exit(ko || veri.length ? 1 : 0);
})().catch(e => { console.log((globalThis.__dice||[]).join('\n')); console.log('\nesplosione: ' + e.message.split('\n')[0]); process.exit(1); });
