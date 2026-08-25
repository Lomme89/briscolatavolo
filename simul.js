/* Mille mani di briscola giocate dalle stesse funzioni che girano nell'app:
   sceltaBriscola() e vistaBot(), con lo stato vero al posto suo. Le regole
   della presa e della pesca sono ricopiate qui apposta corte: quelle vere le
   prova test2.js, qui interessa solo chi vince e quanto ci mette a decidere. */
const { chromium } = require('playwright-core');
const http=require('http'),fs=require('fs'),path=require('path');
const FINTO=fs.readFileSync('vista.js','utf8').match(/const FINTO = `([\s\S]*?)`;/)[1];
const GIRO=`(function(){
  const mescola=a=>{for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]];}return a;};
  function mano(n,chi,teams){
    const d=mescola(newDeck(n));
    S={code:'X',phase:'gioco',game:'briscola',n,teams,seats:Array.from({length:n},(_,i)=>({id:'p'+i,name:'p'+i})),
       hands:{},deck:null,table:[],turn:0,points:Array(teams?2:n).fill(0),tr:Array(n).fill(0),pp:Array(n).fill(0),
       trump:null,trumpSuit:0,mano:1,first:0,albo:{}};
    for(let i=0;i<n;i++) S.hands[i]=d.splice(0,3);
    S.trump=d[d.length-1]; S.trumpSuit=S.trump.s; S.deck=d;
    cadute=[];
    const tempi=[];
    while(Object.values(S.hands).some(h=>h.length)){
      S.table=[];
      for(let k=0;k<n;k++){
        const seat=(S.turn+k)%n;
        const car=CARATTERI[chi[seat]];
        let i;
        if(chi[seat]==='caso') i=Math.random()*S.hands[seat].length|0;
        else { const sc=sceltaBriscola(vistaBot(seat),car); i=sc.i; tempi.push(pensa(car,sc.durezza)); }
        S.table.push({seat,c:S.hands[seat].splice(i,1)[0]});
      }
      const w=trickWinner(S.table,S.trumpSuit);
      const g=S.table.reduce((a,p)=>a+pts(p.c),0);
      S.points[teams?w%2:w]+=g;
      S.table.forEach(p=>cadute.push(p.c));
      if(S.deck.length) for(let k=0;k<n;k++){const s=(w+k)%n; if(S.deck.length) S.hands[s].push(S.deck.shift());}
      S.turn=w;
    }
    return {punti:S.points.slice(),tempi};
  }
  return mano;
})()`;
(async()=>{
  const srv=http.createServer((q,s)=>{const f=path.join(__dirname,q.url==='/'?'index.html':q.url.split('?')[0]);
    fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);s.end();}else{s.writeHead(200,{'content-type':'text/html'});s.end(d);}});}).listen(8763);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const p=await (await b.newContext()).newPage();
  p.on('pageerror',e=>console.log('ERRORE '+e.message));
  await p.addInitScript(FINTO);
  await p.route('**/cdnjs.cloudflare.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
  await p.goto('http://localhost:8763/');
  await p.waitForSelector('#crea',{timeout:4000});
  await p.evaluate(g=>{ window.giro=window.eval(g); }, GIRO);

  const prova=(titolo,n,chi,teams,giri)=>p.evaluate(([n,chi,teams,giri])=>{
    let a=0,b=0,vinteA=0,pari=0,tempi=[];
    for(let k=0;k<giri;k++){
      const r=window.giro(n,chi,teams);
      const pa=teams?r.punti[0]:r.punti[0], pb=teams?r.punti[1]:Math.max(...r.punti.slice(1));
      a+=pa; b+=pb; if(pa>pb)vinteA++; else if(pa===pb)pari++;
      if(k<40) tempi=tempi.concat(r.tempi);
    }
    tempi.sort((x,y)=>x-y);
    return {a:a/giri,b:b/giri,vinteA,pari,
      mediano:tempi[tempi.length>>1]|0, corto:tempi[0]|0, lungo:tempi[tempi.length-1]|0,
      su3s:Math.round(1000*tempi.filter(x=>x>3000).length/tempi.length)/10};
  },[n,chi,teams,giri]).then(r=>{
    console.log(titolo.padEnd(38)+`${r.a.toFixed(1)} a ${r.b.toFixed(1)}   vinte ${r.vinteA}/${giri}${r.pari?' (pari '+r.pari+')':''}`);
    return r;
  });

  console.log('--- in due, ognuno contro tutti ---');
  await prova('Rosaria contro il caso',2,['rosaria','caso'],false,600);
  await prova('Sasà contro il caso',2,['sasa','caso'],false,600);
  await prova('Assunta contro Gennaro',2,['assunta','gennaro'],false,600);
  await prova('Rosaria contro Sasà',2,['rosaria','sasa'],false,600);
  await prova('Rosaria contro Peppino',2,['rosaria','peppino'],false,600);
  console.log('--- in quattro, a squadre ---');
  const r=await prova('Rosaria+Assunta contro Sasà+Sasà',4,['rosaria','sasa','assunta','sasa'],true,600);
  await prova('quattro Peppino',4,['peppino','peppino','peppino','peppino'],true,600);
  console.log('--- quanto ci mettono a calare (ms) ---');
  console.log(`mediana ${r.mediano}, la più svelta ${r.corto}, la più lenta ${r.lungo}, sopra i 3s ${r.su3s}%`);
  await b.close(); srv.close();
})();
