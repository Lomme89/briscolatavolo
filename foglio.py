#!/usr/bin/env python3
"""Rifà il foglio di un mazzo dalle quaranta carte sciolte.

Ogni mazzo dentro index.html è un unico foglio: griglia 10x4, righe = semi
nell'ordine di SUITS (denari, coppe, spade, bastoni), colonne = valori 1..10.
Questo script ne compone uno e sputa fuori la data URI da incollare.

    pip install pillow
    python3 foglio.py cartella-delle-carte --larghezza 200 --qualita 76

Riconosce da solo i due modi di chiamare i file che abbiamo incontrato:
«1d.jpg» (valore + iniziale del seme) e «Denari01.png».  Le carte con gli
angoli trasparenti si appoggiano su bianco, che è il colore della carta.
"""
import argparse, base64, io, os, sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("serve Pillow: pip install pillow")

SEMI = ['denari', 'coppe', 'spade', 'bastoni']       # l'ordine di SUITS
INIZIALI = ['d', 'c', 's', 'b']


def trova(cartella, seme, valore):
    """Il file di una carta, provando i modi di chiamarla che conosciamo."""
    nomi = ['%d%s' % (valore, INIZIALI[seme]),
            '%s%02d' % (SEMI[seme].capitalize(), valore),
            '%s%d' % (SEMI[seme].capitalize(), valore),
            '%s_%d' % (SEMI[seme], valore)]
    for n in nomi:
        for est in ('.png', '.jpg', '.jpeg', '.webp', '.PNG', '.JPG'):
            p = os.path.join(cartella, n + est)
            if os.path.exists(p):
                return p
    raise SystemExit('non trovo %s %d in %s (provati: %s)'
                     % (SEMI[seme], valore, cartella, ', '.join(nomi)))


def arrotonda(im, pct):
    """Sbianca l'angolo fuori da un rettangolo smussato.

    Tagliare un anello dritto dal bordo toglie il filo della fustella sui lati
    ma non nell'angolo, dove la curva rientra di una decina di pixel: sul
    tavolo, con le carte grandi, quell'arco si vede.  Qui l'angolo si cancella
    con la stessa smussatura che poi ci mette il CSS.
    """
    if not pct:
        return im.convert('RGB')
    w, h = im.size
    r = max(1, round(w * pct / 100.0))
    # la maschera si disegna in grande e si rimpicciolisce: così il bordo
    # dell'angolo viene sfumato invece che a scaletta
    m = Image.new('L', (w * 4, h * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w * 4 - 1, h * 4 - 1], radius=r * 4, fill=255)
    m = m.resize((w, h), Image.LANCZOS)
    fondo = Image.new('RGB', (w, h), (255, 255, 255))
    fondo.paste(im.convert('RGB'), (0, 0), m)
    return fondo


def componi(cartella, larghezza, taglia=0, angolo=0):
    carte = [[Image.open(trova(cartella, s, v)) for v in range(1, 11)] for s in range(4)]
    w, h = carte[0][0].size
    if taglia:
        # via un anello di pixel dal bordo: serve quando la carta si porta
        # dietro il filo della fustella, che con la cornice stampata dentro
        # fa due righe e sembra una carta dentro una carta
        carte = [[im.crop((taglia, taglia, im.size[0] - taglia, im.size[1] - taglia))
                  for im in riga] for riga in carte]
        w, h = carte[0][0].size
    cw = larghezza
    ch = round(larghezza * h / w)
    foglio = Image.new('RGB', (cw * 10, ch * 4), (255, 255, 255))
    for r, riga in enumerate(carte):
        for c, im in enumerate(riga):
            if im.size != (w, h):
                raise SystemExit('le carte non hanno tutte la stessa misura: %s' % (im.size,))
            im = im.convert('RGBA')
            # gli angoli trasparenti vanno appoggiati sul bianco della carta,
            # se no in WebP diventano neri
            fondo = Image.new('RGBA', im.size, (255, 255, 255, 255))
            fondo.alpha_composite(im)
            carta = arrotonda(fondo, angolo)
            foglio.paste(carta.resize((cw, ch), Image.LANCZOS), (c * cw, r * ch))
    return foglio, cw, ch


def main():
    a = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('cartella')
    a.add_argument('--larghezza', type=int, default=200, help='larghezza di una carta (default 200)')
    a.add_argument('--qualita', type=int, default=76, help='qualità WebP (default 76)')
    a.add_argument('--taglia', type=int, default=0, help='pixel da togliere dal bordo di ogni carta')
    a.add_argument('--angolo', type=float, default=0,
                   help='sbianca l\'angolo fuori da una smussatura di questa percentuale '
                        'della larghezza (la stessa che poi mette il CSS con --r-carta)')
    a.add_argument('--uscita', help='dove scrivere la data URI (default: a schermo)')
    o = a.parse_args()

    foglio, cw, ch = componi(o.cartella, o.larghezza, o.taglia, o.angolo)
    b = io.BytesIO()
    foglio.save(b, 'WEBP', quality=o.qualita, method=6)
    dati = b.getvalue()
    uri = 'data:image/webp;base64,' + base64.b64encode(dati).decode()

    print('foglio %dx%d, carta %dx%d, --ar %.3f, %d KB (%d KB in base64)'
          % (foglio.size[0], foglio.size[1], cw, ch, ch / cw, len(dati) // 1024,
             len(uri) // 1024), file=sys.stderr)
    if o.uscita:
        open(o.uscita, 'w').write(uri)
    else:
        print(uri)


if __name__ == '__main__':
    main()
