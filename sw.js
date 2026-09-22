/* Service worker — deixa o app abrir sem internet (a obra costuma ter sinal ruim).
   Regra do kit: SUBIR o número do CACHE a cada publicação, senão o navegador
   continua servindo o arquivo velho. */
const CACHE = 'domo-shell-v59';
const ARQUIVOS = [
  './', './index.html', './styles.css', './config.js', './store.js', './ui.js',
  './pdf.js', './compras.js', './acervo.js', './cotacao.js', './cronograma.js', './qualificacao.js', './compromissos.js', './servicos.js', './rh.js', './permutas.js', './drive.js', './app.js?v=59',
  './libs/jspdf.umd.min.js', './logo-diamond.png', './logo-domo.png', './logo-domo-branco.png',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  // `cache: 'reload'` ao montar o pacote: sem isto, addAll aceita o arquivo velho
  // que o navegador ainda guarda para a MESMA URL e o assa dentro do cache novo —
  // subir o número do CACHE não adiantaria nada.
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(ARQUIVOS.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Nunca guardar chamada de servidor em cache: dado tem que ser o do momento.
  // O backend é o Supabase, em outro domínio — por isso a régua olha o HOST.
  // (A régua antiga olhava o caminho /.netlify/functions/, que depois da
  // migração nunca mais apareceu: o app passou a servir sincronização velha.)
  if (url.hostname.endsWith('supabase.co')) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then((achou) => achou || fetch(e.request).then((r) => {
      if (r.ok && url.origin === location.origin) {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
      }
      return r;
    }).catch(() => caches.match('./index.html')))
  );
});
