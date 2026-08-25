/* Controllo in Chromium: le rifiniture nuove si vedono davvero, e la pagina
   non prende a scrollare. Il broker MQTT e' finto e sta qui in node, i due
   client sono due schede vere. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const RADICE = __dirname;
const SCATTI = path.join(__dirname, 'scatti');
fs.mkdirSync(SCATTI, { recursive: true });

const FINTO = `
window.__subs=[]; window.__pubblicati=[];
window.__btDeliver=(t,p)=>window.__subs.filter(s=>s.t===t).forEach(s=>s.c.emit('message',t,{toString:()=>p}));
window.mqtt={connect(){
  const h={},c={
    on(e,f){(h[e]=h[e]||[]).push(f); if(e==='connect')setTimeout(()=>f(),0); return c;},
    emit(e,...a){(h[e]||[]).forEach(f=>f(...a));},
    subscribe(t,cb){window.__subs.push({t,c}); window.btSub(t).then(r=>{
      if(r) c.emit('message',t,{toString:()=>r}); if(cb) cb(null);}); return c;},
    unsubscribe(t){window.__subs=window.__subs.filter(s=>!(s.t===t&&s.c===c)); return c;},
    publish(t,p,o){window.__pubblicati.push(t); window.btPub(t,String(p),!!(o&&o.retain)); return c;},
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
  await A.selectOption('#gm', 'scopa'); await attesa(300);
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
  const finge = (n, g) => `
    code='ABCD'; isHost=true; mySeat=0; connected=true;
    S={code:'ABCD',phase:'attesa',game:'${g || 'briscola'}',teams:true,first:0,albo:{},mano:0,
       seats:Array.from({length:${n}},(_,i)=>({id:i?'x'+i:me.id,
         name:['Bartolomeo','Concetta','Gennaro','Assunta','Pasqualino','Rosaria'][i]}))};
    paint();`;
  /* Scopa e a perdere sono le due righe più lunghe della tendina: «Scopa ·
     2/3/4/6» accanto alle squadre, e «A perdere · 2/4» che si prende tutta la
     riga perché a perdere le squadre non si scelgono. */
  for (const [tel, w, h, alto, basso] of TEL) {
    for (const n of [2, 4, 6, 'scopa', 'treperdere']) {
      const g = typeof n === 'string' ? n : null;
      const k = g ? 4 : n;
      const c = await contesto();
      const p = await nuovaScheda(c, 'stanza');
      await p.setViewportSize({ width: w, height: h });
      await p.goto('http://localhost:8731/');
      await p.waitForSelector('#crea', { timeout: 4000 });
      await p.addStyleTag({
        content: `.wrap{padding-top:${14 + alto}px !important;padding-bottom:${20 + basso}px !important}`
          + `.sonda{padding-top:${alto}px !important;padding-bottom:${basso}px !important}`
      });
      await p.evaluate(s => window.eval(s), finge(k, g));
      await attesa(300);
      const m = await p.evaluate(() => {
        const wr = document.querySelector('.wrap');
        const prima = wr.style.minHeight; wr.style.minHeight = '0';
        const nat = Math.ceil(wr.getBoundingClientRect().height);
        wr.style.minHeight = prima;
        return {
          nat, i: innerHeight,
          tagliate: [...document.querySelectorAll('.scelta select')]
            .filter(s => s.scrollWidth > s.clientWidth + 1)
            .map(s => s.options[s.selectedIndex].text)
        };
      });
      const che = g ? `a ${g} in 4` : `in ${n}`;
      ok(m.nat <= m.i, `stanza ${che} su ${tel}: ci sta senza scrollare (${m.nat} su ${m.i})`);
      ok(!m.tagliate.length, `stanza ${che} su ${tel}: la tendina non taglia "${m.tagliate.join('", "')}"`);
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
  const inGioco = (n, inTav, mazzo, tocca) => `
    code='ABCD'; isHost=true; mySeat=0; connected=true;
    const carte=[];for(let s=0;s<4;s++)for(let r=1;r<=10;r++)carte.push({s,r});
    const mani={}; for(let i=0;i<${n};i++) mani[i]=carte.slice(i*3,i*3+3);
    S={code:'ABCD',phase:'gioco',game:'briscola',teams:${n % 2 === 0},first:0,albo:{},mano:1,n:${n},
       seats:${posti(n)},trump:{s:0,r:1},trumpSuit:0,hands:mani,deck:carte.slice(20,20+${mazzo}),
       table:Array.from({length:${inTav}},(_,i)=>({seat:(i+1)%${n},c:carte[25+i*3]})),
       turn:${tocca === undefined ? 0 : tocca},points:Array(${n % 2 === 0 ? 2 : n}).fill(0),
       tr:Array(${n}).fill(2),pp:Array(${n}).fill(11)};
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
      file: document.querySelectorAll('.hand').length,
      titolo: (document.querySelector('.esitone') || {}).textContent || '',
      coriandoli: document.querySelectorAll('.coriandolo').length,
      /* La barra in cima: il pallino da solo quando fila tutto, e il seme di
         briscola scritto solo quando la carta non sta più sul feltro. */
      inLinea: (document.querySelector('.topbar') || {}).textContent || '',
      capo: (document.querySelector('.brisc') || {}).textContent || '',
      /* La cornice ce l'ha solo chi deve giocare, se no non vuol dire niente. */
      incorniciati: document.querySelectorAll('.opp').length
        && [...document.querySelectorAll('.opp')].filter(o =>
             getComputedStyle(o).borderTopColor !== 'rgba(0, 0, 0, 0)').length,
      diTurno: document.querySelectorAll('.opp.turn').length,
      /* Le tendine della stanza: quello che c'è scritto ci deve stare. */
      tagliate: [...document.querySelectorAll('.scelta select')]
        .filter(s => s.scrollWidth > s.clientWidth + 1)
        .map(s => s.options[s.selectedIndex].text)
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
        /* «In linea» spariva dalla barra: quando va tutto bene resta il pallino. */
        ok(!/In linea/.test(m.inLinea), `in ${n} la barra non scrive «In linea» quando fila tutto`);
        /* Il seme scritto e la carta sul feltro non stanno insieme: si danno il cambio. */
        ok(mazzo ? m.capo === '' : /Denari|Coppe|Spade|Bastoni/.test(m.capo),
          mazzo ? `in ${n} col mazzo vivo il seme non è scritto due volte`
                : `in ${n} a mazzo finito il seme resta scritto in cima`);
        /* Con la palla a un altro: una cornice sola, la sua. Il caso da
           controllare è questo — a turno mio non ne è accesa nessuna, e la
           prova passerebbe anche se le pastiglie fossero incorniciate tutte. */
        const alt = await conStato(tel, inGioco(n, inTav, mazzo, 1));
        ok(alt.diTurno === 1 && alt.incorniciati === 1,
          `in ${n} la cornice ce l'ha solo chi deve giocare (${alt.incorniciati} accese, ${alt.diTurno} di turno)`);
      }
    }
  }
  /* Il mazzo piacentino è più lungo di quello napoletano: le stesse misure
     costano più altezza, e il tavolo va ricontrollato con lui addosso. */
  for (const tel of [TEL[0], TEL[1]]) {
    const c = await contesto();
    const p = await nuovaScheda(c, 'piacentine');
    await p.setViewportSize({ width: tel[1], height: tel[2] });
    await p.addInitScript(() => { try { localStorage.bt_tema = 'piacentine'; } catch (e) { } });
    await p.goto('http://localhost:8731/');
    await p.waitForSelector('#crea', { timeout: 4000 });
    await p.addStyleTag({
      content: `.wrap{padding-top:${14 + tel[3]}px !important;padding-bottom:${20 + tel[4]}px !important}`
        + `.sonda{padding-top:${tel[3]}px !important;padding-bottom:${tel[4]}px !important}`
    });
    await p.evaluate(s => window.eval(s), inGioco(6, 5, 0));
    await attesa(400);
    await p.addStyleTag({ content: '*{animation:none !important;transition:none !important}' });
    const m = await p.evaluate(() => ({
      vero: document.documentElement.scrollHeight, i: innerHeight,
      ar: getComputedStyle(document.documentElement).getPropertyValue('--ar').trim()
    }));
    // --ar si confronta come numero: il CSS lo ridà com'è scritto, «1.700»
    ok(m.vero <= m.i + 1 && Math.abs(parseFloat(m.ar) - 1.7) < 0.001,
      `tavolo piacentino in 6 su ${tel[0]}: non scrolla (${m.vero} su ${m.i}, --ar ${m.ar})`);
    pagine.splice(pagine.indexOf(p), 1);
    await c.close();
  }

  /* I giochi nuovi: dieci carte in mano stanno su due file, e l'asta della
     chiamata è una schermata sua. Nessuna delle due deve far scrollare. */
  const inAsta = `
    code='ABCD'; isHost=true; mySeat=0; connected=true;
    const carte=[];for(let s=0;s<4;s++)for(let r=1;r<=10;r++)carte.push({s,r});
    const mani={}; for(let i=0;i<5;i++) mani[i]=carte.slice(i*8,i*8+8);
    S={code:'ABCD',phase:'asta',game:'chiamata',teams:false,first:0,albo:{},mano:1,n:5,
       seats:${posti(5)},hands:mani,deck:[],table:[],turn:-1,trump:null,trumpSuit:-1,
       points:[0,0],tr:Array(5).fill(0),pp:Array(5).fill(0),
       chiamante:-1,socio:-1,chiamata:null,rivelato:false,
       asta:{turn:0,aperto:0,offerta:{seat:1,r:10},fuori:[2],vinta:false}};
    misuraSchermo(); paint();`;
  const inDieci = g => `
    code='ABCD'; isHost=true; mySeat=0; connected=true;
    const carte=[];for(let s=0;s<4;s++)for(let r=1;r<=10;r++)carte.push({s,r});
    const mani={}; for(let i=0;i<4;i++) mani[i]=carte.slice(i*10,i*10+10);
    S={code:'ABCD',phase:'gioco',game:'${g}',teams:true,first:0,albo:{},mano:1,n:4,
       seats:${posti(4)},hands:mani,deck:[],turn:0,points:[0,0],
       tr:[0,0,0,0],pp:[0,0,0,0],trump:null,trumpSuit:-1};
    if('${g}'==='scopone'){ S.board=[]; S.taken=[[],[],[],[]]; S.scope=[0,0,0,0]; S.lastTake=null; S.mossa=null; }
    else { S.table=[]; S.terzi=[0,0]; S.last=null; }
    misuraSchermo(); paint();`;
  for (const tel of TEL) {
    const a = await conStato(tel, inAsta, 500);
    ok(a.vero <= a.i + 1, `asta della chiamata su ${tel[0]}: non scrolla (${a.vero} su ${a.i})`);
    for (const g of ['tressette', 'scopone']) {
      const m = await conStato(tel, inDieci(g), 500);
      ok(m.vero <= m.i + 1, `${g} con dieci carte in mano su ${tel[0]}: non scrolla (${m.vero} su ${m.i})`);
      ok(m.file === 2, `${g}: la mano sta su due file`);
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

  /* Il tavolo in solitario: si apre senza rete, i finti si siedono, si
     cambiano e se ne vanno, e poi giocano davvero — la mano deve finire e
     i punti devono fare 120. È anche l'unica prova che i bot non si
     inceppano a metà, che è il modo in cui si romperebbero. */
  {
    const c = await contesto();
    const p = await nuovaScheda(c, 'solo');
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto('http://localhost:8731/');
    await p.waitForSelector('#crea', { timeout: 4000 });
    await p.fill('#nm', 'Lomme');
    await p.click('#solo'); await attesa(400);
    ok(await p.isVisible('.seatlist'), 'da solo si apre il tavolo senza passare dal broker');
    ok(!(await p.isVisible('#qr')), 'da solo non c\'è nessun QR da far inquadrare');
    ok(!(await p.$('#link')), 'e nessun invito da mandare');
    /* `solo` è un `let` in cima allo script: sta nell'ambiente lessicale
       globale, non su `window`, e va letto per nome come si legge `S`. */
    const rete = await p.evaluate(() => ({
      solo: solo === true,
      /* Il retained vuoto e lo stato non devono mai partire: da solo il
         codice esiste solo per non avere due strade nel motore. */
      pubblicato: (window.__pubblicati || []).slice()
    }));
    ok(rete.solo, 'e il tavolo si sa di essere in solitario');
    ok(!rete.pubblicato.length, 'e sul filo non parte niente ('+rete.pubblicato.join(', ')+')');

    await p.click('#piu'); await attesa(200);
    await p.click('#piu'); await attesa(200);
    const quanti = await p.evaluate(() => S.seats.length);
    ok(quanti === 4, `i finti si siedono (siamo in ${quanti})`);
    const prima = await p.evaluate(() => S.seats[1].bot);
    await p.click('.seatlist li:nth-child(2) .altro'); await attesa(200);
    const dopo = await p.evaluate(() => S.seats[1].bot);
    ok(prima !== dopo, `tocchi il nome e se ne siede un altro (${prima} → ${dopo})`);
    const carat = await p.evaluate(() => S.seats.filter(s => s.bot).map(s => s.bot));
    ok(new Set(carat).size === carat.length, 'e non se ne siedono due uguali');

    /* Un gioco che i finti non sanno non si dà: il tavolo si fermerebbe sul
       loro turno e non ripartirebbe più. Si dice subito e non si distribuisce.
       Si prova in quattro, dove il tressette per il numero di posti si
       giocherebbe: in tre risponderebbe l'altra spiegazione e non questa. */
    await p.selectOption('#gm', 'tressette'); await attesa(300);
    ok(/non sanno ancora/.test(await p.textContent('#toast') || ''),
      'un gioco che i finti non sanno lo dice appena lo scegli');
    ok(await p.evaluate(() => document.getElementById('via').classList.contains('spento')),
      'e il bottone del via è spento');
    await p.click('#via', { force: true }); await attesa(300);
    ok(await p.evaluate(() => S.phase === 'attesa'), 'e premendolo non si distribuisce lo stesso');
    await p.selectOption('#gm', 'briscola'); await attesa(250);

    await p.click('.seatlist li:nth-child(4) .via'); await attesa(200);
    ok(await p.evaluate(() => S.seats.length) === 3, 'la crocetta lo manda via');

    await p.click('#via'); await attesa(900);
    await p.addStyleTag({ content: '*{animation:none !important;transition:none !important}' });
    /* Si gioca fino in fondo: io calo quando tocca a me, i finti da soli. */
    let giri = 0;
    while (giri++ < 400) {
      await attesa(220);
      if (await p.evaluate(() => S.phase === 'fine')) break;
      if (await p.evaluate(() => S.turn === mySeat && S.table.length < S.n)) {
        const s = await p.$('.slot.playable');
        if (s) await s.click({ force: true });
      }
    }
    const fine = await p.evaluate(() => ({ f: S.phase, t: (S.points || []).reduce((a, b) => a + b, 0) }));
    ok(fine.f === 'fine', 'la mano contro i finti arriva in fondo');
    ok(fine.t === 120, `e i punti fanno 120 (${fine.t})`);
    await p.screenshot({ path: path.join(SCATTI, '10-da-solo.png') });
    pagine.splice(pagine.indexOf(p), 1);
    await c.close();
  }

  /* E la stessa cosa a scopa e a scopone, che sono l'altra vista e l'altro
     modo di scegliere la mossa: quello che si rompe non è chi vince ma il
     finto che si pianta a metà mano e lascia il tavolo fermo per sempre. */
  for (const [gioco, quanti] of [['scopa', 2], ['scopa', 4], ['scopone', 4]]) {
    const c = await contesto();
    const p = await nuovaScheda(c, 'solo ' + gioco);
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto('http://localhost:8731/');
    await p.waitForSelector('#crea', { timeout: 4000 });
    await p.fill('#nm', 'Lomme');
    await p.click('#solo'); await attesa(250);
    for (let k = 2; k < quanti; k++) { await p.click('#piu'); await attesa(90); }
    await p.selectOption('#gm', gioco); await attesa(250);
    await p.click('#via'); await attesa(800);
    await p.addStyleTag({ content: '*{animation:none !important;transition:none !important}' });
    let giri = 0;
    while (giri++ < 600) {
      await attesa(160);
      if (await p.evaluate(() => S.phase === 'fine')) break;
      if (await p.evaluate(() => S.turn === mySeat)) {
        /* Se la carta si può prendere in più modi la vista chiede quale: si
           conferma il primo, che qui interessa solo che il giro non si pianti. */
        if (await p.$('#sc-si')) { await p.click('#sc-si', { force: true }); continue; }
        const s = await p.$('.slot.playable');
        if (s) await s.click({ force: true });
      }
    }
    const r = await p.evaluate(() => ({
      f: S.phase, carte: Object.values(S.taken).reduce((a, t) => a + t.length, 0)
    }));
    ok(r.f === 'fine', `da solo a ${gioco} in ${quanti}: la mano arriva in fondo`);
    ok(r.carte === 40, `da solo a ${gioco} in ${quanti}: le quaranta carte sono tutte raccolte (${r.carte})`);
    pagine.splice(pagine.indexOf(p), 1);
    await c.close();
  }

  /* La stanza in solitario è più alta di quella vera anche se non ha il QR:
     ogni finto porta il mestiere scritto sotto al nome, cioè una riga a
     testa, e in sei sono cinque righe in più. Si misura come l'altra. */
  for (const [tel, w, h, alto, basso] of TEL) {
    for (const quanti of [2, 4, 6]) {
      const c = await contesto();
      const p = await nuovaScheda(c, 'solo ' + tel);
      await p.setViewportSize({ width: w, height: h });
      await p.goto('http://localhost:8731/');
      await p.waitForSelector('#crea', { timeout: 4000 });
      await p.addStyleTag({
        content: `.wrap{padding-top:${14 + alto}px !important;padding-bottom:${20 + basso}px !important}`
          + `.sonda{padding-top:${alto}px !important;padding-bottom:${basso}px !important}`
          + '*{animation:none !important;transition:none !important}'
      });
      await p.fill('#nm', 'Lomme');
      await p.click('#solo'); await attesa(250);
      for (let k = 2; k < quanti; k++) { await p.click('#piu'); await attesa(90); }
      await attesa(200);
      const m = await p.evaluate(() => {
        const wr = document.querySelector('.wrap');
        const pr = wr.style.minHeight; wr.style.minHeight = '0';
        const nat = Math.ceil(wr.getBoundingClientRect().height); wr.style.minHeight = pr;
        return {
          nat, i: innerHeight, n: S.seats.length,
          tagliati: [...document.querySelectorAll('.seatlist li.finto .nome i')]
            .filter(x => x.scrollWidth > x.clientWidth + 1).map(x => x.textContent)
        };
      });
      ok(m.n === quanti && m.nat <= m.i, `da solo in ${quanti} su ${tel}: ci sta senza scrollare (${m.nat} su ${m.i})`);
      ok(!m.tagliati.length, `da solo in ${quanti} su ${tel}: il mestiere del finto ci sta ("${m.tagliati.join('", "')}")`);
      pagine.splice(pagine.indexOf(p), 1);
      await c.close();
    }
  }

  console.log(dice.join('\n'));
  const veri = guai.filter(g => !/favicon|ERR_/.test(g));
  if (veri.length) { console.log('\nGUAI:'); veri.slice(0, 10).forEach(g => console.log(' - ' + g)); }
  const ko = dice.filter(d => d.startsWith('KO')).length;
  console.log(ko || veri.length ? '\nFALLITO' : '\nTUTTO A POSTO');
  await b.close(); srv.close();
  process.exit(ko || veri.length ? 1 : 0);
})().catch(e => { console.log((globalThis.__dice||[]).join('\n')); console.log('\nesplosione: ' + e.message.split('\n')[0]); process.exit(1); });
