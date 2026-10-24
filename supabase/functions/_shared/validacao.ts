// Valida o documento efetivo, depois da união e a cada tentativa do CAS.
const CAMPOS_NUMERICOS = new Set(['qtd', 'preco', 'frete', 'seguro', 'desconto', 'total',
  'totalLiquido', 'totalBruto', 'bruto', 'liquido', 'retencao', 'retencaoPerc', 'adiantamento',
  'valor', 'valorPeriodo', 'perc', 'percAnterior', 'ipi', 'icms', 'ipiPerc', 'icmsPerc']);
const PERCENTUAIS = new Set(['retencaoPerc', 'perc', 'percAnterior', 'ipiPerc', 'icmsPerc']);
export function moedaServidor(valor: number): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return NaN;
  const [base, exp = '0'] = Math.abs(n).toString().split('e');
  return Math.sign(n) * Number(Math.round(Number(base + 'e' + (Number(exp) + 2))) + 'e-2');
}
const moeda = moedaServidor;
const iguais = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
function conferirNumeros(novo: any, antigo: any, caminho = ''): void {
  if (!novo || typeof novo !== 'object') return;
  for (const [campo, valor] of Object.entries(novo)) {
    const anterior = antigo && antigo[campo];
    if (iguais(valor, anterior)) continue; // histórico legado não é reescrito nesta correção.
    if (CAMPOS_NUMERICOS.has(campo) && valor != null && valor !== '') {
      const n = Number(valor);
      if (!['number', 'string'].includes(typeof valor) || !Number.isFinite(n) || n < 0 || (PERCENTUAIS.has(campo) && n > 100)) {
        throw new Error('Valor inválido em ' + caminho + campo + '. Confira antes de salvar.');
      }
    }
    if (Array.isArray(valor)) {
      for (let i = 0; i < valor.length; i++) {
        const item = valor[i];
        const previo = Array.isArray(anterior) ? anterior.find((a: any) => item?.id && a?.id === item.id) : null;
        conferirNumeros(item, previo, caminho + campo + '.');
      }
    } else if (valor && typeof valor === 'object') conferirNumeros(valor, anterior, caminho + campo + '.');
  }
}

export function validarRegistro(col: string, novo: any, antigo: any): void {
  if (['sc', 'oc', 'os', 'cot', 'crono'].includes(col)) conferirNumeros(novo, antigo);
  if (col === 'oc') {
    const ids = new Set((novo.itens || []).map((i: any) => i.id));
    const antigos = new Map((antigo?.recebimentos || []).map((r: any) => [r.id, r]));
    for (const r of (novo.recebimentos || [])) {
      if (iguais(r, antigos.get(r.id))) continue;
      const vistos = new Set();
      for (const i of (r.itens || [])) {
        if (!ids.has(i.itemId) || vistos.has(i.itemId)) throw new Error('Recebimento com item desconhecido ou repetido.');
        vistos.add(i.itemId);
        if (!Number.isFinite(Number(i.qtd)) || Number(i.qtd) < 0) throw new Error('Quantidade recebida inválida.');
      }
    }
  }
  if (col !== 'os') return;
  const existentes = new Map((antigo?.medicoes || []).map((m: any) => [m.id, m]));
  const base = (antigo?.medicoes || []).filter((m: any) => m.situacao !== 'cancelada')
    .slice().sort((a: any, b: any) => a.numero - b.numero || String(a.em).localeCompare(String(b.em)));
  const acumulado = new Map<string, number>();
  for (const m of base) for (const i of (m.itens || [])) acumulado.set(i.itemId, Number(i.perc) || 0);
  const contrato = new Map((novo.itens || []).map((i: any) => [i.id, i]));
  let maxNumero = Math.max(0, ...(antigo?.medicoes || []).map((m: any) => Number(m.numero) || 0));
  const novas = (novo.medicoes || []).filter((m: any) => !existentes.has(m.id)).slice().sort((a: any,b: any)=>a.numero-b.numero);
  const adiantamentos = (novo.adiantamentos || []).filter((a: any) => a && !a.apagadoEm);
  const inicialMigrado = (novo.adiantamentos || []).some((a: any) => a &&
    (a.origem === 'inicial' || (novo.adiantamentoInicialId && a.id === novo.adiantamentoInicialId)));
  const totalAdiantado = moeda(adiantamentos.reduce((s: number,a: any)=>s+Number(a.valor),0) + (inicialMigrado ? 0 : Number(novo.adiantamento) || 0));
  let amortizado = base.reduce((s: number,m: any)=>s+(m.descontos||[]).filter((d: any)=>d.tipo==='adiantamento').reduce((t: number,d: any)=>t+Number(d.valor),0),0);

  for (const m of (novo.medicoes || [])) {
    const previa: any = existentes.get(m.id);
    if (!previa) continue;
    if (['paga', 'cancelada'].includes(previa.situacao) && m.situacao !== previa.situacao) {
      throw new Error('Esta medição já foi paga ou cancelada em outro aparelho. Atualize e confira.');
    }
    for (const campo of ['numero','itens','bruto','retencaoPerc','retencao','descontos','liquido']) {
      if (!iguais(m[campo], previa[campo])) throw new Error('Os valores de uma medição existente não podem ser sobrescritos. Cancele e lance novamente.');
    }
  }
  for (const m of novas) {
    if (!Number.isInteger(m.numero) || m.numero <= maxNumero) throw new Error('Há outra medição com esta numeração. Atualize e confira os valores.');
    maxNumero = m.numero;
    let bruto = 0;
    const vistos = new Set();
    for (const i of (m.itens || [])) {
      const item: any = contrato.get(i.itemId);
      const anterior = acumulado.get(i.itemId) || 0;
      if (!item || vistos.has(i.itemId)) throw new Error('Medição com item desconhecido ou repetido.');
      vistos.add(i.itemId);
      if (!Number.isFinite(Number(i.perc)) || Number(i.perc) < anterior || Number(i.perc) > 100 ||
          (i.percAnterior != null && Math.abs(Number(i.percAnterior) - anterior) > 0.00001)) {
        throw new Error('Outra medição alterou o percentual anterior. Atualize e confira antes de salvar.');
      }
      const periodo = moeda(moeda(Number(item.qtd) * Number(item.preco)) * (Number(i.perc) - anterior) / 100);
      if (!Number.isFinite(Number(i.valorPeriodo)) || Math.abs(Number(i.valorPeriodo) - periodo) > 0.011) {
        throw new Error('Valor da medição divergente do contrato ou de medições anteriores. Confira antes de salvar.');
      }
      bruto += periodo;
      acumulado.set(i.itemId, Number(i.perc));
    }
    bruto = moeda(bruto);
    for (const campo of ['bruto', 'retencaoPerc', 'retencao', 'liquido']) {
      if (m[campo] == null || m[campo] === '' || !Number.isFinite(Number(m[campo]))) throw new Error('Campo obrigatório inválido na medição: ' + campo);
    }
    const retencao = moeda(bruto * Number(m.retencaoPerc || 0) / 100);
    const descontos = (m.descontos || []).reduce((s: number, d: any) => s + Number(d.valor), 0);
    const liquido = moeda(bruto - retencao - descontos);
    amortizado += (m.descontos || []).filter((d: any)=>d.tipo==='adiantamento').reduce((s: number,d: any)=>s+Number(d.valor),0);
    if (amortizado > totalAdiantado + 0.011) throw new Error('A amortização ultrapassa o adiantamento disponível. Atualize e confira.');
    if (!(bruto > 0) || liquido < 0 || !Number.isFinite(liquido) ||
        Math.abs(Number(m.bruto) - bruto) > 0.011 || Math.abs(Number(m.retencao) - retencao) > 0.011 ||
        Math.abs(Number(m.liquido) - liquido) > 0.011) throw new Error('Totais da medição inválidos. Confira bruto, retenção e descontos.');
  }
}
