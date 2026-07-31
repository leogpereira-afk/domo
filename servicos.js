/* Serviços — o contrato de um prestador (gesseiro, eletricista, empreiteiro)
   do começo ao fim:

     contrato → medição por etapa → boletim assinado → pagamento

   Mais três coisas que valem tanto quanto: a PASTA do prestador (CNDs e a
   ficha de cada pessoa que ele põe na obra — a construtora responde junto se
   ele não recolher os encargos), o DIÁRIO (quantos vieram e o que fizeram) e a
   AVALIAÇÃO no fim, que é o que decide se ele volta na próxima obra. */

/* ══════════════════════════════════════════════════════════════════════════
   CONTAS DO CONTRATO
   ══════════════════════════════════════════════════════════════════════════ */

const RETENCAO_PADRAO = 5;   // % de garantia retido em cada medição

const valorItem = (i) => (Number(i.qtd) || 0) * (Number(i.preco) || 0);

// Medições que valem (cancelada não conta), da primeira para a última.
// Desempate pela data: dois aparelhos sem sinal podem lançar a "medição 02" ao
// mesmo tempo e o servidor guarda as duas (união por id). Ordenar só pelo número
// deixaria indefinido qual é a última — e é a última que manda no % acumulado.
const medicoesValidas = (os) => (os.medicoes || [])
  .filter((m) => m.situacao !== 'cancelada')
  .sort((a, b) => (a.numero || 0) - (b.numero || 0) || String(a.em || '').localeCompare(String(b.em || '')));

// Quanto do item já foi medido, em %. O percentual guardado na medição é
// ACUMULADO — a última medição manda.
function percMedido(os, itemId) {
  let p = 0;
  for (const m of medicoesValidas(os)) {
    const it = (m.itens || []).find((x) => x.itemId === itemId);
    if (it && it.perc != null) p = Number(it.perc) || 0;
  }
  return p;
}

function totaisOS(os) {
  const itens = os.itens || [];
  const contrato = itens.reduce((s, i) => s + valorItem(i), 0);
  const ms = medicoesValidas(os);

  const medido = itens.reduce((s, i) => s + valorItem(i) * percMedido(os, i.id) / 100, 0);
  const pagas = ms.filter((m) => m.situacao === 'paga');
  const bruto = ms.reduce((s, m) => s + (Number(m.bruto) || 0), 0);

  // Retenção só existe DE VERDADE quando saiu de um pagamento. Somar medição em
  // rascunho aqui fazia o botão "Liberar retenção" devolver ao prestador dinheiro
  // que a Domo nunca segurou.
  const retido = pagas.reduce((s, m) => s + (Number(m.retencao) || 0), 0);
  const retencaoPrevista = ms.reduce((s, m) => s + (Number(m.retencao) || 0), 0);
  const pago = pagas.reduce((s, m) => s + (Number(m.liquido) || 0), 0);
  const aPagar = ms.filter((m) => m.situacao === 'aprovada').reduce((s, m) => s + (Number(m.liquido) || 0), 0);
  const naoPagas = ms.filter((m) => m.situacao !== 'paga').length;

  // Adiantamento: quanto já voltou nas medições como desconto do tipo adiantamento.
  const amortizado = ms.reduce((s, m) =>
    s + (m.descontos || []).filter((d) => d.tipo === 'adiantamento').reduce((x, d) => x + (Number(d.valor) || 0), 0), 0);
  // Adiantamento virou LANÇAMENTO (data, valor, quem autorizou). O número solto
  // do editor antigo (os.adiantamento) continua valendo como o primeiro deles —
  // contratos que já existiam não podem perder o que foi adiantado.
  const lancados = (os.adiantamentos || []).filter((a) => a && !a.apagadoEm);
  const somaLancados = lancados.reduce((s, a) => s + (Number(a.valor) || 0), 0);
  const adiantamento = somaLancados || Number(os.adiantamento) || 0;

  return {
    contrato,
    medido,
    saldo: contrato - medido,
    percFisico: contrato ? (medido / contrato) * 100 : 0,
    bruto, retido, retencaoPrevista, aPagar, naoPagas,
    lancamentosAdiantamento: lancados,
    // "Já pago" = o dinheiro que REALMENTE saiu do caixa: medições pagas mais
    // os adiantamentos. Antes o adiantamento não entrava e a tela dizia
    // "Já pago R$ 0,00" com R$ 20.000 na mão do empreiteiro.
    pago: pago + adiantamento,
    pagoMedicoes: pago,
    retencaoLiberada: Number((os.retencaoLiberada || {}).valor) || 0,
    adiantamento,
    adiantamentoSaldo: Math.max(0, adiantamento - amortizado),
    adiantamentoExcesso: Math.max(0, amortizado - adiantamento)
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   PASTA DO PRESTADOR (documentos e equipe)
   ══════════════════════════════════════════════════════════════════════════ */

const TIPOS_DOC_PREST = ['Contrato assinado', 'Cartão CNPJ', 'CND FGTS', 'CND Trabalhista (CNDT)',
  'CND Federal / INSS', 'CND Estadual', 'CND Municipal', 'ART / RRT', 'Apólice de seguro',
  'Alvará', 'Identidade / CPF', 'Outros'];

const FUNCOES = ['Gesseiro', 'Ajudante', 'Encarregado', 'Pedreiro', 'Servente', 'Eletricista',
  'Encanador', 'Pintor', 'Carpinteiro', 'Armador', 'Serralheiro', 'Vidraceiro',
  'Impermeabilizador', 'Marmorista', 'Instalador', 'Outros'];

const TREINAMENTOS = ['NR-06 EPI', 'NR-10 Elétrica', 'NR-11 Movimentação de carga',
  'NR-12 Máquinas', 'NR-18 Construção', 'NR-33 Espaço confinado', 'NR-35 Trabalho em altura'];

// Nome normalizado (sem acento, sem espaço sobrando) para não criar duas pastas
// do mesmo prestador por causa de um espaço a mais.
const chaveNome = (x) => String(x || '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

const prestadores = () => lista('prest').sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
// Respeita a lixeira: prestador apagado não pode continuar "cobrindo" a ordem.
// Números de medição que aparecem mais de uma vez (o número é decidido no
// aparelho, então dois celulares sem sinal criam a mesma "Medição 02").
function numerosRepetidos(os) {
  const conta = {};
  for (const m of medicoesValidas(os)) conta[m.numero] = (conta[m.numero] || 0) + 1;
  return Object.keys(conta).filter((n) => conta[n] > 1).map((n) => String(n).padStart(2, '0'));
}

const prestadorDaOS = (os) => {
  const p = (os && os.prestadorId) ? achar('prest', os.prestadorId) : null;
  return p && !p.apagadoEm ? p : null;
};

// Tudo que está vencido ou vencendo na pasta do prestador. É esta lista que
// aparece antes de aprovar uma medição.
// Documento/pessoa apagados ficam MARCADOS (apagadoEm), nunca somem do array:
// o servidor une esses campos por id e nunca remove — tirar do array fazia o
// registro ressuscitar no próximo sync, com a pendência travando a medição.
const docsVivos = (p) => ((p && p.documentos) || []).filter((d) => d && !d.apagadoEm);
const equipeViva = (p) => ((p && p.equipe) || []).filter((e) => e && !e.apagadoEm);

// Documentos cuja validade é obrigatória: sem data, não defende ninguém.
const DOC_PRECISA_VALIDADE = ['CND FGTS', 'CND Trabalhista (CNDT)', 'CND Federal / INSS',
  'CND Estadual', 'CND Municipal', 'ART / RRT', 'Apólice de seguro', 'Alvará'];

function pendenciasPrestador(p, dias = 30) {
  const fora = [];
  if (!p) return fora;

  for (const d of docsVivos(p)) {
    if (!d.validadeEm) {
      // Antes isso era ignorado: bastava cadastrar a CND sem data para o
      // bloqueio inteiro desligar.
      if (DOC_PRECISA_VALIDADE.includes(d.tipo)) fora.push({ grave: true, o_que: d.tipo + ' sem data de validade' });
      continue;
    }
    const n = diasAte(d.validadeEm);
    if (n == null) { fora.push({ grave: true, o_que: d.tipo + ' com data inválida' }); continue; }
    if (n < 0) fora.push({ grave: true, o_que: d.tipo + ' vencida em ' + fmt.data(d.validadeEm) });
    else if (n <= dias) fora.push({ grave: false, o_que: d.tipo + ' vence em ' + n + ' dia(s)' });
  }

  const tipos = docsVivos(p).map((d) => d.tipo);
  if (!tipos.includes('Contrato assinado')) fora.push({ grave: true, o_que: 'sem contrato assinado na pasta' });
  if (p.tipo !== 'PF') {
    for (const obrig of ['CND FGTS', 'CND Trabalhista (CNDT)']) {
      if (!tipos.includes(obrig)) fora.push({ grave: true, o_que: 'sem ' + obrig });
    }
  }

  for (const pes of equipeViva(p)) {
    if (pes.ativo === false) continue;
    if (!pes.asoValidadeEm) fora.push({ grave: true, pessoaId: pes.id, o_que: pes.nome + ': sem ASO' });
    else {
      const n = diasAte(pes.asoValidadeEm);
      if (n == null) fora.push({ grave: true, pessoaId: pes.id, o_que: pes.nome + ': ASO com data inválida' });
      else if (n < 0) fora.push({ grave: true, pessoaId: pes.id, o_que: pes.nome + ': ASO vencido' });
      else if (n <= dias) fora.push({ grave: false, pessoaId: pes.id, o_que: pes.nome + ': ASO vence em ' + n + ' dia(s)' });
    }
    // NR-18 é o treinamento mínimo de quem entra em canteiro. Antes, quem
    // estivesse cadastrado SEM nenhum treinamento simplesmente não era cobrado.
    const trs = pes.treinamentos || [];
    if (!trs.some((t) => /NR-?\s*18/i.test(String(t.nome || '')))) {
      fora.push({ grave: true, pessoaId: pes.id, o_que: pes.nome + ': sem NR-18' });
    }
    for (const t of trs) {
      if (!t.validadeEm) { fora.push({ grave: true, pessoaId: pes.id, o_que: pes.nome + ': ' + t.nome + ' sem data de validade' }); continue; }
      const n = diasAte(t.validadeEm);
      if (n == null) { fora.push({ grave: true, pessoaId: pes.id, o_que: pes.nome + ': ' + t.nome + ' com data inválida' }); continue; }
      if (n < 0) fora.push({ grave: true, pessoaId: pes.id, o_que: pes.nome + ': ' + t.nome + ' vencido' });
      else if (n <= dias) fora.push({ grave: false, pessoaId: pes.id, o_que: pes.nome + ': ' + t.nome + ' vence em ' + n + ' dia(s)' });
    }
  }
  return fora;
}

const prestadoresComPendencia = () => prestadores().filter((p) => pendenciasPrestador(p).some((x) => x.grave)).length;

function notaMedia(p) {
  const av = (p.avaliacoes || []).filter((a) => a && a.media);
  if (!av.length) return null;
  return av.reduce((s, a) => s + Number(a.media), 0) / av.length;
}

const estrelas = (n) => n == null ? '—' : '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

/* ══════════════════════════════════════════════════════════════════════════
   ORDENS DE SERVIÇO — lista
   ══════════════════════════════════════════════════════════════════════════ */
TELAS.servicos = function (el, args) {
  if (args[0] === 'nova') return editorOS(el, null);
  if (args[0] && args[1] === 'editar') return editorOS(el, args[0]);
  if (args[0]) return telaOS(el, args[0]);

  const todas = lista('os');
  const emAndamento = todas.filter((o) => o.situacao === 'andamento');
  const aPagar = todas.reduce((s, o) => s + totaisOS(o).aPagar, 0);

  cabecalho('Ordens de serviço', emAndamento.length + ' em andamento' +
    (aPagar ? ' · ' + fmt.brl(aPagar) + ' de medição aprovada a pagar' : ''),
    '<a class="btn primario" href="#/servicos/nova">+ Nova ordem de serviço</a>');

  el.innerHTML = '<div class="cartao">' +
    (todas.length ?
      '<div class="tabela-rolagem"><table><thead><tr><th>Nº</th><th>Prestador</th><th>Obra / serviço</th>' +
      '<th class="num">Contrato</th><th class="num">Executado</th><th>Situação</th><th>Prazo</th></tr></thead><tbody>' +
      todas.map((o) => {
        const t = totaisOS(o);
        const p = prestadorDaOS(o);
        const alerta = p && pendenciasPrestador(p).some((x) => x.grave);
        const d = o.dataTerminoPrevista ? diasAte(o.dataTerminoPrevista) : null;
        const atrasada = d != null && d < 0 && !['concluida', 'cancelada'].includes(o.situacao);
        return '<tr class="clicavel" data-id="' + esc(o.id) + '">' +
          '<td><b>' + esc(o.codigo || '—') + '</b></td>' +
          '<td>' + esc((o.empreiteiro || {}).nome || '—') +
            (alerta ? ' <span class="etiqueta et-vencido">documento</span>' : '') + '</td>' +
          '<td>' + esc(o.obra || nomeObra(o.obraId)) +
            '<div style="font-size:.8rem;color:var(--texto-fraco)">' + esc(o.localizacao || '') + '</div></td>' +
          '<td class="num">' + fmt.brl(t.contrato) + '</td>' +
          '<td class="num">' + fmt.numero(t.percFisico, 0) + '%' +
            '<div class="progresso" style="margin-top:4px"><i style="width:' + Math.min(100, t.percFisico) + '%"></i></div></td>' +
          '<td>' + etiqueta(o.situacao) + '</td>' +
          '<td>' + (o.dataTerminoPrevista ? fmt.data(o.dataTerminoPrevista) : '—') +
            (atrasada ? ' <span class="etiqueta et-vencido">atrasada</span>' : '') + '</td></tr>';
      }).join('') +
      '</tbody></table></div>'
      : vazio('🛠️', 'Nenhuma ordem de serviço',
        'Contrate o gesseiro, o eletricista, o pintor — com escopo, prazo, valor e medição.')) +
    '</div>';
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => irPara('servicos/' + tr.dataset.id)));
};

/* ── Editor do contrato ────────────────────────────────────────────────────── */
function editorOS(el, id) {
  // A rota /editar podia ser aberta direto na URL mesmo com a ordem em
  // andamento — e aí dava para mexer em qtd/preço de etapa já medida, o que
  // descola o boletim já assinado do que foi pago.
  const jaExiste = id ? achar('os', id) : null;
  if (jaExiste && !['rascunho', 'emitida'].includes(jaExiste.situacao)) {
    toast('Ordem já em andamento — use "Aditivo" para incluir serviço', 'ruim');
    irPara('servicos/' + id);
    return;
  }
  S.formAberto = true;
  const existente = id ? achar('os', id) : null;
  const os = existente || {
    obraId: (obras()[0] || {}).id, dataEmissao: hojeISO(), situacao: 'rascunho',
    itens: [{}, {}], retencaoPerc: RETENCAO_PADRAO, adiantamento: 0
  };
  const e = os.empreiteiro || {};

  cabecalho(existente ? 'Editar ' + (os.codigo || '') : 'Nova ordem de serviço', '',
    '<button class="btn" id="cancelarOS">Cancelar</button><button class="btn primario" id="salvarOS">Salvar</button>');

  el.innerHTML = '<div id="fOS">' +
    '<div class="cartao">' +
      '<h3>👷 Prestador do serviço</h3>' +
      '<div class="linha">' +
        campo('Escolher cadastrado', '<select id="selPrest"><option value="">— digitar abaixo —</option>' +
          prestadores().map((x) => '<option value="' + esc(x.id) + '"' + (os.prestadorId === x.id ? ' selected' : '') + '>' +
            esc(x.nome) + (x.especialidade ? ' · ' + esc(x.especialidade) : '') + '</option>').join('') + '</select>',
          'Quem está cadastrado já traz CNDs e equipe junto.') +
        campo('Nome / razão social', entrada('empreiteiro.nome', e.nome)) +
        campo('CNPJ / CPF', entrada('empreiteiro.cnpjCpf', e.cnpjCpf, { inputmode: 'numeric' })) +
      '</div>' +
      '<div class="linha">' +
        campo('WhatsApp', entrada('empreiteiro.telefone', e.telefone, { tipo: 'tel' })) +
        campo('Responsável técnico', entrada('empreiteiro.responsavelTecnico', e.responsavelTecnico)) +
        campo('Contrato nº', entrada('contratoNumero', os.contratoNumero)) +
      '</div>' +
    '</div>' +
    '<div class="cartao">' +
      '<h3>📍 Serviço</h3>' +
      '<div class="linha">' +
        campo('Obra', seletor('obraId', os.obraId, obras().map((o) => ({ v: o.id, t: o.nome })))) +
        campo('Localização / setor', entrada('localizacao', os.localizacao, { placeholder: 'Ex.: 3º ao 7º pavimento' })) +
      '</div>' +
      '<div class="linha">' +
        campo('Data de emissão', entrada('dataEmissao', os.dataEmissao, { tipo: 'date' })) +
        campo('Início', entrada('dataInicio', os.dataInicio, { tipo: 'date' })) +
        campo('Término previsto', entrada('dataTerminoPrevista', os.dataTerminoPrevista, { tipo: 'date' })) +
      '</div>' +
    '</div>' +
    '<div class="cartao">' +
      '<h3>🔨 Etapas contratadas</h3>' +
      '<p class="legenda">Quebre em etapas medíveis (forro, sanca, acabamento). É por elas que a medição vai andar.</p>' +
      '<div id="itensOS">' + (os.itens || []).map((i) => linhaItem(i, true)).join('') + '</div>' +
      '<button class="btn pequeno" id="maisItemOS">+ Etapa</button>' +
      '<div class="linha estreita" style="margin-top:14px">' +
        campo('Retenção técnica (%)', entrada('retencaoPerc', os.retencaoPerc != null ? os.retencaoPerc : RETENCAO_PADRAO, { inputmode: 'decimal' }),
          'Garantia retida em cada medição, devolvida no fim.') +
        campo('Adiantamento (R$)', entrada('adiantamento', os.adiantamento || 0, { inputmode: 'decimal' }),
          'Se você adiantar dinheiro, desconte nas medições.') +
      '</div>' +
      '<div class="indicador ok" style="margin-top:6px"><div class="rotulo">Valor do contrato</div>' +
        '<div class="valor" id="vTotalOS">R$ 0,00</div></div>' +
      campo('Observações / condições', areaTexto('observacoes', os.observacoes)) +
    '</div>' +
  '</div>';

  const caixa = document.getElementById('itensOS');
  const recalc = () => {
    const t = lerItens(caixa, true).reduce((s, i) => s + valorItem(i), 0);
    document.getElementById('vTotalOS').textContent = fmt.brl(t);
  };
  const ligar = (linha) => {
    linha.querySelector('[data-tirar]').addEventListener('click', () => { linha.remove(); recalc(); });
    linha.querySelectorAll('input').forEach((i) => i.addEventListener('input', recalc));
  };
  Array.from(caixa.children).forEach(ligar);
  recalc();
  document.getElementById('maisItemOS').addEventListener('click', () => {
    caixa.insertAdjacentHTML('beforeend', linhaItem({}, true));
    ligar(caixa.lastElementChild);
  });

  document.getElementById('selPrest').addEventListener('change', (e2) => {
    const p = achar('prest', e2.target.value);
    if (!p) return;
    const set = (n, v) => { const c = el.querySelector('[data-campo="empreiteiro.' + n + '"]'); if (c) c.value = v || ''; };
    set('nome', p.nome); set('cnpjCpf', p.cnpjCpf); set('telefone', p.telefone);
    set('responsavelTecnico', p.responsavelTecnico);
  });

  document.getElementById('cancelarOS').addEventListener('click', () => {
    S.formAberto = false; irPara(existente ? 'servicos/' + existente.id : 'servicos');
  });
  document.getElementById('salvarOS').addEventListener('click', () => {
    const d = lerCampos(document.getElementById('fOS'));
    const itens = lerItens(caixa, true);
    if (!d.empreiteiro.nome.trim()) { toast('Informe o prestador', 'ruim'); return; }
    if (!itens.length) { toast('Inclua pelo menos uma etapa', 'ruim'); return; }

    // Etapa já medida não pode sumir do contrato: a medição perderia a base.
    if (existente) {
      const medidos = (existente.itens || []).filter((i) => percMedido(existente, i.id) > 0).map((i) => i.id);
      const agora = new Set(itens.map((i) => i.id));
      const sumiu = medidos.filter((x) => !agora.has(x));
      if (sumiu.length) { toast('Não dá para tirar etapa que já foi medida', 'ruim'); return; }
    }

    const novo = Object.assign({}, os, d, {
      itens, obra: nomeObra(d.obraId),
      prestadorId: document.getElementById('selPrest').value,
      retencaoPerc: numeroBR(d.retencaoPerc),
      adiantamento: numeroBR(d.adiantamento),
      total: itens.reduce((s, i) => s + valorItem(i), 0)
    });
    if (!existente) novo.historico = historiar(novo, 'Ordem de serviço criada');
    else if (Math.abs((existente.total || 0) - novo.total) > 0.005) {
      novo.historico = historiar(existente, 'Contrato alterado: ' + fmt.brl(existente.total) + ' → ' + fmt.brl(novo.total));
    }

    // Prestador novo entra na pasta automaticamente — a partir daí é só juntar
    // CND e equipe nele.
    if (!novo.prestadorId) {
      // Compara pelo CNPJ/CPF quando existir (é o que identifica de verdade) e
      // pelo nome normalizado como reserva.
      const docNovo = String(novo.empreiteiro.cnpjCpf || '').replace(/\D/g, '');
      const igual = prestadores().find((x) =>
        (docNovo && String(x.cnpjCpf || '').replace(/\D/g, '') === docNovo) ||
        chaveNome(x.nome) === chaveNome(novo.empreiteiro.nome));
      if (igual) novo.prestadorId = igual.id;
      else {
        const p = salvar('prest', {
          nome: String(novo.empreiteiro.nome || '').trim(), cnpjCpf: novo.empreiteiro.cnpjCpf,
          telefone: novo.empreiteiro.telefone, responsavelTecnico: novo.empreiteiro.responsavelTecnico,
          tipo: String(novo.empreiteiro.cnpjCpf || '').replace(/\D/g, '').length === 11 ? 'PF' : 'PJ',
          situacao: 'ativo', documentos: [], equipe: [], avaliacoes: []
        });
        novo.prestadorId = p.id;
      }
    }
    const salvo = salvar('os', novo);
    S.formAberto = false;
    irPara('servicos/' + salvo.id);
    toast('Ordem de serviço salva', 'bom');
  });
}

/* ── Detalhe do contrato ───────────────────────────────────────────────────── */
function telaOS(el, id) {
  const o = achar('os', id);
  if (!o) { cabecalho('Ordem de serviço', ''); el.innerHTML = vazio('🤔', 'Não encontrada'); return; }
  const t = totaisOS(o);
  const p = prestadorDaOS(o);
  const pend = pendenciasPrestador(p);
  const graves = pend.filter((x) => x.grave);
  const pronta = !!(o.codigo && o.tokenPublico);
  const link = location.origin + location.pathname + '#/ver/os/' + o.id + '/' + (o.tokenPublico || '');
  // Canceladas entram na lista: antes elas sumiam da tela e a única pista de
  // que existiram ficava no histórico.
  const ms = (o.medicoes || []).slice()
    .sort((a, b) => (a.numero || 0) - (b.numero || 0) || String(a.em || '').localeCompare(String(b.em || '')))
    .reverse();

  cabecalho(o.codigo || 'Ordem de serviço (sincronizando…)', (o.empreiteiro || {}).nome || '',
    '<a class="btn" href="#/servicos">← Voltar</a>' +
    (['rascunho', 'emitida'].includes(o.situacao) ? '<a class="btn" href="#/servicos/' + esc(o.id) + '/editar">Editar</a>' : '') +
    (['cancelada'].includes(o.situacao) ? '' : '<button class="btn" id="osAdiant">💵 Adiantamento</button>') +
    '<button class="btn" id="osPdf">📄 PDF do contrato</button>' +
    '<button class="btn zap" id="osZap"' + (pronta ? '' : ' disabled') + '>WhatsApp</button>');

  el.innerHTML =
    (graves.length ? '<div class="aviso ruim"><b>Pendência na pasta do prestador:</b> ' +
      esc(graves.slice(0, 4).map((x) => x.o_que).join(' · ')) +
      (graves.length > 4 ? ' e mais ' + (graves.length - 4) : '') +
      ' — <a href="#/prestadores/' + esc(p.id) + '">resolver agora</a></div>' : '') +

    '<div class="grade g4 compacto" style="margin-bottom:16px">' +
      indicador('Contrato', fmt.brl(t.contrato), (o.itens || []).length + ' etapa(s)') +
      indicador('Executado', fmt.numero(t.percFisico, 0) + '%', fmt.brl(t.medido)) +
      indicador('Já pago', fmt.brl(t.pago),
        (t.adiantamento ? fmt.brl(t.adiantamento) + ' de adiantamento · ' : '') +
        (t.aPagar ? fmt.brl(t.aPagar) + ' aprovado a pagar' : 'nada a pagar'), t.aPagar ? 'atencao' : '') +
      indicador('Retido (garantia)', fmt.brl(t.retido - t.retencaoLiberada),
        o.retencaoLiberada ? 'liberado em ' + fmt.data(o.retencaoLiberada.em)
          : t.retencaoPrevista > t.retido ? '+' + fmt.brl(t.retencaoPrevista - t.retido) + ' a reter'
          : 'devolve no fim') +
    '</div>' +

    // Assinatura do buraco: o avanço diz que executou X, mas as medições vivas
    // somam menos que isso. Alguém cancelou uma medição do meio.
    (Math.abs(t.medido - t.bruto) > 0.5
      ? '<div class="aviso ruim"><b>Confira este contrato:</b> a tela diz ' + fmt.brl(t.medido) +
        ' executado, mas as medições válidas somam ' + fmt.brl(t.bruto) + ' — diferença de ' +
        fmt.brl(Math.abs(t.medido - t.bruto)) + '. Provavelmente uma medição do meio foi cancelada. ' +
        'O trecho precisa entrar como aditivo para o prestador receber.</div>'
      : '') +

    '<div class="grade g2"><div>' +
      // ── Etapas e avanço ──
      '<div class="cartao">' +
        '<div class="barra-acoes" style="justify-content:space-between;margin-bottom:10px">' +
          '<h3 style="margin:0">Etapas e avanço</h3>' + etiqueta(o.situacao) + '</div>' +
        '<div class="tabela-rolagem"><table><thead><tr><th>#</th><th>Etapa</th><th class="num">Contratado</th>' +
        '<th class="num">Executado</th><th class="num">A executar</th></tr></thead><tbody>' +
        (o.itens || []).map((i, n) => {
          const perc = percMedido(o, i.id);
          return '<tr><td>' + (n + 1) + '</td>' +
            '<td>' + esc(i.descricao) +
              '<div class="progresso" style="margin-top:5px"><i style="width:' + Math.min(100, perc) + '%"></i></div></td>' +
            '<td class="num">' + fmt.numero(i.qtd) + ' ' + esc(i.unid || '') + '<div style="font-size:.8rem;color:var(--texto-fraco)">' +
              fmt.brl(valorItem(i)) + '</div></td>' +
            '<td class="num"><b>' + fmt.numero(perc, 0) + '%</b><div style="font-size:.8rem;color:var(--texto-fraco)">' +
              fmt.brl(valorItem(i) * perc / 100) + '</div></td>' +
            '<td class="num">' + fmt.brl(valorItem(i) * (100 - perc) / 100) + '</td></tr>';
        }).join('') +
        '</tbody><tfoot><tr><td colspan="3"><b>Total</b></td>' +
          '<td class="num"><b>' + fmt.brl(t.medido) + '</b></td>' +
          '<td class="num"><b>' + fmt.brl(t.saldo) + '</b></td></tr></tfoot></table></div>' +
        (o.observacoes ? '<p style="margin-top:12px"><b>Observações:</b> ' + esc(o.observacoes) + '</p>' : '') +
        '<div class="barra-acoes" style="margin-top:12px">' +
          (['emitida', 'andamento'].includes(o.situacao)
            ? '<button class="btn verde" id="novaMedicao">📏 Nova medição</button>' : '') +
          (['emitida', 'andamento'].includes(o.situacao)
            ? '<button class="btn" id="aditivo">+ Aditivo (serviço extra)</button>' : '') +
        '</div>' +
      '</div>' +

      // ── Medições ──
      '<div class="cartao">' +
        '<h3>📏 Medições</h3>' +
        (ms.length ? ms.map((m) => {
          const cancelada = m.situacao === 'cancelada';
          const cor = cancelada ? 'et-cancelada' : m.situacao === 'paga' ? 'et-entregue'
            : m.situacao === 'aprovada' ? 'et-comprado' : 'et-rascunho';
          const txt = cancelada ? 'Cancelada' : m.situacao === 'paga' ? 'Paga'
            : m.situacao === 'aprovada' ? 'Aprovada — a pagar' : 'Rascunho';
          return '<div class="arquivo-solto" style="align-items:flex-start">' +
            '<span class="ic">📏</span><div style="flex:1;min-width:0">' +
              '<div class="nome">Medição ' + String(m.numero).padStart(2, '0') +
                ' <span class="etiqueta ' + cor + '">' + txt + '</span></div>' +
              '<div class="meta">' + (m.de ? fmt.data(m.de) + ' a ' + fmt.data(m.ate) : fmt.data(m.em)) +
                ' · medido por ' + esc(m.por || '—') + '</div>' +
              '<div class="meta">Bruto ' + fmt.brl(m.bruto) + ' · retenção ' + fmt.brl(m.retencao) +
                ((m.descontos || []).length ? ' · descontos ' + fmt.brl((m.descontos || []).reduce((s, d) => s + (Number(d.valor) || 0), 0)) : '') +
                ' · <b>líquido ' + fmt.brl(m.liquido) + '</b>' +
                (m.pagoEm ? ' · pago em ' + fmt.data(m.pagoEm) : '') + '</div>' +
              (m.obs ? '<div class="meta">' + esc(m.obs) + '</div>' : '') +
              (cancelada ? '<div class="meta" style="color:var(--vermelho)">Cancelada em ' +
                fmt.data(m.canceladaEm) + ' por ' + esc(m.canceladaPor || '—') +
                (m.motivoCancelamento ? ' — ' + esc(m.motivoCancelamento) : '') + '</div>' : '') +
            '</div>' +
            '<div class="acoes" style="flex-direction:column">' +
              (cancelada ? '' : '<button class="btn pequeno" data-mpdf="' + esc(m.id) + '">' +
                (m.situacao === 'rascunho' ? 'Prévia' : 'Boletim') + '</button>') +
              (m.situacao === 'rascunho' && o.situacao !== 'cancelada'
                ? '<button class="btn pequeno primario" data-maprovar="' + esc(m.id) + '">Aprovar</button>' : '') +
              // Ordem cancelada não impede pagar o que já foi aprovado.
              (m.situacao === 'aprovada'
                ? '<button class="btn pequeno verde" data-mpagar="' + esc(m.id) + '">Marcar paga</button>' : '') +
              (['rascunho', 'aprovada'].includes(m.situacao)
                ? '<button class="btn pequeno perigo" data-mcancelar="' + esc(m.id) + '">Cancelar</button>' : '') +
            '</div></div>';
        }).join('')
          : '<p class="legenda">Nenhuma medição ainda. É por ela que o pagamento é liberado.</p>') +
        ((t.lancamentosAdiantamento || []).length
          ? '<div style="margin-top:12px"><h3 style="font-size:.92rem">💵 Adiantamentos</h3>' +
            t.lancamentosAdiantamento.map((a) =>
              '<div class="arquivo-solto"><span class="ic">💵</span><div style="flex:1;min-width:0">' +
              '<div class="nome">' + fmt.brl(a.valor) + ' · ' + fmt.data(a.em) + '</div>' +
              '<div class="meta">autorizado por ' + esc(a.por || '—') +
                (a.obs ? ' · ' + esc(a.obs) : '') + '</div></div></div>').join('') +
            '</div>'
          : '') +
        (t.adiantamentoSaldo ? '<div class="aviso atencao" style="margin-top:10px">Adiantamento a amortizar: <b>' +
          fmt.brl(t.adiantamentoSaldo) + '</b> de ' + fmt.brl(t.adiantamento) + '</div>' : '') +
      '</div>' +

      // ── Diário ──
      '<div class="cartao">' +
        '<div class="barra-acoes" style="justify-content:space-between">' +
          '<h3 style="margin:0">📓 Diário do serviço</h3>' +
          '<button class="btn pequeno" id="novoDiario">+ Apontamento</button></div>' +
        (function () {
          const dias = (o.diario || []).slice().sort((a, b) => String(b.data).localeCompare(String(a.data)));
          if (!dias.length) return '<p class="legenda">Anote quantos vieram e o que foi feito. ' +
            'É o que sustenta a conversa sobre ritmo e prazo.</p>';
          const media = dias.reduce((s, d) => s + (Number(d.efetivo) || 0), 0) / dias.length;
          return '<p class="legenda">' + dias.length + ' apontamento(s) · média de ' +
            fmt.numero(media, 1) + ' pessoa(s) por dia</p>' +
            dias.slice(0, 12).map((d) =>
              '<div class="arquivo-solto" style="align-items:flex-start">' +
                '<span class="ic">' + ((Number(d.efetivo) || 0) === 0 ? '🚫' : '👷') + '</span>' +
                '<div style="flex:1;min-width:0">' +
                  '<div class="nome">' + fmt.data(d.data) + ' · ' + fmt.numero(d.efetivo, 0) + ' pessoa(s)</div>' +
                  '<div class="meta">' + esc(d.atividade || '') + (d.obs ? ' · ' + esc(d.obs) : '') +
                  ' · anotado por ' + esc(d.por || '—') + '</div>' +
                  ((d.fotos || []).length ? '<div class="miniaturas" data-dfotos="' + esc(d.id) + '" style="margin-top:6px"></div>' : '') +
                '</div></div>').join('');
        })() +
      '</div>' +

    '</div><div>' +
      // ── Andamento ──
      '<div class="cartao"><h3>Andamento</h3>' +
        '<div class="barra-acoes" style="flex-direction:column;align-items:stretch">' +
          (o.situacao === 'rascunho' ? '<button class="btn primario" data-os="emitida">1. Emitir ordem</button>' : '') +
          (o.situacao === 'emitida' ? '<button class="btn primario" data-os="andamento">2. Serviço começou</button>' : '') +
          (o.situacao === 'andamento' ? '<button class="btn verde" data-os="concluida">3. Serviço concluído</button>' : '') +
          (o.situacao === 'concluida' && !o.retencaoLiberada && (t.retido > 0)
            ? '<button class="btn" id="liberarRet"' + (t.naoPagas ? ' disabled title="há medição não paga"' : '') +
              '>Liberar retenção (' + fmt.brl(t.retido) + ')</button>' : '') +
          (!['cancelada', 'concluida'].includes(o.situacao) ? '<button class="btn perigo" data-os="cancelada">Cancelar</button>' : '') +
          (o.situacao === 'concluida' && !o.avaliacao ? '<button class="btn" id="avaliar">⭐ Avaliar o prestador</button>' : '') +
        '</div>' +
        (o.avaliacao ? '<p style="margin-top:10px"><b>Avaliação:</b> ' + estrelas(o.avaliacao.media) +
          ' (' + fmt.numero(o.avaliacao.media, 1) + ')' + (o.avaliacao.obs ? '<br>' + esc(o.avaliacao.obs) : '') + '</p>' : '') +
      '</div>' +

      // ── Prestador ──
      '<div class="cartao">' +
        '<div class="barra-acoes" style="justify-content:space-between">' +
          '<h3 style="margin:0">👷 Prestador</h3>' +
          (p ? '<a class="btn pequeno" href="#/prestadores/' + esc(p.id) + '">Abrir pasta</a>' : '') + '</div>' +
        '<p><b>' + esc((o.empreiteiro || {}).nome || '—') + '</b><br>' +
          esc(fmt.doc((o.empreiteiro || {}).cnpjCpf)) + '<br>' +
          esc(fmt.telefone((o.empreiteiro || {}).telefone)) + '</p>' +
        (p ? '<p class="legenda">' + equipeViva(p).filter((x) => x.ativo !== false).length + ' pessoa(s) na equipe · ' +
          docsVivos(p).length + ' documento(s)' +
          (pend.length ? ' · <b style="color:var(--vermelho)">' + pend.length + ' pendência(s)</b>' : ' · tudo em dia') + '</p>' : '') +
      '</div>' +

      '<div class="cartao"><h3>Dados</h3><p>' +
        '<b>Obra:</b> ' + esc(o.obra || nomeObra(o.obraId)) + '<br>' +
        '<b>Local:</b> ' + esc(o.localizacao || '—') + '<br>' +
        '<b>Contrato:</b> ' + esc(o.contratoNumero || '—') + '<br>' +
        '<b>Início:</b> ' + fmt.data(o.dataInicio) + ' · <b>Término:</b> ' + fmt.data(o.dataTerminoPrevista) + '<br>' +
        '<b>Retenção:</b> ' + fmt.numero(o.retencaoPerc != null ? o.retencaoPerc : RETENCAO_PADRAO, 1) + '%' +
      '</p>' +
      (pronta ? '<div class="campo"><label>Link para o prestador</label>' +
        '<input type="text" value="' + esc(link) + '" readonly></div>'
        : '<div class="aviso atencao">Aguardando o número do servidor.</div>') +
      '</div>' +
      '<div class="cartao"><h3>Histórico</h3>' + linhaTempo(o.historico) + '</div>' +
      '<div class="cartao"><button class="btn perigo" id="apagarOS" style="width:100%">Apagar</button></div>' +
    '</div></div>';

  // ── ligações ──
  el.querySelectorAll('[data-os]').forEach((b) => b.addEventListener('click', () => avancarOS(o, b.dataset.os)));
  const bm = document.getElementById('novaMedicao');
  if (bm) bm.addEventListener('click', () => novaMedicao(o));
  const ba = document.getElementById('aditivo');
  if (ba) ba.addEventListener('click', () => lancarAditivo(o));
  const bd = document.getElementById('novoDiario');
  if (bd) bd.addEventListener('click', () => novoApontamento(o));
  const bl = document.getElementById('liberarRet');
  if (bl) bl.addEventListener('click', () => liberarRetencao(o));
  const bav = document.getElementById('avaliar');
  if (bav) bav.addEventListener('click', () => avaliarPrestador(o));

  el.querySelectorAll('[data-mpdf]').forEach((b) => b.addEventListener('click', () => {
    const m = (o.medicoes || []).find((x) => x.id === b.dataset.mpdf);
    if (m) pdfMedicao(o, m, S.cfg);
  }));
  el.querySelectorAll('[data-maprovar]').forEach((b) => b.addEventListener('click', () => aprovarMedicao(o, b.dataset.maprovar)));
  el.querySelectorAll('[data-mpagar]').forEach((b) => b.addEventListener('click', () => pagarMedicao(o, b.dataset.mpagar)));
  el.querySelectorAll('[data-mcancelar]').forEach((b) => b.addEventListener('click', () => cancelarMedicao(o, b.dataset.mcancelar)));

  document.getElementById('osPdf').addEventListener('click', () => pdfOS(o, S.cfg));
  const bad = document.getElementById('osAdiant');
  if (bad) bad.addEventListener('click', () => lancarAdiantamento(o));
  document.getElementById('osZap').addEventListener('click', () => {
    window.open(linkWhats((o.empreiteiro || {}).telefone,
      '*' + ((S.cfg.empresa || {}).nomeCurto || 'Domo') + '* — Ordem de Serviço *' + (o.codigo || '') + '*\n' +
      'Obra: ' + (o.obra || '') + '\nValor: ' + fmt.brl(o.total) + '\n\nDocumento: ' + link), '_blank');
  });
  document.getElementById('apagarOS').addEventListener('click', async () => {
    if (await confirmar('Apagar esta ordem de serviço?', { perigo: true, ok: 'Apagar' })) {
      try { await api('apagar', { colecao: 'os', id: o.id }); } catch (e) { toast('Não consegui apagar: ' + e.message, 'ruim'); return; }
      await puxar(); irPara('servicos');
    }
  });

  // fotos do diário (mesmo cache das fotos de recebimento)
  (o.diario || []).forEach((d) => {
    const caixa = el.querySelector('[data-dfotos="' + d.id + '"]');
    if (!caixa) return;
    (d.fotos || []).forEach(async (fid) => {
      try {
        let url = CACHE_FOTOS.get(fid);
        if (!url) { const { blob } = await baixarArquivo(fid); url = URL.createObjectURL(blob); CACHE_FOTOS.set(fid, url); }
        if (!caixa.isConnected) return;
        const img = document.createElement('img');
        img.src = url;
        img.addEventListener('click', () => window.open(url, '_blank'));
        caixa.appendChild(img);
      } catch { /* foto ainda subindo */ }
    });
  });
}

async function avancarOS(o, destino) {
  const textos = { emitida: 'Ordem emitida', andamento: 'Serviço iniciado', concluida: 'Serviço concluído', cancelada: 'Ordem cancelada' };
  if (destino === 'cancelada' && !await confirmar('Cancelar esta ordem de serviço?', { perigo: true, ok: 'Cancelar' })) return;
  if (destino === 'concluida') {
    const t = totaisOS(o);
    if (t.percFisico < 99.5 && !await confirmar(
      'O contrato está com ' + fmt.numero(t.percFisico, 0) + '% medido. Concluir mesmo assim?',
      { titulo: 'Serviço concluído', ok: 'Concluir' })) return;
  }
  const n = Object.assign({}, o, { situacao: destino });
  n.historico = historiar(o, textos[destino]);
  salvar('os', n);
  render();
  if (destino === 'concluida') setTimeout(() => avaliarPrestador(achar('os', o.id)), 400);
}

/* ══════════════════════════════════════════════════════════════════════════
   MEDIÇÃO
   ══════════════════════════════════════════════════════════════════════════ */
function novaMedicao(o) {
  const itens = o.itens || [];
  if (!itens.length) { toast('O contrato não tem etapas', 'ruim'); return; }
  const retPerc = o.retencaoPerc != null ? Number(o.retencaoPerc) : RETENCAO_PADRAO;
  const numero = Math.max(0, ...(o.medicoes || []).map((m) => Number(m.numero) || 0)) + 1;
  const t = totaisOS(o);
  const ultima = medicoesValidas(o).slice(-1)[0];

  abrirModal({
    titulo: 'Medição ' + String(numero).padStart(2, '0') + ' — ' + (o.codigo || ''),
    largo: true,
    corpo:
      '<p class="legenda">Informe o total JÁ EXECUTADO de cada etapa (acumulado, não só o do período). ' +
      'O sistema calcula o que entra nesta medição.</p>' +
      '<div id="fMed">' +
        '<div class="linha">' +
          // O período começa onde a última medição parou (ou no início do
          // contrato), mas NUNCA depois de hoje — senão a tela já abria com o
          // período invertido e só avisava disso na hora de salvar.
          campo('Período de', entrada('de', (() => {
            const inicio = (ultima && ultima.ate) || o.dataInicio || hojeISO();
            return inicio > hojeISO() ? hojeISO() : inicio;
          })(), { tipo: 'date' })) +
          campo('até', entrada('ate', hojeISO(), { tipo: 'date' })) +
        '</div>' +
        '<div class="medicao-grade">' +
          '<div class="med-cab"><span>Etapa</span><span>Já medido</span><span>Executado total</span><span>Nesta medição</span></div>' +
          itens.map((i) => {
            const ant = percMedido(o, i.id);
            return '<div class="med-linha" data-item="' + esc(i.id) + '">' +
              '<div class="med-etapa"><b>' + esc(i.descricao) + '</b>' +
                '<div class="med-sub">' + fmt.numero(i.qtd) + ' ' + esc(i.unid || '') + ' · ' + fmt.brl(valorItem(i)) + '</div></div>' +
              '<div class="med-ant"><span class="med-rot">Já medido</span>' + fmt.numero(ant, 0) + '%</div>' +
              '<div class="med-perc"><span class="med-rot">Executado total (%)</span>' +
                '<input type="text" inputmode="decimal" data-perc="' + esc(i.id) + '" ' +
                // Precisão CHEIA: arredondar aqui fazia a medição abrir já em
                // estado de erro quando o acumulado tinha mais casas (33,33%).
                'value="' + esc(String(ant).replace('.', ',')) + '"></div>' +
              '<div class="med-valor"><span class="med-rot">Nesta medição</span>' +
                '<b data-valor="' + esc(i.id) + '">R$ 0,00</b></div>' +
            '</div>';
          }).join('') +
        '</div>' +

        '<div class="grade g2" style="margin-top:14px">' +
          '<div class="indicador"><div class="rotulo">Bruto do período</div><div class="valor" id="mBruto">R$ 0,00</div></div>' +
          '<div class="indicador ok"><div class="rotulo">Líquido a pagar</div><div class="valor" id="mLiquido">R$ 0,00</div></div>' +
        '</div>' +

        '<h3 style="margin-top:14px">Descontos</h3>' +
        '<p class="legenda">Retenção de ' + fmt.numero(retPerc, 1) + '% já sai automática' +
          (t.adiantamentoSaldo ? ' · adiantamento a amortizar: ' + fmt.brl(t.adiantamentoSaldo) : '') + '.</p>' +
        '<div id="mDescontos"></div>' +
        '<button class="btn pequeno" id="maisDesc">+ Desconto</button>' +
        campo('Observação da medição', areaTexto('obs', '')) +
      '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar medição', classe: 'primario', aoClicar: (fundo) => salvarMedicao(fundo, o, numero, retPerc) }
    ]
  });

  const linhaDesconto = (d = {}) =>
    '<div class="item-linha desconto-linha" data-desc>' +
      '<div class="campo descricao"><label>Descrição</label>' +
        '<input type="text" data-d="descricao" value="' + esc(d.descricao || '') + '" placeholder="Ex.: material fornecido pela obra"></div>' +
      '<div class="campo"><label>Tipo</label><select data-d="tipo">' +
        [['adiantamento', 'Amortização de adiantamento'], ['material', 'Material da obra'], ['multa', 'Multa'], ['outro', 'Outro']]
          .map(([v, txt]) => '<option value="' + v + '"' + (d.tipo === v ? ' selected' : '') + '>' + txt + '</option>').join('') +
      '</select></div>' +
      '<div class="campo"><label>Valor (R$)</label><input type="text" data-d="valor" inputmode="decimal" value="' + esc(d.valor || '') + '"></div>' +
      '<button class="lixeira" data-tirar>✕</button>' +
    '</div>';

  const caixaDesc = document.getElementById('mDescontos');
  if (t.adiantamentoSaldo) {
    caixaDesc.insertAdjacentHTML('beforeend', linhaDesconto({
      descricao: 'Amortização de adiantamento', tipo: 'adiantamento', valor: ''
    }));
  }
  const ligarDesc = (linha) => {
    linha.querySelector('[data-tirar]').addEventListener('click', () => { linha.remove(); recalcMedicao(o, retPerc); });
    linha.querySelectorAll('input,select').forEach((i) => i.addEventListener('input', () => recalcMedicao(o, retPerc)));
  };
  Array.from(caixaDesc.children).forEach(ligarDesc);
  document.getElementById('maisDesc').addEventListener('click', () => {
    caixaDesc.insertAdjacentHTML('beforeend', linhaDesconto());
    ligarDesc(caixaDesc.lastElementChild);
  });
  document.querySelectorAll('[data-perc]').forEach((i) => i.addEventListener('input', () => recalcMedicao(o, retPerc)));
  recalcMedicao(o, retPerc);
}

// Lê sempre dentro do modal que está À VISTA: com dois modais empilhados o
// querySelector global pegava os campos do modal escondido.
const modalAtual = () => {
  const todos = Array.from(document.querySelectorAll('.fundo-modal')).filter((f) => f.style.display !== 'none');
  return todos[todos.length - 1] || document;
};

function lerLinhasMedicao(o) {
  const raiz = modalAtual();
  return (o.itens || []).map((i) => {
    const inp = raiz.querySelector('[data-perc="' + i.id + '"]');
    if (!inp) return null;
    const ant = percMedido(o, i.id);
    let perc = numeroBR(inp.value);
    if (perc > 100) perc = 100;
    if (perc < 0) perc = 0;
    return { item: i, ant, perc, valorPeriodo: valorItem(i) * Math.max(0, perc - ant) / 100 };
  }).filter(Boolean);
}

function lerDescontosMedicao() {
  return Array.from(document.querySelectorAll('[data-desc]')).map((l) => ({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    descricao: (l.querySelector('[data-d=descricao]').value || '').trim(),
    tipo: l.querySelector('[data-d=tipo]').value,
    valor: numeroBR(l.querySelector('[data-d=valor]').value)
  })).filter((d) => d.valor > 0);
}

function recalcMedicao(o, retPerc) {
  const linhas = lerLinhasMedicao(o);
  let bruto = 0;
  for (const l of linhas) {
    bruto += l.valorPeriodo;
    const cel = modalAtual().querySelector('[data-valor="' + l.item.id + '"]');
    if (cel) {
      cel.textContent = fmt.brl(l.valorPeriodo);
      const linha = cel.closest('.med-linha');
      const erro = l.perc < l.ant - 0.005;
      cel.style.color = erro ? 'var(--vermelho)' : '';
      if (linha) linha.classList.toggle('med-erro', erro);
    }
  }
  const retencao = bruto * retPerc / 100;
  const descontos = lerDescontosMedicao().reduce((s, d) => s + d.valor, 0);
  const b = document.getElementById('mBruto');
  const q = document.getElementById('mLiquido');
  if (b) b.textContent = fmt.brl(bruto);
  if (q) q.textContent = fmt.brl(bruto - retencao - descontos);
}

function salvarMedicao(fundo, o, numero, retPerc) {
  const d = lerCampos(fundo.querySelector('#fMed'));
  const linhas = lerLinhasMedicao(o);

  const voltou = linhas.filter((l) => l.perc < l.ant - 0.005);   // tolera ruído de ponto flutuante
  if (voltou.length) {
    toast('Etapa não pode ter menos que já foi medido: ' + voltou[0].item.descricao, 'ruim');
    return;
  }
  if (d.de && d.ate && d.de > d.ate) {
    toast('O período está invertido: a data final é anterior à inicial', 'ruim');
    return;
  }
  const bruto = linhas.reduce((s, l) => s + l.valorPeriodo, 0);
  if (bruto <= 0) { toast('Nenhuma etapa avançou nesta medição', 'ruim'); return; }

  const descontos = lerDescontosMedicao();

  // Não dá para amortizar mais adiantamento do que foi adiantado.
  const t0 = totaisOS(o);
  const amortAgora = descontos.filter((d) => d.tipo === 'adiantamento').reduce((s, d) => s + d.valor, 0);
  if (amortAgora > t0.adiantamentoSaldo + 0.005) {
    toast('A amortização passa do adiantamento em aberto (' + fmt.brl(t0.adiantamentoSaldo) + ')', 'ruim');
    return;
  }

  const retencao = bruto * retPerc / 100;
  const totalDesc = descontos.reduce((s, x) => s + x.valor, 0);
  const liquido = bruto - retencao - totalDesc;
  if (liquido < 0) { toast('Os descontos passaram do valor da medição', 'ruim'); return; }

  const m = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    numero, de: d.de, ate: d.ate, em: new Date().toISOString(), por: S.quem || '—',
    itens: linhas.map((l) => ({ itemId: l.item.id, perc: l.perc, valorPeriodo: l.valorPeriodo })),
    bruto, retencaoPerc: retPerc, retencao, descontos, liquido,
    situacao: 'rascunho', obs: d.obs
  };
  // Relê o registro na hora de gravar: o modal fica aberto por minutos e nesse
  // tempo o outro aparelho pode ter lançado um aditivo. Gravar por cima do
  // retrato antigo apagava as etapas novas (itens não é campo de união).
  const atual = achar('os', o.id) || o;
  const n = Object.assign({}, atual, { medicoes: [...(atual.medicoes || []), m] });
  if (atual.situacao === 'emitida') n.situacao = 'andamento';
  n.historico = historiar(atual, 'Medição ' + String(numero).padStart(2, '0') + ' lançada: bruto ' +
    fmt.brl(bruto) + ', líquido ' + fmt.brl(liquido));
  salvar('os', n);
  fecharEste(fundo);
  render();
  toast('Medição lançada. Aprove para liberar o pagamento.', 'bom');
}

let _aprovando = false;

async function aprovarMedicao(o, mid) {
  if (_aprovando) return;                 // dois toques no celular aprovavam duas vezes
  _aprovando = true;
  try { await aprovarMedicaoPasso(o, mid); } finally { _aprovando = false; }
}

async function aprovarMedicaoPasso(o, mid) {
  const m = (o.medicoes || []).find((x) => x.id === mid);
  if (!m) return;
  if (o.situacao === 'cancelada') { toast('Esta ordem de serviço está cancelada', 'ruim'); return; }
  if (m.situacao !== 'rascunho') { toast('Esta medição já foi ' + (SITUACOES[m.situacao] || {}).txt, 'ruim'); return; }
  if (numerosRepetidos(o).includes(String(m.numero).padStart(2, '0'))) {
    toast('Existe outra medição com o mesmo número. Cancele a que está sobrando antes de aprovar.', 'ruim');
    return;
  }
  const p = prestadorDaOS(o);

  // Sem prestador cadastrado não há pasta para conferir — e aí a checagem de
  // CND/ASO/NR passaria calada, que é o oposto do que este módulo existe para
  // fazer. Avisa com todas as letras antes de liberar dinheiro.
  if (!p) {
    const seguirSemPasta = await new Promise((resolve) => {
      abrirModal({
        titulo: 'Serviço sem prestador cadastrado',
        corpo:
          '<div class="aviso atencao">Esta ordem não está ligada a nenhum prestador na aba Prestadores, ' +
          'então não dá para conferir contrato, CND, ASO nem NR de quem está na obra.</div>' +
          '<p class="legenda">Ligue a um cadastro para o sistema conseguir te avisar antes de liberar pagamento.</p>',
        aoFechar: () => resolve(false),
        acoes: [
          { texto: 'Cadastrar/ligar agora', aoClicar: (f) => { fecharSilencioso(f); resolve('ligar'); } },
          { texto: 'Aprovar assim mesmo', classe: 'perigo', aoClicar: (f) => { fecharSilencioso(f); resolve(true); } }
        ]
      });
    });
    if (seguirSemPasta === 'ligar') { irPara('prestadores'); return; }
    if (!seguirSemPasta) return;
  }

  const graves = pendenciasPrestador(p).filter((x) => x.grave);

  if (graves.length) {
    const seguir = await new Promise((resolve) => {
      abrirModal({
        titulo: 'Pendência na pasta do prestador',
        corpo:
          '<div class="aviso ruim">Aprovar medição com documento vencido é o caminho mais curto para a ' +
          'Domo responder junto por encargo trabalhista do prestador.</div>' +
          '<ul>' + graves.map((x) => '<li>' + esc(x.o_que) + '</li>').join('') + '</ul>',
        aoFechar: () => resolve(false),
        acoes: [
          { texto: 'Resolver antes', aoClicar: (f) => { fecharSilencioso(f); resolve('resolver'); } },
          { texto: 'Aprovar mesmo assim', classe: 'perigo', aoClicar: (f) => { fecharSilencioso(f); resolve(true); } }
        ]
      });
    });
    if (seguir === 'resolver') { if (p) irPara('prestadores/' + p.id); return; }
    if (!seguir) return;
  }

  const atual = achar('os', o.id) || o;
  const medicoes = (atual.medicoes || []).map((x) => x.id === mid
    ? Object.assign({}, x, { situacao: 'aprovada', aprovadaEm: new Date().toISOString(), aprovadaPor: S.quem || '—' })
    : x);
  const n = Object.assign({}, atual, { medicoes });
  n.historico = historiar(o, 'Medição ' + String(m.numero).padStart(2, '0') + ' aprovada — ' +
    fmt.brl(m.liquido) + ' liberado para pagamento' +
    (graves.length ? ' (com pendência de documento)' : !p ? ' (sem prestador cadastrado para conferir)' : ''));
  salvar('os', n);
  render();
  toast('Medição aprovada', 'bom');
}

async function pagarMedicao(o, mid) {
  const m = (o.medicoes || []).find((x) => x.id === mid);
  if (!m) return;
  if (m.situacao !== 'aprovada') { toast('Só medição aprovada pode ser marcada como paga', 'ruim'); return; }
  // Ordem cancelada NÃO trava o pagamento de medição já aprovada: o serviço
  // daquele trecho foi executado e o prestador tem direito a receber.
  if (o.situacao === 'cancelada' &&
      !await confirmar('Esta ordem de serviço foi cancelada, mas a medição ' +
        String(m.numero).padStart(2, '0') + ' já estava aprovada (' + fmt.brl(m.liquido) + '). ' +
        'Confirmar o pagamento do que foi executado?', { ok: 'Confirmar pagamento' })) return;
  const data = await perguntarData('Data do pagamento de ' + fmt.brl(m.liquido), {
    titulo: 'Medição ' + String(m.numero).padStart(2, '0') + ' paga', valor: hojeISO(), ok: 'Confirmar'
  });
  if (!data) return;
  const atual = achar('os', o.id) || o;
  const medicoes = (atual.medicoes || []).map((x) => x.id === mid
    ? Object.assign({}, x, { situacao: 'paga', pagoEm: data, pagoPor: S.quem || '—' }) : x);
  const n = Object.assign({}, atual, { medicoes });
  n.historico = historiar(o, 'Medição ' + String(m.numero).padStart(2, '0') + ' paga: ' + fmt.brl(m.liquido));
  salvar('os', n);
  render();
}

// Medição lançada errada precisa ter saída: sem isso um percentual digitado a
// mais travava a etapa para sempre (o acumulado só subia).
async function cancelarMedicao(o, mid) {
  const m = (o.medicoes || []).find((x) => x.id === mid);
  if (!m) return;
  if (m.situacao === 'paga') { toast('Medição já paga não pode ser cancelada', 'ruim'); return; }

  // O AVANÇO vem sempre da última medição; o DINHEIRO é somado medição por
  // medição. Cancelar uma do meio deixava o acumulado lá em cima e tirava o
  // valor da conta — e nenhuma medição nova conseguia refaturar aquele trecho,
  // porque só aceita percentual acima do acumulado. O prestador perdia o
  // dinheiro e a tela não mostrava buraco nenhum.
  const posteriores = medicoesValidas(achar('os', o.id) || o).filter((x) =>
    x.id !== mid && ((x.numero || 0) > (m.numero || 0) ||
      ((x.numero || 0) === (m.numero || 0) && String(x.em || '') > String(m.em || ''))));
  if (posteriores.length) {
    const nomes = posteriores.map((x) => String(x.numero).padStart(2, '0')).join(', ');
    const paga = posteriores.some((x) => x.situacao === 'paga');
    await confirmar('A medição ' + nomes + ' é posterior a esta e usa o acumulado dela. ' +
      'Cancele a ' + nomes + ' primeiro.' +
      (paga ? ' Como ela já foi paga, o caminho para recuperar este trecho é lançar um aditivo.' : ''),
      { titulo: 'Não dá para cancelar esta', ok: 'Entendi', cancelar: 'Fechar' });
    return;
  }

  const motivo = await perguntar('Por que está cancelando a medição ' + String(m.numero).padStart(2, '0') + '?',
    { titulo: 'Cancelar medição', multi: true, obrigatorio: true, ok: 'Cancelar medição' });
  if (!motivo) return;
  const atual = achar('os', o.id) || o;
  const medicoes = (atual.medicoes || []).map((x) => x.id === mid
    ? Object.assign({}, x, { situacao: 'cancelada', canceladaEm: new Date().toISOString(),
        canceladaPor: S.quem || '—', motivoCancelamento: motivo }) : x);
  const n = Object.assign({}, atual, { medicoes });
  n.historico = historiar(atual, 'Medição ' + String(m.numero).padStart(2, '0') + ' cancelada: ' + motivo);
  salvar('os', n);
  render();
  toast('Medição ' + String(m.numero).padStart(2, '0') + ' cancelada', 'bom');
}

async function liberarRetencao(o) {
  const t = totaisOS(o);
  // Só devolve o que foi efetivamente retido de um pagamento.
  if (t.naoPagas) {
    toast('Há ' + t.naoPagas + ' medição(ões) sem pagamento — a garantia delas ainda não foi retida.', 'ruim');
    return;
  }
  if (!await confirmar('Liberar a retenção de ' + fmt.brl(t.retido) + ' para o prestador? ' +
    'Faça isso só depois de conferir o serviço.', { titulo: 'Liberar garantia', ok: 'Liberar' })) return;
  const atual = achar('os', o.id) || o;
  const n = Object.assign({}, atual, {
    retencaoLiberada: { em: hojeISO(), por: S.quem || '—', valor: t.retido }
  });
  n.historico = historiar(atual, 'Retenção de garantia liberada: ' + fmt.brl(t.retido));
  salvar('os', n);
  render();
  toast('Retenção liberada', 'bom');
}

/* ── Aditivo: serviço extra que entra no contrato ──────────────────────────── */
// Adiantamento em qualquer momento do contrato. Antes era um campo do editor,
// e o editor tranca assim que a primeira medição joga a ordem para "em
// andamento" — depois disso não havia onde lançar o segundo adiantamento.
function lancarAdiantamento(o) {
  abrirModal({
    titulo: 'Lançar adiantamento',
    corpo: '<p class="legenda">Dinheiro entregue ao prestador antes de medir. ' +
      'Entra no "Já pago" e vira saldo a amortizar nas próximas medições.</p>' +
      '<div id="fAdiant">' +
        '<div class="linha">' +
          campo('Valor', entrada('valor', '', { inputmode: 'decimal', placeholder: '0,00' })) +
          campo('Data', entrada('em', hojeISO(), { tipo: 'date' })) +
        '</div>' +
        campo('Autorizado por', entrada('por', S.quem || '')) +
        campo('Observação', entrada('obs', '', { placeholder: 'Ex.: compra de placa de gesso' })) +
      '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Lançar', classe: 'primario', aoClicar: (fundo) => {
        const d = lerCampos(fundo.querySelector('#fAdiant'));
        const valor = numeroBR(d.valor);
        if (valor <= 0) { toast('Informe o valor', 'ruim'); return; }
        const atual = achar('os', o.id) || o;   // relê: outro aparelho pode ter mexido
        const lanc = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          valor, em: d.em || hojeISO(), por: d.por || S.quem || '—', obs: d.obs
        };
        const n = Object.assign({}, atual, { adiantamentos: [...(atual.adiantamentos || []), lanc] });
        n.historico = historiar(atual, 'Adiantamento de ' + fmt.brl(valor) + ' em ' + fmt.data(lanc.em) +
          ' (autorizado por ' + lanc.por + ')' + (d.obs ? ' — ' + d.obs : ''));
        salvar('os', n);
        fecharEste(fundo); render();
        toast('Adiantamento lançado', 'bom');
      } }
    ]
  });
}

function lancarAditivo(o) {
  abrirModal({
    titulo: 'Aditivo — serviço extra',
    largo: true,
    corpo: '<p class="legenda">O que foi combinado a mais entra como etapa nova do contrato, ' +
      'com data e responsável registrados.</p>' +
      '<div id="fAdit"><div id="itensAdit">' + linhaItem({}, true) + '</div>' +
      '<button class="btn pequeno" id="maisAdit">+ Etapa</button>' +
      campo('Motivo do aditivo', areaTexto('motivo', '', 'Ex.: cliente pediu sanca no hall dos 7 pavimentos')) +
      '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Lançar aditivo', classe: 'primario', aoClicar: (fundo) => {
        const caixa = fundo.querySelector('#itensAdit');
        const novos = lerItens(caixa, true).map((i) => Object.assign({}, i, { aditivoEm: hojeISO() }));
        if (!novos.length) { toast('Escreva o serviço extra', 'ruim'); return; }
        const d = lerCampos(fundo.querySelector('#fAdit'));
        const valor = novos.reduce((s, i) => s + valorItem(i), 0);
        const atual = achar('os', o.id) || o;   // relê: outro aparelho pode ter mexido
        const itens = [...(atual.itens || []), ...novos];
        const n = Object.assign({}, atual, { itens, total: itens.reduce((s, i) => s + valorItem(i), 0) });
        n.historico = historiar(atual, 'Aditivo de ' + fmt.brl(valor) + ' (' + novos.length + ' etapa(s))' +
          (d.motivo ? ': ' + d.motivo : ''));
        salvar('os', n);
        fecharEste(fundo); render();
        toast('Aditivo lançado', 'bom');
      } }
    ]
  });
  const caixa = document.getElementById('itensAdit');
  const ligar = (linha) => linha.querySelector('[data-tirar]').addEventListener('click', () => {
    if (caixa.children.length > 1) linha.remove();
  });
  Array.from(caixa.children).forEach(ligar);
  document.getElementById('maisAdit').addEventListener('click', () => {
    caixa.insertAdjacentHTML('beforeend', linhaItem({}, true));
    ligar(caixa.lastElementChild);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   DIÁRIO DO SERVIÇO
   ══════════════════════════════════════════════════════════════════════════ */
function novoApontamento(o) {
  const fotos = [];
  const enviando = { qtd: 0, get tem() { return this.qtd > 0; } };
  // A construtora responde junto pelo que acontece com quem está no canteiro.
  // Contar cabeça sem olhar o documento de quem entrou é o pior dos dois
  // mundos: fica o registro de que a pessoa estava lá e não fica a prova de
  // que ela podia estar.
  const p = prestadorDaOS(o);
  const pend = p ? pendenciasPrestador(p) : [];
  const graves = pend.filter((x) => x.grave);
  const equipe = equipeViva(p).filter((x) => x.ativo !== false);

  abrirModal({
    titulo: 'Apontamento do dia — ' + (o.codigo || ''),
    corpo: '<div id="fDia">' +
      (graves.length
        ? '<div class="aviso ruim"><b>Atenção antes de apontar:</b> ' +
          esc(graves.slice(0, 4).map((x) => x.o_que).join(' · ')) +
          (graves.length > 4 ? ' e mais ' + (graves.length - 4) : '') +
          '. Documento vencido de quem está no canteiro é responsabilidade da Domo.</div>'
        : '') +
      '<div class="linha">' +
        campo('Data', entrada('data', hojeISO(), { tipo: 'date' })) +
        campo('Quantas pessoas vieram', entrada('efetivo', '', { inputmode: 'numeric', placeholder: '0' }),
          equipe.length ? 'A pasta dele tem ' + equipe.length + ' pessoa(s) cadastrada(s).' : '') +
      '</div>' +
      (equipe.length
        ? '<div class="campo"><label>Quem veio hoje</label>' +
          '<div class="miniaturas" style="gap:6px;flex-wrap:wrap">' +
          equipe.map((x) => {
            const dele = pend.filter((y) => y.pessoaId === x.id);
            const ruim = dele.some((y) => y.grave);
            return '<label class="etiqueta ' + (ruim ? 'et-vencido' : 'et-valido') +
              '" style="cursor:pointer;display:inline-flex;gap:5px;align-items:center;padding:6px 10px">' +
              '<input type="checkbox" data-pessoa="' + esc(x.id) + '" style="width:auto;min-height:0;margin:0">' +
              esc(x.nome) + (ruim ? ' ⚠️' : '') + '</label>';
          }).join('') + '</div>' +
          '<div class="dica">Quem está em vermelho tem documento vencido (ASO, NR ou ficha). ' +
          'Marcar aqui deixa registrado quem entrou.</div></div>'
        : '') +
      campo('O que foi feito hoje', entrada('atividade', '', { placeholder: 'Ex.: forro do 4º pav., eixo A ao D' })) +
      campo('Observação', areaTexto('obs', '', 'Faltou material? Choveu? Alguém foi embora cedo?')) +
      '<div class="campo"><label>Fotos do avanço</label>' +
        '<input type="file" id="diaFotos" accept="image/*" capture="environment" multiple>' +
        '<div class="miniaturas" id="diaMini" style="margin-top:8px"></div>' +
        '<div class="progresso" id="diaProg" style="display:none;margin-top:8px"><i></i></div></div>' +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar apontamento', classe: 'primario', aoClicar: (fundo) => {
        if (enviando.tem) { toast('Espere as fotos terminarem de subir', 'ruim'); return; }
        const d = lerCampos(fundo.querySelector('#fDia'));
        if (!d.data) { toast('Informe a data', 'ruim'); return; }
        const presentes = Array.from(fundo.querySelectorAll('[data-pessoa]:checked')).map((x) => x.dataset.pessoa);
        const comProblema = presentes.filter((pid) => pend.some((y) => y.pessoaId === pid && y.grave));
        const reg = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          data: d.data, em: new Date().toISOString(), por: S.quem || '—',
          efetivo: numeroBR(d.efetivo), atividade: d.atividade, obs: d.obs, fotos: fotos.slice(),
          presentes,
          // Fica marcado no diário: se der problema, a data em que a pessoa
          // entrou com documento vencido está registrada.
          alertaDocumento: comProblema.length
            ? comProblema.map((pid) => (equipe.find((x) => x.id === pid) || {}).nome).filter(Boolean).join(', ')
            : ''
        };
        const n = Object.assign({}, o, { diario: [...(o.diario || []), reg] });
        n.historico = historiar(o, 'Diário ' + fmt.data(d.data) + ': ' + fmt.numero(reg.efetivo, 0) +
          ' pessoa(s)' + (d.atividade ? ' — ' + d.atividade : '') +
          (reg.alertaDocumento ? ' · DOCUMENTO VENCIDO: ' + reg.alertaDocumento : ''));
        salvar('os', n);
        fecharEste(fundo); render();
        if (reg.alertaDocumento) toast('Apontamento salvo — mas ' + reg.alertaDocumento +
          ' está com documento vencido. Regularize antes da próxima medição.', 'ruim');
        else toast('Apontamento salvo', 'bom');
      } }
    ]
  });

  const campoFotos = document.getElementById('diaFotos');
  const mini = document.getElementById('diaMini');
  const prog = document.getElementById('diaProg');
  campoFotos.addEventListener('change', async () => {
    for (const file of Array.from(campoFotos.files || [])) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.style.opacity = '.45';
      mini.appendChild(img);
      prog.style.display = '';
      enviando.qtd++;
      try {
        const menor = await encolherFoto(file);
        const meta = await enviarArquivo(menor, (p) => { prog.querySelector('i').style.width = (p * 100) + '%'; });
        fotos.push(meta.id);
        img.style.opacity = '1';
      } catch (e) {
        img.remove();
        toast('Não consegui subir a foto: ' + e.message, 'ruim');
      } finally { enviando.qtd--; }
    }
    prog.style.display = 'none';
    campoFotos.value = '';
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   AVALIAÇÃO
   ══════════════════════════════════════════════════════════════════════════ */
const CRITERIOS = [
  ['qualidade', 'Qualidade do serviço'],
  ['prazo', 'Cumpriu o prazo'],
  ['limpeza', 'Organização e limpeza'],
  ['seguranca', 'Segurança (EPI, NR)']
];

function avaliarPrestador(o) {
  if (o.avaliacao) { toast('Esta ordem já foi avaliada', ''); return; }
  if (!o) return;
  const notas = (v) => [5, 4, 3, 2, 1].map((n) =>
    '<option value="' + n + '"' + (n === 4 ? ' selected' : '') + '>' + '★'.repeat(n) + ' ' + n + '</option>').join('');
  abrirModal({
    titulo: 'Avaliar ' + ((o.empreiteiro || {}).nome || 'o prestador'),
    corpo: '<p class="legenda">Fica no cadastro dele. É o que decide se contrata de novo na próxima obra.</p>' +
      '<div id="fAval">' +
        CRITERIOS.map(([k, rot]) => campo(rot, '<select data-campo="' + k + '">' + notas() + '</select>')).join('') +
        campo('Observação', areaTexto('obs', '', 'O que funcionou, o que não repetir')) +
      '</div>',
    acoes: [
      { texto: 'Depois', aoClicar: () => fecharModal() },
      { texto: 'Salvar avaliação', classe: 'primario', aoClicar: (fundo) => {
        const d = lerCampos(fundo.querySelector('#fAval'));
        const valores = CRITERIOS.map(([k]) => Number(d[k]) || 0);
        const media = valores.reduce((s, x) => s + x, 0) / valores.length;
        const aval = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          // id determinístico: se cair duas vezes, a união por id funde em vez
          // de duplicar e derrubar a média do prestador.
          id: 'av_' + o.id,
          osId: o.id, osCodigo: o.codigo, em: new Date().toISOString(), por: S.quem || '—',
          qualidade: Number(d.qualidade), prazo: Number(d.prazo),
          limpeza: Number(d.limpeza), seguranca: Number(d.seguranca),
          media, obs: d.obs
        };
        const n = Object.assign({}, o, { avaliacao: aval });
        n.historico = historiar(o, 'Prestador avaliado: ' + fmt.numero(media, 1) + ' de 5');
        salvar('os', n);

        const p = prestadorDaOS(o);
        if (p) salvar('prest', Object.assign({}, p, { avaliacoes: [...(p.avaliacoes || []), aval] }));

        fecharEste(fundo); render();
        toast('Avaliação salva', 'bom');
      } }
    ]
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   PRESTADORES — pasta (documentos + equipe)
   ══════════════════════════════════════════════════════════════════════════ */
// O cadastro de prestador mora junto com o de fornecedor (aba "Fornecedores e
// prestadores") — são as duas metades da mesma agenda: quem vende material e
// quem vende mão de obra. Aqui fica só a ficha individual.
TELAS.prestadores = function (el, args) {
  if (args[0]) return telaPrestador(el, args[0]);
  _abaForn = 'mo';
  // replace em vez de irPara: empilhar no histórico prendia o botão "voltar".
  location.replace('#/fornecedores');
};

function htmlPrestadores() {
  // Mesma régua do fornecedor: melhor qualificado em cima.
  const todos = prestadores().map((p) => Object.assign({ p }, notaPrestador(p)))
    .sort((a, b) => (b.nota == null ? -1 : b.nota) - (a.nota == null ? -1 : a.nota) ||
      String(a.p.nome || '').localeCompare(String(b.p.nome || '')));
  return '<div class="cartao">' +
    (todos.length ?
      '<div class="tabela-rolagem"><table><thead><tr><th>Prestador</th><th>Nota</th><th>Especialidade</th>' +
      '<th>Contato</th><th>Equipe</th><th>Pasta</th><th>No prazo</th></tr></thead><tbody>' +
      todos.map(({ p, nota, desempenho, estrelas: est, provisorio }) => {
        const pend = pendenciasPrestador(p);
        const graves = pend.filter((x) => x.grave).length;
        return '<tr class="clicavel" data-id="' + esc(p.id) + '">' +
          '<td><b>' + esc(p.nome) + '</b>' + (p.situacao === 'inativo' ? ' <span class="etiqueta">inativo</span>' : '') +
            '<div style="font-size:.8rem;color:var(--texto-fraco)">' + esc(fmt.doc(p.cnpjCpf)) + '</div></td>' +
          '<td>' + selo(nota, { provisorio }) +
            (est != null ? '<div style="font-size:.8rem;color:var(--dourado)">' + estrelasDe(est) + '</div>' : '') + '</td>' +
          '<td>' + esc(p.especialidade || '—') + '</td>' +
          '<td>' + esc(p.contato || '') + '<div style="font-size:.8rem;color:var(--texto-fraco)">' +
            esc(fmt.telefone(p.telefone)) + '</div></td>' +
          '<td>' + equipeViva(p).filter((x) => x.ativo !== false).length + ' pessoa(s)</td>' +
          '<td>' + (graves ? '<span class="etiqueta et-vencido">' + graves + ' pendência(s)</span>'
            : pend.length ? '<span class="etiqueta et-vencendo">vencendo</span>'
            : '<span class="etiqueta et-valido">em dia</span>') + '</td>' +
          '<td>' + (desempenho.pontualidade == null ? '—'
            : fmt.numero(desempenho.pontualidade * 100, 0) + '%' +
              (desempenho.atrasoMedio ? '<div style="font-size:.78rem;color:var(--vermelho)">+' +
                fmt.numero(desempenho.atrasoMedio, 0) + 'd</div>' : '')) + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      : vazio('👷', 'Nenhum prestador cadastrado',
        'O gesseiro, o eletricista, o pintor. Guarde CND, contrato e a ficha de quem ele traz.')) +
    '</div>';
}

function ligarPrestadores(el) {
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => irPara('prestadores/' + tr.dataset.id)));
}

function telaPrestador(el, id) {
  const p = achar('prest', id);
  if (!p) { cabecalho('Prestador', ''); el.innerHTML = vazio('🤔', 'Não encontrado'); return; }
  const pend = pendenciasPrestador(p);
  const graves = pend.filter((x) => x.grave);
  const oss = lista('os').filter((o) => o.prestadorId === p.id);
  const n = notaMedia(p);

  cabecalho(p.nome, p.especialidade || 'Prestador de serviço',
    '<a class="btn" href="#/prestadores">← Voltar</a>' +
    (p.telefone ? '<button class="btn zap" id="pZap">WhatsApp</button>' : '') +
    '<button class="btn" id="pEditar">Editar cadastro</button>');

  el.innerHTML =
    (pend.length
      ? '<div class="aviso ' + (graves.length ? 'ruim' : 'atencao') + '">' +
        '<b>' + (graves.length ? 'Pendências que travam a medição:' : 'Vencendo em breve:') + '</b><br>' +
        pend.map((x) => (x.grave ? '⛔ ' : '⚠️ ') + esc(x.o_que)).join('<br>') + '</div>'
      : '<div class="aviso bom">Pasta em dia: documentos e equipe dentro da validade.</div>') +

    '<div class="grade g2"><div>' +
      // documentos
      '<div class="cartao">' +
        '<div class="barra-acoes" style="justify-content:space-between">' +
          '<h3 style="margin:0">📄 Documentos</h3>' +
          '<button class="btn pequeno" id="pNovoDoc">+ Documento</button></div>' +
        (docsVivos(p).length
          ? '<div class="tabela-rolagem"><table><thead><tr><th>Documento</th><th>Validade</th><th>Situação</th><th></th></tr></thead><tbody>' +
            docsVivos(p).map((d) => {
              const semAnexo = d.pendenteArquivo;
              const s = situacaoDoc(d);
              const sub = [d.numero, d.orgao].filter(Boolean).join(' · ');
              return '<tr><td><b>' + esc(d.tipo) + '</b>' +
                (sub ? '<div style="font-size:.8rem;color:var(--texto-fraco)">' + esc(sub) + '</div>' : '') + '</td>' +
                '<td>' + (d.validadeEm ? fmt.data(d.validadeEm) : '—') + '</td>' +
                '<td><span class="etiqueta ' + s.cls + '">' + esc(s.txt) + '</span>' +
                  (semAnexo ? ' <span class="etiqueta et-vencendo">falta o arquivo</span>' : '') + '</td>' +
                '<td class="num">' +
                  (d.arquivoId ? '<button class="btn pequeno primario" data-pbaixar="' + esc(d.id) + '">Abrir</button> ' : '') +
                  '<button class="btn pequeno" data-pdoc="' + esc(d.id) + '">Editar</button></td></tr>';
            }).join('') + '</tbody></table></div>'
          : '<p class="legenda">Sem documento nenhum. O mínimo: contrato assinado, CND FGTS e CNDT.</p>') +
      '</div>' +

      // equipe
      '<div class="cartao">' +
        '<div class="barra-acoes" style="justify-content:space-between">' +
          '<h3 style="margin:0">👥 Equipe na obra</h3>' +
          '<button class="btn pequeno" id="pNovaPessoa">+ Pessoa</button></div>' +
        '<p class="legenda">Quem o prestador põe dentro da obra. Sem ASO e NR válidos, ninguém entra — ' +
          'e a Domo responde junto se acontecer alguma coisa.</p>' +
        (equipeViva(p).length
          ? '<div class="tabela-rolagem"><table><thead><tr><th>Quem</th><th>ASO</th><th>Treinamentos</th><th></th></tr></thead><tbody>' +
            equipeViva(p).map((pes) => {
              const aso = pes.asoValidadeEm ? situacaoDoc({ validadeEm: pes.asoValidadeEm }) : { cls: 'et-vencido', txt: 'sem ASO' };
              return '<tr' + (pes.ativo === false ? ' style="opacity:.5"' : '') + '>' +
                '<td><b>' + esc(pes.nome) + '</b>' + (pes.ativo === false ? ' <span class="etiqueta">saiu</span>' : '') +
                  '<div style="font-size:.8rem;color:var(--texto-fraco)">' + esc(pes.funcao || '—') +
                  // CPF de terceiro não precisa ficar inteiro numa listagem —
                  // fica completo só no cadastro da pessoa.
                  (pes.cpf ? ' · CPF •••.' + esc(String(pes.cpf).replace(/\D/g, '').slice(-5, -2)) +
                    '-' + esc(String(pes.cpf).replace(/\D/g, '').slice(-2)) : '') + '</div></td>' +
                '<td><span class="etiqueta ' + aso.cls + '">' + esc(pes.asoValidadeEm ? fmt.data(pes.asoValidadeEm) : 'sem ASO') + '</span></td>' +
                '<td>' + ((pes.treinamentos || []).length
                  ? (pes.treinamentos || []).map((t) => {
                      const st = t.validadeEm ? situacaoDoc({ validadeEm: t.validadeEm }) : { cls: '', txt: '' };
                      return '<span class="etiqueta ' + st.cls + '">' + esc(t.nome.split(' ')[0]) + '</span>';
                    }).join(' ')
                  : '<span class="etiqueta et-vencido">nenhum</span>') + '</td>' +
                '<td class="num"><button class="btn pequeno" data-ppessoa="' + esc(pes.id) + '">Editar</button></td></tr>';
            }).join('') + '</tbody></table></div>'
          : '<p class="legenda">Nenhuma pessoa cadastrada.</p>') +
      '</div>' +
    '</div><div>' +
      // A ficha explica de onde saiu cada ponto da nota — nota sem explicação
      // é palpite, e ninguém confia em palpite para escolher empreiteiro.
      cartaoQualificacao(notaPrestador(p), 'prest') +
      '<div class="cartao"><h3>Dados</h3><p>' +
        '<b>' + esc(p.nome) + '</b> ' + esc(p.tipo || '') + '<br>' +
        esc(fmt.doc(p.cnpjCpf) || '—') + '<br>' +
        (p.contato ? esc(p.contato) + '<br>' : '') +
        esc(fmt.telefone(p.telefone)) + (p.email ? '<br>' + esc(p.email) : '') +
        (p.responsavelTecnico ? '<br><b>Resp. técnico:</b> ' + esc(p.responsavelTecnico) : '') +
        (p.pix ? '<br><b>PIX:</b> ' + esc(p.pix) : '') +
        (p.banco ? '<br>' + esc(p.banco) : '') +
      '</p>' + (p.obs ? '<p class="legenda">' + esc(p.obs) + '</p>' : '') + '</div>' +

      '<div class="cartao"><h3>⭐ Avaliações</h3>' +
        (n == null ? '<p class="legenda">Ainda não foi avaliado.</p>'
          : '<p style="font-size:1.3rem">' + estrelas(n) + ' <b>' + fmt.numero(n, 1) + '</b></p>' +
            (p.avaliacoes || []).slice().reverse().map((a) => {
              // O código da OS pode não ter sido gravado (avaliação antiga) —
              // busca pelo id em vez de deixar a linha começar com " · ".
              const os = a.osId ? achar('os', a.osId) : null;
              const rotulo = a.osCodigo || (os && os.codigo) || 'Serviço';
              return '<div class="arquivo-solto"><span class="ic">⭐</span><div>' +
                '<div class="nome">' + esc(rotulo) + ' · ' + fmt.numero(a.media, 1) + '</div>' +
                '<div class="meta">' + fmt.data(a.em) + (a.por ? ' por ' + esc(a.por) : '') +
                (a.obs ? ' — ' + esc(a.obs) : '') + '</div></div></div>';
            }).join('')) +
      '</div>' +

      '<div class="cartao"><h3>🛠️ Serviços</h3>' +
        (oss.length ? oss.map((o) => {
          const t = totaisOS(o);
          return '<div class="arquivo-solto"><span class="ic">🧾</span><div style="flex:1">' +
            '<div class="nome">' + esc(o.codigo || '') + ' ' + etiqueta(o.situacao) + '</div>' +
            '<div class="meta">' + esc(o.obra || '') + ' · ' + fmt.brl(t.contrato) + ' · ' +
              fmt.numero(t.percFisico, 0) + '% executado</div></div>' +
            '<div class="acoes"><button class="btn pequeno" data-veros="' + esc(o.id) + '">Abrir</button></div></div>';
        }).join('') : '<p class="legenda">Nenhum serviço contratado ainda.</p>') +
      '</div>' +
      '<div class="cartao"><button class="btn perigo" id="pApagar" style="width:100%">Apagar prestador</button></div>' +
    '</div></div>';

  document.getElementById('pEditar').addEventListener('click', () => editarPrestador(p.id));
  document.getElementById('pNovoDoc').addEventListener('click', () => editarDocPrestador(p, null));
  document.getElementById('pNovaPessoa').addEventListener('click', () => editarPessoa(p, null));
  el.querySelectorAll('[data-pdoc]').forEach((b) => b.addEventListener('click', () => editarDocPrestador(p, b.dataset.pdoc)));
  el.querySelectorAll('[data-ppessoa]').forEach((b) => b.addEventListener('click', () => editarPessoa(p, b.dataset.ppessoa)));
  el.querySelectorAll('[data-veros]').forEach((b) => b.addEventListener('click', () => irPara('servicos/' + b.dataset.veros)));
  el.querySelectorAll('[data-pbaixar]').forEach((b) => b.addEventListener('click', () => {
    const d = (p.documentos || []).find((x) => x.id === b.dataset.pbaixar);
    if (d && d.arquivoId) baixar(d.arquivoId, d.arquivoNome || (p.nome + ' — ' + d.tipo));
  }));
  const bz = document.getElementById('pZap');
  if (bz) bz.addEventListener('click', () => window.open(linkWhats(p.telefone,
    'Olá ' + (p.contato || p.nome) + ', aqui é da ' + ((S.cfg.empresa || {}).nomeCurto || 'Domo Construtora') + '.'), '_blank'));
  document.getElementById('pApagar').addEventListener('click', async () => {
    if (!await confirmar('Apagar ' + p.nome + '? As ordens de serviço dele continuam.', { perigo: true, ok: 'Apagar' })) return;
    try { await api('apagar', { colecao: 'prest', id: p.id }); } catch (e) { toast('Não consegui apagar: ' + e.message, 'ruim'); return; }
    await puxar(); irPara('prestadores');
  });
}

function editarPrestador(id) {
  const p = id ? achar('prest', id) : {};
  abrirModal({
    titulo: id ? 'Editar prestador' : 'Novo prestador',
    largo: true,
    corpo: '<div id="fPrest">' +
      '<div class="linha">' +
        campo('Nome / razão social', entrada('nome', p.nome)) +
        campo('Tipo', seletor('tipo', p.tipo || 'PJ', [{ v: 'PJ', t: 'Empresa (PJ)' }, { v: 'MEI', t: 'MEI' }, { v: 'PF', t: 'Pessoa física' }])) +
        campo('CNPJ / CPF', entrada('cnpjCpf', p.cnpjCpf, { inputmode: 'numeric' })) +
      '</div>' +
      '<div class="linha">' +
        campo('Especialidade', entrada('especialidade', p.especialidade, { placeholder: 'Ex.: Gesso e drywall' })) +
        campo('Contato', entrada('contato', p.contato)) +
        campo('WhatsApp', entrada('telefone', p.telefone, { tipo: 'tel' })) +
      '</div>' +
      '<div class="linha">' +
        campo('E-mail', entrada('email', p.email, { tipo: 'email' })) +
        campo('Endereço', entrada('endereco', p.endereco)) +
      '</div>' +
      '<div class="linha">' +
        campo('Responsável técnico', entrada('responsavelTecnico', p.responsavelTecnico)) +
        campo('CREA / CAU', entrada('creaCau', p.creaCau)) +
      '</div>' +
      '<div class="linha">' +
        campo('Chave PIX', entrada('pix', p.pix)) +
        campo('Dados bancários', entrada('banco', p.banco)) +
        campo('Situação', seletor('situacao', p.situacao || 'ativo', [{ v: 'ativo', t: 'Ativo' }, { v: 'inativo', t: 'Não usar mais' }])) +
      '</div>' +
      campo('Observações', areaTexto('obs', p.obs)) +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar', classe: 'primario', aoClicar: (fundo) => {
        const d = lerCampos(fundo.querySelector('#fPrest'));
        if (!d.nome.trim()) { toast('Informe o nome', 'ruim'); return; }
        const salvo = salvar('prest', Object.assign({ documentos: [], equipe: [], avaliacoes: [] }, p, d));
        fecharEste(fundo);
        if (!id) irPara('prestadores/' + salvo.id); else render();
        toast('Prestador salvo', 'bom');
      } }
    ]
  });
}

function editarDocPrestador(p, docId) {
  const d = docId ? (p.documentos || []).find((x) => x.id === docId) || {} : {};
  abrirModal({
    titulo: docId ? 'Editar documento' : 'Novo documento do prestador',
    corpo: '<div id="fPDoc">' +
      '<div class="linha">' +
        campo('Documento', seletor('tipo', d.tipo || 'CND FGTS', TIPOS_DOC_PREST)) +
        campo('Número', entrada('numero', d.numero)) +
      '</div>' +
      '<div class="linha">' +
        campo('Órgão emissor', entrada('orgao', d.orgao)) +
        campo('Emissão', entrada('emissaoEm', d.emissaoEm, { tipo: 'date' })) +
        campo('Validade', entrada('validadeEm', d.validadeEm, { tipo: 'date' })) +
      '</div>' +
      (d.arquivoId ? '<p class="legenda">Arquivo atual: ' + esc(d.arquivoNome || '—') + '</p>' : '') +
      '<div class="campo"><label>Arquivo (PDF ou foto)</label><input type="file" id="pDocArq"></div>' +
    '</div>',
    acoes: [
      (docId ? { texto: 'Apagar', classe: 'perigo', aoClicar: async (fundo) => {
        if (!await confirmar('Apagar este documento?', { perigo: true, ok: 'Apagar' })) return;
        // Marca em vez de remover: o servidor une esses arrays por id e nunca
        // apaga — remover aqui fazia o documento voltar no próximo sync.
        const atualDoc = achar('prest', p.id) || p;
        salvar('prest', Object.assign({}, atualDoc, {
          documentos: (atualDoc.documentos || []).map((x) => x.id === docId
            ? Object.assign({}, x, { apagadoEm: new Date().toISOString(), apagadoPor: S.quem || '—' }) : x)
        }));
        fecharEste(fundo); render();
      } } : null),
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar', classe: 'primario', aoClicar: async (fundo) => {
        const dados = lerCampos(fundo.querySelector('#fPDoc'));
        const arq = fundo.querySelector('#pDocArq').files[0];
        // Offline-first também aqui: se o arquivo não subir (obra sem sinal), o
        // documento é gravado assim mesmo, marcado como pendente de anexo — a
        // pasta que libera a medição não pode depender de internet boa.
        let extra = {};
        let arquivoFalhou = false;
        if (arq) {
          const metas = await subirArquivos([arq]);
          if (metas.length) extra = { arquivoId: metas[0].id, arquivoNome: arq.name, tamanho: arq.size, pendenteArquivo: false };
          else { arquivoFalhou = true; extra = { pendenteArquivo: true, arquivoNome: arq.name }; }
        }
        const novo = Object.assign({ id: docId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)) },
          d, dados, extra);
        const atualP = achar('prest', p.id) || p;
        const documentos = docId
          ? (atualP.documentos || []).map((x) => x.id === docId ? novo : x)
          : [...(atualP.documentos || []), novo];
        salvar('prest', Object.assign({}, atualP, { documentos }));
        fecharEste(fundo); render();
        toast(arquivoFalhou
          ? 'Documento salvo, mas o arquivo não subiu — anexe de novo quando a internet voltar.'
          : 'Documento salvo', arquivoFalhou ? 'ruim' : 'bom');
      } }
    ].filter(Boolean)
  });
}

function editarPessoa(p, pessoaId) {
  const pes = pessoaId ? (p.equipe || []).find((x) => x.id === pessoaId) || {} : {};
  const treinos = pes.treinamentos || [];
  abrirModal({
    titulo: pessoaId ? 'Editar ' + (pes.nome || 'pessoa') : 'Nova pessoa na equipe',
    largo: true,
    corpo: '<div id="fPessoa">' +
      '<div class="linha">' +
        campo('Nome completo', entrada('nome', pes.nome)) +
        campo('CPF', entrada('cpf', pes.cpf, { inputmode: 'numeric' })) +
        campo('Função', seletor('funcao', pes.funcao || 'Gesseiro', FUNCOES)) +
      '</div>' +
      '<div class="linha">' +
        campo('ASO válido até', entrada('asoValidadeEm', pes.asoValidadeEm, { tipo: 'date' }),
          'Atestado de saúde ocupacional. Sem ele a pessoa não pode entrar na obra.') +
        campo('Está na obra?', seletor('ativo', pes.ativo === false ? 'nao' : 'sim',
          [{ v: 'sim', t: 'Sim, trabalhando' }, { v: 'nao', t: 'Saiu / não vem mais' }])) +
      '</div>' +
      '<h3>Treinamentos (NR)</h3>' +
      '<p class="legenda">Marque o que ele tem e até quando vale.</p>' +
      '<div id="fTreinos">' +
        TREINAMENTOS.map((t) => {
          const tem = treinos.find((x) => x.nome === t);
          return '<div class="item-linha" style="grid-template-columns:1fr 180px">' +
            '<label class="opcao' + (tem ? ' marcada' : '') + '" data-tr="' + esc(t) + '" style="justify-content:flex-start">' +
              '<input type="checkbox" data-tcheck="' + esc(t) + '"' + (tem ? ' checked' : '') + '>' + esc(t) + '</label>' +
            '<div class="campo" style="margin:0"><label>Válido até</label>' +
              '<input type="date" data-tdata="' + esc(t) + '" value="' + esc(tem ? (tem.validadeEm || '') : '') + '"></div>' +
          '</div>';
        }).join('') +
      '</div>' +
      campo('Observação', entrada('obs', pes.obs)) +
    '</div>',
    acoes: [
      (pessoaId ? { texto: 'Apagar', classe: 'perigo', aoClicar: async (fundo) => {
        if (!await confirmar('Tirar ' + (pes.nome || 'esta pessoa') + ' da equipe?', { perigo: true, ok: 'Tirar' })) return;
        const atualEq = achar('prest', p.id) || p;
        salvar('prest', Object.assign({}, atualEq, {
          equipe: (atualEq.equipe || []).map((x) => x.id === pessoaId
            ? Object.assign({}, x, { apagadoEm: new Date().toISOString(), apagadoPor: S.quem || '—' }) : x)
        }));
        fecharEste(fundo); render();
      } } : null),
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar', classe: 'primario', aoClicar: (fundo) => {
        const d = lerCampos(fundo.querySelector('#fPessoa'));
        if (!d.nome.trim()) { toast('Informe o nome', 'ruim'); return; }
        const treinamentos = TREINAMENTOS.map((t) => {
          const chk = fundo.querySelector('[data-tcheck="' + t + '"]');
          if (!chk || !chk.checked) return null;
          const dt = fundo.querySelector('[data-tdata="' + t + '"]');
          return { id: t, nome: t, validadeEm: dt ? dt.value : '' };
        }).filter(Boolean);
        const nova = Object.assign({ id: pessoaId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)) },
          pes, d, { ativo: d.ativo !== 'nao', treinamentos });
        const equipe = pessoaId
          ? (achar('prest', p.id) || p).equipe.map((x) => x.id === pessoaId ? nova : x)
          : [...((achar('prest', p.id) || p).equipe || []), nova];
        salvar('prest', Object.assign({}, p, { equipe }));
        fecharEste(fundo); render();
        toast('Equipe atualizada', 'bom');
      } }
    ].filter(Boolean)
  });

  // marca visual do chip ao clicar
  document.querySelectorAll('[data-tcheck]').forEach((c) => c.addEventListener('change', () => {
    const chip = c.closest('.opcao');
    if (chip) chip.classList.toggle('marcada', c.checked);
  }));
}
