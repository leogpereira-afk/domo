// Quem é quem, e o que cada um pode fazer. ÚNICO lugar onde isso é decidido.
//
// Isto existe porque a regra já morou em dois lugares: o nucleo.mjs aprendeu os
// acessos individuais e o acervo.mjs (que guarda TODOS os arquivos) continuou
// só conhecendo a senha da equipe — ligar acesso próprio para alguém desligava
// o acervo inteiro para essa pessoa. Regra de acesso mora aqui, e as duas
// Functions importam daqui.

import crypto from 'node:crypto';

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// O que cada perfil pode fazer.
//   escreve  = coleções em que ele pode gravar
//   le       = coleções que ele recebe no snapshot (undefined = todas)
//   semPreco = nessas coleções o valor é apagado antes de sair do servidor
export const PERFIS = {
  direcao: {
    txt: 'Direção',
    tudo: true
  },
  escritorio: {
    txt: 'Escritório / compras',
    tudo: false
  },
  obra: {
    txt: 'Obra / almoxarifado',
    tudo: false,
    escreve: ['sc', 'oc', 'crono', 'comp'],
    // 'prest' fica de fora: a pasta do prestador tem CPF, ASO e ficha de
    // terceiros, e quem é da obra não abre essa tela.
    le: ['sc', 'oc', 'os', 'crono', 'forn', 'doc', 'proj', 'comp'],
    semPreco: ['oc', 'os', 'cot']
  }
};

// Só a direção mexe em quem entra, em configuração e no que é definitivo.
export const ACOES_DIRECAO = ['salvarCfg', 'trocarSenha', 'esvaziarLixeira', 'reiniciarNumeracao',
  'restaurar', 'restaurarItem', 'salvarUsuario', 'apagarUsuario', 'log', 'backup'];

// Apagar é definitivo o bastante para não ser de quem está no canteiro.
export const ACOES_NEGADAS_OBRA = ['apagar'];

export function hashGuardado(cfg) {
  if (cfg && cfg.senhaHash) return cfg.senhaHash;
  if (!process.env.PAINEL_SENHA) return null;
  return sha256(sha256(process.env.PAINEL_SENHA));
}

// A senha da equipe continua valendo como Direção — ninguém fica trancado do
// lado de fora ao ligar os acessos individuais.
export function identificar(cfg, senhaCliente) {
  if (!senhaCliente) return null;
  const h = sha256(senhaCliente);
  const u = ((cfg && cfg.usuarios) || []).find((x) => x && x.ativo !== false && x.hash && x.hash === h);
  if (u) return { id: u.id, nome: u.nome, cargo: u.cargo || '', perfil: PERFIS[u.perfil] ? u.perfil : 'obra', proprio: true };
  const mestre = hashGuardado(cfg);
  if (mestre && h === mestre) return { id: 'equipe', nome: '', cargo: '', perfil: 'direcao', proprio: false };
  return null;
}

// Tira todo hash antes de qualquer resposta sair do servidor.
export function cfgSemSegredo(cfg) {
  const c = Object.assign({}, cfg);
  delete c.senhaHash;
  c.usuarios = ((cfg && cfg.usuarios) || []).map((u) => {
    const x = Object.assign({}, u);
    delete x.hash;
    return x;
  });
  return c;
}

export const perfilDe = (quem) => (quem && PERFIS[quem.perfil]) ? quem.perfil : 'obra';

/* ── O que a obra pode mexer em cada coleção ────────────────────────────────
   Esconder a tela no menu não protege nada: a porta é o servidor. Quem é da
   obra pede material e confere carga — não aprova, não precifica, não mede. */

// Campos que o perfil obra PODE alterar em cada coleção. Qualquer outro campo
// tem que chegar igual ao que já está guardado.
const CAMPOS_OBRA = {
  // Recebimento: acrescenta entrega, e o servidor mesmo recalcula a situação.
  oc: ['recebimentos', 'historico', 'situacao', 'atualizadoEm', 'atualizadoPor'],
  // Cronograma: relata entrega e mexe nas datas do fornecedor dele.
  crono: ['etapas', 'responsaveis', 'historico', 'atualizadoEm', 'atualizadoPor']
};

const igual = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

// Devolve '' quando pode, ou o motivo da recusa.
export function motivoRecusa(quem, colecao, registro, atual) {
  const perfil = perfilDe(quem);
  if (perfil !== 'obra') return '';

  const escreve = PERFIS.obra.escreve;
  if (!escreve.includes(colecao)) return 'quem é da obra não grava ' + colecao;

  // Pedir material sim, aprovar o próprio pedido não.
  if (colecao === 'sc') {
    if (atual && atual.situacao !== 'nova') return 'a solicitação já saiu da obra';
    if (registro.situacao && registro.situacao !== 'nova') return 'quem é da obra não aprova a própria solicitação';
    return '';
  }

  // Registro novo (não existe ainda) pode nascer inteiro — não há o que burlar.
  if (!atual) return '';

  const permitidos = CAMPOS_OBRA[colecao] || [];
  for (const k of Object.keys(registro)) {
    if (permitidos.includes(k) || k === 'id') continue;
    if (!igual(registro[k], atual[k])) return 'quem é da obra não altera "' + k + '" em ' + colecao;
  }
  return '';
}

export function podeFazer(quem, action) {
  if (!quem) return false;
  const perfil = perfilDe(quem);
  if (perfil === 'direcao') return true;
  if (ACOES_DIRECAO.includes(action)) return false;
  if (perfil === 'obra' && ACOES_NEGADAS_OBRA.includes(action)) return false;
  return true;
}

/* ── Leitura: o celular da obra não precisa levar preço para casa ───────────
   Os dados ficam gravados em texto no aparelho e continuam lá depois de a
   direção desligar o acesso da pessoa. */

const CAMPOS_VALOR = ['preco', 'total', 'totalLiquido', 'totalBruto', 'desconto', 'frete',
  'valor', 'liquido', 'bruto', 'retencao', 'adiantamento', 'condicaoPagamento', 'banco'];

function semValores(o) {
  if (Array.isArray(o)) return o.map(semValores);
  if (!o || typeof o !== 'object') return o;
  const saida = {};
  for (const [k, v] of Object.entries(o)) {
    if (CAMPOS_VALOR.includes(k)) continue;
    saida[k] = semValores(v);
  }
  return saida;
}

// Filtra e limpa o que vai no snapshot conforme o perfil.
export function filtrarLeitura(quem, registros) {
  const perfil = perfilDe(quem);
  const p = PERFIS[perfil];
  if (!p || p.tudo || !p.le) return registros;
  return registros
    .filter((r) => p.le.includes(r._col))
    .map((r) => {
      if (!(p.semPreco || []).includes(r._col)) return r;
      // 'medicoes' inteira sai fora: é a folha de pagamento do empreiteiro.
      const limpo = semValores(r);
      delete limpo.medicoes;
      delete limpo.aditivos;
      return limpo;
    });
}

export const colecoesQuePodeLer = (quem) => {
  const p = PERFIS[perfilDe(quem)];
  return (p && p.le) || null;
};
