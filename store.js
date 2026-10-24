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
  orc: { pre: '', nome: 'Orçamento Executivo' },
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
  fotosPendentes: 0,
  arquivosPendentes: []
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
// O diário grande do orçamento não disputa a quota de localStorage com os
// demais apps do mesmo domínio. Uma transação mantém operações e recibos por
// acesso; a memória abaixo é somente uma projeção para a interface síncrona.
const DB_DIARIO_ORC = 'domo_orcamento_diario';
const ERRO_DIARIO_ORC='Não foi possível ler o diário do orçamento. Os dados foram preservados; tente novamente.';
const diarioOrc = new Map();
const temDiarioOrc = () => typeof indexedDB !== 'undefined' && !!indexedDB;
const chaveAckOrc=(dono,id)=>'ack:'+encodeURIComponent(dono)+':'+id;
function transacaoDiarioOrc(dono, alterar) {
  return new Promise((resolve,reject) => {
    let erro, resultado, linhas=[];
    const req=indexedDB.open(DB_DIARIO_ORC,1);
    req.onupgradeneeded=()=>req.result.createObjectStore('entradas',{keyPath:'chave'}).createIndex('dono','dono');
    req.onerror=()=>reject(req.error);
    req.onblocked=()=>reject(new Error('Diário do orçamento ocupado por outra aba.'));
    req.onsuccess=()=>{
      const db=req.result,tx=db.transaction('entradas',alterar?'readwrite':'readonly'),st=tx.objectStore('entradas');
      const leitura=st.index('dono').getAll(dono);
      leitura.onsuccess=()=>{
        try {
          const mapa=new Map(leitura.result.map(e=>[e.chave,e]));
          const put=(chave,tipo,valor)=>{const e={chave,dono,tipo,valor:structuredClone(valor)};st.put(e);mapa.set(chave,e);};
          const del=chave=>{st.delete(chave);mapa.delete(chave);};
          resultado=alterar?.(mapa,put,del);linhas=[...mapa.values()];
        }catch(e){erro=e;tx.abort();}
      };
      tx.oncomplete=()=>{
        db.close();
        // Não devolve conteúdo privado à sessão que entrou durante o commit.
        if(donoFila()===dono){for(const [k,e] of diarioOrc)if(e.dono===dono)diarioOrc.delete(k);for(const e of linhas)diarioOrc.set(e.chave,e);}
        resolve(resultado);
      };
      tx.onerror=tx.onabort=()=>{db.close();reject(erro||tx.error||new Error('Não foi possível guardar o diário do orçamento. Mantenha o formulário aberto.'));};
    };
  });
}
function operacaoLocal(op) {
  const entry=diarioOrc.get(chaveOperacao(op));
  if(entry?.dono===donoFila())return structuredClone(entry.valor);
  try{return JSON.parse(localStorage.getItem(chaveOperacao(op))||'null');}catch{return null;}
}
async function carregarDiarioOrcamento(dono=donoFila()) {
  if(!temDiarioOrc()||!dono)return;
  const antigas=[];
  for(let i=0;i<localStorage.length;i++){
    const chave=localStorage.key(i);if(!chave?.startsWith(PREFIXO_FILA))continue;
    const texto=localStorage.getItem(chave);
    try{const f=JSON.parse(texto);if(f?.colecao==='orc'&&f.dono===dono)antigas.push({chave,texto,f});}catch{/* a leitura legada sinaliza dados ilegíveis */}
  }
  await transacaoDiarioOrc(dono,antigas.length?(mapa,put)=>{
    for(const {chave,f} of antigas)if(!mapa.has(chave)&&mapa.get(chaveAckOrc(dono,f.registro.id))?.valor.op!==f.op)put(chave,'operacao',f);
  }:null);
  // Só remove uma representação legada depois do commit, sem tocar outros apps.
  for(const {chave,texto} of antigas)if(localStorage.getItem(chave)===texto)localStorage.removeItem(chave);
  if(donoFila()===dono){if(S.erroFila===ERRO_DIARIO_ORC)S.erroFila='';atualizarFila();}
}
async function conferirDiarioParaEnvio(dono=donoFila()) {
  try{await carregarDiarioOrcamento(dono);return true;}
  catch{if(donoFila()===dono&&(!S.erroFila||S.erroFila===ERRO_DIARIO_ORC))S.erroFila=ERRO_DIARIO_ORC;return false;}
}
async function persistirOperacao(f,exigirExistente=false) {
  if(f.colecao!=='orc'||!temDiarioOrc()){
    if(!exigirExistente||localStorage.getItem(chaveOperacao(f.op)))gravarOperacao(f);
    return;
  }
  await transacaoDiarioOrc(f.dono,(mapa,put)=>{const chave=chaveOperacao(f.op);if(!exigirExistente||mapa.has(chave))put(chave,'operacao',f);});
}
async function removerOperacoes(operacoes) {
  const orc=operacoes.filter(f=>f.colecao==='orc'&&temDiarioOrc());
  for(const dono of new Set(orc.map(f=>f.dono)))await transacaoDiarioOrc(dono,(_mapa,_put,del)=>{for(const f of orc.filter(f=>f.dono===dono))del(chaveOperacao(f.op));});
  for(const f of operacoes)localStorage.removeItem(chaveOperacao(f.op));
}
async function confirmarOperacaoOrc(f,confirmado,salvo) {
  await transacaoDiarioOrc(f.dono,(mapa,put,del)=>{
    for(const e of mapa.values()){
      if(e.tipo!=='operacao')continue;
      const proxima=e.valor;
      if(!(proxima.ancestrais||[]).includes(f.op)||proxima.registro._baseRevisao!==f.registro._baseRevisao||proxima.registro._baseAtualizadoEm!==f.registro._baseAtualizadoEm)continue;
      if(salvo){
        const canonico=consolidarEdicaoOrcamento(f.registro,proxima.registro,salvo);
        if(canonico.conflitos.length){put(e.chave,'operacao',{...proxima,recusado:'O servidor confirmou a versão anterior, mas há campos que precisam de conferência antes do próximo envio.'});continue;}
        proxima.registro={...canonico.registro,_opLocal:proxima.op,_pendente:true,_recusado:null};proxima.baseRegistro=structuredClone(salvo);
      }
      Object.assign(proxima.registro,{_baseExistente:true,_baseRevisao:confirmado._revisao||null,_baseAtualizadoEm:confirmado.atualizadoEm||null});put(e.chave,'operacao',proxima);
    }
    const canonico=salvo||{id:f.registro.id};
    if(mapa.has(chaveOperacao(f.op)))put(chaveOperacao(f.op),'operacao',{...f,confirmado:true,confirmadoSemLeitura:!salvo,recusado:null,baseRegistro:undefined,
      registro:{...canonico,_baseExistente:true,_baseRevisao:confirmado._revisao||null,_baseAtualizadoEm:confirmado.atualizadoEm||null}});
    // Um recibo por orçamento permite que um editor aberto antes do ACK adote
    // seus carimbos, mesmo quando o diário já foi liberado após o cache.
    put(chaveAckOrc(f.dono,f.registro.id),'ack',{op:f.op,enviado:f.registro,registro:salvo||null});
    del('envio:'+f.op);
  });
}
async function registrarEnviosOrc(operacoes,dono) {
  if(!operacoes.length)return;
  await transacaoDiarioOrc(dono,(_mapa,put)=>{for(const f of operacoes)put('envio:'+f.op,'envio',f);});
}
async function reconciliarEnviosOrc(dono) {
  const envios=[...diarioOrc.values()].filter(e=>e.dono===dono&&e.tipo==='envio').map(e=>e.valor);
  if(!envios.length)return true;
  if(!navigator.onLine)return false;
  // Não repetir uma intenção cujo servidor pode ter confirmado enquanto a
  // transação local do ACK falhou. A identidade do envio é exata, não inferida
  // por valores iguais nem por relógio do cliente.
  const resposta=await api('snapshot',{colecoes:['orc']});
  if(donoFila()!==dono)return false;
  for(const f of envios){
    const remoto=(resposta.registros||[]).find(r=>r._col==='orc'&&r.id===f.registro.id);
    if(remoto?._operacaoEnvio===f.op){await confirmarOperacaoOrc(f,remoto,remoto);continue;}
    const mesmaBase=remoto
      ? remoto._revisao ? remoto._revisao===f.registro._baseRevisao : (remoto.atualizadoEm||null)===(f.registro._baseAtualizadoEm||null)
      : f.registro._baseExistente===false;
    await transacaoDiarioOrc(dono,(mapa,put,del)=>{
      if(!mesmaBase){
        // Outra alteração venceu: preservar a intenção e os dois retratos para
        // revisão, sem reaplicar o prefixo anterior contra um histórico assinado.
        for(const e of mapa.values())if(e.tipo==='operacao'&&(e.valor.op===f.op||(e.valor.ancestrais||[]).includes(f.op)))put(e.chave,'operacao',{...e.valor,recusado:'A versão do servidor mudou durante um envio sem confirmação local. Confira as versões em Pendências.'});
        put(PREFIXO_RECUPERACAO+f.op,'versao',f);
        if(remoto)put(PREFIXO_RECUPERACAO+'servidor-'+f.op,'versao',{op:'servidor-'+f.op,dono,colecao:'orc',origem:'servidor',registro:remoto});
      }
      del('envio:'+f.op);
    });
  }
  if(donoFila()!==dono)return false;
  restaurarPendencias();return true;
}
function gravarOperacao(f) {
  const chave = chaveOperacao(f.op);
  const texto = JSON.stringify(f);
  try { localStorage.setItem(chave, texto); }
  catch {
    // Não sacrifica uma cópia offline para abrir espaço para outro registro.
    const msg = 'Memória do aparelho cheia: não foi possível guardar. Mantenha este formulário aberto e tente novamente.';
    S.erroSync = msg;
    document.dispatchEvent(new CustomEvent('domo:status'));
    toast(msg, 'ruim');
    const erro = new Error(msg); erro.code = 'DOMO_STORAGE_FULL'; throw erro;
  }
}
function atualizarFila() {
  const dono = donoFila();
  const fila = [...diarioOrc.values()].filter(e=>e.dono===dono&&e.tipo==='operacao').map(e=>structuredClone(e.valor));
  // Guardar primeiro a lista de chaves evita índices deslocados por outra aba.
  const chaves = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PREFIXO_FILA)) chaves.push(k); }
  for (const k of chaves) {
    const texto = localStorage.getItem(k);
    if (!texto) continue;
    try { const f = JSON.parse(texto); if (f.dono === dono && f.registro && f.op && !fila.some(x=>x.op===f.op)) fila.push(f); }
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
  for (const f of S.fila.filter(x=>!x.confirmado)) { const k = f.colecao + '|' + f.registro.id; contagem.set(k, (contagem.get(k) || 0) + 1); }
  for (const f of S.fila) {
    if (f.confirmado && contagem.has(f.colecao + '|' + f.registro.id)) continue;
    const arr = S.reg[f.colecao] || (S.reg[f.colecao] = []);
    const i = arr.findIndex(r => r.id === f.registro.id);
    if (f.confirmadoSemLeitura) { if(i>=0)arr.splice(i,1);continue; }
    const conflito = contagem.get(f.colecao + '|' + f.registro.id) > 1;
    const rec = Object.assign({}, f.registro, { _opLocal: f.op, _pendente: !f.confirmado && !f.recusado && !conflito,
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
// Banco separado da fila de anexos: nenhuma atualização altera os Blobs pendentes.
const DB_CACHE = 'domo_copia_offline';
function bancoCache(modo, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_CACHE, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('copias');
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Armazenamento ocupado por outra aba'));
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('copias', modo);
      let result;
      try { result = fn(tx.objectStore('copias')); }
      catch (e) { db.close(); reject(e); return; }
      tx.oncomplete = () => { db.close(); resolve(result.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error('Cópia offline não confirmada')); };
    };
  });
}
// Libera apenas a representação antiga depois de preservar e reler seus bytes.
// O conteúdo original permanece no banco, inclusive dados ainda não migráveis.
async function preservarCacheLegado(texto) {
  if (!texto) return;
  const chave = 'legado:' + impressaoLocal(texto);
  await bancoCache('readwrite', st => st.put(texto, chave));
  if (await bancoCache('readonly', st => st.get(chave)) !== texto) throw new Error('Cópia divergente');
  if (localStorage.getItem(K.cache) === texto) localStorage.removeItem(K.cache);
}
function aplicarCache(c) {
  S.reg = Object.assign(regVazio(), c.reg); S.cfg = c.cfg || null; S.ultimoPull = c.em || 0;
}
function lerCache() {
  S.quem = localStorage.getItem(K.quem) || '';
  S.senhaHash = localStorage.getItem(K.senha) || '';
  S.perfil = localStorage.getItem(K.perfil) || 'obra';
  S.usuarioId = localStorage.getItem(K.usuario) || '';
  S.acessoProprio = !!S.usuarioId;
  const dono = donoFila(), senha = S.senhaHash;
  const texto = localStorage.getItem(K.cache);
  let legado;
  try {
    const c = JSON.parse(texto || 'null');
    if (c && c.reg && (!c.dono || c.dono === dono) && senha) { legado = c; aplicarCache(c); }
  } catch { S.erroCache = 'Cópia offline indisponível neste aparelho. Conecte para atualizar.'; }
  const pendencias = () => {
    try { migrarFilaAntiga(); } catch { S.erroFila = 'Não foi possível concluir a migração das pendências. A origem foi preservada; libere espaço neste aparelho.'; }
    restaurarPendencias();
  };
  pendencias();
  if (typeof indexedDB === 'undefined' || !indexedDB || !dono || !senha) return Promise.resolve();
  return (async () => {
    try {
      const c = await bancoCache('readonly', st => st.get(dono));
      if (donoFila() !== dono || S.senhaHash !== senha) return;
      if (c && c.reg && c.dono === dono && (!legado || c.em >= legado.em)) aplicarCache(c);
      else if (legado) await bancoCache('readwrite', st => st.put({...legado, dono}, dono));
      await preservarCacheLegado(texto);
      if (donoFila() !== dono || S.senhaHash !== senha) return;
      S.erroCache = '';
    } catch { if (donoFila() === dono) S.erroCache = 'Cópia offline não atualizada. Os dados anteriores foram preservados; conecte para conferir.'; }
    await conferirDiarioParaEnvio(dono);
    if (donoFila() === dono && S.senhaHash === senha) pendencias();
  })();
}
let cacheEmGravacao = Promise.resolve();
function gravarCache() {
  const dono = donoFila(), senha = S.senhaHash;
  const texto = JSON.stringify({ reg: S.reg, cfg: S.cfg, dono, em: Date.now() });
  const resultado = ok => {
    if (donoFila() === dono && S.senhaHash === senha) {
      S.erroCache = ok ? '' : 'Cópia offline incompleta neste aparelho. As pendências foram preservadas; mantenha o formulário aberto se não conseguir salvar.';
      document.dispatchEvent(new CustomEvent('domo:status'));
    }
    return ok;
  };
  if (!dono || !senha) return false;
  // Compatibilidade com navegadores que não oferecem IndexedDB.
  if (typeof indexedDB === 'undefined' || !indexedDB) {
    try { localStorage.setItem(K.cache, texto); return resultado(true); } catch { return resultado(false); }
  }
  cacheEmGravacao = cacheEmGravacao.then(async () => {
    try {
      await bancoCache('readwrite', st => st.put(JSON.parse(texto), dono));
      await preservarCacheLegado(localStorage.getItem(K.cache));
      return resultado(true);
    } catch { return resultado(false); }
  });
  return cacheEmGravacao;
}
// Compatibilidade com a inicialização/testes antigos: nunca substitui a fila.
function gravarFila() { return Promise.all(S.fila.map(f=>persistirOperacao(f))); }

/* ── Consultas ─────────────────────────────────────────────────────────────── */
// Lista de uma coleção já sem a lixeira e com o mais novo em cima.
function lista(col, incluirApagados = false) {
  return (S.reg[col] || [])
    .filter((r) => incluirApagados || !r.apagadoEm)
    .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
}

const achar = (col, id) => (S.reg[col] || []).find((r) => r.id === id) || null;

// Rascunhos pertencem ao acesso, fora da fila de registros e do snapshot remoto.
const PREFIXO_RASCUNHO_ORC = 'domo_rascunho_orc_v1:';
const chaveRascunhosOrcamento = dono => PREFIXO_RASCUNHO_ORC + encodeURIComponent(dono) + ':';
let rascunhosEmGravacao = Promise.resolve();
async function lerMapaRascunhosOrcamento(dono) {
  if (!dono) return {};
  const prefixo = chaveRascunhosOrcamento(dono), mapa = {};
  if (typeof indexedDB !== 'undefined' && indexedDB) {
    const chaves = await bancoCache('readonly', st => st.getAllKeys());
    for (const chave of chaves.filter(k => typeof k === 'string' && k.startsWith(prefixo))) {
      const item = await bancoCache('readonly', st => st.get(chave));
      if (item) mapa[item.chave] = item;
    }
  } else for (let i=0;i<localStorage.length;i++) {
    const chave=localStorage.key(i);if (!chave?.startsWith(prefixo))continue;
    const item=JSON.parse(localStorage.getItem(chave));if(item)mapa[item.chave]=item;
  }
  return mapa;
}
function atualizarRascunhosOrcamento(chave, payload, remover) {
  const dono = donoFila();
  if (!dono) return Promise.reject(new Error('Entre novamente para guardar o rascunho.'));
  // Serializa desde a captura: a UI pode continuar alterando seu objeto.
  const copia = payload === undefined ? null : JSON.parse(JSON.stringify(payload));
  const task = rascunhosEmGravacao.catch(() => {}).then(async () => {
    const item = { chave, payload: copia, atualizadoEm: new Date().toISOString() };
    const destino = chaveRascunhosOrcamento(dono) + encodeURIComponent(chave);
    if (typeof indexedDB !== 'undefined' && indexedDB) await bancoCache('readwrite', st => remover ? st.delete(destino) : st.put(item, destino));
    else if (remover) localStorage.removeItem(destino);
    else localStorage.setItem(destino, JSON.stringify(item));
    if (donoFila() === dono) document.dispatchEvent(new CustomEvent('domo:status'));
  });
  rascunhosEmGravacao = task;
  return task;
}
const gravarRascunhoOrcamento = (chave, payload) => atualizarRascunhosOrcamento(chave, payload, false);
const removerRascunhoOrcamento = chave => atualizarRascunhosOrcamento(chave, undefined, true);
async function listarRascunhosOrcamento() {
  const dono = donoFila(); await rascunhosEmGravacao.catch(() => {});
  const mapa = await lerMapaRascunhosOrcamento(dono);
  return donoFila() === dono ? Object.values(mapa).sort((a,b) => b.atualizadoEm.localeCompare(a.atualizadoEm)) : [];
}
async function lerRascunhoOrcamento(chave) { return (await listarRascunhosOrcamento()).find(x => x.chave === chave)?.payload || null; }

function estadoSalvamento(col, id) {
  atualizarFila();
  const operacoes = S.fila.filter(f => f.colecao === col && f.registro.id === id);
  const arquivos = (S.arquivosPendentes || []).filter(f => f.dono === donoFila() && f.colecao === col && f.registroId === id);
  const recusado = operacoes.find(f => f.recusado);
  const erroArquivo = arquivos.find(f => f.erro)?.erro;
  const conflito = operacoes.length > 1;
  const estado = recusado || conflito ? 'recusado' : operacoes.length || arquivos.length ? 'pendente' : S.erroCache ? 'erro' : 'sincronizado';
  return { estado, registrosPendentes: operacoes.length, arquivosPendentes: arquivos.length,
    mensagem: recusado?.recusado || (conflito ? 'Há versões para consolidar em Pendências.' : operacoes.some(f=>f.confirmado) ? 'Confirmado no servidor; falta concluir a cópia offline.' : erroArquivo ? 'Arquivo preservado: '+erroArquivo : arquivos.length ? 'Arquivo guardado no aparelho; aguardando confirmação do vínculo.' : operacoes.length ? 'Salvo no aparelho; aguardando sincronização.' : S.erroCache || 'Sincronizado.') };
}

// Três versões permitem unir mudanças independentes sem escolher pelo horário.
// Só é automático quando um lado permaneceu igual à base ou ambos concordam.
function consolidarEdicaoOrcamento(base, local, remoto = achar('orc', local.id), escolhas = {}) {
  const conflitos = [], igual = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const clonar = x => x === undefined ? undefined : structuredClone(x);
  const objeto = x => x && typeof x === 'object' && !Array.isArray(x);
  const chave = x => objeto(x) ? x.id || x.arquivoId || x.item || (x.em ? x.em + '|' + (x.por || '') : null) : null;
  function conflito(caminho, antes, editado, atual) {
    if (escolhas[caminho] === 'local') return clonar(editado);
    if (escolhas[caminho] === 'remoto') return clonar(atual);
    conflitos.push({ caminho, base:clonar(antes), local:clonar(editado), remoto:clonar(atual) });
    return clonar(atual);
  }
  function mesclar(antes, editado, atual, caminho) {
    if (igual(editado, atual)) return clonar(atual);
    if (caminho !== 'consolidacoes') {
      if (igual(editado, antes)) return clonar(atual);
      if (igual(atual, antes)) return clonar(editado);
    }
    if (Array.isArray(editado) && Array.isArray(atual)) {
      const a = Array.isArray(antes) ? antes : [];
      if (caminho === 'consolidacoes') {
        // Prefixo aprovado é uma sequência imutável, inclusive sua ordem.
        const itens = [...new Set([...a,...atual,...editado].map(x => x.item))], bloqueados = new Set();
        for (const item of itens) {
          const anteriores=a.filter(x=>x.item===item), locais=editado.filter(x=>x.item===item), remotas=atual.filter(x=>x.item===item);
          const novasLocais=locais.filter(x=>!anteriores.some(b=>b.id===x.id)&&!remotas.some(r=>r.id===x.id));
          const novasRemotas=remotas.filter(x=>!anteriores.some(b=>b.id===x.id));
          const mudouHistorico=anteriores.some(b=>!igual(b,locais.find(x=>x.id===b.id)));
          if (mudouHistorico || (novasLocais.length && novasRemotas.length)) {
            conflitos.push({caminho:caminho+'.'+item,base:clonar(anteriores),local:clonar(locais),remoto:clonar(remotas)});
            bloqueados.add(item);
          }
        }
        return [...clonar(atual),...editado.filter(x=>!bloqueados.has(x.item)&&!atual.some(r=>r.id===x.id)).map(clonar)];
      }
      if ([a,editado,atual].every(xs => xs.every(x=>chave(x)) && new Set(xs.map(chave)).size === xs.length)) {
        const ids=[...new Set([...atual,...editado,...a].map(chave))];
        return ids.map(id=>mesclar(a.find(x=>chave(x)===id),editado.find(x=>chave(x)===id),atual.find(x=>chave(x)===id),caminho+'.'+id)).filter(x=>x!==undefined);
      }
    }
    if (objeto(editado) && objeto(atual) && (antes === undefined || objeto(antes))) {
      const saida = {};
      for (const k of new Set([...Object.keys(antes||{}),...Object.keys(editado),...Object.keys(atual)])) {
        const valor = mesclar(antes?.[k], editado[k], atual[k], caminho ? caminho+'.'+k : k);
        if (valor !== undefined) saida[k] = valor;
      }
      return saida;
    }
    return conflito(caminho,antes,editado,atual);
  }
  // Metadados de sincronização não são campos editáveis nem conflitos humanos.
  const limpar = value => { const r=clonar(value);if(r)for(const k of Object.keys(r))if(k.startsWith('_')||['atualizadoEm','atualizadoPor'].includes(k))delete r[k];return r; };
  const registro = mesclar(limpar(base),limpar(local),limpar(remoto),'');
  if (registro && remoto) for (const k of Object.keys(remoto)) if (k.startsWith('_') || ['atualizadoEm','atualizadoPor'].includes(k)) registro[k]=clonar(remoto[k]);
  return { registro, conflitos };
}

/* ── Gravação ──────────────────────────────────────────────────────────────── */
// Salva no aparelho na hora e empurra pra fila. Devolve o registro local.
function prepararSalvamento(col, registro, opts = {}, consultar=operacaoLocal) {
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
  for (const antiga of substitui) { const f=consultar(antiga);for (const id of (f && f.ancestrais || [])) ancestrais.add(id); }
  const f = { op, dono, em: local.atualizadoEm, colecao: col, registro: local, seq: ++S.seqFila, substitui, ancestrais: [...ancestrais] };
  if (col === 'orc') {
    let origem;
    origem=baseOp&&consultar(baseOp);
    if (opts.substitui && Object.hasOwn(opts, 'baseRegistro')) f.baseRegistro = structuredClone(opts.baseRegistro);
    else if (origem?.confirmado) f.baseRegistro = structuredClone(origem.registro);
    else if (origem && Object.hasOwn(origem, 'baseRegistro')) f.baseRegistro = origem.baseRegistro;
    else if (Object.hasOwn(opts, 'baseRegistro')) f.baseRegistro = structuredClone(opts.baseRegistro);
    else if (!baseOp && anterior && !anterior._pendente && !anterior._recusado) f.baseRegistro = structuredClone(anterior);
    else if (!anterior) f.baseRegistro = null;
  }
  return {f,local,col,opts};
}
function concluirSalvamento({f,local,col,opts}) {
  if(donoFila()!==f.dono)throw new Error('O orçamento foi preservado no acesso anterior. Entre novamente nesse acesso para continuar.');
  const id=local.id;
  const arr = S.reg[col] || (S.reg[col] = []);
  const i = arr.findIndex(r => r.id === id);
  if (i >= 0) arr[i] = local; else arr.unshift(local);
  atualizarFila();
  gravarCache();
  document.dispatchEvent(new CustomEvent('domo:status'));
  if (!opts.semSubir) subirFila();
  return local;
}
function salvar(col, registro, opts = {}) {
  if(col==='orc'&&temDiarioOrc())return salvarOrcamento(registro,opts);
  const preparado=prepararSalvamento(col,registro,opts),{f}=preparado;
  gravarOperacao(f);
  // Só limpar versões substituídas depois de gravar o sucessor completo.
  for (const antiga of f.substitui) localStorage.removeItem(chaveOperacao(antiga));
  return concluirSalvamento(preparado);
}
async function salvarOrcamento(registro,opts={}) {
  if(!temDiarioOrc())return salvar('orc',registro,opts);
  const dono=donoFila();if(!dono)throw new Error('Entre novamente antes de salvar. O formulário continua aberto.');
  // Captura a intenção antes do primeiro await: o formulário ainda pode mudar.
  let copia=structuredClone(registro),opcoes=structuredClone(opts);
  await carregarDiarioOrcamento(dono);
  let preparado;
  await transacaoDiarioOrc(dono,(mapa,put,del)=>{
    if(donoFila()!==dono)throw new Error('A sessão mudou. O formulário não foi salvo no novo acesso.');
    const recibo=mapa.get(chaveAckOrc(dono,copia.id))?.valor;
    if(copia._opLocal&&recibo?.op===copia._opLocal&&recibo.registro){
      const merge=consolidarEdicaoOrcamento(recibo.enviado,copia,recibo.registro);
      if(merge.conflitos.length){const erro=new Error('Há alterações para conferir antes de salvar.');erro.conflitos=merge.conflitos;throw erro;}
      copia={...merge.registro,_baseExistente:true,_baseRevisao:recibo.registro._revisao||null,_baseAtualizadoEm:recibo.registro.atualizadoEm||null};
      opcoes.baseRegistro=structuredClone(recibo.registro);
    }
    preparado=prepararSalvamento('orc',copia,opcoes,op=>mapa.get(chaveOperacao(op))?.valor||null);
    put(chaveOperacao(preparado.f.op),'operacao',preparado.f);
    for(const op of preparado.f.substitui)del(chaveOperacao(op));
  });
  const salvo=concluirSalvamento(preparado);
  avisarDiarioOrc();
  return salvo;
}

// Uma escolha explícita conserva as versões anteriores para baixar/consultar.
// Não há exclusão silenciosa quando duas abas editaram o mesmo registro.
const PREFIXO_RECUPERACAO = 'domo_recuperacao_v2:';
function versoesLocaisPreservadas() {
  const itens = [...diarioOrc.values()].filter(e=>e.dono===donoFila()&&e.tipo==='versao').map(e=>structuredClone(e.valor));
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIXO_RECUPERACAO)) continue;
    try { const f = JSON.parse(localStorage.getItem(k)); if (f && f.dono === donoFila()) itens.push(f); } catch { /* não apaga origem */ }
  }
  return itens;
}
function consolidarPendenciaOrcamento(op, remoto, escolhas = {}) {
  atualizarFila();
  const escolhida = S.fila.find(f=>f.op===op);
  if (!escolhida) throw new Error('Essa versão já foi atualizada. Abra Pendências novamente.');
  const versoes = S.fila.filter(f=>f.colecao==='orc'&&f.registro.id===escolhida.registro.id&&f.op!==op).concat(escolhida);
  let registro = remoto, conflitos = [];
  for (const versao of versoes) {
    if (!Object.hasOwn(versao,'baseRegistro')) throw new Error('Esta pendência não tem base completa para consolidar. Baixe a versão e revise os itens no orçamento antes de reenviar.');
    const r=consolidarEdicaoOrcamento(versao.baseRegistro,versao.registro,registro,escolhas);
    registro=r.registro;conflitos.push(...r.conflitos);
  }
  return {registro,conflitos};
}
function resolverPendenciaLocal(op, baseConfirmada, escolhas = {}) {
  atualizarFila();
  const escolhida = S.fila.find(f => f.op === op);
  if (!escolhida) throw new Error('Essa versão já foi atualizada. Abra Pendências novamente.');
  if(escolhida.colecao==='orc'&&temDiarioOrc())return resolverPendenciaOrcamentoDuravel(op,baseConfirmada,escolhas);
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
  let registro = Object.assign({}, escolhida.registro);
  if (escolhida.colecao === 'orc' && baseConfirmada !== undefined) {
    const resultado = consolidarPendenciaOrcamento(op, baseConfirmada, escolhas);
    if (resultado.conflitos.length) throw new Error('Há alterações no mesmo campo. Escolha cada conflito antes de reenviar.');
    registro = resultado.registro;
  }
  if (baseConfirmada !== undefined) {
    registro._baseExistente = !!baseConfirmada;
    registro._baseRevisao = baseConfirmada && baseConfirmada._revisao || null;
    registro._baseAtualizadoEm = baseConfirmada && baseConfirmada.atualizadoEm || null;
  }
  return salvar(escolhida.colecao, registro, { substitui: versoes.map(f => f.op), ...(escolhida.colecao === 'orc' ? {baseRegistro:baseConfirmada} : {}) });
}
async function resolverPendenciaOrcamentoDuravel(op,baseConfirmada,escolhas) {
  const dono=donoFila();await carregarDiarioOrcamento(dono);
  if(donoFila()!==dono)throw new Error('A sessão mudou. Abra as pendências novamente.');
  const escolhida=S.fila.find(f=>f.op===op);if(!escolhida)throw new Error('Essa versão já foi atualizada. Abra Pendências novamente.');
  const versoes=S.fila.filter(f=>f.colecao==='orc'&&f.registro.id===escolhida.registro.id);
  const resultado=consolidarPendenciaOrcamento(op,baseConfirmada,escolhas);
  if(resultado.conflitos.length)throw new Error('Há alterações no mesmo campo. Escolha cada conflito antes de reenviar.');
  await transacaoDiarioOrc(dono,(_mapa,put)=>{
    for(const f of versoes)put(PREFIXO_RECUPERACAO+f.op,'versao',f);
    if(baseConfirmada){const opServidor='servidor-'+op+'-'+impressaoLocal(JSON.stringify(baseConfirmada));put(PREFIXO_RECUPERACAO+opServidor,'versao',{op:opServidor,dono,colecao:'orc',origem:'servidor',em:new Date().toISOString(),registro:baseConfirmada});}
  });
  if(donoFila()!==dono)throw new Error('A sessão mudou. As versões foram preservadas no acesso anterior.');
  const registro={...resultado.registro,_baseExistente:!!baseConfirmada,_baseRevisao:baseConfirmada?._revisao||null,_baseAtualizadoEm:baseConfirmada?.atualizadoEm||null};
  return salvarOrcamento(registro,{substitui:versoes.map(f=>f.op),baseRegistro:baseConfirmada});
}

/* Contagem de fotos ainda guardadas no aparelho, para a tela poder dizer. */
async function fotosAindaNoAparelho() {
  try { const itens = (await filaArqListar()) || []; S.arquivosPendentes = itens.filter(x => !x.dono || x.dono === donoFila()); S.fotosPendentes = S.arquivosPendentes.length; return S.fotosPendentes; }
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
  if (_subindo || !S.senhaHash) return false;
  _subindo = true;
  const dono=donoFila();
  try {
    if(temDiarioOrc())await conferirDiarioParaEnvio(dono);
    if(donoFila()!==dono)return false;
    atualizarFila();
    if (!navigator.onLine && !S.fila.some(f=>f.confirmado)) return false;
    // Web Locks serializa envios entre abas. O diário por operação garante
    // durabilidade mesmo nos navegadores sem essa API.
    if (navigator.locks) return await navigator.locks.request('domo-envio-' + donoFila(), enviarFilaDuravel);
    return await enviarFilaDuravel();
  } catch(e) {if(donoFila()===dono)S.erroSync=e.message||'Não foi possível ler o diário local.';return false;
  } finally { _subindo = false; document.dispatchEvent(new CustomEvent('domo:status')); }
}
async function enviarFilaDuravel() {
  const donoInicial=donoFila();
  try { migrarFilaAntiga(); } catch { S.erroFila = 'Migração de pendências incompleta: os dados originais foram preservados.'; }
  let diarioDisponivel=!temDiarioOrc()||await conferirDiarioParaEnvio(donoInicial);
  if(donoFila()!==donoInicial)return false;
  if(diarioDisponivel&&temDiarioOrc()){
    try{diarioDisponivel=await reconciliarEnviosOrc(donoInicial);}catch(e){if(donoFila()===donoInicial)S.erroSync='Confirmação do orçamento pendente: '+e.message;diarioDisponivel=false;}
  }
  if(donoFila()!==donoInicial)return false;
  atualizarFila();
  if (S.erroFila && S.erroFila!==ERRO_DIARIO_ORC) return false;
  // Um ACK já é definitivo. Depois de falha de cache, falta somente concluir
  // sua cópia local; reenviar a versão pré-carimbo pode violar o histórico.
  const aguardandoCopia = S.fila.filter(f=>f.confirmado&&(diarioDisponivel||f.colecao!=='orc'));
  if (aguardandoCopia.length) {
    const donoCopia=donoFila();
    for (const f of aguardandoCopia) {
      if (S.fila.some(x=>!x.confirmado&&x.colecao===f.colecao&&x.registro.id===f.registro.id)) continue;
      const arr=S.reg[f.colecao] || (S.reg[f.colecao]=[]),i=arr.findIndex(x=>x.id===f.registro.id);
      if (f.confirmadoSemLeitura) { if(i>=0)arr.splice(i,1); }
      else {
        const r={...limparParaEnvio(f.registro),_col:f.colecao};
        if(i>=0)arr[i]=r;else arr.unshift(r);
      }
    }
    const copiaConcluida=await gravarCache();
    if (donoFila()!==donoCopia) return false;
    if (!copiaConcluida) {
      S.erroSync='Envio confirmado; falta concluir a cópia offline. O registro canônico permanece neste aparelho.';
      restaurarPendencias();return false;
    }
    await removerOperacoes(aguardandoCopia);
    restaurarPendencias();S.erroSync='';
  }
  if (!navigator.onLine) return !S.fila.length;
  const contagem = new Map();
  for (const f of S.fila) { const k = f.colecao + '|' + f.registro.id; contagem.set(k, (contagem.get(k) || 0) + 1); }
  let enviando = S.fila.filter(f => !f.recusado && (diarioDisponivel||f.colecao!=='orc') && contagem.get(f.colecao + '|' + f.registro.id) === 1).slice(0, 25);
  if (!enviando.length) return diarioDisponivel&&!S.fila.length;
  const dono = donoFila();
  try {
    if(temDiarioOrc()){
      try{await registrarEnviosOrc(enviando.filter(f=>f.colecao==='orc'),dono);}
      catch(e){S.erroSync=e.message||'Não foi possível preservar a tentativa de envio do orçamento.';enviando=enviando.filter(f=>f.colecao!=='orc');if(!enviando.length)return false;}
      if(donoFila()!==dono)return false;
    }
    const r = await api('salvarLote', { protocoloEnvio: 2, itens: enviando.map(f => ({ colecao: f.colecao, registro: {...limparParaEnvio(f.registro),...(f.colecao==='orc'&&temDiarioOrc()?{_operacaoEnvio:f.op}:{})} })) });
    const recusas = new Map((r.recusados || []).map(x => [x.colecao + '|' + x.id, x]));
    const salvos = new Map((r.salvos || []).map(x => [x._col + '|' + x.id, x]));
    const confirmados = new Map([...salvos].map(([k, x]) => [k, x]));
    for (const x of (r.confirmados || [])) confirmados.set(x.colecao + '|' + x.id, x);
    let incompleto = false;
    const operacoesConfirmadas = new Set();
    for (const f of enviando) {
      // Se foi substituída em outra aba durante o envio, seu sucessor permanece.
      const recusa = recusas.get(f.colecao + '|' + f.registro.id);
      if (recusa) { f.recusado = recusa.motivo || 'Recusado pelo servidor'; await persistirOperacao(f,true); }
      else if (confirmados.has(f.colecao + '|' + f.registro.id)) {
        const confirmado = confirmados.get(f.colecao + '|' + f.registro.id);
        if(f.colecao==='orc'&&temDiarioOrc()){
          await confirmarOperacaoOrc(f,confirmado,salvos.get(f.colecao+'|'+f.registro.id));
          operacoesConfirmadas.add(f.op);continue;
        }
        atualizarFila();
        for (const proxima of S.fila) {
          if (!(proxima.ancestrais || []).includes(f.op) || proxima.registro._baseRevisao !== f.registro._baseRevisao || proxima.registro._baseAtualizadoEm !== f.registro._baseAtualizadoEm) continue;
          const salvo = salvos.get(f.colecao + '|' + f.registro.id);
          if (proxima.colecao === 'orc' && salvo) {
            const canonico = consolidarEdicaoOrcamento(f.registro,proxima.registro,salvo);
            if (canonico.conflitos.length) {
              proxima.recusado='O servidor confirmou a versão anterior, mas há campos que precisam de conferência antes do próximo envio.';
              gravarOperacao(proxima);continue;
            }
            // Campos operacionais pertencem ao sucessor; o conteúdo do prefixo
            // vem do ACK canônico, inclusive autoria e horário do servidor.
            proxima.registro={...canonico.registro,_opLocal:proxima.op,_pendente:true,_recusado:null};
            proxima.baseRegistro=structuredClone(salvo);
          }
          proxima.registro._baseExistente = true; proxima.registro._baseRevisao = confirmado._revisao || null; proxima.registro._baseAtualizadoEm = confirmado.atualizadoEm || null;
          gravarOperacao(proxima);
        }
        if (localStorage.getItem(chaveOperacao(f.op))) {
          const salvo=salvos.get(f.colecao+'|'+f.registro.id);
          const canonico=salvo || {id:f.registro.id};
          // Troca atômica por sua resposta oficial antes de depender do cache.
          // A base anterior deixa de ser necessária para uma operação concluída.
          gravarOperacao({...f,confirmado:true,confirmadoSemLeitura:!salvo,recusado:null,baseRegistro:undefined,
            registro:{...canonico,_baseExistente:true,_baseRevisao:confirmado._revisao || null,_baseAtualizadoEm:confirmado.atualizadoEm || null}});
        }
        operacoesConfirmadas.add(f.op);
      }
      else incompleto = true; // HTTP 200 sozinho não confirma cada registro.
    }
    if (donoFila() !== dono) return false; // logout/troca de sessão durante o request
    atualizarFila();
    S.fila = S.fila.filter(f => !operacoesConfirmadas.has(f.op));
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
    // O ACK remoto não substitui a cópia offline: só retira o diário depois
    // que o snapshot completo foi confirmado pela transação do IndexedDB.
    const envioIncompleto = incompleto;
    const copiaConfirmada = await gravarCache();
    if (copiaConfirmada) {
      await removerOperacoes(enviando.filter(f=>operacoesConfirmadas.has(f.op)));
    } else incompleto = true;
    if (donoFila() !== dono) return false;
    restaurarPendencias();
    S.erroSync = envioIncompleto ? 'O servidor não confirmou todos os itens. As pendências continuam neste aparelho.'
      : incompleto ? 'Envio confirmado; falta concluir a cópia offline. O lançamento continua preservado neste aparelho.' : '';
    if (recusas.size) document.dispatchEvent(new CustomEvent('domo:sempermissao', { detail: { qtd: recusas.size, msg: [...recusas.values()][0].motivo, itens: [...recusas.values()] } }));
    document.dispatchEvent(new CustomEvent('domo:dados'));
    if (!incompleto && S.fila.some(f => !f.recusado && contagem.get(f.colecao + '|' + f.registro.id) === 1)) setTimeout(subirFila, 300);
    return !incompleto && !S.fila.length;
  } catch (e) {
    if (donoFila() === dono) S.erroSync = e.message || 'Falha ao enviar';
    if (e.semSenha && donoFila() === dono) document.dispatchEvent(new CustomEvent('domo:semsenha'));
    // A recusa do lote também permanece recuperável, nunca some da fila.
    if (e.semPermissao) for (const f of enviando) { f.recusado = e.message || 'Sem permissão'; await persistirOperacao(f,true); }
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
    await gravarCache();
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
async function enviarArquivo(file, onProgresso, cancelar, opts = {}) {
  const partes = Math.max(1, Math.ceil(file.size / TAM_PARTE));
  const dono = donoFila();
  const sessao = { senhaHash: S.senhaHash, quem: S.quem };
  const conferirSessao = () => { if (!dono || donoFila() !== dono) { const e = new Error('A sessão mudou. O arquivo continua guardado no aparelho.'); e.status = 401; throw e; } };
  conferirSessao();
  let ini;
  if (opts.uploadId) {
    const estado = await apiArq('estadoEnvio',{id:opts.uploadId},{sessao});
    conferirSessao();
    if (estado.meta?.pronto) return estado.meta;
    ini = {id:opts.uploadId,meta:estado.meta};
  } else ini = await apiArq('iniciar', {
    nome: file.name, mime: file.type || 'application/octet-stream', tamanho: file.size, partes,
    ...(opts.vinculoPendente ? {vinculoPendente:opts.vinculoPendente} : {})
  }, { sessao });
  conferirSessao();
  if (opts.onIniciado) await opts.onIniciado(ini.id);
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
  conferirSessao();
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

const progressoArquivos = new Map();
async function anexarArquivoDuravel({file, colecao, registroId, onProgresso}) {
  const dono = donoFila(), registro = achar(colecao, registroId);
  if (!dono || !registro || registro.apagadoEm) throw new Error('Abra um registro válido antes de anexar.');
  if (colecao !== 'orc' || !['direcao','escritorio'].includes(S.perfil)) throw new Error('Seu acesso não permite anexar a este orçamento.');
  if (!file || !file.size) throw new Error('Selecione um arquivo com conteúdo.');
  const item = {id:'fa-'+novaOperacao(), tipo:'anexo', dono, blob:file, nome:file.name, mime:file.type,
    em:new Date().toISOString(), colecao, registroId};
  await filaArqGravar(item); // Nenhuma chamada remota antes de confirmar o Blob.
  const progresso = {onProgresso,arquivoId:null};
  progressoArquivos.set(item.id,progresso);
  await fotosAindaNoAparelho();
  document.dispatchEvent(new CustomEvent('domo:status'));
  if (donoFila() === dono) await subirArquivosPendentes();
  const restante = ((await filaArqListar()) || []).find(x=>x.id===item.id);
  if (!restante) progressoArquivos.delete(item.id);
  return {pendente:!!restante,arquivoId:restante?.arquivoId || progresso.arquivoId,filaId:item.id};
}

async function enviarAnexoDuravel(item, dono) {
  let reg = achar(item.colecao,item.registroId);
  if (!reg || reg.apagadoEm) throw new Error('O orçamento ainda não está disponível para vincular o arquivo.');
  await subirFila(); // Um orçamento novo precisa existir antes da reserva do upload.
  if (donoFila() !== dono) return;
  if (item.arquivoId) {
    try { await apiArq('estadoEnvio',{id:item.arquivoId}); }
    catch (e) {
      if (e.status !== 404) throw e;
      item.arquivoAnteriorId = item.arquivoId;
      delete item.arquivoId; delete item.meta; delete item.uploadId;
      await filaArqGravar(item);
    }
  }
  if (!item.arquivoId) {
    if (item.uploadId) {
      try { await apiArq('estadoEnvio',{id:item.uploadId}); }
      catch (e) { if(e.status!==404)throw e;delete item.uploadId;await filaArqGravar(item); }
    }
    const meta = await enviarArquivo(new File([item.blob],item.nome,{type:item.mime || 'application/octet-stream'}),progressoArquivos.get(item.id)?.onProgresso,null,{
      vinculoPendente:{colecao:item.colecao,registroId:item.registroId},uploadId:item.uploadId,
      onIniciado:async id=>{item.uploadId=id;await filaArqGravar(item);}
    });
    item.arquivoId=meta.id;item.meta={id:meta.id,arquivoId:meta.id,nome:item.nome,mime:meta.mime || item.mime,tamanho:meta.tamanho || item.blob.size};
    if (progressoArquivos.has(item.id)) progressoArquivos.get(item.id).arquivoId=meta.id;
    await filaArqGravar(item);
  }
  if (donoFila() !== dono) return;
  reg = achar(item.colecao,item.registroId);
  if (!reg || reg.apagadoEm) throw new Error('O orçamento não está disponível. O arquivo permanece guardado.');
  if (!(reg.anexos || []).some(a=>a.arquivoId===item.arquivoId)) {
    const copia = {...reg,anexos:[...(reg.anexos || []).filter(a=>a.arquivoId!==item.arquivoAnteriorId),item.meta]};
    await salvarOrcamento(copia,{semSubir:true,baseRegistro:reg});
  }
  await subirFila(); atualizarFila();
  reg = achar(item.colecao,item.registroId);
  const pendente = S.fila.some(f=>f.colecao===item.colecao&&f.registro.id===item.registroId);
  if (donoFila() === dono && !pendente && reg && (reg.anexos || []).some(a=>a.arquivoId===item.arquivoId)) {
    await filaArqApagar(item.id);progressoArquivos.delete(item.id);
  } else S.erroArquivos='Arquivo guardado no aparelho; aguardando confirmação do vínculo no servidor.';
}

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
      delete item.erro;
      if (item.tipo === 'anexo') { await enviarAnexoDuravel(item,dono); continue; }
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
        await salvar(item.colecao, copia, { semSubir: true });
      }
      await subirFila();
      atualizarFila();
      reg = achar(item.colecao, item.registroId);
      sub = reg && (reg[item.subLista] || []).find(x => x.id === item.subId);
      const aguardando = S.fila.some(f => f.colecao === item.colecao && f.registro.id === item.registroId);
      if (!aguardando && sub && (sub[item.campo] || []).includes(item.arquivoId)) await filaArqApagar(item.id);
      else S.erroArquivos = 'Foto guardada no aparelho; aguardando confirmação do vínculo no servidor.';
    } catch (e) {
      item.erro=e.message || 'envio pendente';
      try { await filaArqGravar(item); } catch { /* o Blob anterior continua preservado */ }
      S.erroArquivos = 'Arquivo preservado no aparelho: ' + item.erro; break;
    }
  }
}

/* ── Rede ──────────────────────────────────────────────────────────────────── */
const canalDiarioOrc=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('domo-orcamento-diario'):null;
function avisarDiarioOrc(){canalDiarioOrc?.postMessage({dono:donoFila()});}
if(canalDiarioOrc)canalDiarioOrc.onmessage=async e=>{
  const dono=donoFila();if(!dono||e.data?.dono!==dono)return;
  try{await carregarDiarioOrcamento(dono);if(donoFila()!==dono)return;restaurarPendencias();document.dispatchEvent(new CustomEvent('domo:status'));document.dispatchEvent(new CustomEvent('domo:dados'));}catch{/* preserva as cópias e tenta na próxima sincronização */}
};
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
