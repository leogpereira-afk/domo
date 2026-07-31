/* PDF da Ordem de Compra e da Ordem de Serviço, no mesmo formato da planilha
   que a Domo já usava (cabeçalho, itens, impostos, cláusulas e assinaturas).

   Só usa Helvetica — fonte que o jsPDF já traz. Não registrar outra fonte sem
   registrar TODOS os estilos: setFont mantém o estilo atual e cai em Times
   silenciosamente quando o par nome+estilo não existe. */

const AZUL = [0, 61, 168];
const CINZA = [95, 95, 95];
const CINZA_CLARO = [234, 234, 234];

let _logoCache = null;
function carregarLogo() {
  if (_logoCache) return Promise.resolve(_logoCache);
  return fetch('logo-domo.png')
    .then((r) => r.blob())
    .then((b) => new Promise((ok) => {
      const fr = new FileReader();
      fr.onload = () => { _logoCache = fr.result; ok(_logoCache); };
      fr.onerror = () => ok(null);
      fr.readAsDataURL(b);
    }))
    .catch(() => null);
}

const M = 10;            // margem em mm
const L = 210;           // largura A4
const UTIL = L - 2 * M;  // 190mm

function novoDoc() {
  const { jsPDF } = window.jspdf;
  return new jsPDF({ unit: 'mm', format: 'a4', compress: true });
}

function cabecalhoPDF(doc, logo, cfg, titulo, codigo) {
  const emp = (cfg && cfg.empresa) || {};
  if (logo) { try { doc.addImage(logo, 'PNG', M, 10, 38, 12.2); } catch { /* segue sem logo */ } }
  doc.setTextColor(...CINZA);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  const dados = [emp.nome, emp.cnpj ? 'CNPJ ' + fmt.cnpj(emp.cnpj) + (emp.ie ? ' · IE ' + emp.ie : '') : '',
    emp.endereco, [emp.telefone, emp.email].filter(Boolean).join(' · ')].filter(Boolean);
  dados.forEach((t, i) => doc.text(String(t), M + 42, 12.5 + i * 3.4));

  doc.setFillColor(...AZUL);
  doc.rect(M, 26, UTIL, 9, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(titulo, M + 3, 32.3);
  doc.setFontSize(10);
  doc.text(codigo || '', L - M - 3, 32.3, { align: 'right' });
  doc.setTextColor(20, 20, 20);
  return 40;
}

// Grade de campos rotulados (2, 3 ou 4 por linha).
// O valor pode ocupar até DUAS linhas: endereço de fornecedor e local de
// entrega são longos e antes saíam cortados no meio da palavra.
function blocoCampos(doc, y, campos, colunas = 3) {
  const larg = UTIL / colunas;
  const grupos = [];
  for (let i = 0; i < campos.length; i += colunas) grupos.push(campos.slice(i, i + colunas));

  let yy = y;
  for (const grupo of grupos) {
    doc.setFontSize(8.6);
    doc.setFont('helvetica', 'bold');
    const partes = grupo.map((c) =>
      doc.splitTextToSize(String(c[1] == null || c[1] === '' ? '—' : c[1]), larg - 4).slice(0, 2));
    const alturaLinha = 5.2 + Math.max(...partes.map((p) => p.length)) * 3.5;

    grupo.forEach((c, col) => {
      const x = M + col * larg;
      doc.setFontSize(6.6);
      doc.setTextColor(...CINZA);
      doc.setFont('helvetica', 'normal');
      doc.text(String(c[0]).toUpperCase(), x, yy);
      doc.setFontSize(8.6);
      doc.setTextColor(20, 20, 20);
      doc.setFont('helvetica', 'bold');
      doc.text(partes[col], x, yy + 4);
    });
    yy += alturaLinha + 1.4;
  }
  doc.setDrawColor(...CINZA_CLARO);
  doc.line(M, yy - 1.5, L - M, yy - 1.5);
  return yy + 3;
}

function tituloSecao(doc, y, texto) {
  doc.setFillColor(245, 246, 249);
  doc.rect(M, y - 4.2, UTIL, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...AZUL);
  doc.text(texto.toUpperCase(), M + 2, y);
  doc.setTextColor(20, 20, 20);
  return y + 6;
}

// Tabela com quebra de página automática.
function tabela(doc, y, colunas, linhas, aoQuebrar) {
  const desenharCabecalho = (yy) => {
    doc.setFillColor(...AZUL);
    doc.rect(M, yy - 4.5, UTIL, 6.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    let x = M + 1.5;
    colunas.forEach((c) => {
      doc.text(c.titulo, c.alinha === 'right' ? x + c.largura - 3 : x, yy, { align: c.alinha === 'right' ? 'right' : 'left' });
      x += c.largura;
    });
    doc.setTextColor(20, 20, 20);
    return yy + 4.5;
  };

  y = desenharCabecalho(y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  linhas.forEach((linha, idx) => {
    // Altura da linha = maior célula quebrada
    const partes = colunas.map((c, i) => doc.splitTextToSize(String(linha[i] == null ? '' : linha[i]), c.largura - 3));
    const alt = Math.max(...partes.map((p) => p.length)) * 3.6 + 2.6;

    if (y + alt > 272) {
      doc.addPage();
      y = aoQuebrar ? aoQuebrar(doc) : 20;
      y = desenharCabecalho(y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
    }
    if (idx % 2 === 1) { doc.setFillColor(249, 250, 252); doc.rect(M, y - 3.2, UTIL, alt, 'F'); }
    let x = M + 1.5;
    colunas.forEach((c, i) => {
      const alinhaDir = c.alinha === 'right';
      doc.text(partes[i], alinhaDir ? x + c.largura - 3 : x, y, { align: alinhaDir ? 'right' : 'left' });
      x += c.largura;
    });
    doc.setDrawColor(...CINZA_CLARO);
    doc.line(M, y + alt - 3.2, L - M, y + alt - 3.2);
    y += alt;
  });
  return y + 2;
}

function assinaturas(doc, y, blocos) {
  if (y > 232) { doc.addPage(); y = 24; }
  const larg = UTIL / blocos.length;
  let extra = 0;
  blocos.forEach((b, i) => {
    const x = M + i * larg;
    doc.setDrawColor(120, 120, 120);
    doc.line(x + 4, y, x + larg - 8, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(20, 20, 20);
    // Razão social longa quebra em até 2 linhas em vez de escrever por cima
    // do bloco de assinatura do lado.
    const nomeLinhas = doc.splitTextToSize(String(b.nome || ''), larg - 12).slice(0, 2);
    doc.text(nomeLinhas, x + 4, y + 4);
    const desloca = (nomeLinhas.length - 1) * 3.4;
    extra = Math.max(extra, desloca);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...CINZA);
    doc.text(String(b.cargo || ''), x + 4, y + 7.6 + desloca);
    if (b.crea) doc.text(String(b.crea), x + 4, y + 10.8 + desloca);
    doc.text('Data: ____/____/________', x + 4, y + 15 + desloca);
  });
  doc.setTextColor(20, 20, 20);
  return y + 20 + extra;
}

function rodapePDF(doc, texto) {
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(6.8);
    doc.setTextColor(...CINZA);
    doc.setFont('helvetica', 'normal');
    doc.text(texto, M, 289);
    doc.text('Página ' + i + ' de ' + total, L - M, 289, { align: 'right' });
  }
}

/* ── Ordem de Compra ───────────────────────────────────────────────────────── */
async function pdfOC(o, cfg) {
  const logo = await carregarLogo();
  const doc = novoDoc();
  const f = o.fornecedor || {};
  const t = totaisOC(o);
  const emp = (cfg && cfg.empresa) || {};

  let y = cabecalhoPDF(doc, logo, cfg, 'ORDEM DE COMPRA', o.codigo || '');

  y = tituloSecao(doc, y + 2, 'Fornecedor');
  y = blocoCampos(doc, y, [
    ['Fornecedor', f.nome], ['CNPJ', fmt.cnpj(f.cnpj)], ['Inscrição estadual', f.ie],
    ['Contato / representante', f.contato], ['Telefone', fmt.telefone(f.telefone)], ['E-mail', f.email],
    ['Endereço', f.endereco], ['Obra / projeto', o.obra || ''], ['Data de emissão', fmt.data(o.dataEmissao)]
  ], 3);

  y = tituloSecao(doc, y + 2, 'Condições comerciais');
  y = blocoCampos(doc, y, [
    ['Local de entrega', o.localEntrega], ['Prazo de entrega', o.prazoEntrega], ['Entrega prevista', o.entregaPrevista ? fmt.data(o.entregaPrevista) : ''],
    ['Modalidade', o.modalidade], ['Condição de pagamento', o.condicaoPagamento], ['Forma de pagamento', o.formaPagamento],
    ['Validade da proposta', o.validadeProposta], ['Garantia', o.garantia], ['Nota fiscal obrigatória', o.notaFiscalObrigatoria === false ? 'Não' : 'Sim'],
    ['Dados bancários', o.dadosBancarios]
  ], 3);

  y = tituloSecao(doc, y + 2, 'Materiais');
  const colunas = [
    { titulo: '#', largura: 8 },
    { titulo: 'DESCRIÇÃO DO MATERIAL', largura: 70 },
    { titulo: 'MARCA / ESPEC.', largura: 30 },
    { titulo: 'UN', largura: 10 },
    { titulo: 'QTD', largura: 16, alinha: 'right' },
    { titulo: 'PREÇO UNIT.', largura: 27, alinha: 'right' },
    { titulo: 'TOTAL', largura: 29, alinha: 'right' }
  ];
  const linhas = (o.itens || []).map((i, n) => [
    n + 1, i.descricao, i.marca || '', i.unid || '',
    fmt.numero(i.qtd), fmt.brl(i.preco), fmt.brl((Number(i.qtd) || 0) * (Number(i.preco) || 0))
  ]);
  y = tabela(doc, y, colunas, linhas, (d) => cabecalhoPDF(d, logo, cfg, 'ORDEM DE COMPRA', o.codigo || ''));

  // Totais
  if (y > 240) { doc.addPage(); y = cabecalhoPDF(doc, logo, cfg, 'ORDEM DE COMPRA', o.codigo || ''); }
  const totais = [
    ['Soma dos materiais', t.total],
    o.ipiPerc ? ['IPI (' + fmt.numero(o.ipiPerc) + '%)', t.ipi] : null,
    o.icmsPerc ? ['ICMS / ST (' + fmt.numero(o.icmsPerc) + '%)', t.icms] : null,
    o.frete ? ['Frete', Number(o.frete)] : null,
    o.seguro ? ['Seguro', Number(o.seguro)] : null,
    o.desconto ? ['Desconto negociado', -Math.abs(Number(o.desconto))] : null
  ].filter(Boolean);
  const xTot = M + UTIL - 78;
  doc.setFontSize(8);
  totais.forEach((lin) => {
    doc.setFont('helvetica', 'normal');
    doc.text(String(lin[0]), xTot, y);
    doc.text(fmt.brl(lin[1]), L - M - 2, y, { align: 'right' });
    y += 4.4;
  });
  y += 1.6;
  doc.setFillColor(...AZUL);
  doc.rect(xTot - 3, y - 3.6, 81, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('VALOR LÍQUIDO FINAL', xTot, y + 1.6);
  doc.text(fmt.brl(t.totalLiquido), L - M - 2, y + 1.6, { align: 'right' });
  doc.setTextColor(20, 20, 20);
  y += 12;

  if (o.observacoes) {
    y = tituloSecao(doc, y, 'Observações / condições gerais');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const linhasObs = doc.splitTextToSize(String(o.observacoes), UTIL - 4);
    doc.text(linhasObs, M + 2, y);
    y += linhasObs.length * 3.8 + 4;
  }

  const clausulas = (cfg && cfg.clausulasOC) || [];
  if (clausulas.length) {
    if (y > 225) { doc.addPage(); y = cabecalhoPDF(doc, logo, cfg, 'ORDEM DE COMPRA', o.codigo || ''); }
    y = tituloSecao(doc, y, 'Cláusulas e condições contratuais');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    clausulas.forEach((c, i) => {
      const linhasC = doc.splitTextToSize((i + 1) + '. ' + c, UTIL - 4);
      if (y + linhasC.length * 3.2 > 262) { doc.addPage(); y = 22; }
      doc.text(linhasC, M + 2, y);
      y += linhasC.length * 3.2 + 1.4;
    });
    y += 4;
  }

  const ass = (cfg && cfg.assinaturas) || {};
  y = assinaturas(doc, Math.max(y + 6, y), [
    Object.assign({ nome: emp.nomeCurto || 'Domo Construtora', cargo: 'Diretor de Engenharia' }, ass.diretor || {}),
    { nome: f.nome || '', cargo: 'Representante do fornecedor', crea: f.cnpj ? 'CNPJ ' + fmt.cnpj(f.cnpj) : '' },
    Object.assign({ nome: '', cargo: 'Engenheiro da obra' }, ass.engenheiro || {})
  ]);

  rodapePDF(doc, (emp.nomeCurto || 'Domo Construtora') + ' · Ordem de compra ' + (o.codigo || '') +
    ' · emitida em ' + fmt.data(o.dataEmissao || o.criadoEm));
  doc.save((o.codigo || 'ordem-de-compra') + '-' + ((o.fornecedor || {}).nome || 'domo').replace(/\W+/g, '_').slice(0, 24) + '.pdf');
}

/* ── Boletim de Medição ────────────────────────────────────────────────────── */
// É o papel que o prestador assina reconhecendo o que foi medido. Sem ele,
// discussão de medição vira palavra contra palavra.
async function pdfMedicao(os, m, cfg) {
  const logo = await carregarLogo();
  const doc = novoDoc();
  const e = os.empreiteiro || {};
  const emp = (cfg && cfg.empresa) || {};
  const nMed = 'MEDIÇÃO ' + String(m.numero).padStart(2, '0');

  // % acumulado até a medição ANTERIOR (a diferença é o que se paga agora).
  const anteriores = (os.medicoes || [])
    .filter((x) => x.situacao !== 'cancelada' && (x.numero || 0) < (m.numero || 0))
    .sort((a, b) => (a.numero || 0) - (b.numero || 0));
  const percAntes = (itemId) => {
    let p = 0;
    for (const x of anteriores) {
      const it = (x.itens || []).find((y) => y.itemId === itemId);
      if (it && it.perc != null) p = Number(it.perc) || 0;
    }
    return p;
  };

  let y = cabecalhoPDF(doc, logo, cfg, 'BOLETIM DE ' + nMed, os.codigo || '');

  // Rascunho é conferência interna: sai marcado para ninguém confundir com o
  // documento que libera pagamento.
  if (m.situacao === 'rascunho') {
    doc.setFillColor(253, 243, 224);
    doc.rect(M, y - 2.5, UTIL, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(168, 104, 0);
    doc.text('PRÉVIA — MEDIÇÃO AINDA NÃO APROVADA. NÃO VALE PARA PAGAMENTO.', M + 3, y + 2.2);
    doc.setTextColor(20, 20, 20);
    y += 8;
  }

  y = tituloSecao(doc, y + 2, 'Prestador e período');
  y = blocoCampos(doc, y, [
    ['Prestador', e.nome], ['CNPJ / CPF', fmt.doc(e.cnpjCpf)], ['Contrato nº', os.contratoNumero],
    ['Obra', os.obra], ['Local', os.localizacao], ['Responsável técnico', e.responsavelTecnico],
    ['Período medido', (m.de ? fmt.data(m.de) : '—') + ' a ' + (m.ate ? fmt.data(m.ate) : '—')],
    ['Data da medição', fmt.data(m.em)], ['Medido por', m.por]
  ], 3);

  y = tituloSecao(doc, y + 2, 'Etapas medidas');
  const colunas = [
    { titulo: '#', largura: 8 },
    { titulo: 'ETAPA', largura: 66 },
    { titulo: 'CONTRATADO', largura: 26, alinha: 'right' },
    { titulo: '% ANT.', largura: 16, alinha: 'right' },
    { titulo: '% ATUAL', largura: 18, alinha: 'right' },
    { titulo: 'NO PERÍODO', largura: 28, alinha: 'right' },
    { titulo: 'ACUMULADO', largura: 28, alinha: 'right' }
  ];
  // O boletim é o retrato DAQUELA medição: monta a partir de m.itens (o que foi
  // medido), não de os.itens (o contrato de hoje). Sem isso, reimprimir um
  // boletim já assinado passava a listar aditivos lançados depois.
  // E o valor do período é o que ficou GRAVADO — recalcular com o preço atual
  // faria o papel não fechar com o líquido pago.
  const porId = new Map((os.itens || []).map((i) => [i.id, i]));
  const linhas = (m.itens || []).map((it, n) => {
    const i = porId.get(it.itemId) || { descricao: '(etapa removida do contrato)', qtd: 0, preco: 0 };
    const total = (Number(i.qtd) || 0) * (Number(i.preco) || 0);
    const atual = Number(it.perc) || 0;
    const antes = percAntes(it.itemId);
    const periodo = it.valorPeriodo != null
      ? Number(it.valorPeriodo) || 0
      : total * Math.max(0, atual - antes) / 100;
    return [
      n + 1, i.descricao, fmt.brl(total),
      fmt.numero(antes, 2) + '%', fmt.numero(atual, 2) + '%',
      fmt.brl(periodo),
      fmt.brl(total * atual / 100)
    ];
  });
  y = tabela(doc, y, colunas, linhas, (d) => cabecalhoPDF(d, logo, cfg, 'BOLETIM DE ' + nMed, os.codigo || ''));

  const contas = [
    ['Bruto do período', Number(m.bruto) || 0],
    ['Retenção técnica (' + fmt.numero(m.retencaoPerc || 0, 1) + '%)', -(Number(m.retencao) || 0)]
  ].concat((m.descontos || []).map((d) => [d.descricao || 'Desconto', -(Number(d.valor) || 0)]));

  // O quadro de totais não pode ser partido no meio nem cair em cima do rodapé.
  const alturaContas = contas.length * 4.4 + 14;
  if (y + alturaContas > 262) { doc.addPage(); y = cabecalhoPDF(doc, logo, cfg, 'BOLETIM DE ' + nMed, os.codigo || ''); }

  const xTot = M + UTIL - 78;
  doc.setFontSize(8);
  contas.forEach((lin) => {
    doc.setFont('helvetica', 'normal');
    doc.text(String(lin[0]), xTot, y);
    doc.text(fmt.brl(lin[1]), L - M - 2, y, { align: 'right' });
    y += 4.4;
  });
  y += 1.6;
  doc.setFillColor(...AZUL);
  doc.rect(xTot - 3, y - 3.6, 81, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('LÍQUIDO A PAGAR', xTot, y + 1.6);
  doc.text(fmt.brl(m.liquido), L - M - 2, y + 1.6, { align: 'right' });
  doc.setTextColor(20, 20, 20);
  y += 12;

  if (m.obs) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const linhasObs = doc.splitTextToSize(String(m.obs), UTIL - 4);
    if (y + linhasObs.length * 3.8 + 12 > 266) { doc.addPage(); y = cabecalhoPDF(doc, logo, cfg, 'BOLETIM DE ' + nMed, os.codigo || ''); }
    y = tituloSecao(doc, y, 'Observações');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(linhasObs, M + 2, y);
    y += linhasObs.length * 3.8 + 4;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  const decl = doc.splitTextToSize(
    'Declaramos que os serviços acima foram executados e conferidos no período indicado. ' +
    'A retenção técnica será devolvida após a conclusão e o aceite final do serviço. ' +
    'Este boletim é a base para a liberação do pagamento correspondente.', UTIL - 4);
  if (y + decl.length * 3.4 + 8 > 268) { doc.addPage(); y = cabecalhoPDF(doc, logo, cfg, 'BOLETIM DE ' + nMed, os.codigo || ''); }
  doc.text(decl, M + 2, y);
  y += decl.length * 3.4 + 6;

  const ass = (cfg && cfg.assinaturas) || {};
  y = assinaturas(doc, y + 6, [
    { nome: e.nome || '', cargo: 'Prestador do serviço',
      crea: e.cnpjCpf ? (String(e.cnpjCpf).replace(/\D/g, '').length === 11 ? 'CPF ' + fmt.doc(e.cnpjCpf) : 'CNPJ ' + fmt.doc(e.cnpjCpf)) : '' },
    Object.assign({ nome: '', cargo: 'Engenheiro da obra' }, ass.engenheiro || {}),
    Object.assign({ nome: '', cargo: 'Diretor de Engenharia' }, ass.diretor || {})
  ]);

  rodapePDF(doc, (emp.nomeCurto || 'Domo Construtora') + ' · ' + nMed + ' da ' + (os.codigo || '') +
    ' · ' + ((os.empreiteiro || {}).nome || ''));
  doc.save((os.codigo || 'OS') + '-medicao-' + String(m.numero).padStart(2, '0') + '.pdf');
}

/* ── Ordem de Serviço ──────────────────────────────────────────────────────── */
async function pdfOS(o, cfg) {
  const logo = await carregarLogo();
  const doc = novoDoc();
  const e = o.empreiteiro || {};
  const emp = (cfg && cfg.empresa) || {};
  const total = (o.itens || []).reduce((s, i) => s + (Number(i.qtd) || 0) * (Number(i.preco) || 0), 0);

  let y = cabecalhoPDF(doc, logo, cfg, 'ORDEM DE SERVIÇO', o.codigo || '');

  y = tituloSecao(doc, y + 2, 'Contratado');
  y = blocoCampos(doc, y, [
    ['Empreiteiro / prestador', e.nome], ['CNPJ / CPF', fmt.doc(e.cnpjCpf)], ['Responsável técnico', e.responsavelTecnico],
    ['Contrato nº', o.contratoNumero], ['Telefone', fmt.telefone(e.telefone)], ['Data de emissão', fmt.data(o.dataEmissao)],
    ['Obra / projeto', o.obra], ['Localização / setor', o.localizacao], ['Prazo', fmt.data(o.dataInicio) + ' a ' + fmt.data(o.dataTerminoPrevista)]
  ], 3);

  y = tituloSecao(doc, y + 2, 'Serviços contratados');
  const colunas = [
    { titulo: '#', largura: 8 },
    { titulo: 'DESCRIÇÃO DO SERVIÇO', largura: 100 },
    { titulo: 'UN', largura: 12 },
    { titulo: 'QTD', largura: 18, alinha: 'right' },
    { titulo: 'PREÇO UNIT.', largura: 26, alinha: 'right' },
    { titulo: 'TOTAL', largura: 26, alinha: 'right' }
  ];
  const linhas = (o.itens || []).map((i, n) => [
    n + 1, i.descricao, i.unid || '', fmt.numero(i.qtd), fmt.brl(i.preco),
    fmt.brl((Number(i.qtd) || 0) * (Number(i.preco) || 0))
  ]);
  y = tabela(doc, y, colunas, linhas, (d) => cabecalhoPDF(d, logo, cfg, 'ORDEM DE SERVIÇO', o.codigo || ''));

  if (y > 245) { doc.addPage(); y = cabecalhoPDF(doc, logo, cfg, 'ORDEM DE SERVIÇO', o.codigo || ''); }
  doc.setFillColor(...AZUL);
  doc.rect(M + UTIL - 81, y - 3.6, 81, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('VALOR TOTAL', M + UTIL - 78, y + 1.6);
  doc.text(fmt.brl(total), L - M - 2, y + 1.6, { align: 'right' });
  doc.setTextColor(20, 20, 20);
  y += 12;

  if (o.observacoes) {
    y = tituloSecao(doc, y, 'Observações / condições');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const obs = doc.splitTextToSize(String(o.observacoes), UTIL - 4);
    doc.text(obs, M + 2, y);
    y += obs.length * 3.8 + 6;
  }

  const ass = (cfg && cfg.assinaturas) || {};
  y = assinaturas(doc, y + 8, [
    Object.assign({ nome: '', cargo: 'Diretor de Engenharia' }, ass.diretor || {}),
    { nome: e.nome || '', cargo: 'Empreiteiro / prestador',
      crea: e.cnpjCpf ? (String(e.cnpjCpf).replace(/\D/g, '').length === 11 ? 'CPF ' + fmt.doc(e.cnpjCpf) : 'CNPJ ' + fmt.doc(e.cnpjCpf)) : '' },
    Object.assign({ nome: '', cargo: 'Engenheiro Civil' }, ass.engenheiro || {})
  ]);

  rodapePDF(doc, (emp.nomeCurto || 'Domo Construtora') + ' · Ordem de serviço ' + (o.codigo || '') +
    ' · emitida em ' + fmt.data(o.dataEmissao || o.criadoEm));
  doc.save((o.codigo || 'ordem-de-servico') + '-' + ((o.empreiteiro || {}).nome || 'domo').replace(/\W+/g, '_').slice(0, 24) + '.pdf');
}
