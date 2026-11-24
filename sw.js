// Service worker: rede primeiro, cópia local só quando a rede falha.
//
// Com internet, toda requisição vai ao servidor e a resposta atualiza a
// cópia guardada — uma publicação nova aparece no próximo carregamento, sem
// o problema clássico de app preso numa versão antiga. Sem internet, o app,
// as bibliotecas, a fonte e o SDK do Firebase saem da cópia; os dados vêm do
// cache local do próprio Firestore (js/db.js).

const CACHE = 'simulador-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    for (const nome of await caches.keys()) if (nome !== CACHE) await caches.delete(nome);
    await self.clients.claim();
  })());
});

function guardavel(url) {
  if (url.origin === self.location.origin) return true;
  // O SDK do Firebase vem como módulos de versão fixa. A API do Firestore
  // (firestore.googleapis.com) não entra aqui: ela tem o cache dela.
  return url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
}

self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!guardavel(url)) return;

  evento.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const resposta = await fetch(req);
      if (resposta.ok) cache.put(req, resposta.clone());
      return resposta;
    } catch (erro) {
      const guardada = await cache.match(req, { ignoreSearch: url.origin === self.location.origin });
      if (guardada) return guardada;
      throw erro;
    }
  })());
});
