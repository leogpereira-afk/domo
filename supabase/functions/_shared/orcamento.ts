// One pure implementation serves browser, Node tests and Deno.
import '../../../orcamento-model.js';
import { db } from './dados.ts';
import { arquivosDoRegistro } from './arquivos.ts';
import { podeLerRegistro } from './acesso.ts';
import { NOMES_COLECOES } from './colecoes.ts';

const listaOrc = (x: any): any[] => Array.isArray(x) ? x : [];
const igualOrc = (a: any, b: any) => (globalThis as any).Orcamento.iguaisJSON(a ?? null, b ?? null);
function prefixoOrc(antes: any[], depois: any[], titulo: string) {
  if (depois.length < antes.length || antes.some((x, i) => !igualOrc(x, depois[i]))) {
    throw new Error(titulo + ' é preservado; acrescente uma nova decisão sem reescrever o histórico.');
  }
}

// O cliente registra a intenção offline. Identidade e data da decisão confirmada
// pertencem à sessão autenticada e ao servidor, inclusive no acesso compartilhado.
function carimbarHistoricoOrc(novo: any, anterior: any, perfil: string, ator: any, restauracao = false) {
  const em = new Date().toISOString(), porId = ator?.id || '',
    por = ator?.proprio && ator?.nome ? ator.nome : 'Direção (acesso compartilhado)';
  if (!porId) throw new Error('Identidade autenticada ausente para gravar o orçamento.');
  const carimbo = {em, por, porId};
  if (restauracao && perfil !== 'direcao') throw new Error('Somente direção restaura orçamento.');
  const restauracoes = listaOrc(anterior?.restauracoes);
  if (restauracao) {
    // Datas/autores do backup são históricos importados, não uma aprovação
    // feita agora pelo restaurador. O ato de restaurar tem carimbo próprio.
    novo.restauracoes = [...restauracoes, {id:crypto.randomUUID(), ...carimbo, origemHistorico:'backup',
      revisoesImportadas:listaOrc(novo.revisoes).filter(r=>!listaOrc(anterior?.revisoes).some(a=>a.id===r.id)).map(r=>r.id),
      consolidacoesImportadas:listaOrc(novo.consolidacoes).filter(r=>!listaOrc(anterior?.consolidacoes).some(a=>a.id===r.id)).map(r=>r.id)}];
  } else {
    prefixoOrc(restauracoes, listaOrc(novo.restauracoes), 'Histórico de restaurações');
    if (listaOrc(novo.restauracoes).length !== restauracoes.length) throw new Error('Restaurações são registradas somente pelo servidor.');
  }
  for (const campo of ['revisoes', 'consolidacoes']) {
    const antes = listaOrc(anterior?.[campo]), depois = listaOrc(novo[campo]);
    prefixoOrc(antes, depois, 'Histórico de ' + campo);
    novo[campo] = depois.map((r, i) => {
      if (i < antes.length) return r;
      const aprova = campo === 'revisoes' || r.estado === 'consolidado';
      if (aprova && perfil !== 'direcao') throw new Error('Somente direção aprova o orçamento.');
      if (restauracao) return r;
      const n = {...r, ...carimbo};
      // Não aceitar uma assinatura de aprovação em um evento que não aprova.
      delete n.aprovadoPor; delete n.aprovadoPorId; delete n.aprovadoEm;
      if (aprova) Object.assign(n, {aprovadoPor:por, aprovadoPorId:porId, aprovadoEm:em});
      return n;
    });
  }
  const antigas = new Map(listaOrc(anterior?.validacoes).map(v => [v.id, v]));
  const novas = listaOrc(novo.validacoes);
  for (const id of antigas.keys()) if (!novas.some(v => v.id === id)) throw new Error('Preserve a validação e seu histórico; desative com motivo.');
  novo.validacoes = novas.map(v => {
    const antes: any = antigas.get(v.id), hist = listaOrc(v.historico), velho = listaOrc(antes?.historico);
    prefixoOrc(velho, hist, 'Histórico da validação');
    const campos = (r: any) => Object.fromEntries(Object.entries(r || {}).filter(([k]) => k !== 'historico'));
    const acrescimos = hist.slice(velho.length).map(h => restauracao ? h : ({...h, id:h.id || crypto.randomUUID(), ...carimbo}));
    if (!igualOrc(campos(v), campos(antes)) && !acrescimos.length) {
      acrescimos.push({...campos(v), id:crypto.randomUUID(), ...carimbo});
    }
    return {...v, historico:[...velho, ...acrescimos]};
  });
  if ((novo.inativoEm || null) !== (anterior?.inativoEm || null)) {
    if (perfil !== 'direcao') throw new Error('Somente direção arquiva ou reativa orçamento.');
    if (novo.inativoEm && !restauracao) {
      if (!String(novo.inativoMotivo || '').trim()) throw new Error('Informe o motivo do arquivamento do orçamento.');
      novo.inativoEm = em; novo.inativoPor = por; novo.inativoPorId = porId;
    }
  }
  return novo;
}

async function carregarFontesOrc(novo: any, carregar: any) {
  const registros: Record<string, any[]> = {}, snapshots = new Map<string, any>();
  async function incluir(col: string, id: string) {
    const chave = col + '|' + id;
    if (snapshots.has(chave)) return snapshots.get(chave).registro;
    const fonte = await carregar(col, id);
    snapshots.set(chave, {col, id, registro:fonte || null});
    if (fonte) (registros[col] ||= []).push(fonte);
    return fonte;
  }
  for (const v of listaOrc(novo.vinculos)) {
    if (!['sc','cot','oc','os','forn','permuta','doc'].includes(v.col)) continue;
    const fonte = await incluir(v.col, v.registroId);
    if (v.col === 'permuta') for (const o of listaOrc(fonte?.ordens)) {
      if (['oc','os'].includes(o.col) && o.id && !o.apagadoEm) await incluir(o.col, o.id);
    }
  }
  return {registros, fontes:[...snapshots.values()]};
}

export async function validarOrcamentoServidor(enviado: any, anterior: any, perfil: string, carregar: any, listar: any, ator: any, restauracao = false) {
  if (anterior?.excluindoEm || enviado?.excluindoEm) throw new Error('O orçamento está reservado para limpeza definitiva; a restauração não pode disputar a remoção.');
  const novo = carimbarHistoricoOrc(structuredClone(enviado), anterior, perfil, ator, restauracao);
  if (novo.origem?.hash) {
    const existentes = await listar(["orc"], ["orc"]);
    if (existentes.some((r: any) => r.id !== novo.id && !r.apagadoEm && r.obraId === novo.obraId && r.origem?.hash === novo.origem.hash)) throw new Error("Esta origem já foi importada nesta obra.");
  }
  const {registros} = await carregarFontesOrc(novo, carregar);
  const erros = (globalThis as any).Orcamento.validar(novo, anterior, perfil, registros);
  if (erros.length) throw new Error(erros.join(' '));
  const arquivos = arquivosDoRegistro(novo);
  const anteriores = new Set(arquivosDoRegistro(anterior || {}));
  novo.arquivosPendentesReparo = [];
  const donos = arquivos.length && perfil !== 'direcao' ? await listar(null, NOMES_COLECOES) : [];
  for (const id of arquivos) {
    const meta = await carregar('_arqmeta', id);
    if (!meta || meta.apagadoEm || meta.excluindoEm || meta.pronto !== true) {
      if (anteriores.has(id)) { novo.arquivosPendentesReparo.push({arquivoId:id, motivo:'Arquivo ausente ou incompleto; reanexe para reparar.'}); continue; }
      throw new Error('Arquivo inexistente ou envio não concluído: ' + id + '. Reenvie o anexo antes de vincular.');
    }
    const existentes = donos.filter((r: any) => arquivosDoRegistro(r).includes(id));
    if (perfil !== 'direcao' && (existentes.some((r: any) => !podeLerRegistro(ator, r)) || (!existentes.length && meta.criadoPorId !== ator.id))) {
      throw new Error('Seu acesso não permite vincular este arquivo ao orçamento.');
    }
    if (meta.vinculoPendente && (meta.vinculoPendente.colecao !== 'orc' || meta.vinculoPendente.registroId !== novo.id)) {
      throw new Error('Arquivo reservado para outro registro.');
    }
  }
  return novo;
}

// Preflight de backup antes de qualquer escrita. Usa as fontes finais propostas
// e todos os orçamentos ativos para não começar restauração já sabidamente inválida.
export async function conferirRestauracaoOrcamentos(registros: any[], carregar: any, listar: any, ator: any) {
  if (!registros.some(r=>r._col === 'orc')) return new Map<string, any>();
  const mapa = new Map<string, any>();
  for (const r of registros) {
    const chave = r._col + '|' + r.id;
    if (mapa.has(chave)) throw new Error('Backup contém registro duplicado: ' + chave);
    const copia = {...r}; delete copia._col; mapa.set(chave, copia);
  }
  const virtuais = async (col: string, id: string) => mapa.has(col + '|' + id) ? mapa.get(col + '|' + id) : carregar(col, id);
  const orcamentos = new Map<string, any>((await listar(['orc'], ['orc'])).map((r: any)=>[r.id, r]));
  const anteriores = new Map<string, any>();
  for (const r of registros.filter(r=>r._col === 'orc')) {
    const anterior = await carregar('orc', r.id); anteriores.set(r.id, anterior);
    const pronto = await validarOrcamentoServidor(mapa.get('orc|' + r.id), anterior, 'direcao', virtuais, listar, ator, true);
    orcamentos.set(r.id, pronto);
  }
  const O = (globalThis as any).Orcamento;
  const grupos = (orc: any) => {
    const gs = new Map<string, any>();
    if (!orc || orc.apagadoEm || orc.inativoEm) return gs;
    for (const v of listaOrc(orc.vinculos).filter((v: any)=>O.vinculoAtivo(v) && v.etapa !== 'referencia')) {
      const chave = [v.col,v.registroId,v.etapa].join('|'), g = gs.get(chave) || {v, valor:0, itens:[]};
      g.valor += v.valorCentavos; g.itens.push({id:v.id,item:v.item,valorCentavos:v.valorCentavos}); gs.set(chave,g);
    }
    for (const g of gs.values()) g.itens.sort((a: any,b: any)=>String(a.id).localeCompare(String(b.id)));
    return gs;
  };
  const totais = new Map<string, number>();
  for (const orc of orcamentos.values()) for (const [chave,g] of grupos(orc)) totais.set(chave,(totais.get(chave)||0)+g.valor);
  const origens = new Set<string>();
  for (const orc of orcamentos.values()) if (!orc.apagadoEm && orc.origem?.hash) {
    const chave = orc.obraId + '|' + orc.origem.hash;
    if (origens.has(chave)) throw new Error('Backup duplicaria a origem do orçamento na mesma obra.');
    origens.add(chave);
  }
  for (const [id,anterior] of anteriores) {
    const orc = orcamentos.get(id), antes = grupos(anterior), {registros:fontes} = await carregarFontesOrc(orc, virtuais);
    for (const [chave,g] of grupos(orc)) {
      if (igualOrc(antes.get(chave)?.itens, g.itens)) continue;
      const limite = O.limiteFonte(g.v, listaOrc(fontes[g.v.col]).find(f=>f.id===g.v.registroId), fontes);
      if (!Number.isSafeInteger(limite) || limite < 0 || (totais.get(chave)||0) > limite) throw new Error('Backup excederia o rateio disponível na origem. Nenhum registro foi restaurado.');
    }
  }
  return anteriores;
}

// A soma global e a releitura das fontes ficam na mesma transação do CAS.
// A migração 0005 é obrigatória; não existe fallback para a RPC antiga.
export async function gravarOrcamentoSeInalterado(id: string, esperado: any, registro: any, carregar: any): Promise<boolean> {
  const {registros, fontes} = await carregarFontesOrc(registro, carregar);
  const O = (globalThis as any).Orcamento, controles = new Map<string, any>();
  // A autorização de perfil já ocorreu no handler. Repetir as regras de dados
  // com estes mesmos retratos fecha a janela entre a conferência e o limite.
  const erros = O.validar(registro, esperado, 'direcao', registros);
  if (erros.length) throw new Error(erros.join(' '));
  for (const v of listaOrc(registro.vinculos)) {
    if (!O.vinculoAtivo(v) || v.etapa === 'referencia') continue;
    const fonte = listaOrc(registros[v.col]).find(f => f.id === v.registroId && !f.apagadoEm);
    controles.set([v.col, v.registroId, v.etapa].join('|'), {col:v.col, id:v.registroId, etapa:v.etapa, limiteCentavos:O.limiteFonte(v, fonte, registros)});
  }
  registro._revisao = crypto.randomUUID();
  registro.atualizadoEm = new Date(Math.max(Date.now(), (Date.parse(esperado?.atualizadoEm || '') || 0) + 1)).toISOString();
  const anteriores = new Set(arquivosDoRegistro(esperado || {})), arquivos = [];
  registro.arquivosPendentesReparo = [];
  for (const arquivoId of arquivosDoRegistro(registro)) {
    const meta = await carregar('_arqmeta', arquivoId);
    if (anteriores.has(arquivoId) && (!meta || meta.apagadoEm || meta.excluindoEm || meta.pronto !== true)) {
      registro.arquivosPendentesReparo.push({arquivoId, motivo:'Arquivo ausente ou incompleto; reanexe para reparar.'});
      continue;
    }
    arquivos.push(arquivoId);
  }
  const {data, error} = await db.rpc('domo_gravar_orcamento', {
    p_id:id, p_esperado:esperado, p_registro:registro, p_fontes:fontes,
    p_limites:[...controles.values()], p_arquivos:arquivos,
  });
  if (error) throw new Error('Não foi possível salvar o orçamento com segurança: ' + error.message);
  return data === true;
}

export async function reservarExclusaoOrcamento(id: string, esperado: any) {
  const {data,error} = await db.rpc('domo_reservar_exclusao_orcamento',{p_id:id,p_esperado:esperado});
  if (error) throw new Error('Não foi possível reservar a limpeza do orçamento: ' + error.message);
  return data;
}

export async function removerOrcamentoSeInalterado(id: string, esperado: any) {
  const {data,error} = await db.rpc('domo_remover_orcamento',{p_id:id,p_esperado:esperado});
  if (error) throw new Error('Não foi possível concluir a limpeza do orçamento: ' + error.message);
  return data === true;
}
