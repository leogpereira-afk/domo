// Netlify Function — endpoint /.netlify/functions/nucleo
// Backend do sistema de gestão da Domo Construtora.
// Armazenamento: Netlify Blobs (stores: "domo", "cfg", "seq", "log", "backup").
//
// Duas camadas de autenticação:
//   1. TOKEN (header x-token) — barra robô/curioso. Viaja no navegador, é leve.
//   2. SENHA do painel (header x-senha = sha256 da senha digitada) — conferida
//      aqui no servidor contra cfg.senhaHash. É ela que protege os dados.
// Ações públicas (só exigem o TOKEN): cfgPublico, novaSolicitacao, andamento
// e verPublico — são as telas que a obra e o fornecedor abrem sem senha
// nenhuma. Nelas nunca sai preço, valor de ordem nem telefone de terceiro.

import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

import { COLECOES } from './lib/colecoes.mjs';
import {
  PERFIS, ACOES_DIRECAO, identificar, cfgSemSegredo, podeFazer,
  motivoRecusa, filtrarLeitura, hashGuardado, perfilDe
} from './lib/acesso.mjs';

// Leitura FORTE (consistency: 'strong'). Sem isso, o Blobs devolve leitura
// eventual: um registro recém-gravado volta como inexistente por mais de 5s
// (medido no ar em 28/07/2026 — quem pedia material não conseguia consultar o
// próprio pedido logo depois). Só funciona em Function v2 (ESM, export default);
// na runtime antiga (exports.handler + connectLambda) a leitura forte dá erro.
function blobStore(name) {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token, consistency: 'strong' });
  return getStore({ name, consistency: 'strong' });
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const agora = () => new Date().toISOString();
const idNovo = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const tokenCurto = () => crypto.randomBytes(9).toString('base64url');

function resp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// ── Configuração ─────────────────────────────────────────────────────────────
const CFG_PADRAO = {
  empresa: {
    nome: 'DOMO INCORPORADORA E CONSTRUTORA LTDA',
    nomeCurto: 'Domo Construtora',
    cnpj: '',
    ie: '',
    endereco: '',
    telefone: '',
    email: ''
  },
  obras: [
    { id: 'diamond', nome: 'Edifício Diamond', endereco: '', ativa: true }
  ],
  setores: ['Fundação', 'Estrutura', 'Alvenaria', 'Instalações elétricas', 'Instalações hidráulicas',
            'Revestimento', 'Esquadrias', 'Pintura', 'Cobertura', 'Administrativo', 'Ferramentas/EPI', 'Outros'],
  unidades: ['un', 'pç', 'm', 'm²', 'm³', 'kg', 'sc', 'L', 'cx', 'rolo', 'barra', 'vb'],
  disciplinas: ['Arquitetônico', 'Estrutural', 'Elétrico', 'Hidrossanitário', 'Incêndio', 'Climatização',
                'Gás', 'Impermeabilização', 'Terraplanagem', 'Executivo', 'As built', 'Outros'],
  tiposDoc: ['CNPJ', 'Contrato Social', 'Alvará', 'CND Federal', 'CND Estadual', 'CND Municipal',
             'CND FGTS', 'CND Trabalhista', 'ART/RRT', 'Licença Ambiental', 'Seguro', 'Habite-se',
             'Matrícula', 'Certificado Digital', 'Outros'],
  assinaturas: {
    diretor: { nome: 'ALESSANDRO GONÇALVES', cargo: 'Diretor de Engenharia', crea: 'CREA-MG 150.950/D' },
    engenheiro: { nome: '', cargo: 'Engenheiro Civil', crea: '' }
  },
  clausulasOC: [
    'Esta Ordem de Compra tem força de contrato de aquisição, sendo regida pela legislação civil e comercial vigente.',
    'O fornecedor deverá emitir Nota Fiscal correspondente ao valor integral desta OC, com os dados fiscais do contratante.',
    'A entrega fora do prazo estabelecido sujeitará o fornecedor a multa de 0,5% ao dia sobre o valor dos materiais não entregues.',
    'Materiais entregues em desacordo com as especificações serão rejeitados e devolvidos às custas do fornecedor.',
    'O pagamento será liberado após recebimento, conferência e aceite formal dos materiais pelo Engenheiro da Obra.',
    'A presente OC somente produz efeitos após assinatura de ambas as partes e é válida pelo prazo indicado no campo Validade da Proposta.'
  ],
  senhaHash: null,
  // Acessos individuais da equipe. Cada um: {id, nome, cargo, telefone, perfil,
  // hash, ativo, criadoEm, ultimoAcesso}. O hash NUNCA sai daqui para o
  // navegador — é removido em toda resposta.
  usuarios: [],
  atualizadoEm: null
};


async function lerCfg() {
  let salvo = null;
  try { salvo = await blobStore('cfg').get('cfg', { type: 'json' }); } catch { salvo = null; }
  return Object.assign({}, CFG_PADRAO, salvo || {});
}

async function registrarLog(entrada) {
  try {
    const key = 'log_' + agora() + '_' + Math.random().toString(36).slice(2, 6);
    await blobStore('log').setJSON(key, Object.assign({ em: agora() }, entrada));
  } catch (e) {
    console.warn('[api] log falhou:', e && e.message);
  }
}

// ── Numeração sequencial sem duplicata ───────────────────────────────────────
// Reivindica uma CHAVE POR NÚMERO com onlyIfNew (atômico de verdade no Blobs
// v10). Contador "lê, soma 1, grava" duplica na prática — não usar.
async function numerar(col) {
  const s = blobStore('seq');
  let n = 1;
  try {
    const u = await s.get('ultimo_' + col, { type: 'json' });
    if (u && u.n) n = u.n + 1;
  } catch { /* começa do 1 */ }
  for (let i = 0; i < 500; i++) {
    let r = null;
    try { r = await s.set('num_' + col + '_' + n, '1', { onlyIfNew: true }); } catch { r = null; }
    if (r && r.modified) {
      try { await s.setJSON('ultimo_' + col, { n }); } catch { /* só acelera a próxima numeração */ }
      return n;
    }
    n++;
  }
  throw new Error('Não consegui gerar o número de ' + col);
}

// ── Leitura das coleções ─────────────────────────────────────────────────────
async function lerTudo(cols) {
  const store = blobStore('domo');
  let chaves = [];
  try {
    const r = await store.list();
    chaves = (r && r.blobs ? r.blobs : []).map((b) => b.key);
  } catch (e) {
    console.warn('[api] list falhou:', e && e.message);
  }
  const alvo = chaves.filter((k) => {
    const col = k.split('_')[0];
    return COLECOES[col] && (!cols || cols.includes(col));
  });
  const saida = [];
  const LOTE = 24;
  for (let i = 0; i < alvo.length; i += LOTE) {
    const parte = await Promise.all(alvo.slice(i, i + LOTE).map(async (k) => {
      try {
        const o = await store.get(k, { type: 'json' });
        if (o) o._col = k.split('_')[0];
        return o;
      } catch { return null; }
    }));
    for (const o of parte) if (o) saida.push(o);
  }
  return saida;
}

async function lerUm(col, id) {
  try { return await blobStore('domo').get(col + '_' + id, { type: 'json' }); } catch { return null; }
}

// Une arrays de histórico/anexos por id para dois aparelhos não apagarem
// o que o outro acabou de acrescentar (última escrita vence no resto).
function unirPorId(antigo, novo) {
  const a = Array.isArray(antigo) ? antigo : [];
  const b = Array.isArray(novo) ? novo : [];
  const vistos = new Map();
  for (const it of a.concat(b)) {
    if (!it) continue;
    const k = it.id || (it.em || '') + '|' + (it.o_que || it.texto || '');
    const anterior = vistos.get(k) || {};
    const unido = Object.assign({}, anterior, it);
    // As listas de dentro (remessas, entregas) e o objeto de preços também
    // são de dois donos: o fornecedor escreve pelo link enquanto o escritório
    // mexe na mesma etapa pela tela.
    for (const sub of SUBLISTAS_UNIAO) {
      if (Array.isArray(anterior[sub]) || Array.isArray(it[sub])) unido[sub] = unirPorId(anterior[sub], it[sub]);
    }
    for (const sub of SUBOBJETOS_UNIAO) {
      if (anterior[sub] || it[sub]) unido[sub] = Object.assign({}, anterior[sub] || {}, it[sub] || {});
    }
    vistos.set(k, unido);
  }
  return Array.from(vistos.values());
}

// Arrays que dois aparelhos podem alimentar ao mesmo tempo: são UNIDOS por id
// em vez de sobrescritos (medição, diário, documentos e equipe do prestador).
// Listas em que os dois lados TÊM RAZÃO ao mesmo tempo: em vez de o último a
// gravar apagar o do outro, o servidor junta item a item pelo id.
// 'etapas'/'responsaveis' entraram depois da fusão do cronograma: como todos os
// fornecedores da obra passaram a morar num registro só, o celular do
// almoxarife subindo uma cópia velha apagava as confirmações que o concreteiro
// tinha acabado de mandar pelo link.
const CAMPOS_UNIAO = ['historico', 'recebimentos', 'cotacoes', 'anexos', 'medicoes', 'versoes',
                      'diario', 'documentos', 'equipe', 'avaliacoes', 'aditivos', 'adiantamentos',
                      'etapas', 'responsaveis', 'fornecedores'];

// Dentro de cada item unido, estas listas também se juntam em vez de se
// sobrepor (as remessas e as entregas que o fornecedor informa moram DENTRO da
// etapa; os preços moram DENTRO do fornecedor convidado).
const SUBLISTAS_UNIAO = ['remessas', 'entregas', 'itens_recebidos'];
const SUBOBJETOS_UNIAO = ['precos'];

// Todos os arquivos guardados no store 'arq' que pertencem a este registro:
// projeto/documento (com as revisões antigas) e as fotos de recebimento.
function arquivosDoRegistro(o) {
  const ids = [];
  if (o.arquivoId) ids.push(o.arquivoId);
  for (const v of (o.versoes || [])) if (v && v.arquivoId) ids.push(v.arquivoId);
  for (const r of (o.recebimentos || [])) for (const f of (r.fotos || [])) if (f) ids.push(f);
  for (const d of (o.diario || [])) for (const f of (d.fotos || [])) if (f) ids.push(f);
  for (const d of (o.documentos || [])) if (d && d.arquivoId) ids.push(d.arquivoId);
  return Array.from(new Set(ids));
}

async function gravar(col, registro, por) {
  if (!COLECOES[col]) throw new Error('Coleção desconhecida: ' + col);
  const store = blobStore('domo');
  const id = registro.id || idNovo();
  const antigo = await lerUm(col, id);
  const novo = Object.assign({}, antigo || {}, registro, { id });

  for (const campo of CAMPOS_UNIAO) {
    if (antigo && (antigo[campo] || registro[campo])) novo[campo] = unirPorId(antigo[campo], registro[campo]);
  }

  // A situação de uma ordem de compra é DECIDIDA AQUI, depois de juntar os
  // recebimentos dos dois aparelhos. Cada celular só enxerga os recebimentos
  // que ele mesmo conhece: se o almoxarife registra 40 e o engenheiro 80 de um
  // pedido de 120, nenhum dos dois via "entregue" — a conta agora é do servidor.
  // A situação que MANDA é a guardada, não a que veio do navegador: um modal
  // de recebimento aberto há dez minutos trazia o retrato velho e ressuscitava
  // uma compra que o escritório tinha acabado de cancelar.
  const situacaoValida = (antigo && antigo.situacao) || novo.situacao;
  if (antigo && antigo.situacao === 'cancelada') novo.situacao = 'cancelada';
  if (col === 'oc' && Array.isArray(novo.recebimentos) && novo.recebimentos.length &&
      !['cancelada', 'rascunho'].includes(situacaoValida)) {
    const recebidoDoItem = (itemId) => novo.recebimentos.reduce((s, r) => {
      const achado = (r.itens || []).find((i) => i.itemId === itemId);
      return s + ((achado && Number(achado.qtd)) || 0);
    }, 0);
    const completo = (novo.itens || []).length > 0 &&
      (novo.itens || []).every((i) => recebidoDoItem(i.id) + 0.001 >= (Number(i.qtd) || 0));
    // 'entregue' manual (encerrar mesmo com falta) não é rebaixado para parcial.
    if (completo) novo.situacao = 'entregue';
    else if (novo.situacao !== 'entregue') novo.situacao = 'parcial';

    // Quem decidiu que chegou tudo foi o servidor — então é ele que fecha as
    // solicitações ligadas. O navegador sozinho não enxerga os recebimentos do
    // outro aparelho e deixaria a solicitação presa em "em compra".
    if (novo.situacao === 'entregue' && (!antigo || antigo.situacao !== 'entregue')) {
      for (const sid of (novo.scIds || [])) {
        try {
          const sc = await lerUm('sc', sid);
          if (!sc || sc.situacao === 'atendida' || sc.apagadoEm) continue;
          // Só fecha quando TODAS as ordens daquela solicitação chegaram. Um
          // pedido dividido em duas compras virava "atendida" na primeira
          // entrega e o resto do material sumia do radar de todo mundo.
          let faltaAlguma = false;
          for (const oid of (sc.ocIds || [])) {
            if (oid === id) continue;
            const outra = await lerUm('oc', oid);
            if (!outra || outra.apagadoEm || outra.situacao === 'cancelada') continue;
            if (outra.situacao !== 'entregue') { faltaAlguma = true; break; }
          }
          if (faltaAlguma) continue;
          sc.situacao = 'atendida';
          sc.historico = unirPorId(sc.historico, [{
            id: idNovo(), em: agora(), por: por || '—',
            o_que: 'Material recebido na obra (' + (novo.codigo || '') + ')'
          }]);
          sc.atualizadoEm = agora();
          await store.setJSON('sc_' + sid, sc);
        } catch { /* fechar a solicitação não pode derrubar a gravação da ordem */ }
      }
    }
  }

  if (!novo.criadoEm) { novo.criadoEm = agora(); novo.criadoPor = por || registro.criadoPor || '—'; }
  novo.atualizadoEm = agora();
  novo.atualizadoPor = por || novo.atualizadoPor || '—';

  const pre = COLECOES[col].pre;
  if (pre && !novo.numero) {
    novo.numero = await numerar(col);
    novo.codigo = pre + '-' + String(novo.numero).padStart(4, '0');
    // Índice número → id. A LISTAGEM do Blobs demora ~1min a atualizar, mas o
    // get por chave é imediato: sem isso, quem acabou de pedir material não
    // consegue consultar o próprio pedido.
    // Precisa de await: a Function congela assim que responde e uma promessa
    // solta simplesmente não chega a gravar.
    try { await blobStore('seq').setJSON('idx_' + col + '_' + novo.numero, { id }); } catch { /* índice é atalho, não é crítico */ }
  }
  if (pre && !novo.codigo && novo.numero) novo.codigo = pre + '-' + String(novo.numero).padStart(4, '0');
  if ((col === 'oc' || col === 'os') && !novo.tokenPublico) novo.tokenPublico = tokenCurto();

  // Cada fornecedor convidado ganha um endereço próprio para responder — é o
  // link que vai no WhatsApp. Um token por convite: um fornecedor nunca vê a
  // resposta do outro.
  if (col === 'cot') {
    novo.fornecedores = (novo.fornecedores || []).map((f) =>
      f && !f.token ? Object.assign({}, f, { token: tokenCurto() }) : f);
  }
  // No cronograma o link é POR RESPONSÁVEL: um só endereço mostra todas as
  // etapas daquele fornecedor, e ele confirma data por data.
  if (col === 'crono') {
    novo.responsaveis = (novo.responsaveis || []).map((r) =>
      r && !r.token ? Object.assign({}, r, { token: tokenCurto() }) : r);
  }

  await store.setJSON(col + '_' + id, novo);
  novo._col = col;
  return novo;
}

// ── Limpeza do que vem de fora (solicitação pública) ─────────────────────────
const txt = (v, max) => String(v == null ? '' : v).slice(0, max || 200).trim();
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };

function limparSolicitacao(r) {
  const itens = (Array.isArray(r.itens) ? r.itens : []).slice(0, 40).map((it, i) => ({
    id: it.id || idNovo(),
    n: i + 1,
    descricao: txt(it.descricao, 300),
    unid: txt(it.unid, 10),
    qtd: num(it.qtd),
    obs: txt(it.obs, 200)
  })).filter((it) => it.descricao);
  return {
    obraId: txt(r.obraId, 40) || 'diamond',
    obra: txt(r.obra, 120),
    solicitante: {
      nome: txt(r.solicitante && r.solicitante.nome, 80),
      telefone: txt(r.solicitante && r.solicitante.telefone, 30),
      funcao: txt(r.solicitante && r.solicitante.funcao, 60)
    },
    setor: txt(r.setor, 60),
    urgencia: ['normal', 'urgente', 'critica'].includes(r.urgencia) ? r.urgencia : 'normal',
    necessidadeEm: txt(r.necessidadeEm, 10),
    justificativa: txt(r.justificativa, 800),
    itens,
    situacao: 'nova',
    origem: 'link público'
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return resp({ ok: true });
  if (req.method !== 'POST') return resp({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return resp({ error: 'JSON inválido' }, 400); }

  // Headers viram objeto com as chaves em minúsculas (h['x-token'] continua valendo).
  const h = Object.fromEntries(req.headers);
  const token = h['x-token'] || body.token;
  if (!process.env.TOKEN || token !== process.env.TOKEN) return resp({ error: 'Não autorizado' }, 401);

  const { action } = body;
  const cfg = await lerCfg();

  const senhaCliente = h['x-senha'] || body.senha || '';
  const esperado = hashGuardado(cfg);
  const quem = identificar(cfg, senhaCliente);
  const autenticado = !!quem;
  // Nome que vai para o histórico: se o acesso é próprio, o nome do cadastro
  // manda — assim ninguém assina no lugar de outro trocando o campo do login.
  const por = (quem && quem.proprio && quem.nome)
    || txt(h['x-quem'] ? decodeURIComponent(h['x-quem']) : (body.por || ''), 60) || '—';

  const PUBLICAS = ['ping', 'cfgPublico', 'entrar', 'novaSolicitacao', 'andamento', 'verPublico',
    'verCotacao', 'responderCotacao', 'verPrazos', 'responderPrazo',
    'relatarEntrega', 'sugerirEtapa'];
  if (!PUBLICAS.includes(action) && !autenticado) return resp({ error: 'Senha do painel inválida', semSenha: true }, 403);
  if (!PUBLICAS.includes(action) && !podeFazer(quem, action)) {
    await registrarLog({ acao: 'bloqueado: ' + action, por, perfil: quem.perfil });
    return resp({ error: 'Seu acesso não permite isso. Fale com a direção.', semPermissao: true }, 403);
  }

  try {
    switch (action) {

      // Não devolve se a senha bate: isso virava um oráculo para testar senha
      // em massa sem deixar rastro. Quem quer conferir a senha usa 'entrar'.
      case 'ping':
        return resp({ ok: true, runtime: 'v2' });

      // Dados que a tela pública precisa (formulário de solicitação).
      case 'cfgPublico':
        return resp({
          ok: true,
          empresa: { nome: cfg.empresa.nome, nomeCurto: cfg.empresa.nomeCurto },
          obras: (cfg.obras || []).filter((o) => o.ativa !== false).map((o) => ({ id: o.id, nome: o.nome })),
          setores: cfg.setores,
          unidades: cfg.unidades
        });

      case 'entrar': {
        if (!esperado) {
          return resp({ ok: false, error: 'Painel ainda não configurado: falta a variável PAINEL_SENHA no Netlify.' }, 503);
        }
        if (!autenticado) {
          await registrarLog({ acao: 'login negado', por });
          return resp({ ok: false, error: 'Senha incorreta' }, 403);
        }
        // Carimba o último acesso de quem tem acesso próprio (é assim que a
        // direção vê quem parou de usar e pode desligar).
        if (quem.proprio) {
          const usuarios = (cfg.usuarios || []).map((u) =>
            u.id === quem.id ? Object.assign({}, u, { ultimoAcesso: agora() }) : u);
          await blobStore('cfg').setJSON('cfg', Object.assign({}, cfg, { usuarios }));
        }
        await registrarLog({ acao: 'entrou', por, perfil: quem.perfil });
        return resp({
          ok: true,
          senhaPadrao: !quem.proprio && !cfg.senhaHash,
          proprio: quem.proprio,
          nome: quem.nome, cargo: quem.cargo, perfil: quem.perfil, usuarioId: quem.id
        });
      }

      // Tudo que o painel precisa numa requisição só.
      case 'snapshot': {
        const todos = await lerTudo(body.colecoes || null);
        // O celular da obra não leva preço nem contrato para casa: o cache
        // fica em texto no aparelho e sobrevive ao desligamento do acesso.
        const registros = filtrarLeitura(quem, todos);
        // A lista da equipe (nome, cargo, telefone) só interessa a quem
        // administra acesso — não precisa ficar guardada no celular de todos.
        const cfgSaida = cfgSemSegredo(cfg);
        if (perfilDe(quem) !== 'direcao') cfgSaida.usuarios = [];
        return resp({
          ok: true, cfg: cfgSaida, registros, em: agora(),
          eu: { id: quem.id, nome: quem.nome, perfil: quem.perfil, proprio: quem.proprio }
        });
      }

      // Grava vários registros de uma vez (um pedido só evita atropelo entre
      // gravações concorrentes no mesmo blob).
      // Recusa item a item, NUNCA o pacote inteiro: o almoxarife manda o
      // recebimento e a solicitação no mesmo lote, e barrar tudo por causa de
      // um item fazia o app descartar o recebimento junto — trabalho de uma
      // manhã inteira sumindo por causa de uma linha proibida.
      case 'salvarLote': {
        const itens = Array.isArray(body.itens) ? body.itens : [];
        if (!itens.length) return resp({ ok: true, salvos: [] });
        const salvos = [];
        const recusados = [];
        for (const it of itens) {
          if (!it || !it.colecao || !it.registro) continue;
          const atual = it.registro.id ? await lerUm(it.colecao, it.registro.id) : null;
          const motivo = motivoRecusa(quem, it.colecao, it.registro, atual);
          if (motivo) {
            recusados.push({ colecao: it.colecao, id: it.registro.id, motivo });
            continue;
          }
          salvos.push(await gravar(it.colecao, it.registro, por));
        }
        if (recusados.length) {
          await registrarLog({ acao: 'recusou gravação', por, perfil: perfilDe(quem),
            detalhe: recusados.map((r) => r.colecao + ':' + r.motivo).join(' | ') });
        }
        await registrarLog({ acao: 'salvou', por, qtd: salvos.length, cols: itens.map((i) => i.colecao).join(',') });
        return resp({ ok: true, salvos, recusados });
      }

      // Lixeira: marca apagadoEm em vez de sumir com o registro.
      case 'apagar': {
        const { colecao, id } = body;
        const r = await lerUm(colecao, id);
        if (!r) return resp({ ok: true });
        r.apagadoEm = agora();
        r.apagadoPor = por;
        await blobStore('domo').setJSON(colecao + '_' + id, r);
        await registrarLog({ acao: 'apagou', por, colecao, id, codigo: r.codigo || r.nome });
        return resp({ ok: true });
      }

      // Apaga DE VEZ tudo que está na lixeira (o botão em Configurações),
      // junto com os arquivos que só aquele registro usava — senão uma planta
      // de 60MB ficaria ocupando espaço para sempre depois de apagada.
      case 'esvaziarLixeira': {
        const store = blobStore('domo');
        const arq = blobStore('arq');
        const r = await store.list().catch(() => null);
        let apagados = 0, arquivos = 0;
        for (const b of (r && r.blobs ? r.blobs : [])) {
          if (!COLECOES[b.key.split('_')[0]]) continue;
          const o = await store.get(b.key, { type: 'json' }).catch(() => null);
          if (!o || !o.apagadoEm) continue;
          for (const idArq of arquivosDoRegistro(o)) {
            const meta = await arq.get(idArq + '_meta', { type: 'json' }).catch(() => null);
            for (let i = 0; i < ((meta && meta.partes) || 1); i++) await arq.delete(idArq + '_p' + i).catch(() => {});
            await arq.delete(idArq + '_meta').catch(() => {});
            arquivos++;
          }
          await store.delete(b.key).catch(() => {});
          apagados++;
        }
        await registrarLog({ acao: 'esvaziou a lixeira', por, qtd: apagados, arquivos });
        return resp({ ok: true, apagados, arquivos });
      }

      // Recomeça a numeração de uma coleção (ex.: virada de ano, ou depois de
      // limpar os testes). Solta as chaves já reivindicadas para poder repetir.
      case 'reiniciarNumeracao': {
        const col = body.colecao;
        if (!COLECOES[col] || !COLECOES[col].pre) return resp({ ok: false, error: 'Coleção sem numeração' }, 400);
        const proximo = Math.max(1, parseInt(body.proximo, 10) || 1);
        const s = blobStore('seq');
        const r = await s.list().catch(() => null);
        let soltas = 0;
        for (const b of (r && r.blobs ? r.blobs : [])) {
          if (b.key.startsWith('num_' + col + '_') || b.key.startsWith('idx_' + col + '_')) {
            const n = parseInt(b.key.split('_').pop(), 10);
            if (n >= proximo) { await s.delete(b.key).catch(() => {}); soltas++; }
          }
        }
        await s.setJSON('ultimo_' + col, { n: proximo - 1 });
        await registrarLog({ acao: 'reiniciou a numeração', por, colecao: col, proximo });
        return resp({ ok: true, proximo, soltas });
      }

      case 'restaurarItem': {
        const { colecao, id } = body;
        const r = await lerUm(colecao, id);
        if (!r) return resp({ ok: false, error: 'Não encontrado' }, 404);
        delete r.apagadoEm; delete r.apagadoPor;
        r.atualizadoEm = agora(); r.atualizadoPor = por;
        await blobStore('domo').setJSON(colecao + '_' + id, r);
        return resp({ ok: true, registro: r });
      }

      // ── PÚBLICO: a obra pede material sem senha ────────────────────────────
      case 'novaSolicitacao': {
        const limpo = limparSolicitacao(body.registro || {});
        if (!limpo.solicitante.nome) return resp({ ok: false, error: 'Informe seu nome' }, 400);
        if (!limpo.itens.length) return resp({ ok: false, error: 'Inclua pelo menos um item' }, 400);
        const quem = limpo.solicitante.nome;
        limpo.historico = [{ id: idNovo(), em: agora(), por: quem, o_que: 'Solicitação registrada pelo link da obra' }];
        const salvo = await gravar('sc', limpo, quem);
        await registrarLog({ acao: 'nova solicitação', por: quem, codigo: salvo.codigo, obra: salvo.obra });
        return resp({ ok: true, codigo: salvo.codigo, id: salvo.id, numero: salvo.numero });
      }

      // ── PÚBLICO: quadro de andamento da obra ──────────────────────────────
      // Basta o nome de quem está olhando: a pessoa vê TODOS os pedidos e o que
      // está por chegar (decisão do usuário em 29/07). O que NÃO sai daqui:
      // preço unitário, valor da ordem e telefone de quem pediu — isso é
      // informação comercial e dado pessoal de terceiro.
      case 'andamento': {
        // Sem exigir nome: quem abre o link é a obra e já quer ver o quadro.
        // Cache de 60s: sem ele, cada abertura varre a base inteira — e esta é
        // uma rota aberta, que pode ser chamada em rajada.
        const cacheStore = blobStore('cfg');
        const cache = await cacheStore.get('andamento_cache', { type: 'json' }).catch(() => null);
        if (cache && cache.em && (Date.now() - new Date(cache.em).getTime()) < 60000) {
          return resp({ ok: true, em: cache.em, pedidos: cache.pedidos, doCache: true });
        }

        const todos = await lerTudo(['sc', 'oc']);
        const ocs = todos.filter((x) => x._col === 'oc' && !x.apagadoEm);
        const porId = new Map(ocs.map((o) => [o.id, o]));
        const pedidos = todos
          .filter((x) => x._col === 'sc' && !x.apagadoEm)
          .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')))
          .slice(0, 150)
          .map((s) => ({
            codigo: s.codigo,
            situacao: s.situacao,
            obra: s.obra,
            setor: s.setor,
            urgencia: s.urgencia,
            quem: (s.solicitante && s.solicitante.nome) || '—',
            criadoEm: s.criadoEm,
            necessidadeEm: s.necessidadeEm,
            motivoRecusa: s.motivoRecusa,
            itens: (s.itens || []).map((i) => ({ descricao: i.descricao, qtd: i.qtd, unid: i.unid })),
            compras: (s.ocIds || []).map((id) => porId.get(id)).filter(Boolean).map((o) => ({
              codigo: o.codigo,
              situacao: o.situacao,
              fornecedor: (o.fornecedor && o.fornecedor.nome) || '',
              entregaPrevista: o.entregaPrevista,
              recebidoEm: o.recebidoEm
            })),
            historico: (s.historico || []).slice(-6).map((x) => ({ em: x.em, por: x.por, o_que: x.o_que }))
          }));

        const em = agora();
        try { await cacheStore.setJSON('andamento_cache', { em, pedidos }); } catch { /* sem cache, só fica mais lento */ }
        return resp({ ok: true, em, pedidos });
      }

      // ── PÚBLICO: fornecedor abre a OC/OS pelo link do WhatsApp ─────────────
      case 'verPublico': {
        const { tipo, id } = body;
        if (!['oc', 'os'].includes(tipo)) return resp({ ok: false, error: 'Tipo inválido' }, 400);
        const r = await lerUm(tipo, id);
        if (!r || r.apagadoEm) return resp({ ok: false, error: 'Documento não encontrado' }, 404);
        if (!r.tokenPublico || r.tokenPublico !== body.t) return resp({ ok: false, error: 'Link inválido' }, 403);
        if (r.situacao === 'rascunho') return resp({ ok: false, error: 'Documento ainda não emitido' }, 403);

        // LISTA BRANCA (nunca lista negra): só sai o que o documento precisa
        // mostrar. Lista negra sempre fica para trás quando um módulo novo
        // passa a guardar campo novo dentro do mesmo registro.
        const campos = tipo === 'oc'
          ? ['id', 'codigo', 'situacao', 'obra', 'dataEmissao', 'entregaPrevista', 'fornecedor',
             'localEntrega', 'prazoEntrega', 'validadeProposta', 'modalidade', 'condicaoPagamento',
             'formaPagamento', 'dadosBancarios', 'garantia', 'notaFiscalObrigatoria', 'itens',
             'ipiPerc', 'icmsPerc', 'frete', 'seguro', 'desconto', 'total', 'totalLiquido', 'observacoes']
          : ['id', 'codigo', 'situacao', 'obra', 'localizacao', 'contratoNumero', 'dataEmissao',
             'dataInicio', 'dataTerminoPrevista', 'empreiteiro', 'itens', 'total', 'observacoes'];
        const enxuto = {};
        for (const c of campos) if (r[c] !== undefined) enxuto[c] = r[c];

        const publico = { empresa: cfg.empresa, assinaturas: cfg.assinaturas, clausulasOC: cfg.clausulasOC };
        return resp({ ok: true, registro: enxuto, cfg: publico });
      }

      // ── PÚBLICO: o fornecedor abre a cotação pelo link do WhatsApp ─────────
      case 'verCotacao': {
        const c = await lerUm('cot', body.id);
        if (!c || c.apagadoEm) return resp({ ok: false, error: 'Cotação não encontrada' }, 404);
        const f = (c.fornecedores || []).find((x) => x.token && x.token === body.t);
        if (!f) return resp({ ok: false, error: 'Link inválido' }, 403);
        if (c.situacao === 'cancelada') return resp({ ok: false, error: 'Esta cotação foi cancelada' }, 403);
        // O fornecedor vê SÓ o que precisa: os itens e a resposta dele.
        // Nunca o preço nem o nome dos concorrentes.
        return resp({
          ok: true,
          empresa: { nome: cfg.empresa.nome, nomeCurto: cfg.empresa.nomeCurto },
          cotacao: {
            codigo: c.codigo, obra: c.obra, prazoResposta: c.prazoResposta,
            observacoes: c.observacoes, encerrada: c.situacao !== 'aberta',
            itens: (c.itens || []).map((i) => ({ id: i.id, descricao: i.descricao, unid: i.unid, qtd: i.qtd }))
          },
          minhaResposta: {
            nome: f.nome, contato: f.contato, precos: f.precos || {}, frete: f.frete,
            prazoEntrega: f.prazoEntrega, condicaoPagamento: f.condicaoPagamento,
            validade: f.validade, obs: f.obs, respondidoEm: f.respondidoEm
          }
        });
      }

      case 'responderCotacao': {
        const c = await lerUm('cot', body.id);
        if (!c || c.apagadoEm) return resp({ ok: false, error: 'Cotação não encontrada' }, 404);
        if (c.situacao !== 'aberta') return resp({ ok: false, error: 'Esta cotação já foi encerrada' }, 403);
        const i = (c.fornecedores || []).findIndex((x) => x.token && x.token === body.t);
        if (i < 0) return resp({ ok: false, error: 'Link inválido' }, 403);

        const precos = {};
        for (const it of (c.itens || [])) {
          const v = num((body.precos || {})[it.id]);
          if (v > 0) precos[it.id] = v;
        }
        if (!Object.keys(precos).length) return resp({ ok: false, error: 'Informe o preço de pelo menos um item' }, 400);

        const f = c.fornecedores[i];
        const total = (c.itens || []).reduce((s2, it) =>
          s2 + (precos[it.id] || 0) * (Number(it.qtd) || 0), 0) + num(body.frete);

        c.fornecedores[i] = Object.assign({}, f, {
          precos, frete: num(body.frete), total,
          prazoEntrega: txt(body.prazoEntrega, 60),
          condicaoPagamento: txt(body.condicaoPagamento, 60),
          validade: txt(body.validade, 40),
          obs: txt(body.obs, 500),
          contato: txt(body.contato, 80) || f.contato,
          respondidoEm: agora()
        });
        c.historico = unirPorId(c.historico, [{
          id: idNovo(), em: agora(), por: f.nome || 'fornecedor',
          o_que: 'Cotação respondida por ' + (f.nome || '—') + ': ' +
            total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        }]);
        c.atualizadoEm = agora();
        await blobStore('domo').setJSON('cot_' + c.id, c);
        return resp({ ok: true, total });
      }

      // ── PÚBLICO: o fornecedor vê as datas dele e diz se atende ────────────
      case 'verPrazos': {
        const c = await lerUm('crono', body.id);
        if (!c || c.apagadoEm) return resp({ ok: false, error: 'Cronograma não encontrado' }, 404);
        const r0 = (c.responsaveis || []).find((x) => x.token && x.token === body.t);
        if (!r0) return resp({ ok: false, error: 'Link inválido' }, 403);
        // Só as etapas DELE. Ninguém vê o cronograma inteiro da obra nem quem
        // mais está contratado.
        const minhas = (c.etapas || []).filter((e) => e.responsavelId === r0.id && !e.apagadoEm);
        return resp({
          ok: true,
          empresa: { nome: cfg.empresa.nome, nomeCurto: cfg.empresa.nomeCurto },
          cronograma: { codigo: c.codigo, nome: c.nome, obra: c.obra, encerrado: c.situacao !== 'ativo' },
          responsavel: { nome: r0.nome, contato: r0.contato },
          etapas: minhas.map((e) => ({
            id: e.id, nome: e.nome, inicio: e.inicio, fim: e.fim,
            qtd: e.qtd, unid: e.unid, obs: e.obs,
            resposta: e.resposta || null,
            remessas: e.remessas || [],
            entregas: (e.entregas || []).map((x) => ({ em: x.em, data: x.data, nf: x.nf, qtd: x.qtd, obs: x.obs })),
            concluida: !!e.concluidaEm,
            pendenteAprovacao: !!e.pendenteAprovacao,
            recusadaEm: e.recusadaEm || null
          }))
        });
      }

      case 'responderPrazo': {
        const c = await lerUm('crono', body.id);
        if (!c || c.apagadoEm) return resp({ ok: false, error: 'Cronograma não encontrado' }, 404);
        if (c.situacao !== 'ativo') return resp({ ok: false, error: 'Este cronograma foi encerrado' }, 403);
        const r0 = (c.responsaveis || []).find((x) => x.token && x.token === body.t);
        if (!r0) return resp({ ok: false, error: 'Link inválido' }, 403);
        const i = (c.etapas || []).findIndex((e) => e.id === body.etapaId && e.responsavelId === r0.id);
        if (i < 0) return resp({ ok: false, error: 'Etapa não encontrada' }, 404);

        const atende = body.atende === true || body.atende === 'sim';
        if (!atende && !txt(body.justificativa, 500)) {
          return resp({ ok: false, error: 'Diga por que não consegue atender' }, 400);
        }
        const e = c.etapas[i];

        // Programação do fornecedor: ferro e concreto chegam parcelados, então
        // ele detalha quantos caminhões e em que dias.
        const remessas = (Array.isArray(body.remessas) ? body.remessas : []).slice(0, 20)
          .map((x, n) => ({
            id: (x && x.id) || ('rm' + n + idNovo()),
            data: txt(x && x.data, 10),
            qtd: num(x && x.qtd),
            obs: txt(x && x.obs, 200)
          })).filter((x) => x.data || x.qtd);

        c.etapas[i] = Object.assign({}, e, {
          resposta: {
            em: agora(), por: txt(body.por, 80) || r0.nome,
            atende,
            novaData: txt(body.novaData, 10),
            justificativa: txt(body.justificativa, 500)
          }
        }, remessas.length ? { remessas } : {});
        c.historico = unirPorId(c.historico, [{
          id: idNovo(), em: agora(), por: r0.nome,
          o_que: (atende ? '✅ ' : '⛔ ') + r0.nome + (atende ? ' confirmou' : ' NÃO atende') +
            ' a etapa "' + (e.nome || '') + '"' +
            (!atende && body.novaData ? ' — propôs ' + body.novaData : '') +
            (body.justificativa ? ': ' + txt(body.justificativa, 200) : '')
        }]);
        c.atualizadoEm = agora();
        await blobStore('domo').setJSON('crono_' + c.id, c);
        return resp({ ok: true });
      }

      // ── PÚBLICO: o fornecedor relata o que já entregou ────────────────────
      case 'relatarEntrega': {
        const c = await lerUm('crono', body.id);
        if (!c || c.apagadoEm) return resp({ ok: false, error: 'Cronograma não encontrado' }, 404);
        if (c.situacao !== 'ativo') return resp({ ok: false, error: 'Este cronograma foi encerrado' }, 403);
        const r0 = (c.responsaveis || []).find((x) => x.token && x.token === body.t);
        if (!r0) return resp({ ok: false, error: 'Link inválido' }, 403);
        const i = (c.etapas || []).findIndex((e) => e.id === body.etapaId && e.responsavelId === r0.id);
        if (i < 0) return resp({ ok: false, error: 'Etapa não encontrada' }, 404);

        const rel = {
          id: idNovo(), em: agora(), por: txt(body.por, 80) || r0.nome,
          data: txt(body.data, 10), nf: txt(body.nf, 40), qtd: num(body.qtd),
          obs: txt(body.obs, 500),
          fotos: (Array.isArray(body.fotos) ? body.fotos : []).slice(0, 5).map((f) => txt(f, 60))
        };
        const e = c.etapas[i];
        c.etapas[i] = Object.assign({}, e, { entregas: unirPorId(e.entregas, [rel]) });
        c.historico = unirPorId(c.historico, [{
          id: idNovo(), em: agora(), por: r0.nome,
          o_que: '🚚 ' + r0.nome + ' informou entrega em "' + (e.nome || '') + '"' +
            (rel.qtd ? ' — ' + rel.qtd : '') + (rel.nf ? ' · NF ' + rel.nf : '')
        }]);
        c.atualizadoEm = agora();
        await blobStore('domo').setJSON('crono_' + c.id, c);
        return resp({ ok: true });
      }

      // ── PÚBLICO: o fornecedor sugere uma etapa ────────────────────────────
      case 'sugerirEtapa': {
        const c = await lerUm('crono', body.id);
        if (!c || c.apagadoEm) return resp({ ok: false, error: 'Cronograma não encontrado' }, 404);
        if (c.situacao !== 'ativo') return resp({ ok: false, error: 'Este cronograma foi encerrado' }, 403);
        const r0 = (c.responsaveis || []).find((x) => x.token && x.token === body.t);
        if (!r0) return resp({ ok: false, error: 'Link inválido' }, 403);
        const nome = txt(body.nome, 160);
        if (!nome) return resp({ ok: false, error: 'Escreva o que precisa acontecer' }, 400);
        // Sugestão NÃO entra no cronograma: entra como proposta esperando o
        // engenheiro aprovar. Quem manda na data da obra é a obra.
        const etapa = {
          id: idNovo(), nome, responsavelId: r0.id,
          inicio: txt(body.inicio, 10), fim: txt(body.fim, 10),
          qtd: num(body.qtd), unid: txt(body.unid, 10), obs: txt(body.obs, 500),
          sugeridaPor: r0.nome, sugeridaEm: agora(), pendenteAprovacao: true
        };
        c.etapas = [...(c.etapas || []), etapa];
        c.historico = unirPorId(c.historico, [{
          id: idNovo(), em: agora(), por: r0.nome,
          o_que: '💡 ' + r0.nome + ' sugeriu a etapa "' + nome + '"' +
            (etapa.inicio ? ' para ' + etapa.inicio : '') + ' — esperando sua aprovação'
        }]);
        c.atualizadoEm = agora();
        await blobStore('domo').setJSON('crono_' + c.id, c);
        return resp({ ok: true });
      }

      // ── Configurações ─────────────────────────────────────────────────────
      case 'salvarCfg': {
        const novo = Object.assign({}, cfg, body.cfg || {});
        novo.senhaHash = cfg.senhaHash;   // senha só muda pela ação própria
        novo.usuarios = cfg.usuarios || []; // idem os acessos: o cliente nem vê os hashes
        novo.atualizadoEm = agora();
        novo.atualizadoPor = por;
        await blobStore('cfg').setJSON('cfg', novo);
        await registrarLog({ acao: 'mudou configuração', por });
        return resp({ ok: true, cfg: cfgSemSegredo(novo) });
      }

      /* ── Acessos da equipe ────────────────────────────────────────────────
         Um acesso por pessoa: o histórico passa a dizer QUEM aprovou, e
         desligar alguém não obriga a trocar a senha de todo mundo. */
      case 'salvarUsuario': {
        const u = body.usuario || {};
        const nome = txt(u.nome, 60);
        if (!nome) return resp({ ok: false, error: 'Informe o nome' }, 400);
        const perfil = PERFIS[u.perfil] ? u.perfil : 'obra';
        const lista = cfg.usuarios || [];
        const existente = u.id ? lista.find((x) => x.id === u.id) : null;
        if (u.id && !existente) return resp({ ok: false, error: 'Acesso não encontrado' }, 404);

        // Hash novo só vem quando a direção define/troca a senha da pessoa.
        let hash = existente ? existente.hash : null;
        if (u.novaHash) {
          const nh = txt(u.novaHash, 128);
          if (nh.length < 32) return resp({ ok: false, error: 'Senha inválida' }, 400);
          hash = sha256(nh);
        }
        if (!hash) return resp({ ok: false, error: 'Defina uma senha para esta pessoa' }, 400);
        // Duas pessoas com a mesma senha se confundem no login (ele identifica
        // pelo hash). Melhor barrar na hora de criar do que descobrir depois.
        if ((hash === hashGuardado(cfg)) ||
            lista.some((x) => x.hash === hash && x.id !== (u.id || ''))) {
          return resp({ ok: false, error: 'Essa senha já está em uso por outro acesso. Escolha outra.' }, 400);
        }

        const registro = Object.assign({}, existente || {}, {
          id: u.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
          nome, cargo: txt(u.cargo, 60), telefone: txt(u.telefone, 30),
          perfil, hash, ativo: u.ativo !== false,
          criadoEm: (existente && existente.criadoEm) || agora(),
          atualizadoEm: agora(), atualizadoPor: por
        });
        const usuarios = existente
          ? lista.map((x) => x.id === registro.id ? registro : x)
          : [...lista, registro];
        await blobStore('cfg').setJSON('cfg', Object.assign({}, cfg, { usuarios, atualizadoEm: agora() }));
        await registrarLog({
          acao: existente ? 'alterou o acesso de ' + nome : 'criou acesso para ' + nome,
          por, perfil
        });
        return resp({ ok: true, cfg: cfgSemSegredo(Object.assign({}, cfg, { usuarios })) });
      }

      case 'apagarUsuario': {
        const id = txt(body.id, 40);
        const lista = cfg.usuarios || [];
        const alvo = lista.find((x) => x.id === id);
        if (!alvo) return resp({ ok: true });
        const usuarios = lista.filter((x) => x.id !== id);
        await blobStore('cfg').setJSON('cfg', Object.assign({}, cfg, { usuarios, atualizadoEm: agora() }));
        await registrarLog({ acao: 'removeu o acesso de ' + alvo.nome, por });
        return resp({ ok: true, cfg: cfgSemSegredo(Object.assign({}, cfg, { usuarios })) });
      }

      // A própria pessoa troca a senha dela (não precisa ser da direção).
      case 'minhaSenha': {
        if (!quem.proprio) {
          return resp({ ok: false, error: 'Você entrou com a senha da equipe. Troque em Configurações.' }, 400);
        }
        const nh = txt(body.novaHash, 128);
        if (!nh || nh.length < 32) return resp({ ok: false, error: 'Senha inválida' }, 400);
        const novoHash = sha256(nh);
        if (novoHash === hashGuardado(cfg) ||
            (cfg.usuarios || []).some((x) => x.hash === novoHash && x.id !== quem.id)) {
          return resp({ ok: false, error: 'Essa senha já está em uso. Escolha outra.' }, 400);
        }
        const usuarios = (cfg.usuarios || []).map((x) =>
          x.id === quem.id ? Object.assign({}, x, { hash: novoHash, atualizadoEm: agora() }) : x);
        await blobStore('cfg').setJSON('cfg', Object.assign({}, cfg, { usuarios, atualizadoEm: agora() }));
        await registrarLog({ acao: 'trocou a própria senha', por });
        return resp({ ok: true });
      }

      case 'trocarSenha': {
        const nova = txt(body.novaHash, 128);
        if (!nova || nova.length < 32) return resp({ ok: false, error: 'Senha inválida' }, 400);
        const novo = Object.assign({}, cfg, { senhaHash: sha256(nova), atualizadoEm: agora() });
        await blobStore('cfg').setJSON('cfg', novo);
        await registrarLog({ acao: 'trocou a senha do painel', por });
        return resp({ ok: true });
      }

      // ── Log e backup ──────────────────────────────────────────────────────
      case 'log': {
        const r = await blobStore('log').list();
        const chaves = (r && r.blobs ? r.blobs : []).map((b) => b.key).sort().reverse().slice(0, body.limite || 200);
        const linhas = await Promise.all(chaves.map((k) => blobStore('log').get(k, { type: 'json' }).catch(() => null)));
        return resp({ ok: true, linhas: linhas.filter(Boolean) });
      }

      case 'backup': {
        const registros = await lerTudo(null);
        // O arquivo do backup sai do servidor e vai parar no computador de
        // alguém: nenhum hash de senha viaja junto.
        const limpo = cfgSemSegredo(cfg);
        // A numeração entra no backup: sem ela, uma restauração recomeçaria em
        // SC-0001 e repetiria número de documento que já foi para fornecedor.
        const seq = {};
        try {
          const s = blobStore('seq');
          const r = await s.list();
          for (const b of (r && r.blobs ? r.blobs : [])) {
            if (b.key.startsWith('ultimo_')) seq[b.key] = await s.get(b.key, { type: 'json' }).catch(() => null);
          }
        } catch { /* backup sem a numeração ainda é melhor que backup nenhum */ }
        return resp({ ok: true, em: agora(), cfg: limpo, registros, seq });
      }

      case 'restaurar': {
        const registros = Array.isArray(body.registros) ? body.registros : [];
        let n = 0;
        const maiorNumero = {};
        for (const r of registros) {
          const col = r._col;
          if (!COLECOES[col] || !r.id) continue;
          const copia = Object.assign({}, r); delete copia._col;
          await blobStore('domo').setJSON(col + '_' + r.id, copia);
          if (r.numero) maiorNumero[col] = Math.max(maiorNumero[col] || 0, Number(r.numero) || 0);
          n++;
        }
        // A numeração acompanha o que foi restaurado, senão o próximo documento
        // sairia com um número que já existe.
        const s = blobStore('seq');
        for (const [col, maior] of Object.entries(maiorNumero)) {
          const atual = await s.get('ultimo_' + col, { type: 'json' }).catch(() => null);
          if (!atual || (atual.n || 0) < maior) await s.setJSON('ultimo_' + col, { n: maior }).catch(() => {});
        }
        await registrarLog({ acao: 'restaurou backup', por, qtd: n });
        return resp({ ok: true, restaurados: n });
      }

      default:
        return resp({ error: 'Ação desconhecida: ' + action }, 400);
    }
  } catch (e) {
    console.error('[api] erro:', e);
    return resp({ error: (e && e.message) || String(e) }, 500);
  }
};
