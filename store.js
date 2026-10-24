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
  erroSync: '',
  erroCache: '',
  erroFila: '',
  erroArquivos: '',
  fotosPendentes: 0
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
  const sessao = opts.sessao || S;
  if (sessao.senhaHash && !opts.publico) headers['x-senha'] = sessao.senhaHash;
  if (sessao.quem) headers['x-quem'] = encodeURIComponent(sessao.quem);
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
// Uma operação por chave: setItem é atômico. Nenhuma aba regrava uma lista
// que pode ter ficado velha. IDs únicos também identificam exatamente o ACK.
const PREFIXO_FILA = 'domo_fila_v2:';
const chaveOperacao = (op) => PREFIXO_FILA + op;
function impressaoLocal(texto) {
  let a = 2166136261, b = 5381;
  for (const c of texto) { a = Math.imul(a ^ c.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ c.charCodeAt(0); }
  return (a >>> 0).toString(16) + (b >>> 0).toString(16);
}
function donoFila() {
  if (S.usuarioId) return 'usuario:' + S.usuarioId;
  if (!S.senhaHash) return '';
  // Identificador local, não é credencial nem controle de autorização.
  return 'equipe:' + impressaoLocal(S.senhaHash + '|' + S.quem);
}
function novaOperacao() { return crypto.randomUUID(); }
function gravarOperacao(f) {
  const chave = chaveOperacao(f.op);
  const texto = JSON.stringify(f);
  try { localStorage.setItem(chave, texto); }
  catch {
    // O cache pode ser baixado de novo; a fila nunca é descartável.
    try { localStorage.removeItem(K.cache); localStorage.setItem(chave, texto); }
    catch {
      const msg = 'Memória do aparelho cheia: não foi possível guardar. Mantenha este formulário aberto e tente novamente.';
      S.erroSync = msg;
      document.dispatchEvent(new CustomEvent('domo:status'));
      toast(msg, 'ruim');
      const erro = new Error(msg); erro.code = 'DOMO_STORAGE_FULL'; throw erro;
    }
  }
}
function atualizarFila() {
  const dono = donoFila();
  const fila = [];
  // Guardar primeiro a lista de chaves evita índices deslocados por outra aba.
  const chaves = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PREFIXO_FILA)) chaves.push(k); }
  for (const k of chaves) {
    const texto = localStorage.getItem(k);
    if (!texto) continue;
    try { const f = JSON.parse(texto); if (f.dono === dono && f.registro && f.op) fila.push(f); }
    catch { S.erroFila = 'Há uma pendência local ilegível. Preserve os dados deste aparelho e solicite recuperação.'; }
  }
  fila.sort((a, b) => String(a.em || '').localeCompare(String(b.em || '')) || a.op.localeCompare(b.op));
  // Uma edição nova substitui SOMENTE a versão que o editor conhecia. Duas
  // abas editando versões diferentes ficam ambas recuperáveis, sem last-write-wins.
  const substituidas = new Set(fila.flatMap(f => f.substitui || []));
  S.fila = fila.filter(f => !substituidas.has(f.op));
  S.seqFila = Math.max(S.seqFila, ...S.fila.map(f => Number(f.seq) || 0));
  return S.fila;
}
function restaurarPendencias() {
  atualizarFila();
  const contagem = new Map();
  for (const f of S.fila) { const k = f.colecao + '|' + f.registro.id; contagem.set(k, (contagem.get(k) || 0) + 1); }
  for (const f of S.fila) {
    const arr = S.reg[f.colecao] || (S.reg[f.colecao] = []);
    const i = arr.findIndex(r => r.id === f.registro.id);
    const conflito = contagem.get(f.colecao + '|' + f.registro.id) > 1;
    const rec = Object.assign({}, f.registro, { _opLocal: f.op, _pendente: !f.recusado && !conflito,
      _recusado: f.recusado || (conflito ? 'Alterações em abas diferentes. Confira as versões em Pendências.' : null) });
    if (i >= 0) arr[i] = rec; else arr.unshift(rec);
  }
}
function migrarFilaAntiga() {
  const texto = localStorage.getItem(K.fila);
  if (!texto) return;
  let antigas;
  try { antigas = JSON.parse(texto); if (!Array.isArray(antigas) || antigas.some(f => !f || !COLECOES_APP.includes(f.colecao) || !f.registro || typeof f.registro !== 'object' || !f.registro.id)) throw new Error(); }
  catch { S.erroFila = 'Fila antiga ilegível: preserve os dados deste aparelho para recuperação.'; return; }
  const dono = donoFila();
  if (!dono) return;
  const donoAntigo = localStorage.getItem('domo_fila_v1_dono');
  if (donoAntigo && donoAntigo !== dono) return;
  // O dono legado só pode ser estabelecido pela sessão lembrada no aparelho.
  if (!donoAntigo && (!localStorage.getItem(K.senha) || localStorage.getItem(K.senha) !== S.senhaHash)) return;
  localStorage.setItem('domo_fila_v1_dono', dono);
  for (const f of antigas) {
    const op = 'legado-' + dono + '-' + impressaoLocal(JSON.stringify(f));
    const recibo = 'domo_migrado_v2:' + op;
    if (localStorage.getItem(recibo)) continue;
    if (!localStorage.getItem(chaveOperacao(op))) gravarOperacao(Object.assign({}, f, { op, dono, em: f.registro.atualizadoEm || '', substitui: [] }));
    // O recibo impede reimportação depois do ACK. A origem NÃO é apagada: uma
    // aba v1 ainda aberta pode estar gravando nela no mesmo instante.
    localStorage.setItem(recibo, '1');
  }
  S.erroFila = '';
}
function lerCache() {
  S.quem = localStorage.getItem(K.quem) || '';
  S.senhaHash = localStorage.getItem(K.senha) || '';
  S.perfil = localStorage.getItem(K.perfil) || 'obra';
  S.usuarioId = localStorage.getItem(K.usuario) || '';
  S.acessoProprio = !!S.usuarioId;
  try {
    const c = JSON.parse(localStorage.getItem(K.cache) || 'null');
    if (c && c.reg && (!c.dono || c.dono === donoFila()) && S.senhaHash) { S.reg = Object.assign(S.reg, c.reg); S.cfg = c.cfg || null; S.ultimoPull = c.em || 0; }
  } catch { S.erroCache = 'Cópia offline indisponível neste aparelho. Conecte para atualizar.'; }
  try { migrarFilaAntiga(); } catch { S.erroFila = 'Não foi possível concluir a migração das pendências. A origem foi preservada; libere espaço neste aparelho.'; }
  restaurarPendencias();
}
function gravarCache() {
  try {
    localStorage.setItem(K.cache, JSON.stringify({ reg: S.reg, cfg: S.cfg, dono: donoFila(), em: Date.now() }));
    S.erroCache = '';
    return true;
  } catch {
    S.erroCache = 'Cópia offline incompleta neste aparelho. Os envios confirmados continuam no servidor.';
    document.dispatchEvent(new CustomEvent('domo:status'));
    return false;
  }
}
// Compatibilidade com a inicialização/testes antigos: nunca substitui a fila.
function gravarFila() { for (const f of S.fila) gravarOperacao(f); return true; }

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
  const id = registro.id || novaOperacao();
  const anterior = achar(col, id);
  const op = novaOperacao();
  const local = Object.assign({}, anterior || {}, registro, {
    id, atualizadoEm: new Date().toISOString(), atualizadoPor: S.quem || '—',
    _pendente: true, _recusado: null, _opLocal: op
  });
  if (!local.criadoEm) { local.criadoEm = local.atualizadoEm; local.criadoPor = S.quem || '—'; }
  // A base pertence ao registro que abriu o editor, não a um snapshot que
  // chegou silenciosamente depois. Edições offline encadeadas mantêm a base.
  const base = Object.hasOwn(registro, '_baseExistente') || registro.atualizadoEm || registro._opLocal ? registro : anterior;
  if (base && Object.hasOwn(base, '_baseExistente')) {
    local._baseExistente = base._baseExistente;
    local._baseRevisao = base._baseRevisao;
    local._baseAtualizadoEm = base._baseAtualizadoEm;
  } else if (!base || !(base._pendente || base._opLocal || base._recusado)) {
    local._baseExistente = !!anterior;
    local._baseRevisao = base && base._revisao || null;
    local._baseAtualizadoEm = base && base.atualizadoEm || null;
  }

  const dono = donoFila();
  if (!dono) throw new Error('Entre novamente antes de salvar. O formulário continua aberto.');
  // Confirma durabilidade ANTES de trocar a tela ou retornar sucesso ao caller.
  // O predecessor fica explicitamente registrado no mesmo setItem atômico.
  // Só o objeto que o editor conhecia pode indicar o predecessor. S.reg pode
  // ter recebido outra versão pelo evento storage enquanto o formulário abria.
  const baseOp = registro._opLocal;
  const substitui = opts.substitui || (baseOp ? [baseOp] : []);
  const ancestrais = new Set(substitui);
  for (const antiga of substitui) { try { const f = JSON.parse(localStorage.getItem(chaveOperacao(antiga))); for (const id of (f && f.ancestrais || [])) ancestrais.add(id); } catch { /* origem continua preservada */ } }
  const f = { op, dono, em: local.atualizadoEm, colecao: col, registro: local, seq: ++S.seqFila, substitui, ancestrais: [...ancestrais] };
  gravarOperacao(f);
  // Só limpar versões substituídas depois de gravar o sucessor completo.
  for (const antiga of substitui) localStorage.removeItem(chaveOperacao(antiga));
  const arr = S.reg[col] || (S.reg[col] = []);
  const i = arr.findIndex(r => r.id === id);
  if (i >= 0) arr[i] = local; else arr.unshift(local);
  atualizarFila();
  gravarCache();
  document.dispatchEvent(new CustomEvent('domo:status'));
  if (!opts.semSubir) subirFila();
  return local;
}

// Uma escolha explícita conserva as versões anteriores para baixar/consultar.
// Não há exclusão silenciosa quando duas abas editaram o mesmo registro.
const PREFIXO_RECUPERACAO = 'domo_recuperacao_v2:';
function versoesLocaisPreservadas() {
  const itens = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIXO_RECUPERACAO)) continue;
    try { const f = JSON.parse(localStorage.getItem(k)); if (f && f.dono === donoFila()) itens.push(f); } catch { /* não apaga origem */ }
  }
  return itens;
}
function resolverPendenciaLocal(op, baseConfirmada) {
  atualizarFila();
  const escolhida = S.fila.find(f => f.op === op);
  if (!escolhida) throw new Error('Essa versão já foi atualizada. Abra Pendências novamente.');
  const versoes = S.fila.filter(f => f.colecao === escolhida.colecao && f.registro.id === escolhida.registro.id);
  try {
    for (const f of versoes) localStorage.setItem(PREFIXO_RECUPERACAO + f.op, JSON.stringify(f));
    if (baseConfirmada) {
      const opServidor = 'servidor-' + escolhida.op + '-' + impressaoLocal(JSON.stringify(baseConfirmada));
      localStorage.setItem(PREFIXO_RECUPERACAO + opServidor, JSON.stringify({
        op: opServidor, dono: escolhida.dono, colecao: escolhida.colecao, origem: 'servidor',
        em: new Date().toISOString(), registro: baseConfirmada
      }));
    }
  }
  catch { throw new Error('Não há espaço para preservar as versões anteriores. Baixe as cópias e libere espaço antes de reenviar.'); }
  const registro = Object.assign({}, escolhida.registro);
  if (baseConfirmada !== undefined) {
    registro._baseExistente = !!baseConfirmada;
    registro._baseRevisao = baseConfirmada && baseConfirmada._revisao || null;
    registro._baseAtualizadoEm = baseConfirmada && baseConfirmada.atualizadoEm || null;
  }
  return salvar(escolhida.colecao, registro, { substitui: versoes.map(f => f.op) });
}

/* Contagem de fotos ainda guardadas no aparelho, para a tela poder dizer. */
async function fotosAindaNoAparelho() {
  try { const itens = (await filaArqListar()) || []; S.fotosPendentes = itens.filter(x => !x.dono || x.dono === donoFila()).length; return S.fotosPendentes; }
  catch { S.erroArquivos = 'Não foi possível conferir as fotos guardadas neste aparelho.'; return null; }
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
  if (_subindo || !navigator.onLine || !S.senhaHash) return false;
  _subindo = true;
  try {
    // Web Locks serializa envios entre abas. O diário por operação garante
    // durabilidade mesmo nos navegadores sem essa API.
    if (navigator.locks) return await navigator.locks.request('domo-envio-' + donoFila(), enviarFilaDuravel);
    return await enviarFilaDuravel();
  } finally { _subindo = false; document.dispatchEvent(new CustomEvent('domo:status')); }
}
async function enviarFilaDuravel() {
  try { migrarFilaAntiga(); } catch { S.erroFila = 'Migração de pendências incompleta: os dados originais foram preservados.'; }
  atualizarFila();
  if (S.erroFila) return false;
  const contagem = new Map();
  for (const f of S.fila) { const k = f.colecao + '|' + f.registro.id; contagem.set(k, (contagem.get(k) || 0) + 1); }
  const enviando = S.fila.filter(f => !f.recusado && contagem.get(f.colecao + '|' + f.registro.id) === 1).slice(0, 25);
  if (!enviando.length) return !S.fila.length;
  const dono = donoFila();
  try {
    const r = await api('salvarLote', { protocoloEnvio: 2, itens: enviando.map(f => ({ colecao: f.colecao, registro: limparParaEnvio(f.registro) })) });
    const recusas = new Map((r.recusados || []).map(x => [x.colecao + '|' + x.id, x]));
    const salvos = new Map((r.salvos || []).map(x => [x._col + '|' + x.id, x]));
    const confirmados = new Map([...salvos].map(([k, x]) => [k, x]));
    for (const x of (r.confirmados || [])) confirmados.set(x.colecao + '|' + x.id, x);
    let incompleto = false;
    for (const f of enviando) {
      // Se foi substituída em outra aba durante o envio, seu sucessor permanece.
      const recusa = recusas.get(f.colecao + '|' + f.registro.id);
      if (recusa) { if (localStorage.getItem(chaveOperacao(f.op))) { f.recusado = recusa.motivo || 'Recusado pelo servidor'; gravarOperacao(f); } }
      else if (confirmados.has(f.colecao + '|' + f.registro.id)) {
        const confirmado = confirmados.get(f.colecao + '|' + f.registro.id);
        atualizarFila();
        for (const proxima of S.fila) {
          if (!(proxima.ancestrais || []).includes(f.op) || proxima.registro._baseRevisao !== f.registro._baseRevisao || proxima.registro._baseAtualizadoEm !== f.registro._baseAtualizadoEm) continue;
          proxima.registro._baseExistente = true; proxima.registro._baseRevisao = confirmado._revisao || null; proxima.registro._baseAtualizadoEm = confirmado.atualizadoEm || null;
          gravarOperacao(proxima);
        }
        localStorage.removeItem(chaveOperacao(f.op));
      }
      else incompleto = true; // HTTP 200 sozinho não confirma cada registro.
    }
    if (donoFila() !== dono) return false; // logout/troca de sessão durante o request
    atualizarFila();
    for (const [chave, confirmado] of confirmados) {
      if (salvos.has(chave)) continue;
      const col = confirmado.colecao || confirmado._col;
      S.reg[col] = (S.reg[col] || []).filter(x => x.id !== confirmado.id);
    }
    for (const [chave, salvo] of salvos) {
      if (S.fila.some(f => f.colecao + '|' + f.registro.id === chave)) continue;
      const arr = S.reg[salvo._col] || (S.reg[salvo._col] = []);
      const i = arr.findIndex(x => x.id === salvo.id);
      if (i >= 0) arr[i] = salvo; else arr.unshift(salvo);
    }
    restaurarPendencias();
    gravarCache();
    S.erroSync = incompleto ? 'O servidor não confirmou todos os itens. As pendências continuam neste aparelho.' : '';
    if (recusas.size) document.dispatchEvent(new CustomEvent('domo:sempermissao', { detail: { qtd: recusas.size, msg: [...recusas.values()][0].motivo, itens: [...recusas.values()] } }));
    document.dispatchEvent(new CustomEvent('domo:dados'));
    if (!incompleto && S.fila.some(f => !f.recusado && contagem.get(f.colecao + '|' + f.registro.id) === 1)) setTimeout(subirFila, 300);
    return !incompleto && !S.fila.length;
  } catch (e) {
    if (donoFila() === dono) S.erroSync = e.message || 'Falha ao enviar';
    if (e.semSenha && donoFila() === dono) document.dispatchEvent(new CustomEvent('domo:semsenha'));
    // A recusa do lote também permanece recuperável, nunca some da fila.
    if (e.semPermissao) for (const f of enviando) { if (localStorage.getItem(chaveOperacao(f.op))) { f.recusado = e.message || 'Sem permissão'; gravarOperacao(f); } }
    if (donoFila() === dono) restaurarPendencias();
    return false;
  }
}
const limparParaEnvio = (r) => { const c = Object.assign({}, r); delete c._pendente; delete c._recusado; delete c._opLocal; delete c._col; return c; };

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
  const donoPull = donoFila();
  S.sincronizando = true;
  S.erroSync = '';
  document.dispatchEvent(new CustomEvent('domo:status'));
  try {
    await subirFila();
    const erroEnvio = S.erroSync;
    const r = await api('snapshot');
    if (donoFila() !== donoPull) return false;
    const novo = regVazio();
    for (const reg of (r.registros || [])) {
      const col = reg._col;
      if (novo[col]) novo[col].push(reg);
    }
    // Não descarta o que este aparelho acabou de mexer: um registro
    // recém-gravado que não veio no snapshot sumiria da tela de quem o criou.
    const GRACA_MS = 3 * 60 * 1000;
    const recente = (o) => {
      const t = o.atualizadoEm || o.criadoEm;
      return t && (Date.now() - new Date(t).getTime()) < GRACA_MS;
    };
    restaurarPendencias();
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
    S.erroSync = erroEnvio;
    gravarCache();
    // Só agora os pais e subitens estão disponíveis para costurar as fotos.
    await subirArquivosPendentes();
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
    if (donoFila() === donoPull) {
      S.erroSync = e.message || 'falha ao baixar';
      if (e.semSenha) document.dispatchEvent(new CustomEvent('domo:semsenha'));
    }
  } finally {
    _puxando = false;
    S.sincronizando = false;
    document.dispatchEvent(new CustomEvent('domo:status'));
  }
  return !S.erroSync && !S.erroFila && !S.erroArquivos && !S.fila.length;
}

/* ── Arquivos grandes (projetos, documentos, fotos) ────────────────────────── */
// 2,5MB por pedaço: em base64 vira ~3,4MB, com folga no limite de corpo
// que a Edge Function (domo-acervo) aceita por requisição.
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
  const dono = donoFila();
  const sessao = { senhaHash: S.senhaHash, quem: S.quem };
  const conferirSessao = () => { if (!dono || donoFila() !== dono) { const e = new Error('A sessão mudou. O arquivo continua guardado no aparelho.'); e.status = 401; throw e; } };
  conferirSessao();
  const ini = await apiArq('iniciar', {
    nome: file.name, mime: file.type || 'application/octet-stream', tamanho: file.size, partes
  }, { sessao });
  for (let i = 0; i < partes; i++) {
    if (cancelar && cancelar.pedido) throw new Error('envio cancelado');
    const pedaco = file.slice(i * TAM_PARTE, Math.min(file.size, (i + 1) * TAM_PARTE));
    const dados = bytesParaBase64(await pedaco.arrayBuffer());
    let ultimoErro = null;
    for (let tent = 0; tent < 3; tent++) {
      try { conferirSessao(); await apiArq('parte', { id: ini.id, i, dados }, { prazoMs: 180000, sessao }); ultimoErro = null; break; }
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
  conferirSessao();
  const fim = await apiArq('finalizar', { id: ini.id }, { sessao });
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

/* ── Fila de ARQUIVOS (IndexedDB) ──────────────────────────────────────────────
   A regra de ouro do sistema é "salva no aparelho primeiro". Ela valia para os
   registros (S.fila em localStorage) e NÃO valia para arquivo nenhum: a foto do
   recebimento que não subia ficava num array em MEMÓRIA e morria com a aba. O
   registro guardava só a CONTAGEM de fotos pendentes — um número, sem o arquivo
   — e a prova da entrega sumia sem ninguém ser avisado.

   Por que IndexedDB e não localStorage: localStorage só guarda texto, e os 5 MB
   dele são divididos com os outros sistemas da casa. Aqui cabe Blob. */
const DB_ARQ = 'domo_arquivos_pendentes';
function abrirBanco() {
  return new Promise((ok, erro) => {
    const req = indexedDB.open(DB_ARQ, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('fila')) req.result.createObjectStore('fila', { keyPath: 'id' }); };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => erro(req.error || new Error('IndexedDB indisponível'));
  });
}
async function comFila(modo, fn) {
  const db = await abrirBanco();
  return new Promise((ok, erro) => {
    const t = db.transaction('fila', modo);
    const r = fn(t.objectStore('fila'));
    t.onerror = () => erro(t.error || new Error('Falha ao guardar arquivo'));
    t.onabort = () => erro(t.error || new Error('Gravação do arquivo cancelada'));
    t.oncomplete = () => { db.close(); ok(r && r.result !== undefined ? r.result : r); };
  });
}
const filaArqGravar = (item) => comFila('readwrite', (st) => st.put(item));
const filaArqListar = () => comFila('readonly', (st) => st.getAll());
const filaArqApagar = (id) => comFila('readwrite', (st) => st.delete(id));

/* Anexa uma foto a um sub-item de um registro (ex.: as fotos de UM recebimento
   dentro da ordem). Tenta subir agora; se não der, guarda o arquivo no aparelho
   e devolve pendente:true — quem chamou avisa a pessoa, e subirFila() termina o
   serviço quando a internet voltar. */
async function anexarFoto({ file, colecao, registroId, subLista, subId, campo, onProgresso }) {
  const dono = donoFila();
  if (!dono) throw new Error('Entre novamente antes de anexar.');
  const item = { id: 'fa-' + novaOperacao(), dono, blob: file, nome: file.name, mime: file.type,
    em: new Date().toISOString(), colecao, registroId, subLista, subId, campo: campo || 'fotos' };
  // Nem o envio online elimina a cópia local antes de o registro confirmar o vínculo.
  await filaArqGravar(item);
  await fotosAindaNoAparelho();
  if (donoFila() !== dono) return { id: null, pendente: true, filaId: item.id };
  try {
    const meta = await enviarArquivo(file, onProgresso);
    item.arquivoId = meta.id;
    await filaArqGravar(item);
    return { id: meta.id, pendente: false, filaId: item.id };
  } catch { return { id: null, pendente: true, filaId: item.id }; }
}

let _subindoArquivos = false;
async function subirArquivosPendentes() {
  if (_subindoArquivos || !navigator.onLine || !S.senhaHash) return;
  _subindoArquivos = true;
  const dono = donoFila();
  try {
    if (navigator.locks) await navigator.locks.request('domo-fotos-' + dono, () => enviarArquivosDaSessao(dono));
    else await enviarArquivosDaSessao(dono);
  } finally { _subindoArquivos = false; await fotosAindaNoAparelho(); document.dispatchEvent(new CustomEvent('domo:status')); }
}
async function enviarArquivosDaSessao(dono) {
  let pendentes;
  try { pendentes = (await filaArqListar()) || []; }
  catch { S.erroArquivos = 'Não foi possível abrir as fotos guardadas neste aparelho.'; return; }
  S.erroArquivos = '';
  for (const item of pendentes) {
    if (!item.dono) { S.erroArquivos = 'Há fotos antigas sem dono identificado. Recupere-as em Pendências.'; continue; }
    if (item.dono !== dono || donoFila() !== dono) continue;
    try {
      let reg = achar(item.colecao, item.registroId);
      let sub = reg && (reg[item.subLista] || []).find(x => x.id === item.subId);
      if (!reg || reg.apagadoEm || !sub || sub.apagadoEm) { S.erroArquivos = 'Foto guardada: o recebimento ainda não está disponível para vincular.'; continue; }
      if (!item.arquivoId) {
        const meta = await enviarArquivo(new File([item.blob], item.nome || 'foto.jpg', { type: item.mime || 'image/jpeg' }));
        item.arquivoId = meta.id;
        await filaArqGravar(item); // retomada reaproveita o upload já confirmado
      }
      if (donoFila() !== dono) return;
      reg = achar(item.colecao, item.registroId);
      sub = reg && (reg[item.subLista] || []).find(x => x.id === item.subId);
      if (!sub) continue;
      if (!(sub[item.campo] || []).includes(item.arquivoId)) {
        const copia = Object.assign({}, reg, { [item.subLista]: reg[item.subLista].map(x => x.id !== item.subId ? x : Object.assign({}, x, {
          [item.campo]: [...new Set([...(x[item.campo] || []), item.arquivoId])],
          fotosPendentes: Math.max(0, (Number(x.fotosPendentes) || 0) - 1)
        })) });
        salvar(item.colecao, copia, { semSubir: true });
      }
      await subirFila();
      atualizarFila();
      reg = achar(item.colecao, item.registroId);
      sub = reg && (reg[item.subLista] || []).find(x => x.id === item.subId);
      const aguardando = S.fila.some(f => f.colecao === item.colecao && f.registro.id === item.registroId);
      if (!aguardando && sub && (sub[item.campo] || []).includes(item.arquivoId)) await filaArqApagar(item.id);
      else S.erroArquivos = 'Foto guardada no aparelho; aguardando confirmação do vínculo no servidor.';
    } catch (e) { S.erroArquivos = 'Foto preservada no aparelho: ' + (e.message || 'envio pendente'); break; }
  }
}

/* ── Rede ──────────────────────────────────────────────────────────────────── */
window.addEventListener('storage', (e) => {
  if (e.key && (e.key.startsWith(PREFIXO_FILA) || e.key === K.fila)) {
    try { migrarFilaAntiga(); restaurarPendencias(); } catch { /* mantém origem */ }
    document.dispatchEvent(new CustomEvent('domo:status'));
    // Não redesenha o formulário que a outra aba está preenchendo.
    document.dispatchEvent(new CustomEvent('domo:dados'));
  }
});
window.addEventListener('online', () => { S.online = true; subirFila(); puxar(); });
window.addEventListener('offline', () => { S.online = false; document.dispatchEvent(new CustomEvent('domo:status')); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - S.ultimoPull > 45000) puxar();
});
setInterval(() => { if (!document.hidden) puxar(); }, 90000);
