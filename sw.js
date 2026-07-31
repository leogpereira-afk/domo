/* Service worker — deixa o app abrir sem internet (a obra costuma ter sinal ruim).
   Regra do kit: SUBIR o número do CACHE a cada publicação, senão o navegador
   continua servindo o arquivo velho. */
const CACHE = 'domo-shell-v35';
const ARQUIVOS = [
  './', './index.html', './styles.css', './config.js', './store.js', './ui.js',
  './pdf.js', './compras.js', './acervo.js', './cotacao.js', './cronograma.js', './qualificacao.js', './servicos.js', './app.js',
  './libs/jspdf.umd.min.js', './logo-domo.png', './logo-domo-branco.png',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Nunca guardar chamada de servidor em cache: dado tem que ser o do momento.
  // O backend agora é o Supabase (outro domínio) — a regra antiga, que olhava
  // o caminho /.netlify/functions/, virava letra morta e o app passaria a
  // servir resposta velha de sincronização.
  if (url.hostname.endsWith('supabase.co')) return;
  if (url.pathname.includes('/.netlify/functions/')) return;
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
