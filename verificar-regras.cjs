// Guarda da régua de leitura da obra.
//
// CAMPOS_VALOR/CAMPOS_PESSOAIS (supabase/functions/_shared/acesso.ts) são listas
// escritas à mão, e lista à mão envelhece: em 22/09/2026 quatro campos de
// dinheiro e o CPF do prestador já viajavam para o celular da obra porque
// ninguém lembrou de acrescentá-los. Este teste varre o que as TELAS realmente
// gravam e falha quando aparece um campo sensível fora das listas.
const fs = require('fs'), test = require('node:test'), assert = require('node:assert/strict');

const acesso = fs.readFileSync('supabase/functions/_shared/acesso.ts', 'utf8');
const lista = (nome) => {
  const m = acesso.match(new RegExp('const ' + nome + '\\s*=\\s*\\[([\\s\\S]*?)\\];'));
  assert.ok(m, nome + ' não encontrada em acesso.ts');
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};

// Nome de campo que, pelo nome, carrega dinheiro ou documento de pessoa.
const SENSIVEL = /^(preco|valor|total|liquido|bruto|frete|seguro|desconto|retencao|adiantamento|banco|dadosBancarios|condicao|condicaoPagamento|formaPagamento|cpf|cnpj|cnpjCpf|rg|pis)$/;

test('todo campo sensível que as telas gravam está na régua da obra', () => {
  const cobertos = new Set([...lista('CAMPOS_VALOR'), ...lista('CAMPOS_PESSOAIS')]);
  const achados = new Map();
  for (const arq of fs.readdirSync('.').filter((f) => f.endsWith('.js'))) {
    const txt = fs.readFileSync(arq, 'utf8');
    // entrada('campo', …) e data-campo="campo" são as duas formas de gravar da casa
    for (const m of txt.matchAll(/entrada\('([A-Za-z.]+)'|data-campo=["']([A-Za-z.]+)["']/g)) {
      const caminho = m[1] || m[2];
      const folha = caminho.split('.').pop();
      if (SENSIVEL.test(folha) && !cobertos.has(folha)) {
        if (!achados.has(folha)) achados.set(folha, arq + ' → ' + caminho);
      }
    }
  }
  assert.deepEqual([...achados.entries()], [],
    'campo sensível fora de CAMPOS_VALOR/CAMPOS_PESSOAIS: ' + [...achados.entries()].map((e) => e.join(' ')).join(' · '));
});

test('a obra nunca reescreve histórico: a trava está no reporProtegidos', () => {
  assert.match(acesso, /saida\.historico = saida\.historico\.map/,
    'sumiu a trava que congela entrada de histórico já existente para o perfil obra');
});

test('cada função global do app é declarada uma vez só', () => {
  const onde = new Map();
  for (const arq of fs.readdirSync('.').filter((f) => f.endsWith('.js') && !f.startsWith('verificar'))) {
    for (const m of fs.readFileSync(arq, 'utf8').matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)/gm)) {
      onde.set(m[1], (onde.get(m[1]) || []).concat(arq));
    }
  }
  const repetidas = [...onde].filter(([, arqs]) => arqs.length > 1)
    .map(([nome, arqs]) => nome + ' em ' + arqs.join(' e '));
  // Os arquivos dividem o mesmo escopo: o último carregado vence, calado.
  assert.deepEqual(repetidas, [], 'função global declarada duas vezes: ' + repetidas.join(' · '));
});

test('todo ponto que apaga avisa antes quando está sem internet', () => {
  const faltando = [];
  for (const arq of fs.readdirSync('.').filter((f) => f.endsWith('.js') && !f.startsWith('verificar'))) {
    const linhas = fs.readFileSync(arq, 'utf8').split('\n');
    linhas.forEach((l, i) => {
      if (!l.includes("api('apagar'")) return;
      const perto = linhas.slice(Math.max(0, i - 6), i).join(' ');
      if (!perto.includes('semInternetParaApagar')) faltando.push(arq + ':' + (i + 1));
    });
  }
  // 'apagar' não passa pela fila offline: sem o aviso, o canteiro vê 'Failed to fetch'.
  assert.deepEqual(faltando, [], 'apaga sem avisar que está offline: ' + faltando.join(', '));
});

test('a lista de coleções do cliente bate com a do servidor', () => {
  const cli = fs.readFileSync('store.js', 'utf8'), srv = fs.readFileSync('supabase/functions/_shared/colecoes.ts', 'utf8');
  const doCliente = [...cli.matchAll(/^\s{2}([a-z]+):\s*\{ pre: '([^']*)'/gm)].map((m) => m[1] + ':' + m[2]);
  const doServidor = [...srv.matchAll(/^\s{2}([a-z]+):\s*\{ pre: "([^"]*)"/gm)].map((m) => m[1] + ':' + m[2]);
  // A lista já morou em três arquivos e as coleções novas ficaram de fora do
  // backup diário sem ninguém notar; depois a lixeira mostrou 7 das 12.
  assert.deepEqual(doCliente.sort(), doServidor.sort(),
    'cliente e servidor discordam sobre as coleções: ' + doCliente.sort().join(',') + ' × ' + doServidor.sort().join(','));
});

test('copiar link passa pela função da casa, não pelo clipboard cru', () => {
  const fora = [];
  for (const arq of fs.readdirSync('.').filter((f) => f.endsWith('.js') && !f.startsWith('verificar') && f !== 'ui.js')) {
    if (fs.readFileSync(arq, 'utf8').includes('navigator.clipboard')) fora.push(arq);
  }
  // Estava escrito 9 vezes; uma delas sem saída quando o navegador não tem
  // clipboard (celular velho, rede interna sem HTTPS): o link não ia e nada dizia.
  assert.deepEqual(fora, [], 'usa navigator.clipboard direto em vez de copiar(): ' + fora.join(', '));
});
