# Briscola al tavolo

Webapp per giocare a **briscola** e **scopa** con carte napoletane quando si è seduti
insieme senza un mazzo vero. Ognuno usa il proprio telefono, un codice di quattro lettere
tiene insieme il tavolo. Da 2 a 6 giocatori.

In produzione su GitHub Pages: `https://lomme89.github.io/briscolatavolo/`

## File

```
index.html          tutto il gioco: markup, stile, motore, rete (~1,3 MB)
manifest.json       manifest PWA
sw.js               service worker, cache del guscio
.nojekyll           impedisce a GitHub Pages di processare i file
icone/              icona-192, icona-512, icona-maskable-512, apple-touch-icon
harness.js          più client jsdom con un broker MQTT finto in-process
test2.js            partite intere di briscola e scopa, da 2 a 4
vista.js            le stesse cose in Chromium, per quello che jsdom non vede
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
| `deal()` / `dealScopa()` | distribuzione, smista in base a `S.game` |
| `autoResolve()` | chiude la presa a briscola dopo 1700 ms |
| `giocaScopa()` / `finisciScopa()` | mossa e conteggio finale a scopa |
| `prese(board, val)` | tutte le prese possibili con una carta |
| `contaScopa(st)` | carte, denari, settebello, primiera, scope |
| `paint()` | smista alle viste, poi `suoniDiff()` |
| `tavolo()` / `tavoloScopa()` | le due viste di gioco |
| `lancia()` / `raccogli()` / `scossa()` | animazioni, Web Animations API |
| `avvisa(testo)` | l'unico posto dove dire una cosa breve |
| `nega(el, testo)` | un tocco che non può fare niente, e il perché |
| `presenzaDiff()` | chi si è appena seduto, chi se n'è andato, chi aspetta |
| `volaPrese()` / `timbroScopa()` | la presa e la scopa, a scopa |
| `misuraSchermo()` | le fasce di altezza, al netto degli incavi |
| `spazioQR()` / `misuraHome()` | quanto cede il QR, quanto cede il ventaglio |

Le viste ricostruiscono `#app` via `innerHTML` a ogni cambio di stato. È volutamente
grezzo e va benissimo a queste dimensioni: non introdurre un framework.

### Forma dello stato

```js
S = {
  code, game: 'briscola'|'scopa', phase: 'attesa'|'gioco'|'fine',
  seats: [{id, name}],        // denso, max 6, l'indice è il posto
  coda: [{id, name}],         // chi è arrivato a mano iniziata, entra al prossimo giro
  via: [playerId],            // chi non manda il battito da mezzo minuto
  teams, n, first, mano, albo: {playerId: maniVinte},
  hands: {seat: [carta]}, deck: [carta],
  // briscola
  trump, trumpSuit, table: [{seat, c}], turn, points: [], tr: [], pp: [],
  // scopa
  board: [carta], taken: {seat: [carta]}, scope: [], lastTake, mossa, esito
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

L'uscita del mazziere chiede conferma a due tocchi: non esce e basta, pubblica
il retained vuoto e **smonta il tavolo di tutti**.

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

**Scopa.** 4 carte scoperte, 3 in mano. Se sul tavolo c'è una carta di valore uguale la
presa di quella è **obbligatoria**, niente somme; se le combinazioni possibili sono più
d'una sceglie il giocatore. Scopa quando il tavolo resta vuoto, tranne sull'ultima carta
della mano. Le carte avanzate vanno all'ultimo che ha preso. Punti: carte, denari,
settebello, primiera (7=21, 6=18, A=16, 5=15, 4=14, 3=13, 2=12, figure=10), più uno per
scopa; in parità il punto non si assegna. **In cinque la scopa non è giocabile**, i conti
non tornano.

## Temi

Ci sono tre temi, in `TEMI`: **classico** (napoletane, feltro verde, EB Garamond),
**chiaro** e **scuro** (mazzi moderni disegnati piatti, palette neutra, carattere di
sistema in grassetto stretto). Ognuno porta il suo mazzo, la sua palette e il suo
carattere; il tema è una scelta **personale**, sta nel `localStorage` e non nello stato
del tavolo, quindi allo stesso tavolo si può stare uno al chiaro e uno allo scuro.

I colori stanno tutti in token sotto `html[data-tema=…]`. Se aggiungi una regola non
scrivere un colore a mano: usa un token, se no il tema sbagliato ti si vede addosso.
`--acc-rgb` è l'accento in componenti separate, per gli aloni in `rgba()`.

**Le proporzioni della carta cambiano col mazzo**: `--ar` vale 1.517 col mazzo napoletano
e 1.733 con i due moderni. Ogni misura ricavata dall'altezza passa da `perAltezza()`, che
la riscala di `1.517/--ar`. Senza, col mazzo più lungo la pagina scrolla.

Si sceglie da due posti: le tre pastiglie tonde nella barra in fondo alla home, e la
sezione «Aspetto» in fondo al pannello delle regole, per cambiarlo anche stando a tavolo.

## Carte

Ogni mazzo è un unico foglio incorporato in base64 dentro `index.html`: JPEG quello
napoletano, WebP i due moderni (200×347 per carta, qualità 72 — un terzo del JPEG a parità
di resa su disegni piatti). Ogni carta è un `div` con `background-size: 1000% 400%` e
`background-position` calcolata da seme e valore. Righe = semi nell'ordine `SUITS`,
colonne = valori 1..10.

Il tre e il quattro di denari sono ricostruiti a mano, perché gli originali avevano il
numero di monete sbagliato.

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

Da quattro giocatori in su, e solo sopra i 740px di altezza, le carte calate stanno su più
file: `--pcols` dice quante per riga e `--pw2` la misura corrispondente, che il CSS sceglie
al posto di `--pw` dentro la media query. In sei si passa da una cinquantina di pixel al
doppio. Nella stessa situazione il blocco si sposta a sinistra (`.felt.folto`) per non
finire sotto il mazzo.

La home sta in piedi su tre scaglioni di altezza. Sopra i 700px va tutto per intero;
sotto, il ventaglio di copertina si rimpicciolisce e la riga di presentazione esce; sotto
i 620 restano solo titolo, campi e bottoni.

**Gli scaglioni non sono media query.** `max-height` misura il viewport, non lo spazio in
cui si disegna: la pagina ha `viewport-fit=cover`, quindi su un telefono con l'incavo la
safe-area si prende fino a 93px che la media query non conta, e le fasce non scattavano
mai. Le mette `misuraSchermo()` come classi sulla radice, `html.basso` e
`html.minuscolo`, misurando l'altezza al netto degli incavi con una sonda — `env()` si
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
di spiegazione (`.senzanote`), poi i posti su due colonne (`.stretta`). Alla fine riprova
a rimettere le spiegazioni, perché mettere i posti su due colonne non toglie niente
mentre toglierle sì — si prova nell'altro ordine solo perché su un telefono stretto le
due colonne accorciano i nomi. Quello che avanza se lo prende il QR, fino a 240px: più è
grande, più da lontano si inquadra. Se tocchi la stanza, rimisura con `vista.js`, che
prova 2, 4 e 6 posti su quattro telefoni con la loro safe-area.

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
alle scope.

`vibra()` segue il tasto del muto, perché quel tasto dice "silenzia", non "silenzia solo
l'audio".

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
davvero. `test2.js` porta a termine partite intere di briscola e scopa da 2 a 4 e verifica
che tutte e 40 le carte siano raccolte, che i punteggi coincidano su ogni client e che non
ci siano eccezioni.

Servono due pacchetti, e non sono dipendenze del sito: `npm i jsdom
playwright-core`. Poi `node test2.js` per le partite e `node vista.js` per la
prova in Chromium, che tira su un server locale e guarda quello che jsdom non
può vedere: che gli avvisi compaiano, che il codice finisca davvero negli
appunti, che il QR si apra, e che a nessuna misura di schermo la pagina prenda
a scrollare. Lascia gli scatti in `scatti/`.

In `vista.js` ogni client sta in un **contesto suo**: due schede dello stesso
browser condividono il `localStorage`, quindi lo stesso `bt_id`, e per il
mazziere sono la stessa persona — il secondo non si siede e basta.

**Far girare i test dopo ogni modifica al motore o alle viste.** La scopa era arrivata in
produzione rotta proprio perché due funzioni scritte per la briscola andavano in eccezione
su `S.table`, che a scopa non esiste, e l'eccezione interrompeva il ciclo che tiene
allineati i client.

## Idee non ancora fatte

- Briscola chiamata in cinque, con asta e socio segreto.
- Altri mazzi regionali: serve un foglio come quello napoletano, stessa griglia 10×4.
- Partita lunga a 11 o 21 punti invece della singola mano.
- Migrazione dell'autorità se il mazziere se ne va.
