/* Store — conversa com o servidor, guarda tudo no aparelho e segura a fila
   quando cai a internet.

   Regra de ouro (offline-first): o dado é salvo NO APARELHO primeiro e só
   depois sobe. Quem está na obra sem sinal continua trabalhando; quando a
   internet volta, a fila sobe sozinha. */

// TODAS as coleções do sistema. Ao criar uma nova, acrescente AQUI (e no
// COLECOES do nucleo.mjs) — era em dois lugares e a cotação chegava do
// servidor mas era jogada fora por não existir nesta lista.
/* Lista ÚNICA das coleções no cliente — espelho de
   supabase/functions/_shared/colecoes.ts (verificar-regras.cjs falha se as duas
   divergirem). `pre` é o prefixo do número do documento; vazio = não numera.
   Ela guarda o NOME porque duas telas escreviam a própria lista à mão e as duas
   envelheceram: a lixeira mostrava 7 das 12 coleções — enquanto o botão de
   esvaziar apagava as 12 — e o 'recomeçar a numeração' oferecia 3 das 5. */
const COLECOES_DOMO = {
  sc:      { pre: 'SC', nome: 'Solicitação de compra' },
  cot:     { pre: 'CT', nome: 'Cotação' },
  crono:   { pre: 'CR', nome: 'Cronograma' },
  oc:      { pre: 'OC', nome: 'Ordem de compra' },
  os:      { pre: 'OS', nome: 'Ordem de serviço' },
  forn:    { pre: '',   nome: 'Fornecedor' },
  prest:   { pre: '',   nome: 'Prestador de serviço' },
  doc:     { pre: '',   nome: 'Documento' },
  proj:    { pre: '',   nome: 'Projeto' },
  comp:    { pre: '',   nome: 'Compromisso' },
  pessoa:  { pre: '',   nome: 'Colaborador' },
  permuta: { pre: '',   nome: 'Permuta' },
};
const COLECOES_APP = Object.keys(COLECOES_DOMO);
const regVazio = () => COLECOES_APP.reduce((a, c) => { a[c] = []; return a; }, {});

const S = {
  cfg: null,
  reg: regVazio(),
  fila: [],
  quem: '',
  senhaHash: '',
  // Quem entrou: perfil manda no menu e nos botões. A porta de verdade é o
  // servidor — isto aqui só evita mostrar o que a pessoa não pode fazer.
  perfil: 'obra',   // o mais fechado até o servidor dizer quem é (ver app.js:perfilAtual)
  usuarioId: '',
  acessoProprio: false,
  seqFila: 0,
  sincronizando: false,
  ultimoPull: 0,
  online: navigator.onLine,
  erroSync: ''
};

const K = {
  cache: 'domo_cache_v1',
  fila: 'domo_fila_v1',
  quem: 'domo_quem',
  senha: 'domo_senha',
  perfil: 'domo_perfil',
  usuario: 'domo_usuario',
  gruposMenu: 'domo_grupos_recolhidos'
};

// Espelho do que o servidor faz valer (lib/acesso.mjs). Serve só para não
// mostrar botão que a pessoa não pode apertar — a porta é o servidor.
const ESCRITA_POR_PERFIL = { obra: ['sc', 'oc', 'crono', 'comp'] };
function podeEscrever(colecao) {
  const permitidas = ESCRITA_POR_PERFIL[S.perfil];
  return !permitidas || permitidas.includes(colecao);
}

/* ── SHA-256 (a senha nunca viaja em texto puro) ───────────────────────────── */
async function sha256(txt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ── Chamada ao servidor ───────────────────────────────────────────────────── */
async function api(action, dados = {}, opts = {}) {
  const headers = { 'Content-Type': 'application/json', 'x-token': TOKEN };
  if (S.senhaHash && !opts.publico) headers['x-senha'] = S.senhaHash;
  if (S.quem) headers['x-quem'] = encodeURIComponent(S.quem);
  // Prazo máximo: no 4G do canteiro a conexão "pendura" (fica aberta sem
  // resposta) e sem isso a promessa nunca voltava — travando a tela atrás dela.
  const ctrl = new AbortController();
  const prazo = setTimeout(() => ctrl.abort(), opts.prazoMs || 60000);
  let r;
  try {
    r = await fetch(opts.url || API, {
      method: 'POST',
      headers,
      body: JSON.stringify(Object.assign({ action }, dados)),
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(prazo);
    throw (e && e.name === 'AbortError') ? new Error('A internet demorou demais para responder') : e;
  }
  clearTimeout(prazo);
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  if (!r.ok) {
    const e = new Error((j && (j.error || j.message)) || ('Erro ' + r.status));
    e.status = r.status;
    e.semSenha = !!(j && j.semSenha);
    e.semPermissao = !!(j && j.semPermissao);
    throw e;
  }
  return j;
}

const apiArq = (action, dados = {}, opts = {}) => api(action, dados, Object.assign({ url: API_ARQ }, opts));

/* Apagar é a ÚNICA operação que vai direto ao servidor, sem passar pela fila
   offline — então é a única que pode estourar na cara de quem está no canteiro.
   Sem sinal, a mensagem do navegador é 'Failed to fetch'. Dois dos dez pontos
   que apagam lembravam de avisar; os outros oito não. A frase mora aqui. */
function semInternetParaApagar() {
  if (navigator.onLine) return false;
  toast('Sem internet agora — tente quando conectar', 'ruim');
  return true;
}

/* ── Cache local ───────────────────────────────────────────────────────────── */
function lerCache() {
  try {
    const c = JSON.parse(localStorage.getItem(K.cache) || 'null');
    if (c && c.reg) { S.reg = Object.assign(S.reg, c.reg); S.cfg = c.cfg || null; S.ultimoPull = c.em || 0; }
  } catch { /* cache corrompido: começa limpo */ }
  try { S.fila = JSON.parse(localStorage.getItem(K.fila) || '[]'); } catch { S.fila = []; }
  // O contador PRECISA continuar de onde parou. Se recomeçar do zero, um número
  // novo colide com um já gravado e o envio apaga da fila algo que nunca subiu.
  // Entradas de versões antigas do app (sem seq) ganham um número aqui.
  S.seqFila = S.fila.reduce((m, f) => Math.max(m, Number(f.seq) || 0), 0);
  let faltando = false;
  for (const f of S.fila) if (!f.seq) { f.seq = ++S.seqFila; faltando = true; }
  if (faltando) { try { localStorage.setItem(K.fila, JSON.stringify(S.fila)); } catch { /* segue */ } }
  S.quem = localStorage.getItem(K.quem) || '';
  S.senhaHash = localStorage.getItem(K.senha) || '';
  S.perfil = localStorage.getItem(K.perfil) || 'obra';   // recusa por omissão; o snapshot corrige em segundos
  S.usuarioId = localStorage.getItem(K.usuario) || '';
  S.acessoProprio = !!S.usuarioId;
  // Se o cache tiver se perdido (memória cheia), a fila reconstrói o que ainda
  // não subiu — senão o trabalho feito sem sinal some da tela ao reabrir o app.
  for (const f of S.fila) {
    const arr = S.reg[f.colecao] || (S.reg[f.colecao] = []);
    const i = arr.findIndex((r) => r.id === f.registro.id);
    const rec = Object.assign({}, f.registro, { _pendente: true });
    if (i >= 0) arr[i] = rec; else arr.unshift(rec);
  }
}

function gravarCache() {
  try {
    localStorage.setItem(K.cache, JSON.stringify({ reg: S.reg, cfg: S.cfg, em: Date.now() }));
  } catch (e) {
    console.warn('cache cheio:', e && e.message);
  }
}

// A fila é o que segura o trabalho feito sem internet: se ela não couber no
// aparelho, o usuário PRECISA saber (o cache pode falhar calado, a fila não).
function gravarFila() {
  try {
    localStorage.setItem(K.fila, JSON.stringify(S.fila));
    return true;
  } catch (e) {
    // Tenta abrir espaço jogando fora o cache (ele se refaz no próximo snapshot).
    try {
      localStorage.removeItem(K.cache);
      localStorage.setItem(K.fila, JSON.stringify(S.fila));
      return true;
    } catch (e2) {
      S.erroSync = 'memória do aparelho cheia — não consigo guardar offline';
      document.dispatchEvent(new CustomEvent('domo:status'));
      toast('Memória do aparelho cheia. Conecte à internet antes de continuar.', 'ruim');
      return false;
    }
  }
}

/* ── Consultas ─────────────────────────────────────────────────────────────── */
// Lista de uma coleção já sem a lixeira e com o mais novo em cima.
function lista(col, incluirApagados = false) {
  return (S.reg[col] || [])
    .filter((r) => incluirApagados || !r.apagadoEm)
    .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
}

const achar = (col, id) => (S.reg[col] || []).find((r) => r.id === id) || null;

/* ── Gravação ──────────────────────────────────────────────────────────────── */
// Salva no aparelho na hora e empurra pra fila. Devolve o registro local.
function salvar(col, registro, opts = {}) {
  const id = registro.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const local = Object.assign({}, achar(col, id) || {}, registro, {
    id,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: S.quem || '—',
    _pendente: true,
    _recusado: null   // tentar de novo limpa a recusa anterior
  });
  if (!local.criadoEm) { local.criadoEm = local.atualizadoEm; local.criadoPor = S.quem || '—'; }

  const arr = S.reg[col] || (S.reg[col] = []);
  const i = arr.findIndex((r) => r.id === id);
  if (i >= 0) arr[i] = local; else arr.unshift(local);
  gravarCache();

  // Cada entrada leva um número próprio. Sem isso, uma alteração feita enquanto
  // o envio anterior estava no ar era apagada da fila junto com a antiga.
  S.fila = S.fila.filter((f) => !(f.colecao === col && f.registro.id === id));
  S.fila.push({ colecao: col, registro: local, seq: ++S.seqFila });
  gravarFila();

  if (!opts.semSubir) subirFila();
  return local;
}

// Acrescenta uma linha no histórico do registro (quem fez, quando, o quê).
function historiar(registro, o_que) {
  const h = Array.isArray(registro.historico) ? registro.historico.slice() : [];
  h.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    em: new Date().toISOString(),
    por: S.quem || '—',
    o_que
  });
  return h;
}

let _subindo = false;
async function subirFila() {
  if (_subindo || !S.fila.length || !navigator.onLine) return;
  _subindo = true;
  const enviando = S.fila.slice(0, 25);
  try {
    const r = await api('salvarLote', {
      itens: enviando.map((f) => ({ colecao: f.colecao, registro: limparParaEnvio(f.registro) }))
    });
    // Tira da fila SÓ o que foi enviado (pelo número da entrada). Se o usuário
    // mexeu de novo no mesmo registro durante o envio, a alteração nova fica.
    // Remove pelas PRÓPRIAS entradas enviadas (identidade), não pelo número —
    // assim nem um seq repetido leva junto o que não foi enviado.
    const enviadas = new Set(enviando);
    S.fila = S.fila.filter((f) => !enviadas.has(f));
    gravarFila();
    // O servidor agora recusa ITEM A ITEM (nunca o pacote). Avisa o que ficou
    // de fora, com nome e motivo — antes o trabalho sumia calado.
    if ((r.recusados || []).length) {
      /* O aviso passava e o registro continuava na tela marcado 'enviando…' —
         para sempre, porque ele já tinha saído da fila. Três minutos depois o
         snapshot deixava de reinjetá-lo e ele sumia sozinho, sem ninguém
         entender. Agora a recusa fica CARIMBADA no registro: a tela mostra o
         motivo no lugar de 'enviando…' e a pessoa decide o que fazer. */
      for (const rec of r.recusados) {
        const arr = S.reg[rec.colecao];
        const alvo = arr && arr.find((x) => x.id === rec.id);
        if (alvo) { delete alvo._pendente; alvo._recusado = rec.motivo || 'recusado pelo servidor'; }
      }
      gravarCache();
      document.dispatchEvent(new CustomEvent('domo:sempermissao', {
        detail: { qtd: r.recusados.length, msg: r.recusados[0].motivo, itens: r.recusados }
      }));
    }
    const aindaNaFila = new Set(S.fila.map((f) => f.colecao + '|' + f.registro.id));
    for (const salvo of (r.salvos || [])) {
      const col = salvo._col;
      // Registro com alteração mais nova esperando: não sobrescreve a tela.
      if (aindaNaFila.has(col + '|' + salvo.id)) continue;
      const arr = S.reg[col] || (S.reg[col] = []);
      const i = arr.findIndex((x) => x.id === salvo.id);
      if (i >= 0) arr[i] = salvo; else arr.unshift(salvo);
    }
    gravarCache();
    S.erroSync = '';
    document.dispatchEvent(new CustomEvent('domo:dados'));
    if (S.fila.length) setTimeout(subirFila, 300);
  } catch (e) {
    S.erroSync = e.message || 'falha ao enviar';
    if (e.semSenha) document.dispatchEvent(new CustomEvent('domo:semsenha'));
    // Ação inteira negada (não é mais o caso do salvarLote, que recusa item a
    // item): a fila nunca passaria, então sai — mas o usuário fica sabendo
    // exatamente o que não foi salvo, com o código de cada documento.
    if (e.semPermissao) {
      const enviadas = new Set(enviando);
      S.fila = S.fila.filter((f) => !enviadas.has(f));
      gravarFila();
      document.dispatchEvent(new CustomEvent('domo:sempermissao', {
        detail: {
          qtd: enviando.length, msg: e.message,
          itens: enviando.map((f) => ({ colecao: f.colecao, id: f.registro.id, codigo: f.registro.codigo || '' }))
        }
      }));
    }
    console.warn('fila:', e.message);
  } finally {
    _subindo = false;
    document.dispatchEvent(new CustomEvent('domo:status'));
  }
}

const limparParaEnvio = (r) => { const c = Object.assign({}, r); delete c._pendente; delete c._recusado; delete c._col; return c; };

// Impressão digital barata do que está na tela: id + quando mudou.
function assinaturaDados() {
  const partes = [];
  for (const col of Object.keys(S.reg)) {
    for (const r of S.reg[col]) partes.push(col + r.id + (r.atualizadoEm || '') + (r.apagadoEm || ''));
  }
  partes.sort();
  return partes.join('|') + '#' + JSON.stringify(S.cfg || null);
}

/* ── Puxar do servidor ─────────────────────────────────────────────────────── */
let _puxando = false;
async function puxar() {
  if (_puxando || !navigator.onLine || !S.senhaHash) return;
  _puxando = true;
  S.sincronizando = true;
  document.dispatchEvent(new CustomEvent('domo:status'));
  try {
    await subirFila();
    const r = await api('snapshot');
    const novo = regVazio();
    for (const reg of (r.registros || [])) {
      const col = reg._col;
      if (novo[col]) novo[col].push(reg);
    }
    // Não descarta o que este aparelho acabou de mexer. A LISTAGEM do Blobs
    // tem consistência eventual (~1min): um registro recém-gravado pode não
    // vir no snapshot e sumiria da tela de quem o criou.
    const GRACA_MS = 3 * 60 * 1000;
    const recente = (o) => {
      const t = o.atualizadoEm || o.criadoEm;
      return t && (Date.now() - new Date(t).getTime()) < GRACA_MS;
    };
    const naFila = new Set(S.fila.map((f) => f.colecao + '|' + f.registro.id));
    for (const col of Object.keys(novo)) {
      const vindos = new Set(novo[col].map((x) => x.id));
      for (const local of (S.reg[col] || [])) {
        const chave = col + '|' + local.id;
        if (naFila.has(chave)) {
          // Alteração ainda não enviada SEMPRE ganha da versão do servidor,
          // mesmo que o servidor já conheça o registro — senão o recebimento
          // feito sem sinal era desfeito na tela do próprio autor.
          novo[col] = novo[col].filter((x) => x.id !== local.id);
          novo[col].push(local);
        } else if (!vindos.has(local.id) && recente(local)) {
          // 'comp' é agenda pessoal, filtrada por dono no servidor: se ele
          // deixou de vir no snapshot é porque saiu da minha lista (foi
          // encaminhado). NÃO reinjetar pela carência — senão o compromisso
          // que passei para outro fica preso na minha tela por 3 minutos.
          // (O que ainda está na fila é protegido pelo ramo de cima.)
          if (col === 'comp') continue;
          novo[col].push(local);
        }
      }
    }
    S.reg = novo;
    S.cfg = r.cfg || S.cfg;
    // O servidor diz o perfil a cada sincronização: se a direção mudar o
    // acesso de alguém, o menu daquela pessoa acompanha sem precisar sair.
    if (r.eu && r.eu.perfil) {
      S.perfil = r.eu.perfil;
      S.acessoProprio = !!r.eu.proprio;
      S.usuarioId = r.eu.proprio ? r.eu.id : '';
      if (r.eu.proprio && r.eu.nome) S.quem = r.eu.nome;
      try {
        localStorage.setItem(K.perfil, S.perfil);
        localStorage.setItem(K.usuario, S.usuarioId);
        if (S.quem) localStorage.setItem(K.quem, S.quem);
      } catch { /* modo privado: segue sem lembrar */ }
    }
    S.ultimoPull = Date.now();
    S.erroSync = '';
    gravarCache();
    // Só avisa a tela quando algo REALMENTE mudou. Antes, o sync de 90s
    // redesenhava a página do nada e jogava a rolagem pro topo no meio da leitura.
    const assinatura = assinaturaDados();
    if (assinatura !== S.assinatura) {
      // A assinatura só é dada por consumida quando a tela REALMENTE redesenhar
      // (o app.js confirma). Com modal aberto o redesenho é adiado, e sem isso
      // a tela ficaria desatualizada para sempre depois de fechar o modal.
      S.assinaturaPendente = assinatura;
      document.dispatchEvent(new CustomEvent('domo:dados'));
    }
  } catch (e) {
    S.erroSync = e.message || 'falha ao baixar';
    if (e.semSenha) document.dispatchEvent(new CustomEvent('domo:semsenha'));
  } finally {
    _puxando = false;
    S.sincronizando = false;
    document.dispatchEvent(new CustomEvent('domo:status'));
  }
}

/* ── Arquivos grandes (projetos, documentos, fotos) ────────────────────────── */
// 2,5MB por pedaço: em base64 vira ~3,4MB, com folga no limite de 6MB
// que a Function do Netlify aceita por requisição.
const TAM_PARTE = 2.5 * 1024 * 1024;

function bytesParaBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return btoa(bin);
}

function base64ParaBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Sobe um File em partes. onProgresso(0..1) pra barra de progresso.
// Cada parte tem 3 tentativas: no 4G da obra uma falha isolada no meio de uma
// planta de 40MB não pode jogar fora o upload inteiro.
async function enviarArquivo(file, onProgresso, cancelar) {
  const partes = Math.max(1, Math.ceil(file.size / TAM_PARTE));
  const ini = await apiArq('iniciar', {
    nome: file.name, mime: file.type || 'application/octet-stream', tamanho: file.size, partes
  });
  for (let i = 0; i < partes; i++) {
    if (cancelar && cancelar.pedido) throw new Error('envio cancelado');
    const pedaco = file.slice(i * TAM_PARTE, Math.min(file.size, (i + 1) * TAM_PARTE));
    const dados = bytesParaBase64(await pedaco.arrayBuffer());
    let ultimoErro = null;
    for (let tent = 0; tent < 3; tent++) {
      try { await apiArq('parte', { id: ini.id, i, dados }, { prazoMs: 180000 }); ultimoErro = null; break; }
      catch (e) {
        ultimoErro = e;
        // Erro definitivo (senha, parte inválida, arquivo não iniciado) não
        // melhora com insistência — e não vale esperar depois da última tentativa.
        if (e.status && e.status < 500 && e.status !== 429) break;
        if (tent < 2) await new Promise((r) => setTimeout(r, 800 * (tent + 1)));
      }
    }
    if (ultimoErro) throw ultimoErro;
    if (onProgresso) onProgresso((i + 1) / partes);
  }
  const fim = await apiArq('finalizar', { id: ini.id });
  return fim.meta || ini.meta;
}

// Baixa juntando as partes no navegador e devolve um Blob.
/* O laço de pedaços é o mesmo para o acervo e para o Drive: `pedir(i)` devolve
   { dados (base64), partes, mime, nome }. Estava escrito duas vezes — e a cópia
   do Drive tinha nascido sem a trava de download duplo e sem barra de progresso. */
async function baixarEmPartes(pedir, onProgresso) {
  const pedacos = [];
  let i = 0, total = 1, meta = null;
  while (i < total) {
    const r = await pedir(i);
    meta = meta || r;
    total = Number(r.partes) || 1;
    pedacos.push(base64ParaBytes(r.dados));
    i++;
    if (onProgresso) onProgresso(i / total);
  }
  return { blob: new Blob(pedacos, { type: (meta && meta.mime) || 'application/octet-stream' }), meta: meta || {} };
}

async function baixarArquivo(id, onProgresso) {
  const { meta } = await apiArq('meta', { id });
  return baixarEmPartes(async (i) => {
    const r = await apiArq('baixarParte', { id, i }, { prazoMs: 180000 });
    return Object.assign({}, r, { partes: meta.partes || 1, mime: meta.mime, nome: meta.nome });
  }, onProgresso);
}

function salvarNoAparelho(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome || 'arquivo';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ── Rede ──────────────────────────────────────────────────────────────────── */
window.addEventListener('online', () => { S.online = true; subirFila(); puxar(); });
window.addEventListener('offline', () => { S.online = false; document.dispatchEvent(new CustomEvent('domo:status')); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - S.ultimoPull > 45000) puxar();
});
setInterval(() => { if (!document.hidden) puxar(); }, 90000);
