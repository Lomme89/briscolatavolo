/* Briscola al tavolo — service worker */
const V = 'briscola-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest',
  './icone/icona-192.png', './icone/icona-512.png', './icone/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const url = new URL(r.url);
  // il broker e le websocket non si toccano mai
  if (url.protocol.startsWith('ws')) return;

  if (url.origin === location.origin) {
    // il guscio dell'app: prima la cache, poi la rete, e intanto si aggiorna
    e.respondWith(caches.match(r).then(hit => {
      const rete = fetch(r).then(res => {
        if (res && res.ok) caches.open(V).then(c => c.put(r, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || rete;
    }));
  } else {
    // librerie esterne: prima la rete, la cache come rete di sicurezza
    e.respondWith(fetch(r).then(res => {
      if (res && res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); }
      return res;
    }).catch(() => caches.match(r)));
  }
});
