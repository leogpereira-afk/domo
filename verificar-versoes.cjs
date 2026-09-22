// Guarda: a Domo tem TRÊS números que precisam andar juntos — o CACHE do
// service worker (domo-shell-vN), o ?v=N do app.js (no index.html E na lista do
// sw) e o VERSAO do rodapé. Divergir faz o navegador servir arquivo velho com
// cara de novo. E todo .js do site precisa estar na lista do service worker,
// senão ele não abre sem internet (a obra tem sinal ruim).
const fs = require('fs'), test = require('node:test'), assert = require('node:assert/strict');
test('CACHE, ?v= e VERSAO na mesma versão', () => {
  const sw = fs.readFileSync('sw.js', 'utf8'), html = fs.readFileSync('index.html', 'utf8'),
        cfg = fs.readFileSync('config.js', 'utf8');
  const cache = sw.match(/domo-shell-v(\d+)/)[1];
  const versao = cfg.match(/VERSAO\s*=\s*'v(\d+)'/)[1];
  const vs = new Set([...sw.matchAll(/\?v=(\d+)/g), ...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]));
  assert.deepEqual([...vs], [cache], 'URLs em ?v=' + [...vs].join('/') + ' e cache em v' + cache);
  assert.equal(versao, cache, 'VERSAO do rodapé (v' + versao + ') diferente do cache (v' + cache + ')');
});
test('todo script do index está no pacote do service worker', () => {
  const sw = fs.readFileSync('sw.js', 'utf8'), html = fs.readFileSync('index.html', 'utf8');
  const doIndex = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1].split('?')[0]);
  const faltando = doIndex.filter((f) => !sw.includes("'./" + f));
  assert.deepEqual(faltando, [], 'fora do service worker: ' + faltando.join(', '));
});
