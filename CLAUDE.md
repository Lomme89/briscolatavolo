# Briscola al tavolo

Webapp per giocare a carte napoletane quando si è seduti insieme senza un mazzo vero.
Ognuno usa il proprio telefono, un codice di quattro lettere tiene insieme il tavolo.
Da 2 a 6 giocatori, e a briscola i posti che avanzano li possono tenere dei finti. Sei giochi: **briscola**, **briscola chiamata**, **scopa**,
**scopone scientifico**, **tressette** e **tressette a perdere**.

In produzione su GitHub Pages: `https://lomme89.github.io/briscolatavolo/`

## File

```
index.html          tutto il gioco: markup, stile, motore, rete (~1,3 MB)
manifest.json       manifest PWA
sw.js               service worker, cache del guscio
.nojekyll           impedisce a GitHub Pages di processare i file
icone/              icona-192, icona-512, icona-maskable-512, apple-touch-icon
foglio.py           rifà il foglio di un mazzo dalle quaranta carte sciolte
harness.js          più client jsdom con un broker MQTT finto in-process
test2.js            partite intere di briscola e scopa, da 2 a 4
vista.js            le stesse cose in Chromium, per quello che jsdom non vede
simul.js            mille mani di briscola fra bot, per misurare la strategia
```

Non c'è build, non ci sono dipendenze npm, non c'è bundler. Si modifica `index.html`
a mano e si carica. Due sole librerie esterne, da cdnjs: **mqtt.js** e **qrcodejs**.

## Architettura

Non c'è backend. Il telefono di chi apre il tavolo è **autoritativo**: possiede lo stato,
applica le regole, pubblica. Gli altri client sono terminali stupidi che disegnano e
mandano intenzioni.

Il trasporto è un **broker MQTT pubblico** (`broker.emqx.io` via WSS, con
`test.mosquitto.org` come riserva). Due topic per tavolo:

- `bt/<CODICE>/s` — lo stato completo in JSON, **retained**, pubblicato solo dal mazziere.
  Il flag retained è ciò che permette a chi entra dopo, o si riconnette, di vedere subito
  la partita.
- `bt/<CODICE>/a` — le azioni dei giocatori. Solo il mazziere è iscritto. Ci passa anche
  il battito di presenza, `{t:'qui'}`, che ogni client manda ogni cinque secondi.
- `bt/<CODICE>/h` — il battito del mazziere, non retained. Serve solo a far sapere agli
  altri che è ancora lì.

QoS 0: nessuna ritrasmissione. Non serve, perché ogni messaggio di stato è completo e non
incrementale — il successivo rimette tutti in pari.

Uscendo, il mazziere pubblica un retained vuoto per smontare il tavolo.

Il service worker serve **`index.html` prima dalla rete** e tiene la cache come rete di
sicurezza per quando il telefono è offline. Il contrario, che è la scelta normale per un
guscio, qui era sbagliato: il guscio *è* l'app, cambia a ogni modifica, e servirlo dalla
cache voleva dire far vedere la versione vecchia e accorgersi della nuova solo al secondo
avvio. Icone e manifest, che cambiano di rado, restano cache-first.

### Conseguenze note e accettate

- Se il mazziere chiude la pagina la partita muore. Non c'è migrazione dell'autorità.
- Lo stato contiene le mani di tutti. Il client nasconde quelle altrui, ma chi apre gli
  strumenti da sviluppatore può sbirciare. Accettabile tra amici allo stesso tavolo.
- Il topic non è autenticato: chi indovina il codice può leggere e mandare azioni.
  Il mazziere valida i turni, quindi non si gioca fuori tempo, ma non c'è identità vera.
- Broker pubblico di prova, senza garanzie di servizio.

## Funzioni principali in index.html

| Funzione | Ruolo |
|---|---|
| `handle(a)` | unico punto d'ingresso delle azioni, gira solo sul mazziere |
| `deal()` / `dealScopa()` / `dealChiamata()` | distribuzione, smista in base a `S.game` |
| `autoResolve()` | chiude la presa dei giochi a mano, con `ritmoPresa()` |
| `vinceTre(t)` / `terzi(c)` | chi prende e quanto vale, a tressette |
| `puoGiocare(st,seat,i)` | l'obbligo di rispondere al seme |
| `vincitori(st)` | chi ha vinto: il massimo, o il minimo a perdere, o i 61 della chiamata |
| `giocaScopa()` / `finisciScopa()` | mossa e conteggio finale a scopa |
| `prese(board, val)` | tutte le prese possibili con una carta |
| `contaScopa(st)` | carte, denari, settebello, primiera, scope |
| `paint()` | smista alle viste, poi `suoniDiff()` |
| `tavolo()` / `tavoloScopa()` / `tavoloAsta()` | le viste di gioco e quella dell'asta |
| `ventaglioMano()` / `misureMano()` | la mano, su una fila o su due |
| `lancia()` / `raccogli()` / `scossa()` | animazioni, Web Animations API |
| `avvisa(testo)` | l'unico posto dove dire una cosa breve |
| `nega(el, testo)` | un tocco che non può fare niente, e il perché |
| `vistaBot(seat)` | l'unica finestra di un finto sul tavolo: solo quello che vedrebbe |
| `sceltaBriscola(v,car)` / `sceltaScopa(v,car)` | che mossa fa un finto, e quanto è dura la scelta |
| `pensa(car,durezza)` | quanto ci mette a calarla |
| `robot()` | prenota il turno del finto, una volta sola per mossa |
| `presenzaDiff()` | chi si è appena seduto, chi se n'è andato, chi aspetta |
| `volaPrese()` / `timbroScopa()` | la presa e la scopa, a scopa |
| `finePartita()` | la mano finita: conti a schermo intero, e la festa |
| `festeggia()` / `coriandoli()` | gli effetti per chi vince |
| `suonoCarta()` | schiocco, corpo e panno: una carta che si posa |
| `conn()` / `capo()` | la barra in cima: come va la rete, e a che gioco si sta |
| `misuraSchermo()` | le fasce di altezza, al netto degli incavi |
| `spazioQR()` / `misuraHome()` | quanto cede il QR, quanto cede il ventaglio |

Le viste ricostruiscono `#app` via `innerHTML` a ogni cambio di stato. È volutamente
grezzo e va benissimo a queste dimensioni: non introdurre un framework.

### Il registro dei giochi

Ogni gioco è una riga in `GIOCHI`, e aggiungerne uno è aggiungere una riga più il
pezzo di motore che gli serve:

```js
const GIOCHI={
  briscola:  {nome:'Briscola', titolo:'La briscola',          posti:[2,3,4,5,6], vista:'briscola', bot:true},
  chiamata:  {nome:'Chiamata', titolo:'La briscola chiamata', posti:[5],         vista:'briscola'},
  scopa:     {nome:'Scopa',    titolo:'La scopa',             posti:[2,3,4,6],   vista:'scopa', bot:true},
  scopone:   {nome:'Scopone',  titolo:'Lo scopone scientifico',posti:[4],        vista:'scopa', sempreSquadre:true, bot:true},
  tressette: {nome:'Tressette',titolo:'Il tressette',         posti:[2,4],       vista:'briscola', sempreSquadre:true},
  treperdere:{nome:'A perdere',titolo:'Il tressette a perdere',posti:[2,4],      vista:'briscola', sempreSquadre:true}
};
```

`vista` dice quale delle due viste di gioco disegna il tavolo, `posti` in quanti si
può giocare, `sempreSquadre` che le squadre non sono una scelta, `bot` se i finti lo
sanno giocare. Quest'ultima non è un vezzo: con un finto seduto a un gioco che non
sa, il tavolo si ferma sul suo turno e non riparte più — quindi non si dà, e il
bottone del via dice perché. Nella stanza il
gioco si sceglie da una **tendina**, non da una fila di bottoni: sei giochi facevano
due righe e ogni gioco in più ne avrebbe aggiunta una, e quello spazio è quello che
poi manca al QR. Le opzioni non si disabilitano mai — dentro c'è scritto in quanti si
gioca (`postiBrevi()`, «Briscola · 2-6») e sceglierne una che coi presenti non si fa
risponde subito con `avvisa()`, oltre a spegnere il bottone del via. Non guardare mai `S.game`
direttamente per sapere quale vista o quanti posti: passa da `gioco(st)`,
`vistaDi(st)` e `siGiocaIn(g,k)`.

I punti non sono più per posto ma **per gruppo**: `nGroups(st)` quanti sono e
`groupOf(seat,st)` in quale sta un posto. A squadre è `seat%2`, alla chiamata è
«chiamante e socio» contro «gli altri tre», altrove è il posto stesso. Se scrivi
qualcosa che somma punti, passa da lì: con l'indice del posto la chiamata conta
male e basta.

### Forma dello stato

```js
S = {
  code, game: 'briscola'|'chiamata'|'scopa'|'scopone'|'tressette'|'treperdere',
  phase: 'attesa'|'asta'|'gioco'|'fine',
  seats: [{id, name}],        // denso, max 6, l'indice è il posto
  coda: [{id, name}],         // chi è arrivato a mano iniziata, entra al prossimo giro
  via: [playerId],            // chi non manda il battito da mezzo minuto
  teams, n, first, mano, albo: {playerId: maniVinte},
  hands: {seat: [carta]}, deck: [carta],
  // briscola
  trump, trumpSuit, table: [{seat, c}], turn, points: [], tr: [], pp: [],
  // scopa e scopone
  board: [carta], taken: {seat: [carta]}, scope: [], lastTake, mossa, esito,
  // tressette: i punti veri stanno in terzi, points ne è la parte intera
  terzi: [],
  // chiamata
  asta: {turn, aperto, offerta:{seat,r}, fuori:[seat], vinta},
  chiamata: carta, chiamante: seat, socio: seat, rivelato
}
```

Una carta è `{s, r}`: `s` è il seme (0 denari, 1 coppe, 2 spade, 3 bastoni), `r` va da
1 a 10. `ripulisci()` azzera i campi della mano precedente quando si cambia gioco:
senza, una vista parte con i resti dell'altra e si rompe.

## Risposte al tocco

Ogni azione deve rispondere **subito** e **dire com'è andata**. Tre pezzi
reggono tutto il resto.

`avvisa(testo, {ico, ko, ms})` scrive una pastiglia in `#toast`, che sta fuori
da `#app` e quindi **non se ne va col ridisegno**. Ne restano al massimo tre.
È anche l'unico punto dell'app con `aria-live`, quindi è lì che va detto
quello che deve sentire chi non guarda lo schermo.

`nega(el, testo)` è la risposta a un tocco che non può fare niente: scossetta,
vibrazione, tono basso, avviso. Serve perché **un elemento `disabled` non
riceve nemmeno il tocco**: chi ci prova non sa se il tocco sia arrivato o se
l'app sia morta. Per questo il bottone che non si può premere ora porta
`.spento` + `aria-disabled` invece di `disabled`, e le carte non giocabili
portano `.muta` — il `disabled` vero resta solo per il fermo dopo la giocata,
che deve davvero bloccare tutto. Se aggiungi un comando che a volte non si può
usare, non spegnerlo con `disabled`: dagli un motivo.

La classe `.giu` (il bottone premuto) la mette **un ascoltatore solo, in delega
su `document`**, al `pointerdown` e non al click: su telefono `:active` non è
affidabile, e le viste ricreano i bottoni a ogni messaggio di stato, quindi
legarli uno per uno non reggerebbe. Le carte hanno il loro `.premuta`, dallo
stesso motivo, e la delega le salta apposta.

Attenzione a chi si lega addosso i `data-`: `applicaTema` scrive `data-tema`
sulla **radice**, quindi `querySelectorAll('[data-tema]')` prende anche
`<html>`. `legaTemi()` ci attaccava un `onclick`, e da lì in poi un tocco in
un punto qualsiasi della pagina risaliva fino alla radice, ri-applicava il
tema, suonava e ridisegnava tutto. Ora il selettore è `button[data-tema]`.
Se leghi eventi per attributo, chiedi anche il tag.

La conferma di un'azione **non va scritta sul nodo**: fra il tocco e la
risposta (gli appunti sono asincroni) può arrivare un messaggio di stato e la
vista si rifà da capo, lasciandoti in mano un bottone staccato. Sta in un
flag che la vista consulta quando disegna — `invitoFatto`, come
`sciogliChiesto` — e l'animazione della spunta è legata a `.appena`, se no un
ridisegno qualsiasi la rifarebbe partire.

`copiaTesto()` prova la Clipboard API e poi il campo nascosto, e **torna se ce
l'ha fatta**: prima si scriveva «Link copiato» comunque, anche fuori da https
dove non c'era niente da copiare. Dove esiste la condivisione di sistema
(`siCondivide()`, cioè `navigator.share` su schermo tattile) il link si manda
invece di copiarlo, perché è quello che si fa davvero al tavolo.

**In cima si scrive solo quello che serve.** Tre cose se ne sono andate dalla
testa del tavolo, e tutte e tre per lo stesso motivo: c'erano sempre, quindi non
dicevano niente. `conn()` scriveva «In linea» per tutta la partita e adesso lascia
solo il pallino, con le parole che tornano quando c'è da ricollegare o quando il
mazziere non risponde. `capo()` scriveva il seme di briscola mentre la carta vera
stava sul feltro grande una volta e mezza il dorso: ora le due cose si danno il
cambio, la scritta esce solo a mazzo finito, quando la briscola ce l'ha qualcuno in
mano — e alla chiamata, dove la carta chiamata resta sul feltro fino in fondo, non
esce mai. A tressette non c'è briscola e si scrive il gioco, che è l'unico posto che
distingue il tressette da quello a perdere.

E le pastiglie dei giocatori **hanno la cornice solo quando tocca a loro**: erano
incorniciate tutte uguali, e quella di chi doveva giocare si distingueva per un filo
d'oro che non si vedeva. Adesso gli altri sono nomi appoggiati sul feltro, la cornice
vuol dire una cosa sola, e la fascia in cima pesa la metà. A briscola è sparito anche
il numero delle prese, che uno ha dovuto chiedere che cosa fosse: una presa può
valere trenta punti o zero, quindi contarle non dice niente su chi sta vincendo.
Resta nel pannello dei conti, sotto «Prese». A scopa invece le carte prese sono un
punto vero, e quel numero rimane.

L'uscita del mazziere chiede conferma a due tocchi: non esce e basta, pubblica
il retained vuoto e **smonta il tavolo di tutti**.

## I finti giocatori

Un bot **non è una modalità**: è un posto come gli altri, con un id suo, che invece di
mandare l'azione dalla rete la mette dritta in `handle()`. Girano solo sul mazziere, che
è l'unico ad avere lo stato vero — e per questo si possono mettere anche a un tavolo
vero, per riempire il quarto posto quando siete in tre. Un tavolo **in solitario** è
soltanto il caso in cui i posti li tengono tutti loro: `solo` spegne la rete e basta.
Niente broker, niente codice, niente QR; funziona col telefono in aereo, ed è l'unico
bottone della home che non aspetta il collegamento.

**`vistaBot(seat)` è il punto in cui si decide se barano.** Lo stato ha le mani di
tutti, e un bot che le legge gioca perfetto: non perde mai, e non è divertente. Quella
funzione è la sola finestra che ha sul tavolo, e dentro c'è la sua mano, il tavolo, la
briscola, quante carte restano nel mazzo e quello che è già caduto. Se aggiungi un gioco
ai bot, aggiungi lì quello che gli serve — non altrove.

Le carte cadute stanno in `cadute`, **fuori dallo stato**: sul filo non servono a
nessuno, i bot girano solo qui, e ogni `deal()` le azzera.

I caratteri sono sei manopole sulla stessa strategia, non sei strategie:

| manopola | che cosa muove |
|---|---|
| `rischio` | quanto volentieri brucia una briscola per portare via il giro |
| `memoria` | se tiene il conto di quello che è caduto e di quante briscole restano fuori |
| `fretta` | quanto è svelto a rispondere |
| `errore` | quanto spesso prende la **seconda** scelta invece della prima |
| `caos` | quanto spesso ne cala una a caso |
| `avidita` | se l'asso lo incassa o se lo tiene |

`errore` e `caos` sono due cose diverse apposta: chi sbaglia prende la seconda scelta,
che è come sbaglia uno che sta giocando; chi va a caso non stava guardando. È l'unica
cosa che distingue chi ha imparato ieri da chi gioca male e basta.

Un carattere nuovo è **una riga in `CARATTERI`**. Quelli che ci sono: Assunta prudente,
Gennaro sanguigno, Peppino distratto, Rosaria che se le ricorda tutte, Sasà che ha
imparato ieri.

**Quello che fa sembrare vero un finto non è come gioca: è quando gioca.** `pensa()`
allunga l'attesa quando le prime due scelte si somigliano — una carta obbligata esce
subito, una scelta difficile si fa aspettare — e ogni tanto ci aggiunge un
tentennamento. C'è un tetto a 4,2 secondi: la lentezza è un carattere, non una
punizione, e oltre quel punto uno smette di credere che stia pensando e comincia a
credere che si sia rotto qualcosa.

`robot()` prenota il turno **una volta sola per mossa**. `paint()` gira a ogni cosa che
succede, il muto e il resize compresi: senza la chiave lo stesso finto si sarebbe
riprenotato dieci volte per la stessa carta, e chi gioca col tasto del muto non lo
avrebbe fatto calare mai.

Sanno la **briscola**, la **scopa** e con lei lo **scopone**, che è la stessa
strategia col mazzo tutto in mano. `robot()` esce da solo sugli altri giochi — la
chiamata e il tressette — che restano giocabili fra persone come prima, e che con un
finto seduto non si danno affatto (`saGiocare()`, la colonna `bot` del registro).

A scopa la mossa non è una carta ma una carta **più quale presa**, e il voto è la
somma di quello che porta via e di quello che lascia: le carte, i denari, il
settebello, quanto migliora la primiera del gruppo, la scopa — e in negativo il
rischio di lasciare un tavolo che somma da uno a dieci, che è **l'unico modo di
regalare una scopa** e quello che si regala sempre. `memoria` qui vuol dire tenere
il conto delle prese, che al tavolo stanno un attimo scoperte davanti a tutti prima
di finire nel mucchietto.

Una differenza di ritmo: a briscola la presa se la prende `autoResolve()`, che
aspetta lui. A scopa lo stato cambia subito, quindi è il bot che deve aspettare —
se cala mentre le carte stanno ancora volando via non si vede più chi ha preso che
cosa.

## Presenza

Ogni client manda `{t:'qui'}` ogni cinque secondi e il mazziere segna l'ora in `visti`.
Chi non si fa sentire per **trenta secondi** finisce in `S.via`: il suo nome si smorza e
la barra dice che non risponde. Il mazziere fa lo stesso verso gli altri su `/h`, e chi
non lo sente più se lo vede scritto al posto di "In linea".

**Il battito non fa succedere niente da solo.** Non salta turni, non scioglie mani, non
libera posti: la soglia è larga apposta perché uno che ci sta pensando su manda il battito
lo stesso, e sarebbe sbagliato metterlo di fretta. L'unica cosa che abilita è un bottone
per il mazziere, che chiude la mano in due tocchi quando qualcuno se n'è andato davvero.

Chi arriva a mano iniziata finisce in `S.coda` e si siede alla mano dopo: `assorbiCoda()`
lo travasa in `seats` appena la fase non è più `gioco`. Nel frattempo vede il tavolo da
spettatore, con scritto perché non ha carte in mano.

## Regole implementate

**Briscola.** 3 carte in mano, si pesca dopo ogni presa a partire dal vincitore, la
briscola scoperta è l'ultima carta del mazzo. Ordine di forza: asso, tre, re, cavallo,
fante, 7, 6, 5, 4, 2. Punti 11/10/4/3/2, totale 120.

Il numero di giocatori non divide 40, quindi **in tre si toglie un due e in sei se ne
tolgono quattro**: sono carte da zero punti, il totale resta 120 e le carte finiscono
tutte insieme. In 4 e 6 si può giocare a squadre alternate (`seat % 2`).

**Briscola chiamata**, in cinque soli. Otto carte a testa, mazzo intero, niente
pesca. Prima si fa l'**asta**: a giro si chiama un rango sempre più basso —
asso, tre, re, cavallo, fante, sette, sei, cinque, quattro, due — e chi passa è
fuori per sempre. Resta uno: quello sceglie il **seme**, che diventa briscola, e
chi ha in mano quella carta esatta è il suo socio **senza saperlo dire**. Il socio
si scopre da solo quando quella carta cade: fino a quel momento `S.rivelato` è
falso e nessuno legge «con te» sotto un nome. Se passano tutti si ridà.
Chiamante e socio vincono con **61 punti su 120**; se il chiamante chiama una
carta che ha già in mano gioca da solo contro quattro, e `S.socio` resta `-1`.

**Tressette**, in due o in quattro, sempre a squadre in quattro. Dieci carte a
testa, niente briscola: **si risponde al seme se si può** — è l'unica regola
dell'app che vieta una carta per il suo seme, e la fa rispettare `puoGiocare()`,
che serve sia al mazziere per validare sia alla vista per smorzare le carte.
Ordine di forza: tre, due, asso, re, cavallo, fante, sette, sei, cinque, quattro.
I punti si contano in **terzi**: l'asso ne vale tre, il due, il tre e le tre
figure uno ciascuno, il resto niente; l'ultima presa vale un punto intero, cioè
tre terzi. In tutto undici punti. I terzi che avanzano non contano — `S.points` è
`Math.floor(S.terzi/3)` — ma si vedono salire lo stesso, scritti come frazione a
fianco al punteggio, se no un punto che non si muove per tre prese sembra rotto.

**Tressette a perdere**: identico, ma vince chi fa **meno** punti. È l'unico
gioco dove il massimo non vince, e per questo chi vince non lo decide più la vista
ma `vincitori(st)`.

**Scopone scientifico**, in quattro e sempre a squadre. È la scopa col mazzo
distribuito tutto subito: dieci carte a testa, quattro sul tavolo, niente pesca.
Le regole della presa e i conti sono quelli della scopa.

**Scopa.** 4 carte scoperte, 3 in mano. Se sul tavolo c'è una carta di valore uguale la
presa di quella è **obbligatoria**, niente somme; se le combinazioni possibili sono più
d'una sceglie il giocatore. Scopa quando il tavolo resta vuoto, tranne sull'ultima carta
della mano. Le carte avanzate vanno all'ultimo che ha preso. Punti: carte, denari,
settebello, primiera (7=21, 6=18, A=16, 5=15, 4=14, 3=13, 2=12, figure=10), più uno per
scopa; in parità il punto non si assegna. **In cinque la scopa non è giocabile**, i conti
non tornano.

## La fine della mano

A mano finita non si torna al tavolo vuoto: `finePartita()` prende tutto lo schermo e
mostra chi ha vinto, i punti che salgono da zero e la tabella dei conti — che prima
stava dietro al bottone dei punteggi, cioè dietro a un tocco che nessuno faceva.

È l'unica schermata con dentro una lista che può essere più lunga dello spazio, e per
questo è anche l'unica che si prende un'altezza **definita** (`.wrap.schermointero`):
con `min-height` il contenitore cresce col contenuto e i figli non si stringono mai,
quindi a scorrere finirebbe la pagina invece della tabella.

Se hai vinto tu parte `festeggia()`: coriandoli in `#volo`, scossa, vibrazione e
`SND.trionfo()`. È l'unico punto dell'app dove il ritmo non è misurato, ed è voluto —
tutto il resto è tenuto corto apposta, questo no. Chi ha chiesto meno movimento
(`prefers-reduced-motion`) riceve solo il suono e la vibrazione. La festa si fa una
volta per mano: la guardia è `festaFatta`, se no ogni messaggio di stato la rifarebbe.

## Temi

Ci sono quattro temi, in `TEMI`: **classico** (napoletane) e **piacentine**, tutti e due
sul feltro verde con EB Garamond e le cornici dorate, e **chiaro** e **scuro** (mazzi
moderni disegnati piatti, palette neutra, carattere di sistema in grassetto stretto).
I due tradizionali si distinguono per il mazzo, per le proporzioni della carta e per il
dorso, rosso il napoletano e blu il piacentino: con lo stesso dorso non si capirebbe
quale dei due è acceso guardando la pastiglia. `applicaTema` mette anche la classe
`html.tradizionale`, che è la scorciatoia per «napoletane o piacentine» e regge la
doratura delle cornici. Ognuno porta il suo mazzo, la sua palette e il suo
carattere; il tema è una scelta **personale**, sta nel `localStorage` e non nello stato
del tavolo, quindi allo stesso tavolo si può stare uno al chiaro e uno allo scuro.

Le **cornici** hanno un token loro, `--bordo`, separato da `--felt-line`: nel classico
sono dorate, perché è un mazzo da bar e le scatole erano bordate d'oro, e nei due
moderni restano il grigio di prima. Nel classico c'è anche un secondo filo più chiaro
dentro al bordo (`inset 0 0 0 1px`): è quello che fa leggere una cornice come dorata
invece che come una riga colorata. Se aggiungi una superficie incorniciata usa
`var(--bordo)`, non `var(--felt-line)`.

I colori stanno tutti in token sotto `html[data-tema=…]`. Se aggiungi una regola non
scrivere un colore a mano: usa un token, se no il tema sbagliato ti si vede addosso.
`--acc-rgb` è l'accento in componenti separate, per gli aloni in `rgba()`.

La **briscola** in alto a destra sta a `--tw`, una volta e mezza il dorso: è la carta
che si guarda per tutta la mano e a misura di dorso non si leggeva. Esce da sotto il
mazzo, che le sta sopra (`z-index` dentro `.deckbox`, che fa contesto apposta: se no il
dorso finirebbe sopra anche alle carte calate, che quando arrivano lì devono passargli
davanti). **Sparisce quando il mazzo finisce**: l'ultima carta del mazzo è proprio lei,
e a quel punto ce l'ha qualcuno in mano — lasciarla lì vuol dire far vedere la stessa
carta in due posti.

Sotto al mazzo non c'è il numero di carte rimaste ma **per quante altre mani il mazzo
dà da pescare** (`maniRimaste()`), che a mazzo finito diventa «mazzo finito». Non sono
i giri che restano da giocare: quelli sono sempre questi più i tre che ognuno ha già in
mano.

**Le proporzioni della carta cambiano col mazzo**: `--ar` vale 1.655 col napoletano,
1.700 col piacentino (col taglio: senza sarebbe 1.685) e 1.733 con i due moderni. Ogni misura ricavata dall'altezza passa
da `perAltezza()`, che la riscala di `1.517/--ar`; e i minimi e i massimi dei `clamp`
passano da `perLato()`, che fa la stessa cosa su una misura in larghezza — sono scelti
sulla larghezza ma quello che pesa sul tavolo è l'altezza, e con un mazzo più lungo la
stessa larghezza costa più spazio. Senza l'uno o l'altro, col mazzo più lungo la pagina
scrolla.

Si sceglie da due posti: le tre pastiglie tonde nella barra in fondo alla home, e la
sezione «Aspetto» in fondo al pannello delle regole, per cambiarlo anche stando a tavolo.

## Carte

Ogni mazzo è un unico foglio incorporato in base64 dentro `index.html`, tutti e quattro
in WebP: napoletane 200×331 a qualità 76, piacentine 200×337 a qualità 72, i due moderni
200×347 a qualità 72. Ogni carta è un `div` con `background-size: 1000% 400%` e
`background-position` calcolata da seme e valore. Righe = semi nell'ordine `SUITS`,
colonne = valori 1..10.

I fogli si rifanno con `foglio.py` (serve `pip install pillow`), che prende una cartella
di quaranta carte, le compone sulla griglia, appoggia su bianco gli angoli trasparenti —
le piacentine ce li hanno, e in WebP diventerebbero neri — e stampa la data URI da
incollare:

```
python3 foglio.py cartella-delle-carte --larghezza 200 --qualita 76 [--taglia 4] [--angolo 12]
```

La misura della cella è 200px di larghezza per tutti: più grande non si vede la
differenza a schermo e il file raddoppia. Lo script dice anche quanto viene `--ar`.

`--taglia` toglie un anello di pixel dal bordo di ogni carta, e le piacentine ne hanno
bisogno: si portano dietro il filo della fustella, che insieme alla cornice stampata
dentro faceva due righe, cioè una carta dentro una carta. Con quattro pixel via il filo
sparisce dai lati — ma **non dall'angolo**, dove la curva rientra di una decina di pixel
e un anello dritto non la prende. Lì serve `--angolo`, che sbianca tutto quello che sta
fuori da una smussatura in percentuale della larghezza. Sul tavolo, con le carte grandi,
quell'arco si vedeva; in home, con le carte del ventaglio a sessanta pixel, no — ed è
per questo che sembrava un difetto solo di una schermata.

La smussatura del CSS (`--r-carta`, il 10%) sta apposta **dentro** a quella con cui si
è sbiancato l'angolo (il 12%): così il bordo visibile cade sempre nel bianco pulito, e
mezzo pixel di disaccordo fra il taglio del CSS e quello del disegno non fa riaffiorare
il filo. Per la stessa ragione nel tema
piacentino `--card-edge` è **bianco**: il bordo di `.card` gli girava attorno ancora più
fuori, dorato, e adesso si confonde col bianco della carta. E `--r-carta` non è fisso ma
un decimo della larghezza, così la smussatura segue l'angolo stampato a ogni misura
invece di tagliarlo.

Il mazzo napoletano è stato rifatto da capo da una serie di carte corrette: il vecchio
foglio aveva il tre e il quattro di denari col numero di monete sbagliato e l'asso di
spade capovolto.

Il dorso non è un'immagine: è fatto di gradienti CSS in `--dorso`, uno per tema, e lo
riusano sia il mazzo sul tavolo sia le mini-carte in mano agli avversari.

## Font

Il carattere da titoli è **EB Garamond** (SIL OFL 1.1), sottoinsieme latino, variabile
400–600, incorporato in base64 dentro il `@font-face` in cima allo `<style>` (~44 KB).
È incorporato e non linkato perché Palatino, il vecchio primo termine dello stack, non
esiste su Android né su iOS: titolo, codice del tavolo e punteggi cambiavano faccia su
ogni telefono. Le cifre sono minuscole di default; dove i numeri si allineano in colonna
(`.sc .val`, `.tbl td.num`) sono riportate ad alte e a passo fisso.

## Misure delle carte

Le carte non hanno misure fisse: `tavolo()` e `tavoloScopa()` scrivono `--cw` (la mano)
e `--pw` (le carte in tavola) come `clamp(min, min(<larghezza>, <altezza>), max)`. Il
termine in `vw` tiene conto dei margini della pagina e dei vuoti fra le carte, quello in
`vh` di quello che sta sopra e sotto il feltro. Senza il secondo, su un telefono basso la
pagina scrollava; senza il primo, le carte andavano a capo.

Da quattro giocatori in su, e solo con `html.alto` (cioè da 740px di altezza **utile**),
le carte calate stanno su più file: `--pcols` dice quante per riga e `--pw2` la misura
corrispondente, che il CSS sceglie al posto di `--pw`. Anche questa era una media query,
e sbagliava per lo stesso motivo delle fasce: un Galaxy S8 è alto 740px esatti ma con la
safe-area ne restano 692, e su due file le carte non ci stavano. In sei si passa da una cinquantina di pixel al
doppio. Nella stessa situazione il blocco si sposta a sinistra (`.felt.folto`) per non
finire sotto il mazzo.

**Da sei carte in su la mano va su due file.** Otto carte alla chiamata e dieci a
tressette e scopone su una fila sola verrebbero larghe un dito: `ventaglioMano()`
le spezza in due `.hand` e `misureMano()` cambia il conto di `--cw` di conseguenza —
il termine in larghezza si divide per quante ce n'è per fila, quello in altezza dà a
ogni fila 8.7 unità di `--vhu` (8.0 su `html.minuscolo`), che è quanto si può prendere
senza far scrollare la pagina. Non è il doppio del budget di una fila: due file di
carte piccole stanno in meno spazio di quanto sembri, perché si sovrappongono.

Per lo stesso motivo la pastiglia di un avversario **non disegna dieci dorsi**: da sei
carte in su ne mostra uno solo e ci scrive accanto quante sono. Con dieci mini-carte la
riga dei nomi andava su tre file e si mangiava il tavolo.

La home sta in piedi su tre scaglioni di altezza. Sopra i 700px va tutto per intero;
sotto, il ventaglio di copertina si rimpicciolisce e la riga di presentazione esce; sotto
i 620 restano solo titolo, campi e bottoni.

**Gli scaglioni non sono media query.** `max-height` misura il viewport, non lo spazio in
cui si disegna: la pagina ha `viewport-fit=cover`, quindi su un telefono con l'incavo la
safe-area si prende fino a 93px che la media query non conta, e le fasce non scattavano
mai. Le mette `misuraSchermo()` come classi sulla radice — `html.basso`, `html.minuscolo` e
`html.alto` — misurando l'altezza al netto degli incavi con una sonda — `env()` si
legge solo da un elemento, non da JS. Le soglie si guardano su quell'altezza e non su
quella corrente: `html.basso` stringe anche il padding di `.wrap`, e guardando il valore
corrente si oscillerebbe attorno alla soglia.

Anche così la home non ci stava: con l'incavo restano 763px utili su un iPhone 14, che
non sono pochi abbastanza per far scattare `html.basso` ma non bastano per la home
intera. La parte elastica è il ventaglio di copertina, e `misuraHome()` gliela fa fare:
misura di quanto si sfora e stringe le tre carte di quel tanto, fino a toglierle. Per
questo `--cw` del ventaglio sta su `.hero` e non su `.hero .card` — così si può
sovrascrivere dall'alto.

**La stanza invece si misura davvero**, perché la lista dei posti cresce fino a sei righe
e il totale cambia col telefono. `stanza()` disegna a QR ancora vuoto, chiede a
`spazioQR()` quanto resta, e se non basta toglie qualcosa e rimisura: prima le due righe
di spiegazione (`.senzanote`), poi i posti su due colonne (`.stretta`), e in ultimo
il QR se ancora non basta. Da solo il QR non c'è, ma la scala si fa lo stesso: ogni
finto porta il mestiere scritto sotto al nome, cioè una riga a testa, e in sei sono
cinque righe in più di una stanza vera. Alla fine riprova
a rimettere le spiegazioni, perché mettere i posti su due colonne non toglie niente
mentre toglierle sì — si prova nell'altro ordine solo perché su un telefono stretto le
due colonne accorciano i nomi. Quello che avanza se lo prende il QR, fino a 240px: più è
grande, più da lontano si inquadra. Se tocchi la stanza, rimisura con `vista.js`, che
prova 2, 4 e 6 posti su quattro telefoni con la loro safe-area.

Le misure in altezza del tavolo non usano `vh` ma `--vhu`, che è un centesimo
dell'altezza **utile** e lo scrive `misuraSchermo()`: con `viewport-fit=cover` un `vh`
vero conta anche la safe-area, e su un telefono con l'incavo venivano fuori carte più
grandi dello spazio che c'era davvero.

Toccando questi valori, rimisurare: basta caricare `index.html` in un browser headless,
piazzare uno stato finto e controllare che `scrollHeight` non superi `innerHeight` per
ogni numero di giocatori e per le varie misure del tavolo di scopa.

## Animazioni e ritmo

Le viste rifanno `#app` via `innerHTML` a ogni messaggio di stato, quindi **ogni
animazione d'entrata ripartirebbe da capo su nodi nuovi**: la mano si ridistribuiva a ogni
mossa altrui. Le entrate sono legate a una classe (`.slot.nuova`, `.bc.nuova`, `.seatlist
li.nuovo`) che il JS mette solo su quello che è cambiato davvero, confrontando con `visto`
tramite `novita()`. Se aggiungi un'animazione d'entrata, legala a una classe allo stesso
modo, o ripartirà a ogni stato.

`distribuisci()` fa partire le carte dal mazzo verso i posti, tre alla volta, e la mano
vera entra quando le sue sono arrivate (`.hand.dando` la tiene ferma nel frattempo). Vola
in un piano a parte, `#volo`, sopra al tavolo e sotto ai pannelli. `sidistribuisce(st)`
decide se ha senso animarla: solo all'inizio vero di una mano, se no chi entra a partita
in corso si vedrebbe distribuire carte già giocate.

`ritmoPresa(st)` calcola la scaletta della presa: quando si accende ogni carta durante il
conteggio, quando batte la carta che vince, quando parte la raccolta, quando è finito
tutto. **La usano sia il client per animare sia il mazziere in `autoResolve()` per sapere
quando pubblicare lo stato nuovo.** Se le due cose si scollano l'animazione viene tagliata
a metà, che è esattamente quello che succedeva coi 1700 ms fissi contro una raccolta che
finiva fra 1755 e 1935.

Il resto segue tre regole: le carte si contano una alla volta e ognuna suona un semitono
più su della precedente (`SND.conta`, scala in `SCALA`); i totali non saltano al valore
nuovo ma ci arrivano (`salePunteggio`); quanto vale il giro allunga l'attesa prima di
scoprire chi prende, e la scossa dello schermo è riservata ai giri da venti punti in su e
alle scope. **La soglia dipende dal gioco**: a tressette un giro grosso sono sei terzi,
non venti punti, e con la soglia della briscola non si sarebbe vista una scossa mai —
`ritmoPresa()` e `valore(st,c)` la scelgono da `S.game`.

`vibra()` segue il tasto del muto, perché quel tasto dice "silenzia", non "silenzia solo
l'audio".

Il suono di una carta non è un fruscio solo: `suonoCarta()` ne sovrappone tre — lo
schiocco del bordo che si stacca (rumore brevissimo, passa-alto), il corpo che sbatte
(più lungo, passa-banda) e il tonfo del panno sotto (un seno basso) — e li sballa un
po' ogni volta, perché due carte identiche una dopo l'altra si sentono subito che sono
finte. `soffio()` è il mattone: rumore filtrato con l'inviluppo dato da una potenza, e
il filtro che può scorrere durante il suono, che è quello che distingue una carta che
struscia da una che sbatte.

A scopa le carte prese sparivano al ridisegno. `volaPrese()` le fa volare a chi
le ha prese, e per sapere **da dove** partono fotografa il tavolo con
`fotoBoard()` *prima* di rifare `#app`: quali carte siano prese lo dice la
differenza col tavolo nuovo, così non serve aggiungere niente allo stato che
gira in rete. Insieme a loro vola la carta appena calata, che a scopa nel
tavolo non ci passa mai. `incassa(seat)` fa reagire la pastiglia di chi le
riceve — vale anche per la presa a briscola, che prima atterrava nel nulla.

`timbroScopa()` sta in `#volo`, non nel feltro: dentro `#app` il primo messaggio
di stato se lo porterebbe via.

La mossa a scopa si riconosce da **una chiave di contenuto**, non dal
riferimento all'oggetto: ogni messaggio ne ricrea uno nuovo, e confrontando i
riferimenti la presa si risuonava a ogni ridisegno (per esempio quando cambiava
solo `S.via`). Stessa idea di `chiavePresa` a briscola.

## Test

`harness.js` monta più client jsdom con un broker MQTT finto in-process e li fa giocare
davvero. `test2.js` porta a termine una partita intera per ognuno degli undici modi di
giocare — briscola in 2, 3 e 4, scopa in 2, 3 e 4, scopone in 4, tressette in 2 e 4,
a perdere in 4, chiamata in 5 — e verifica che tutte e 40 le carte siano raccolte, che
i punteggi coincidano su ogni client e che non ci siano eccezioni. Il caso della
chiamata guida anche l'asta, perché senza il seme scelto la partita non parte.

Servono due pacchetti, e non sono dipendenze del sito: `npm i jsdom
playwright-core`. Poi `node test2.js` per le partite e `node vista.js` per la
prova in Chromium, che tira su un server locale e guarda quello che jsdom non
può vedere: che gli avvisi compaiano, che il codice finisca davvero negli
appunti, che il QR si apra, e che a nessuna misura di schermo la pagina prenda
a scrollare — la schermata dell'asta e la mano da dieci carte comprese, che sono le
due che possono sforare per prime. Lascia gli scatti in `scatti/`.

In `vista.js` ogni client sta in un **contesto suo**: due schede dello stesso
browser condividono il `localStorage`, quindi lo stesso `bt_id`, e per il
mazziere sono la stessa persona — il secondo non si siede e basta.

La strategia si misura, non si guarda: mille mani in un secondo con `simul.js`, che
chiama `sceltaBriscola()` e `vistaBot()` veri con lo stato al posto suo. A briscola,
contro chi gioca a caso Rosaria fa 80 a 40, contro Sasà 69 a 51; a scopa 3,2 a 1,3
contro il caso e il settebello nel 64% delle mani. Il controllo che conta è l'ultima
riga: caratteri tutti uguali devono uscire pari, e il posto di chi apre va fatto
girare — a scopone chi cala l'ultima carta si prende anche il tavolo, e senza
girarlo quel vantaggio finisce nel punteggio e sembra strategia.

Il mazziere arriva alla fine della mano prima degli altri: l'ultimo stato deve
ancora attraversare il broker. `test2.js` **aspetta che si mettano in pari** prima
di confrontarli — senza, con la macchina carica il controllo trovava i clienti a
un giro indietro e sembrava un disallineamento vero.

**Far girare i test dopo ogni modifica al motore o alle viste.** La scopa era arrivata in
produzione rotta proprio perché due funzioni scritte per la briscola andavano in eccezione
su `S.table`, che a scopa non esiste, e l'eccezione interrompeva il ciclo che tiene
allineati i client.

## Idee non ancora fatte

- Altri mazzi regionali: serve un foglio come quello napoletano, stessa griglia 10×4.
- Partita lunga a 11 o 21 punti invece della singola mano.
- Migrazione dell'autorità se il mazziere se ne va.
