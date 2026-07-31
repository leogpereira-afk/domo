/* Qualificação de fornecedor e de prestador.

   A nota tem DUAS metades, e isso é de propósito:

   • DESEMPENHO — o sistema mede sozinho, do histórico que já existe. Entregou no
     prazo? Respondeu a cotação? Chegou tudo? Ninguém precisa preencher nada, e
     ninguém consegue "melhorar" a nota de um amigo.
   • AVALIAÇÃO — as estrelas que quem viveu a obra dá depois da compra ou do
     serviço. É o que o número não pega: se o motorista descarrega direito, se
     o vendedor resolve problema, se a equipe deixa a obra limpa.

   Uma sozinha mente. O fornecedor pode entregar sempre no prazo e mandar
   material ruim; pode ser um doce ao telefone e nunca cumprir data. */

/* ── Régua ─────────────────────────────────────────────────────────────────── */
const CLASSES = [
  { min: 8.5, letra: 'A', txt: 'Preferencial', cls: 'et-entregue', dica: 'Chame primeiro.' },
  { min: 7.0, letra: 'B', txt: 'Aprovado', cls: 'et-valido', dica: 'Pode contar com ele.' },
  { min: 5.0, letra: 'C', txt: 'Atenção', cls: 'et-vencendo', dica: 'Cobre prazo e confira a entrega.' },
  { min: 0, letra: 'D', txt: 'Evitar', cls: 'et-vencido', dica: 'Só em último caso, e com prazo curto.' }
];

const classeDe = (nota) => nota == null ? null : CLASSES.find((c) => nota >= c.min);

/* Etiqueta pronta para a tela.
   `provisorio` = ainda não houve ENTREGA (ou serviço concluído) para medir.
   Sem isso, quem só respondeu uma cotação aparecia como "A · 10" — nota de
   quem nunca entregou nada, que é justamente a que mais engana na hora de
   escolher. Quem tem pouco histórico aparece como "provisório". */
function selo(nota, opts = {}) {
  const c = classeDe(nota);
  if (!c) return '<span class="etiqueta">sem histórico</span>';
  if (opts.provisorio) {
    return '<span class="etiqueta" title="Ainda não entregou nada: esta nota vem só da resposta a cotação.">' +
      'provisório · ' + fmt.numero(nota, 1) + '</span>';
  }
  return '<span class="etiqueta ' + c.cls + '" title="' + esc(c.dica) + '">' +
    c.letra + ' · ' + fmt.numero(nota, 1) + (opts.txt ? ' ' + c.txt : '') + '</span>';
}

const estrelasDe = (n) => n == null ? '—' : '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

// Média das estrelas dadas à mão (0 a 5), de fornecedor ou prestador.
function mediaAvaliacoes(x) {
  const av = ((x && x.avaliacoes) || []).filter((a) => a && a.media && !a.apagadoEm);
  if (!av.length) return null;
  return av.reduce((s, a) => s + Number(a.media), 0) / av.length;
}

// Junta desempenho (0-10) com avaliação (0-5 → 0-10). Quem tem as duas pesa
// 60/40 a favor do que foi MEDIDO — estrela é opinião, data de entrega é fato.
function combinar(desempenho, estrelas) {
  const doHumano = estrelas == null ? null : estrelas * 2;
  if (desempenho == null && doHumano == null) return null;
  if (desempenho == null) return doHumano;
  if (doHumano == null) return desempenho;
  return desempenho * 0.6 + doHumano * 0.4;
}

/* ══════════════════════════════════════════════════════════════════════════
   FORNECEDOR DE MATERIAL
   ══════════════════════════════════════════════════════════════════════════ */

const CRITERIOS_FORN = [
  ['preco', 'Preço (era competitivo?)'],
  ['prazo', 'Cumpriu o prazo combinado'],
  ['qualidade', 'Qualidade do material'],
  ['atendimento', 'Atendimento (resolve problema?)']
];

// Toda ordem de compra daquele fornecedor (por id ou, para as antigas, por nome).
function comprasDoFornecedor(f) {
  const ch = (x) => String(x || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
  const nome = ch(f.nome);
  return lista('oc').filter((o) => o.situacao !== 'rascunho' &&
    (o.fornecedorId === f.id || (nome && ch((o.fornecedor || {}).nome) === nome)));
}

function convitesDoFornecedor(f) {
  const ch = (x) => String(x || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
  const nome = ch(f.nome);
  const saida = [];
  for (const c of lista('cot')) {
    for (const x of (c.fornecedores || [])) {
      if (x.fornecedorId === f.id || (nome && ch(x.nome) === nome)) saida.push({ cot: c, convite: x });
    }
  }
  return saida;
}

// O que o sistema sabe sem ninguém digitar nada.
function desempenhoFornecedor(f) {
  const compras = comprasDoFornecedor(f);
  const entregues = compras.filter((o) => o.situacao === 'entregue');
  const canceladas = compras.filter((o) => o.situacao === 'cancelada');

  // Pontualidade: data da última entrega contra a data prometida.
  const comPrazo = entregues.filter((o) => o.entregaPrevista && (o.recebidoEm || o.atualizadoEm));
  const atrasos = comPrazo.map((o) => {
    const chegou = String(o.recebidoEm || o.atualizadoEm).slice(0, 10);
    return Math.round((new Date(chegou) - new Date(o.entregaPrevista)) / 86400000);
  });
  const noPrazo = atrasos.filter((d) => d <= 0).length;
  const pontualidade = atrasos.length ? noPrazo / atrasos.length : null;
  const atrasoMedio = atrasos.length ? atrasos.reduce((s, d) => s + Math.max(0, d), 0) / atrasos.length : null;

  // Entregou tudo, ou fechamos a ordem com falta?
  const comFalta = entregues.filter((o) => o.encerradaComFalta).length;
  const completude = entregues.length ? (entregues.length - comFalta) / entregues.length : null;

  // Responde cotação? Em quanto tempo?
  const convites = convitesDoFornecedor(f);
  const respondidos = convites.filter((x) => x.convite.respondidoEm);
  const taxaResposta = convites.length ? respondidos.length / convites.length : null;
  const horas = respondidos
    .filter((x) => x.convite.convidadoEm)
    .map((x) => (new Date(x.convite.respondidoEm) - new Date(x.convite.convidadoEm)) / 3600000)
    .filter((h) => h >= 0);
  const tempoResposta = horas.length ? horas.reduce((s, h) => s + h, 0) / horas.length : null;
  const ganhou = convites.filter((x) => x.convite.escolhido).length;

  // Nota do desempenho: só entram as dimensões que TÊM histórico. Fornecedor
  // novo não é penalizado por ainda não ter passado por nada.
  const partes = [];
  if (pontualidade != null) partes.push({ v: pontualidade * 10, peso: 4 });
  if (completude != null) partes.push({ v: completude * 10, peso: 3 });
  if (taxaResposta != null) partes.push({ v: taxaResposta * 10, peso: 3 });
  const peso = partes.reduce((s, x) => s + x.peso, 0);
  const nota = peso ? partes.reduce((s, x) => s + x.v * x.peso, 0) / peso : null;

  return {
    compras: compras.length, entregues: entregues.length, canceladas: canceladas.length,
    totalComprado: compras.filter((o) => o.situacao !== 'cancelada')
      .reduce((s, o) => s + (Number(o.totalLiquido) || 0), 0),
    pontualidade, atrasoMedio, noPrazo, medidas: atrasos.length,
    completude, comFalta,
    convites: convites.length, respondidos: respondidos.length, taxaResposta, tempoResposta, ganhou,
    nota
  };
}

function notaFornecedor(f) {
  const d = desempenhoFornecedor(f);
  const estrelas = mediaAvaliacoes(f);
  const quantasAvaliacoes = ((f.avaliacoes) || []).filter((a) => a && a.media && !a.apagadoEm).length;
  // Sem entrega nenhuma e sem avaliação, a nota não passa de um palpite.
  const provisorio = d.entregues === 0 && quantasAvaliacoes === 0;
  return { nota: combinar(d.nota, estrelas), desempenho: d, estrelas, quantasAvaliacoes, provisorio };
}

/* ── Avaliar depois da compra ──────────────────────────────────────────────── */
function avaliarFornecedor(oc) {
  const f = achar('forn', oc.fornecedorId) ||
    fornecedoresAtivos().find((x) => String(x.nome || '').toLowerCase() === String((oc.fornecedor || {}).nome || '').toLowerCase());
  if (!f) { toast('Este fornecedor não está no cadastro — cadastre para poder avaliar', 'ruim'); return; }
  if (oc.avaliacao) { toast('Esta compra já foi avaliada', ''); return; }

  const opcoes = () => [5, 4, 3, 2, 1].map((n) =>
    '<option value="' + n + '"' + (n === 4 ? ' selected' : '') + '>' + '★'.repeat(n) + ' ' + n + '</option>').join('');

  abrirModal({
    titulo: 'Avaliar ' + ((oc.fornecedor || {}).nome || 'o fornecedor'),
    corpo: '<p class="legenda">Vale para a próxima cotação: o sistema mostra a nota dele na hora de convidar. ' +
      'Leva 20 segundos e é o que evita comprar de novo com quem já deu problema.</p>' +
      '<div id="fAvalF">' +
        CRITERIOS_FORN.map(([k, rot]) => campo(rot, '<select data-campo="' + k + '">' + opcoes() + '</select>')).join('') +
        campo('Observação', areaTexto('obs', '', 'Ex.: entregou 2 dias atrasado mas avisou antes')) +
      '</div>',
    acoes: [
      { texto: 'Depois', aoClicar: () => fecharModal() },
      { texto: 'Salvar avaliação', classe: 'primario', aoClicar: (fundo) => {
        const d = lerCampos(fundo.querySelector('#fAvalF'));
        const valores = CRITERIOS_FORN.map(([k]) => Number(d[k]) || 0);
        const media = valores.reduce((s, x) => s + x, 0) / valores.length;
        const aval = {
          // id vindo da ordem: se a gravação cair duas vezes, a união por id
          // funde em vez de duplicar e torcer a média.
          id: 'av_' + oc.id,
          ocId: oc.id, ocCodigo: oc.codigo, em: new Date().toISOString(), por: S.quem || '—',
          preco: Number(d.preco), prazo: Number(d.prazo),
          qualidade: Number(d.qualidade), atendimento: Number(d.atendimento),
          media, obs: d.obs
        };
        salvar('oc', Object.assign({}, achar('oc', oc.id) || oc, { avaliacao: aval }));
        const atual = achar('forn', f.id) || f;
        salvar('forn', Object.assign({}, atual, { avaliacoes: [...(atual.avaliacoes || []), aval] }));
        fecharEste(fundo); render();
        toast('Avaliação salva — ela aparece na próxima cotação', 'bom');
      } }
    ]
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   PRESTADOR DE SERVIÇO
   ══════════════════════════════════════════════════════════════════════════ */

function desempenhoPrestador(p) {
  const oss = lista('os').filter((o) => o.prestadorId === p.id);
  const concluidas = oss.filter((o) => o.situacao === 'concluida');

  // Terminou na data combinada?
  const comPrazo = concluidas.filter((o) => o.dataTerminoPrevista && (o.concluidaEm || o.atualizadoEm));
  const atrasos = comPrazo.map((o) => {
    const fim = String(o.concluidaEm || o.atualizadoEm).slice(0, 10);
    return Math.round((new Date(fim) - new Date(o.dataTerminoPrevista)) / 86400000);
  });
  const pontualidade = atrasos.length ? atrasos.filter((d) => d <= 0).length / atrasos.length : null;
  const atrasoMedio = atrasos.length ? atrasos.reduce((s, d) => s + Math.max(0, d), 0) / atrasos.length : null;

  // A pasta em dia é parte da qualificação: CND vencida da equipe dele é risco
  // que a construtora paga junto.
  const pend = typeof pendenciasPrestador === 'function' ? pendenciasPrestador(p) : [];
  const graves = pend.filter((x) => x.grave).length;
  const documentos = graves ? Math.max(0, 10 - graves * 2.5) : 10;

  // Medição cancelada é retrabalho: alguém mediu errado ou o serviço voltou.
  const medicoes = oss.reduce((s, o) => s + (o.medicoes || []).length, 0);
  const canceladas = oss.reduce((s, o) => s + (o.medicoes || []).filter((m) => m.situacao === 'cancelada').length, 0);
  const retrabalho = medicoes ? (medicoes - canceladas) / medicoes : null;

  const partes = [];
  if (pontualidade != null) partes.push({ v: pontualidade * 10, peso: 4 });
  partes.push({ v: documentos, peso: 3 });
  if (retrabalho != null) partes.push({ v: retrabalho * 10, peso: 2 });
  const peso = partes.reduce((s, x) => s + x.peso, 0);
  const nota = peso ? partes.reduce((s, x) => s + x.v * x.peso, 0) / peso : null;

  return {
    contratos: oss.length, concluidas: concluidas.length,
    valorContratado: oss.filter((o) => o.situacao !== 'cancelada')
      .reduce((s, o) => s + (totaisOS(o).contrato || 0), 0),
    pontualidade, atrasoMedio, medidas: atrasos.length,
    pendenciasGraves: graves, documentos,
    medicoes, canceladas, retrabalho,
    nota
  };
}

function notaPrestador(p) {
  const d = desempenhoPrestador(p);
  const estrelas = mediaAvaliacoes(p);
  const quantasAvaliacoes = ((p.avaliacoes) || []).filter((a) => a && a.media && !a.apagadoEm).length;
  const provisorio = d.concluidas === 0 && quantasAvaliacoes === 0;
  return { nota: combinar(d.nota, estrelas), desempenho: d, estrelas, quantasAvaliacoes, provisorio };
}

/* ══════════════════════════════════════════════════════════════════════════
   FICHA — a tela que explica a nota
   Nota sem explicação é palpite. Aqui dá para ver de onde saiu cada ponto.
   ══════════════════════════════════════════════════════════════════════════ */
function linhaFicha(icone, titulo, valor, detalhe, ruim) {
  return '<div class="arquivo-solto"><span class="ic">' + icone + '</span>' +
    '<div style="flex:1;min-width:0"><div class="nome">' + esc(titulo) + '</div>' +
    (detalhe ? '<div class="meta">' + detalhe + '</div>' : '') + '</div>' +
    '<div class="acoes"><b' + (ruim ? ' style="color:var(--vermelho)"' : '') + '>' + valor + '</b></div></div>';
}

const pct = (v) => v == null ? '—' : fmt.numero(v * 100, 0) + '%';

function cartaoQualificacao(q, tipo) {
  const c = classeDe(q.nota);
  const d = q.desempenho;
  const semNada = q.nota == null;

  return '<div class="cartao" style="border-left:4px solid ' +
      (c ? (c.letra === 'A' ? 'var(--verde)' : c.letra === 'B' ? 'var(--azul)'
        : c.letra === 'C' ? 'var(--ambar)' : 'var(--vermelho)') : 'var(--borda)') + '">' +
    '<div class="barra-acoes" style="justify-content:space-between;align-items:flex-start">' +
      '<div><h3 style="margin:0">⭐ Qualificação</h3>' +
        '<div class="legenda">' + (semNada
          ? 'Ainda sem histórico para pontuar.'
          : q.provisorio
            ? 'Nota provisória: ' + (tipo === 'forn' ? 'ainda não entregou nenhuma compra' : 'ainda não concluiu nenhum serviço') +
              '. Ela vira definitiva na primeira entrega.'
            : esc(c.txt) + ' — ' + esc(c.dica)) + '</div></div>' +
      '<div style="text-align:right">' +
        (semNada ? '<span class="etiqueta">sem histórico</span>'
          : '<div style="font-size:2rem;font-weight:700;line-height:1' +
            (q.provisorio ? ';color:var(--texto-fraco)' : '') + '">' + fmt.numero(q.nota, 1) +
            '<span style="font-size:1rem;color:var(--texto-fraco)">/10</span></div>' +
            '<div>' + selo(q.nota, { txt: true, provisorio: q.provisorio }) + '</div>') +
      '</div>' +
    '</div>' +

    '<div style="margin-top:10px">' +
      (tipo === 'forn'
        ? linhaFicha('🚚', 'Entrega no prazo', pct(d.pontualidade),
            d.medidas ? d.noPrazo + ' de ' + d.medidas + ' entrega(s) no prazo' +
              (d.atrasoMedio ? ' · atraso médio de ' + fmt.numero(d.atrasoMedio, 1) + ' dia(s)' : '')
              : 'nenhuma entrega com data prometida ainda',
            d.pontualidade != null && d.pontualidade < 0.7) +
          linhaFicha('📦', 'Entregou tudo', pct(d.completude),
            d.entregues ? d.entregues + ' compra(s) entregue(s)' +
              (d.comFalta ? ' · ' + d.comFalta + ' encerrada(s) com falta' : ' · sem falta')
              : 'nenhuma compra entregue ainda',
            d.completude != null && d.completude < 0.8) +
          linhaFicha('💵', 'Responde cotação', pct(d.taxaResposta),
            d.convites ? d.respondidos + ' de ' + d.convites + ' convite(s)' +
              (d.tempoResposta != null ? ' · responde em ' + fmt.numero(d.tempoResposta, 0) + 'h' : '') +
              (d.ganhou ? ' · ganhou ' + d.ganhou : '')
              : 'nunca foi convidado para cotar',
            d.taxaResposta != null && d.taxaResposta < 0.5)
        : linhaFicha('📅', 'Termina no prazo', pct(d.pontualidade),
            d.medidas ? d.medidas + ' contrato(s) concluído(s) com prazo' +
              (d.atrasoMedio ? ' · atraso médio de ' + fmt.numero(d.atrasoMedio, 0) + ' dia(s)' : '')
              : 'nenhum contrato concluído com data prevista',
            d.pontualidade != null && d.pontualidade < 0.7) +
          linhaFicha('🗂️', 'Pasta em dia', fmt.numero(d.documentos, 0) + '/10',
            d.pendenciasGraves ? d.pendenciasGraves + ' pendência(s) grave(s) hoje — trava medição' : 'CND, ASO e NR em ordem',
            d.pendenciasGraves > 0) +
          linhaFicha('📏', 'Medição sem retrabalho', pct(d.retrabalho),
            d.medicoes ? d.medicoes + ' medição(ões) · ' + d.canceladas + ' cancelada(s)' : 'nenhuma medição ainda',
            d.retrabalho != null && d.retrabalho < 0.8)) +

      linhaFicha('⭐', 'Nota da equipe', q.estrelas == null ? '—' : estrelasDe(q.estrelas),
        q.estrelas == null
          ? 'ninguém avaliou ainda — avalie ao final de cada ' + (tipo === 'forn' ? 'compra' : 'serviço')
          : fmt.numero(q.estrelas, 1) + ' de 5 em ' + (q.quantasAvaliacoes || 0) + ' avaliação(ões)') +
    '</div>' +

    '<p class="legenda" style="margin-top:10px">A nota é 60% do que o sistema mediu sozinho ' +
    '(prazo, entrega, resposta) e 40% das estrelas que a equipe deu. ' +
    'Fornecedor novo fica "sem histórico" — não é penalizado por ser novo.</p>' +
  '</div>';
}

// Lista de avaliações escritas (aparece na ficha).
function listaAvaliacoes(x, criterios) {
  const av = ((x && x.avaliacoes) || []).filter((a) => a && !a.apagadoEm)
    .sort((a, b) => String(b.em).localeCompare(String(a.em)));
  if (!av.length) return '<p class="legenda">Nenhuma avaliação escrita ainda.</p>';
  return av.map((a) =>
    '<div class="arquivo-solto" style="align-items:flex-start"><span class="ic">' + estrelasDe(a.media).slice(0, 1) + '</span>' +
    '<div style="flex:1;min-width:0">' +
      '<div class="nome">' + esc(a.ocCodigo || a.osCodigo || '—') + ' · ' + estrelasDe(a.media) +
        ' <b>' + fmt.numero(a.media, 1) + '</b></div>' +
      '<div class="meta">' + criterios.map(([k, rot]) =>
        esc(rot.split(' (')[0]) + ': ' + (a[k] || '—')).join(' · ') + '</div>' +
      (a.obs ? '<div class="meta">' + esc(a.obs) + '</div>' : '') +
      '<div class="meta">' + fmt.data(a.em) + ' · ' + esc(a.por || '—') + '</div>' +
    '</div></div>').join('');
}

/* ── Ficha do fornecedor (#/fornecedores/<id>) ─────────────────────────────── */
function fichaFornecedor(el, id) {
  const f = achar('forn', id);
  if (!f) { cabecalho('Fornecedor', ''); el.innerHTML = vazio('🤔', 'Não encontrado'); return; }
  const q = notaFornecedor(f);
  const compras = comprasDoFornecedor(f);
  const convites = convitesDoFornecedor(f);

  cabecalho(f.nome, (f.categorias || 'Fornecedor de material') + ' · ' + fmt.cnpj(f.cnpj),
    '<a class="btn" href="#/fornecedores">← Voltar</a>' +
    (f.telefone ? '<button class="btn zap" id="fZap">WhatsApp</button>' : '') +
    '<button class="btn primario" id="fEditar">Editar cadastro</button>');

  el.innerHTML =
    '<div class="grade g2"><div>' +
      cartaoQualificacao(q, 'forn') +
      '<div class="cartao"><h3>🧾 Compras</h3>' +
        (compras.length
          ? '<div class="tabela-rolagem"><table><thead><tr><th>Nº</th><th>Data</th>' +
            '<th class="num">Valor</th><th>Situação</th><th>Prazo</th></tr></thead><tbody>' +
            compras.slice(0, 20).map((o) => {
              const chegou = o.recebidoEm ? String(o.recebidoEm).slice(0, 10) : null;
              const atraso = (chegou && o.entregaPrevista)
                ? Math.round((new Date(chegou) - new Date(o.entregaPrevista)) / 86400000) : null;
              return '<tr class="clicavel" data-oc="' + esc(o.id) + '">' +
                '<td><b>' + esc(o.codigo || '—') + '</b></td>' +
                '<td>' + fmt.data(o.dataEmissao || o.criadoEm) + '</td>' +
                '<td class="num">' + fmt.brl(o.totalLiquido) + '</td>' +
                '<td>' + etiqueta(o.situacao) + '</td>' +
                '<td>' + (atraso == null ? '—'
                  : atraso <= 0 ? '<span class="etiqueta et-valido">no prazo</span>'
                  : '<span class="etiqueta et-vencido">' + atraso + 'd atrasado</span>') + '</td></tr>';
            }).join('') + '</tbody></table></div>'
          : '<p class="legenda">Nenhuma compra ainda.</p>') +
      '</div>' +
    '</div><div>' +
      '<div class="cartao"><h3>Resumo</h3><p>' +
        '<b>Compras:</b> ' + q.desempenho.compras + '<br>' +
        '<b>Total comprado:</b> ' + fmt.brl(q.desempenho.totalComprado) + '<br>' +
        '<b>Convites para cotar:</b> ' + q.desempenho.convites +
          ' · ganhou ' + q.desempenho.ganhou + '<br>' +
        '<b>Contato:</b> ' + esc(f.contato || '—') + '<br>' +
        '<b>WhatsApp:</b> ' + esc(fmt.telefone(f.telefone)) + '<br>' +
        '<b>Fornece:</b> ' + esc(f.categorias || '—') +
      '</p></div>' +
      '<div class="cartao"><h3>⭐ Avaliações da equipe</h3>' +
        listaAvaliacoes(f, CRITERIOS_FORN) + '</div>' +
      (convites.length
        ? '<div class="cartao"><h3>💵 Cotações</h3>' +
          convites.slice(0, 10).map((x) =>
            '<div class="arquivo-solto"><span class="ic">' +
            (x.convite.escolhido ? '🏆' : x.convite.respondidoEm ? '✅' : '⏳') + '</span>' +
            '<div style="flex:1;min-width:0"><div class="nome">' + esc(x.cot.codigo || '—') + '</div>' +
            '<div class="meta">' + (x.convite.respondidoEm
              ? 'respondeu ' + fmt.quando(x.convite.respondidoEm) + (x.convite.escolhido ? ' · escolhido' : '')
              : 'não respondeu') + '</div></div></div>').join('') +
          '</div>'
        : '') +
    '</div></div>';

  el.querySelectorAll('[data-oc]').forEach((tr) => tr.addEventListener('click', () => irPara('compras/' + tr.dataset.oc)));
  document.getElementById('fEditar').addEventListener('click', () => editarFornecedor(f.id));
  const bz = document.getElementById('fZap');
  if (bz) bz.addEventListener('click', () => window.open(linkWhats(f.telefone,
    'Olá ' + (f.contato || '') + ', aqui é da ' + ((S.cfg.empresa || {}).nomeCurto || 'Domo Construtora') + '.'), '_blank'));
}
