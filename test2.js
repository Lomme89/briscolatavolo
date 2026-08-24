/* Partite intere di briscola e scopa da 2 a 4: tutte le carte raccolte,
   punteggi uguali su ogni client, nessuna eccezione. */
const H = require('./harness.js');
const { nuovoBroker, apriClient, attesa, $, $$, finoA } = H;

const NOMI = ['Ada', 'Bino', 'Cira', 'Dino', 'Ebe', 'Fio'];
const stato = c => { try { return JSON.parse(c.w.eval('typeof S!=="undefined"&&S?JSON.stringify(S):"null"')); } catch (e) { return null; } };

async function partita(gioco, n, errori) {
  const broker = nuovoBroker();
  const cl = [];
  for (let i = 0; i < n; i++) cl.push(apriClient(broker, gioco + n + '/' + NOMI[i], errori));
  await attesa(160);

  // il mazziere apre
  await finoA(() => $(cl[0], '#nm'), 4000, 'home del mazziere');
  $(cl[0], '#nm').value = NOMI[0];
  $(cl[0], '#crea').click();
  await finoA(() => $(cl[0], '.roomcode'), 4000, 'stanza aperta');
  const code = $(cl[0], '.roomcode').textContent.trim();

  // gli altri si siedono
  for (let i = 1; i < n; i++) {
    await finoA(() => $(cl[i], '#cd'), 4000, 'home ospite');
    $(cl[i], '#nm').value = NOMI[i];
    $(cl[i], '#cd').value = code;
    $(cl[i], '#go').click();
  }
  await finoA(() => (stato(cl[0]) || {}).seats && stato(cl[0]).seats.length === n, 9000, n + ' seduti');

  if (gioco === 'scopa') {
    const b = $$(cl[0], '#gm button').find(x => x.dataset.v === 'scopa');
    b.click();
    await finoA(() => (stato(cl[0]) || {}).game === 'scopa', 4000, 'gioco scopa');
  }

  // si distribuisce
  await finoA(() => $(cl[0], '#via'), 4000, 'bottone distribuisci');
  $(cl[0], '#via').click();
  await finoA(() => (stato(cl[0]) || {}).phase === 'gioco', 6000, 'mano iniziata');

  // si gioca fino alla fine
  const t0 = Date.now();
  let mosse = 0;
  while (Date.now() - t0 < 180000) {
    const st = stato(cl[0]);
    if (st && st.phase === 'fine') break;
    let mosso = false;
    for (const c of cl) {
      const s = $$(c, '.slot').filter(b => !b.disabled && !b.classList.contains('muta') && !b.classList.contains('gone'));
      if (!s.length) continue;
      s[Math.floor(Math.random() * s.length)].click();
      mosse++;
      await attesa(40);
      const si = $(c, '#sc-si'); if (si) { si.click(); await attesa(40); }
      mosso = true; break;
    }
    await attesa(mosso ? 90 : 200);
  }

  const fin = stato(cl[0]);
  const err = [];
  if (!fin || fin.phase !== 'fine') err.push('la mano non e\' finita dopo ' + mosse + ' mosse');
  else {
    if (gioco === 'scopa') {
      const carte = Object.values(fin.taken).reduce((a, v) => a + v.length, 0);
      if (carte !== 40) err.push('carte raccolte ' + carte + ' invece di 40');
      if (fin.board.length) err.push('sul tavolo restano ' + fin.board.length + ' carte');
    } else {
      const tot = fin.points.reduce((a, b) => a + b, 0);
      if (tot !== 120) err.push('punti totali ' + tot + ' invece di 120');
      if (fin.deck.length) err.push('nel mazzo restano ' + fin.deck.length + ' carte');
      if (Object.values(fin.hands).some(h => h.length)) err.push('qualcuno ha ancora carte in mano');
    }
    // tutti d'accordo
    for (let i = 1; i < n; i++) {
      const s = stato(cl[i]);
      if (!s) { err.push(NOMI[i] + ' non ha stato'); continue; }
      if (s.phase !== 'fine') err.push(NOMI[i] + ' non vede la fine');
      if ((s.points || []).join() !== fin.points.join())
        err.push(NOMI[i] + ' vede ' + (s.points || []).join() + ' invece di ' + fin.points.join());
    }
  }
  cl.forEach(c => c.dom.window.close());
  return { err, punti: fin ? fin.points.join('-') : '?', mosse };
}

(async () => {
  const errori = [];
  const casi = [['briscola', 2], ['briscola', 3], ['briscola', 4], ['scopa', 2], ['scopa', 3], ['scopa', 4]];
  let ko = 0;
  for (const [g, n] of casi) {
    const t = Date.now();
    let r;
    try { r = await partita(g, n, errori); }
    catch (e) { r = { err: ['eccezione: ' + e.message], punti: '?', mosse: 0 }; }
    const s = ((Date.now() - t) / 1000).toFixed(0) + 's';
    if (r.err.length) { ko++; console.log('KO  ' + g + ' in ' + n + '  ' + s + '  ' + r.err.join(' | ')); }
    else console.log('ok  ' + g + ' in ' + n + '  ' + s + '  punti ' + r.punti + ', ' + r.mosse + ' mosse');
  }
  const veri = errori.filter(e => !/Could not parse CSS|Not implemented/i.test(e));
  if (veri.length) { console.log('\nECCEZIONI (' + veri.length + '):'); veri.slice(0, 12).forEach(e => console.log(' - ' + e.split('\n')[0])); }
  console.log(ko || veri.length ? '\nFALLITO' : '\nTUTTO A POSTO');
  process.exit(ko || veri.length ? 1 : 0);
})();
