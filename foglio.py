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
    from PIL import Image
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


def componi(cartella, larghezza):
    carte = [[Image.open(trova(cartella, s, v)) for v in range(1, 11)] for s in range(4)]
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
            foglio.paste(fondo.convert('RGB').resize((cw, ch), Image.LANCZOS), (c * cw, r * ch))
    return foglio, cw, ch


def main():
    a = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('cartella')
    a.add_argument('--larghezza', type=int, default=200, help='larghezza di una carta (default 200)')
    a.add_argument('--qualita', type=int, default=76, help='qualità WebP (default 76)')
    a.add_argument('--uscita', help='dove scrivere la data URI (default: a schermo)')
    o = a.parse_args()

    foglio, cw, ch = componi(o.cartella, o.larghezza)
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
