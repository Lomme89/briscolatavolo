# Briscola al tavolo

Webapp per giocare a **briscola** e **scopa** con carte napoletane quando si è seduti
insieme senza un mazzo vero. Ognuno usa il proprio telefono, un codice di quattro lettere
tiene insieme il tavolo. Da 2 a 6 giocatori.

In produzione su GitHub Pages: `https://lomme89.github.io/briscolatavolo/`

## File

```
index.html          tutto il gioco: markup, stile, motore, rete (~760 KB)
manifest.json       manifest PWA
sw.js               service worker, cache del guscio
.nojekyll           impedisce a GitHub Pages di processare i file
icone/              icona-192, icona-512, icona-maskable-512, apple-touch-icon
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
- `bt/<CODICE>/a` — le azioni dei giocatori. Solo il mazziere è iscritto.

QoS 0: nessuna ritrasmissione. Non serve, perché ogni messaggio di stato è completo e non
incrementale — il successivo rimette tutti in pari.

Uscendo, il mazziere pubblica un retained vuoto per smontare il tavolo.

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

Le viste ricostruiscono `#app` via `innerHTML` a ogni cambio di stato. È volutamente
grezzo e va benissimo a queste dimensioni: non introdurre un framework.

### Forma dello stato

```js
S = {
  code, game: 'briscola'|'scopa', phase: 'attesa'|'gioco'|'fine',
  seats: [{id, name}],        // denso, max 6, l'indice è il posto
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

## Carte

Le 40 carte sono un unico foglio JPEG incorporato in base64 dentro `index.html`. Ogni
carta è un `div` con `background-size: 1000% 400%` e `background-position` calcolata da
seme e valore. Righe = semi nell'ordine `SUITS`, colonne = valori 1..10.

Il tre e il quattro di denari sono ricostruiti a mano, perché gli originali avevano il
numero di monete sbagliato.

## Test

`harness.js` monta più client jsdom con un broker MQTT finto in-process e li fa giocare
davvero. `test2.js` porta a termine partite intere di briscola e scopa da 2 a 4 e verifica
che tutte e 40 le carte siano raccolte, che i punteggi coincidano su ogni client e che non
ci siano eccezioni.

**Far girare i test dopo ogni modifica al motore o alle viste.** La scopa era arrivata in
produzione rotta proprio perché due funzioni scritte per la briscola andavano in eccezione
su `S.table`, che a scopa non esiste, e l'eccezione interrompeva il ciclo che tiene
allineati i client.

## Idee non ancora fatte

- Briscola chiamata in cinque, con asta e socio segreto.
- Altri mazzi regionali: serve un foglio come quello napoletano, stessa griglia 10×4.
- Partita lunga a 11 o 21 punti invece della singola mano.
- Migrazione dell'autorità se il mazziere se ne va.
