/* PERMUTAS: quanto ainda falta acertar com o parceiro.
 *
 * Permuta é troca. Na construção ela é regra, não exceção: o dono do terreno
 * entra com a área, o fornecedor entrega o elevador, o prestador executa a
 * fachada — e recebem em unidade do empreendimento, material ou acerto, não em
 * dinheiro corrente. Hoje esse controle vive na cabeça e num papel: ninguém
 * responde "quanto ainda falta da permuta do fulano" sem procurar ordem por
 * ordem.
 *
 * A tela é de UMA pergunta: o saldo. Todo o resto existe para sustentá-lo.
 *
 *   saldo = o que o parceiro entregou − o que a Domo já entregou a ele
 *
 *   saldo POSITIVO → a Domo ainda deve ao parceiro
 *   saldo NEGATIVO → o parceiro já recebeu mais do que entregou
 *
 * Os dois casos são normais e a tela precisa distinguir — por isso o número
 * nunca aparece sozinho, sempre com a frase que diz de que lado ele está.
 *
 * O QUE ELA NÃO FAZ, DE PROPÓSITO (cada uma nasceu de um jeito de errar que já
 * custou caro nos outros módulos):
 *
 * 1. NÃO ADIVINHA quais ordens são da permuta. O mesmo fornecedor vende na
 *    permuta E vende à vista; só a direção sabe separar. Cada ordem entra por
 *    um CLIQUE, e o que fica guardado é a LISTA das aceitas — nunca uma regra
 *    que as deduza depois. Deduzir pelo nome já criou sósia noutro sistema;
 *    aqui criaria saldo falso, que é dinheiro.
 *
 * 2. NÃO ESCONDE DIVERGÊNCIA. O valor é congelado no aceite e conferido contra
 *    a ordem viva a cada abertura: mudou, a tela diz e passa a usar o novo;
 *    a ordem sumiu ou foi cancelada, a tela avisa que o valor talvez deva sair
 *    da conta. Saldo que se corrige em silêncio é pior que saldo errado —
 *    ninguém volta a conferir.
 *
 * 3. NÃO DEIXA UMA ORDEM ABATER DUAS PERMUTAS. Sem esse índice, aceitar a
 *    mesma OC em duas permutas apagaria dinheiro de verdade e nenhuma das duas
 *    telas mostraria erro.
 *
 * 4. NÃO SOMA SALDOS OPOSTOS no topo. "R$ 30 mil que a Domo deve" mais
 *    "R$ 30 mil que o parceiro deve entregar" não são zero — são dois fatos
 *    contrários, e somá-los produz um número que não responde pergunta nenhuma.
 */

/* ── Vocabulário ────────────────────────────────────────────────────────────
   `entrega`   — o parceiro nos entregou (terreno, material, serviço, dinheiro)
   `pagamento` — a Domo entregou a ele (unidade, dinheiro, material)

   São dois VALORES DE CAMPO opostos, nunca sinal no número. Guardar o lado no
   sinal seria mais curto e pior: um menos digitado sem querer inverte a conta,
   e ninguém enxerga um sinal no meio de uma coluna de valores. */
const LADOS_PERMUTA = {
  entrega:   { rotulo: 'O parceiro entregou', curto: 'Entregou',  icone: '📥', cor: 'verde' },
  pagamento: { rotulo: 'A Domo entregou',   curto: 'Recebeu',   icone: '📤', cor: 'azul' }
};
const ladoPermuta = (t) => LADOS_PERMUTA[t] || LADOS_PERMUTA.entrega;

const permutas = () => lista('permuta');
const vivosP = (arr) => (arr || []).filter((x) => x && !x.apagadoEm);
const idP = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const cent = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* O que a ordem vale para a permuta.
   OC: o líquido — é o que a Domo se comprometeu a pagar, já com imposto, frete
   e desconto. OS: o valor do contrato.
   Arredondar ao centavo não é preciosismo: o total da OC sai de multiplicação
   e soma de itens e traz cauda binária (7340.4400000000005). Na tela some, na
   CONFERÊNCIA não: o congelado seria comparado com o vivo e a tela acusaria
   "mudou" numa ordem que ninguém tocou. */
function valorDaOrdem(o, col) {
  if (!o) return 0;
  if (col === 'oc') {
    if (typeof totaisOC === 'function') return cent(totaisOC(o).totalLiquido);
    return cent(o.totalLiquido != null ? o.totalLiquido : o.total);
  }
  if (typeof totaisOS === 'function') return cent(totaisOS(o).contrato);
  return cent(o.total);
}

// A ordem existe e ainda conta? Cancelada e apagada não valem como entrega.
const ordemViva = (o) => !!o && !o.apagadoEm && o.situacao !== 'cancelada';

/* A ficha da ordem como fica guardada DENTRO da permuta — o congelado.
   Guarda a CONTA, não só o resultado: "R$ 2.000,00" sozinho não responde de
   onde saiu; o bruto e o desconto ao lado respondem, e é o que a direção
   confere com o parceiro na frente do documento. */
function fichaDaOrdem(o, col) {
  const t = col === 'oc' && typeof totaisOC === 'function' ? totaisOC(o) : null;
  const desconto = cent(o.desconto);
  return {
    id: o.id, col,
    numero: String(o.codigo || ''),
    parceiro: String((o.fornecedor && o.fornecedor.nome) || (o.empreiteiro && o.empreiteiro.nome) || ''),
    data: String(o.dataEmissao || o.dataInicio || o.criadoEm || '').slice(0, 10),
    valor: valorDaOrdem(o, col),
    ...(t && desconto > 0 ? { bruto: cent(t.total), desconto } : {}),
    aceitoEm: new Date().toISOString(), aceitoPor: S.quem || '—'
  };
}

/* AS LINHAS DA PERMUTA, prontas para a tela.
 *
 * Cada ordem aceita vira uma linha que sabe se ainda existe e se o valor mudou
 * desde o aceite. `valor` é o número que ENTRA na conta.
 *
 * SÓ DÁ PARA DIZER "SUMIU" SE A LISTA CHEGOU. Quando o aparelho ainda não
 * sincronizou, ou o perfil não lê ordens, `lista('oc')` vem vazia — e aí TODAS
 * as ordens da permuta pareceriam canceladas de uma vez. Lista vazia não é
 * resposta: é ausência de resposta. Nesse caso a conta usa o congelado e a tela
 * diz que não deu para conferir. */
function linhasDaPermuta(p) {
  const temOrdens = lista('oc').length > 0 || lista('os').length > 0;
  return vivosP(p && p.ordens).map((f) => {
    const viva = temOrdens ? achar(f.col, f.id) : null;
    const existe = ordemViva(viva);
    const congelado = cent(f.valor);
    const atual = existe ? valorDaOrdem(viva, f.col) : null;
    // A ordem viva manda: quando ela responde, ela é a verdade. O congelado só
    // sustenta a linha que não deu para conferir.
    const valor = atual === null ? congelado : atual;
    return {
      id: f.id, col: f.col,
      numero: String((viva && viva.codigo) || f.numero || ''),
      parceiro: String(f.parceiro || ''),
      data: String((viva && (viva.dataEmissao || viva.dataInicio)) || f.data || '').slice(0, 10),
      valor, congelado,
      // Centavo de arredondamento não é "mudança de valor".
      mudou: atual !== null && Math.abs(atual - congelado) >= 0.01,
      bruto: cent((viva && viva.total) || f.bruto),
      desconto: cent((viva && viva.desconto) || f.desconto),
      // Continua contando: foi aceita, e o valor foi dado como entregue. Quem
      // decide tirar é a direção, no botão — não a tela sozinha.
      sumiu: temOrdens && !existe,
      semConferir: !temOrdens
    };
  }).sort((a, b) => String(b.data).localeCompare(String(a.data)));
}

function lancamentosDaPermuta(p) {
  return vivosP(p && p.lancamentos).map((l) => ({
    id: l.id,
    data: String(l.data || '').slice(0, 10),
    descricao: String(l.descricao || ''),
    valor: cent(l.valor),
    tipo: l.tipo === 'pagamento' ? 'pagamento' : 'entrega',
    // A nota do que foi. Mora DENTRO da entrada porque documento solto numa
    // gaveta da permuta não diz a qual entrada pertence.
    anexo: l.anexo || null
  })).sort((a, b) => String(b.data).localeCompare(String(a.data)));
}

/* O RESUMO: entregou, recebeu, saldo. */
function resumoDaPermuta(p) {
  const linhas = linhasDaPermuta(p);
  const lancs = lancamentosDaPermuta(p);
  const entregasManuais = lancs.filter((l) => l.tipo === 'entrega');
  const pagamentos = lancs.filter((l) => l.tipo === 'pagamento');

  const emOrdens = linhas.reduce((s, l) => s + l.valor, 0);
  const emEntregas = entregasManuais.reduce((s, l) => s + l.valor, 0);
  const entregue = cent(emOrdens + emEntregas);
  const pago = cent(pagamentos.reduce((s, l) => s + l.valor, 0));

  return {
    linhas, lancamentos: lancs, entregasManuais, pagamentos,
    emOrdens: cent(emOrdens), emEntregas: cent(emEntregas),
    entregue, pago,
    saldo: cent(entregue - pago),
    // Quanto do que ele entregou já foi quitado — para a barra. Sem entrega não
    // há denominador: devolve null em vez de fingir 0% ou 100%.
    pct: entregue > 0 ? Math.min(1, pago / entregue) : null,
    // O que a tela precisa AVISAR em vez de esconder.
    mudaram: linhas.filter((l) => l.mudou).length,
    sumiram: linhas.filter((l) => l.sumiu).length,
    semConferir: linhas.some((l) => l.semConferir)
  };
}

/* Quem é o dono de cada ordem já aceita, em TODAS as permutas. Uma ordem só
   pode abater uma permuta: sem este índice, aceitar a mesma OC duas vezes
   apagaria dinheiro e nenhuma das telas mostraria erro. */
function donoPorOrdem() {
  const mapa = new Map();
  for (const p of permutas()) {
    if (p.apagadoEm) continue;
    for (const f of vivosP(p.ordens)) {
      const k = f.col + ':' + f.id;
      if (!mapa.has(k)) mapa.set(k, { id: p.id, nome: p.nome || 'sem nome' });
    }
  }
  return mapa;
}

/* As ordens dos parceiros desta permuta, para a tela de escolher.
   `presaEm` marca a que já entrou em OUTRA permuta — aparece bloqueada, com o
   nome de onde está. */
function ordensDosParceiros(p) {
  const nomes = new Set((p.parceiros || []).map((x) => chaveParceiro(x.nome)));
  const ids = new Set((p.parceiros || []).map((x) => x.id).filter(Boolean));
  if (!nomes.size && !ids.size) return [];
  const dono = donoPorOrdem();
  const daPermuta = new Set(vivosP(p.ordens).map((f) => f.col + ':' + f.id));
  const saida = [];
  for (const col of ['oc', 'os']) {
    for (const o of lista(col)) {
      if (!ordemViva(o)) continue;
      const nome = (o.fornecedor && o.fornecedor.nome) || (o.empreiteiro && o.empreiteiro.nome) || '';
      const vinculo = col === 'oc' ? o.fornecedorId : o.prestadorId;
      if (!nomes.has(chaveParceiro(nome)) && !(vinculo && ids.has(vinculo))) continue;
      const d = dono.get(col + ':' + o.id);
      saida.push({
        id: o.id, col, numero: String(o.codigo || ''), parceiro: nome,
        data: String(o.dataEmissao || o.dataInicio || '').slice(0, 10),
        valor: valorDaOrdem(o, col),
        nesta: daPermuta.has(col + ':' + o.id),
        presaEm: d && d.id !== p.id ? d.nome : null
      });
    }
  }
  return saida.sort((a, b) => String(b.data).localeCompare(String(a.data)));
}

// Nome de parceiro comparável: sem acento, sem caixa, sem espaço sobrando.
function chaveParceiro(nome) {
  return String(nome == null ? '' : nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().replace(/\s+/g, ' ').toUpperCase();
}

/* OS TOTAIS DE TODAS AS PERMUTAS — os números do topo.
 *
 * NÃO SOMA OS SALDOS. Saldo positivo (a Domo deve) e negativo (o parceiro deve
 * entregar) são fatos opostos; somados viram um número que não responde nada.
 * Saem separados, e quem lê decide o que fazer com cada um.
 *
 * `semEntrega` é o que impede o número de mentir: uma permuta em que a Domo já
 * entregou e ninguém lançou o que o parceiro deu aparece como "parceiro devendo
 * tudo" — e não é dívida, é cadastro faltando. */
function totaisDasPermutas(resumos) {
  const vivas = (resumos || []).filter((p) => !p.encerrada);
  const t = { quantas: vivas.length, encerradas: (resumos || []).length - vivas.length,
    entregue: 0, pago: 0, aPagar: 0, aReceber: 0, semEntrega: 0 };
  for (const p of vivas) {
    t.entregue += p.entregue || 0;
    t.pago += p.pago || 0;
    if (p.saldo > 0) t.aPagar += p.saldo;          // a Domo ainda deve
    else if (p.saldo < 0) t.aReceber += -p.saldo;  // o parceiro ainda deve entregar
    if (!(p.entregue > 0) && (p.pago || 0) > 0) t.semEntrega++;
  }
  for (const k of ['entregue', 'pago', 'aPagar', 'aReceber']) t[k] = cent(t[k]);
  return t;
}

/* O EXTRATO — a conta consolidada, para o papel.
   A tela é dividida por TAREFA (lançar, escolher ordem, ver saldo), porque é
   assim que se trabalha. O papel é dividido por CONTA, porque é assim que se
   confere com o parceiro: de um lado tudo o que ele entregou — ordem e
   lançamento na MESMA lista, em ordem de data —, do outro tudo o que recebeu.
   Separados, ele soma duas colunas para saber onde está; juntos, lê de cima
   para baixo. */
function extratoDaPermuta(p) {
  const r = resumoDaPermuta(p);
  const entregou = [
    ...r.linhas.map((l) => ({
      data: l.data, documento: nomeOrdem(l.col, l.numero),
      descricao: l.parceiro, valor: l.valor,
      alerta: l.sumiu ? 'cancelada no sistema' : l.mudou ? 'valor mudou' : null
    })),
    ...r.entregasManuais.map((l) => ({
      data: l.data, documento: 'Lançamento', descricao: l.descricao || '(sem descrição)',
      valor: l.valor, alerta: null
    }))
  ].sort((a, b) => a.data.localeCompare(b.data));
  const recebeu = r.pagamentos.map((l) => ({
    data: l.data, descricao: l.descricao || '(sem descrição)', valor: l.valor,
    nota: (l.anexo && l.anexo.nome) || null
  })).sort((a, b) => a.data.localeCompare(b.data));
  return { ...r, entregou, recebeu,
    // A BALANÇA: o que entrou, o que saiu, e de que lado sobra.
    balanca: { recebemos: r.entregue, entregamos: r.pago, diferenca: r.saldo,
      lado: r.saldo > 0 ? 'a-pagar' : r.saldo < 0 ? 'a-receber' : 'zerada' } };
}

// A frase que acompanha o número — o saldo nunca aparece sozinho.
function fraseDoSaldo(saldo) {
  if (Math.abs(saldo) < 0.01) return { txt: 'permuta quitada', cls: '' };
  return saldo > 0
    ? { txt: 'a Domo ainda deve', cls: 'et-vencendo' }
    : { txt: 'o parceiro ainda deve entregar', cls: 'et-valido' };
}

/* ══════════════════════════════════════════════════════════════════════════
   LISTA — onde a direção bate o olho para saber onde ainda falta acertar
   ══════════════════════════════════════════════════════════════════════════ */
let verPermutasEncerradas = false;

TELAS.permutas = function (el, args) {
  if (args[0]) return telaPermuta(el, args[0]);

  const todas = permutas().map((p) => Object.assign({}, p, resumoDaPermuta(p)))
    .sort((a, b) => {
      if (!!a.encerrada !== !!b.encerrada) return a.encerrada ? 1 : -1;
      return Math.abs(b.saldo) - Math.abs(a.saldo);   // o que mais falta acertar primeiro
    });
  const encerradas = todas.filter((p) => p.encerrada);
  if (!encerradas.length) verPermutasEncerradas = false;
  const visiveis = verPermutasEncerradas ? todas : todas.filter((p) => !p.encerrada);
  const t = totaisDasPermutas(todas);

  cabecalho('Permutas', t.quantas + ' em aberto',
    '<button class="btn primario" id="novaPermuta">+ Permuta</button>');

  el.innerHTML =
    '<div class="aviso info">Permuta é troca: o parceiro entra com terreno, material ou serviço e ' +
    'recebe em unidade, material ou acerto. Aqui fica o que cada lado já entregou — e quanto ainda falta.</div>' +
    (t.semEntrega
      ? '<div class="aviso atencao"><b>' + t.semEntrega + '</b> permuta(s) com entrega da Domo lançada e ' +
        'nada lançado do lado do parceiro. Isso não é dívida dele — é cadastro faltando.</div>'
      : '') +

    (todas.length ?
      '<div class="grade g3" style="margin-bottom:14px">' +
        '<div class="indicador"><div class="rotulo">O parceiro entregou</div>' +
          '<div class="valor">' + fmt.brl(t.entregue) + '</div>' +
          '<div class="legenda">somando as ' + t.quantas + ' permuta(s) em aberto</div></div>' +
        '<div class="indicador"><div class="rotulo">A Domo já entregou</div>' +
          '<div class="valor">' + fmt.brl(t.pago) + '</div></div>' +
        '<div class="indicador ' + (t.aPagar > 0 ? 'alerta' : '') + '">' +
          '<div class="rotulo">A Domo ainda deve</div>' +
          '<div class="valor">' + fmt.brl(t.aPagar) + '</div>' +
          '<div class="legenda">' + (t.aReceber > 0
            ? 'e ' + fmt.brl(t.aReceber) + ' os parceiros ainda devem entregar'
            : 'nenhum parceiro devendo entrega') + '</div></div>' +
      '</div>' : '') +

    (encerradas.length
      ? '<div class="barra-acoes" style="margin-bottom:10px">' +
        '<button class="btn pequeno' + (verPermutasEncerradas ? ' primario' : '') + '" id="togEnc">' +
          (verPermutasEncerradas ? 'Ocultar encerradas' : 'Ver encerradas (' + encerradas.length + ')') +
        '</button></div>' : '') +

    (visiveis.length
      ? visiveis.map((p) => {
          const f = fraseDoSaldo(p.saldo);
          const alertas = [p.mudaram ? p.mudaram + ' valor(es) mudaram' : '',
            p.sumiram ? p.sumiram + ' ordem(ns) cancelada(s)' : '',
            p.semConferir ? 'não deu para conferir' : ''].filter(Boolean);
          return '<div class="cartao clicavel" data-id="' + esc(p.id) + '"' +
            (p.encerrada ? ' style="opacity:.6"' : '') + '>' +
            '<div class="barra-acoes" style="justify-content:space-between;align-items:flex-start">' +
              '<div style="min-width:0">' +
                '<h3 style="margin:0">🤝 ' + esc(p.nome || 'Sem nome') +
                  (p.encerrada ? ' <span class="etiqueta">encerrada</span>' : '') + '</h3>' +
                '<div class="legenda">' + esc((p.parceiros || []).map((x) => x.nome).join(' · ') || 'nenhum parceiro ligado') + '</div>' +
              '</div>' +
              '<div style="text-align:right;white-space:nowrap">' +
                '<div class="valor" style="font-size:1.25rem">' + fmt.brl(Math.abs(p.saldo)) + '</div>' +
                '<span class="etiqueta ' + f.cls + '">' + f.txt + '</span>' +
              '</div>' +
            '</div>' +
            (p.pct != null
              ? '<div class="progresso" style="margin-top:10px"><i style="width:' + (p.pct * 100).toFixed(1) + '%"></i></div>' +
                '<div class="legenda" style="margin-top:4px">Entregou ' + fmt.brl(p.entregue) +
                ' · recebeu ' + fmt.brl(p.pago) + '</div>'
              : '<div class="legenda" style="margin-top:8px">Nada lançado do lado do parceiro ainda.</div>') +
            (alertas.length ? '<div class="legenda" style="color:var(--ambar);margin-top:4px">⚠ ' + esc(alertas.join(' · ')) + '</div>' : '') +
          '</div>';
        }).join('')
      : '<div class="cartao">' + vazio('🤝', verPermutasEncerradas ? 'Nada encerrado' : 'Nenhuma permuta',
          'Cadastre a troca com o parceiro para acompanhar o que cada lado já entregou.') + '</div>');

  el.querySelectorAll('[data-id]').forEach((c) => c.addEventListener('click', () => irPara('permutas/' + c.dataset.id)));
  const tg = document.getElementById('togEnc');
  if (tg) tg.addEventListener('click', () => { verPermutasEncerradas = !verPermutasEncerradas; render(); });
  document.getElementById('novaPermuta').addEventListener('click', () => editarPermuta(null));
};

/* ══════════════════════════════════════════════════════════════════════════
   UMA PERMUTA — o saldo, o que cada lado entregou, e as ordens que entram
   ══════════════════════════════════════════════════════════════════════════ */
function telaPermuta(el, id) {
  const p = achar('permuta', id);
  if (!p || p.apagadoEm) { cabecalho('Permuta', ''); el.innerHTML = vazio('🤔', 'Não encontrada'); return; }
  const r = resumoDaPermuta(p);
  const f = fraseDoSaldo(r.saldo);

  cabecalho('🤝 ' + (p.nome || 'Permuta'),
    (p.parceiros || []).map((x) => x.nome).join(' · ') + (p.encerrada ? ' · ENCERRADA' : ''),
    '<a class="btn" href="#/permutas">← Voltar</a>' +
    '<button class="btn" id="pdfPerm">📄 Extrato</button>' +
    '<button class="btn" id="editPerm">Editar</button>');

  el.innerHTML =
    // O SALDO, que é a razão da tela existir — nunca sozinho, sempre com a frase.
    '<div class="cartao" style="text-align:center">' +
      '<div class="rotulo">Saldo da permuta</div>' +
      '<div class="valor" style="font-size:2.1rem">' + fmt.brl(Math.abs(r.saldo)) + '</div>' +
      '<div><span class="etiqueta ' + f.cls + '">' + f.txt + '</span></div>' +
      (r.pct != null ? '<div class="progresso" style="margin-top:12px"><i style="width:' + (r.pct * 100).toFixed(1) + '%"></i></div>' : '') +
      '<div class="legenda" style="margin-top:6px">O parceiro entregou <b>' + fmt.brl(r.entregue) +
        '</b> · a Domo já entregou <b>' + fmt.brl(r.pago) + '</b></div>' +
    '</div>' +

    // Os avisos ficam ANTES das listas: divergência escondida é pior que erro.
    (r.semConferir ? '<div class="aviso atencao">As ordens ainda não chegaram neste aparelho — a conta está usando os ' +
      'valores congelados no aceite e <b>não deu para conferir</b>. Sincronize para conferir.</div>' : '') +
    (r.mudaram ? '<div class="aviso atencao"><b>' + r.mudaram + '</b> ordem(ns) mudaram de valor depois do aceite. ' +
      'A conta já usa o valor novo — confira se ainda combina com o acertado.</div>' : '') +
    (r.sumiram ? '<div class="aviso atencao"><b>' + r.sumiram + '</b> ordem(ns) foram canceladas ou apagadas e ' +
      'continuam contando como entrega. Se não valem mais, tire-as da permuta no ✕.</div>' : '') +

    '<div class="grade g2">' +

    // 📥 O QUE O PARCEIRO ENTREGOU — ordens aceitas + lançamentos
    '<div><div class="cartao">' +
      '<div class="barra-acoes" style="justify-content:space-between">' +
        '<h3 style="margin:0">📥 O parceiro entregou</h3>' +
        '<div><b>' + fmt.brl(r.entregue) + '</b></div></div>' +
      '<div class="legenda" style="margin-bottom:8px">Ordens de compra e de serviço deste parceiro que ' +
        'entram nesta permuta — cada uma entra por um clique, nunca por dedução.</div>' +
      (r.linhas.length ? r.linhas.map((l) => linhaOrdemPermuta(l)).join('')
        : '<p class="legenda">Nenhuma ordem aceita ainda.</p>') +
      '<div class="barra-acoes" style="margin-top:10px">' +
        '<button class="btn pequeno primario" id="escolherOrdens">+ Escolher ordens</button>' +
        '<button class="btn pequeno" id="addEntrega">+ Lançar entrega</button>' +
      '</div>' +
      (r.entregasManuais.length
        ? '<div style="margin-top:10px"><div class="legenda">Fora de ordem (' + fmt.brl(r.emEntregas) + ')</div>' +
          r.entregasManuais.map((l) => linhaLancPermuta(l)).join('') + '</div>' : '') +
    '</div></div>' +

    // 📤 O QUE A DOMO ENTREGOU
    '<div><div class="cartao">' +
      '<div class="barra-acoes" style="justify-content:space-between">' +
        '<h3 style="margin:0">📤 A Domo entregou</h3>' +
        '<div><b>' + fmt.brl(r.pago) + '</b></div></div>' +
      '<div class="legenda" style="margin-bottom:8px">Unidade do empreendimento, dinheiro, material — ' +
        'cada entrega com data, o que foi e a nota anexada nela.</div>' +
      (r.pagamentos.length ? r.pagamentos.map((l) => linhaLancPermuta(l)).join('')
        : '<p class="legenda">Nada entregue ao parceiro ainda.</p>') +
      '<div class="barra-acoes" style="margin-top:10px">' +
        '<button class="btn pequeno primario" id="addPagamento">+ Lançar o que entregamos</button></div>' +
    '</div>' +
    (p.obs ? '<div class="cartao"><h3>📝 Combinado</h3><p class="legenda" style="white-space:pre-wrap">' + esc(p.obs) + '</p></div>' : '') +
    '<div class="cartao"><h3>Histórico</h3>' + linhaTempo(p.historico) + '</div>' +
    '</div></div>';

  // ── ações
  document.getElementById('editPerm').addEventListener('click', () => editarPermuta(p.id));
  document.getElementById('pdfPerm').addEventListener('click', () => pdfPermuta(achar('permuta', p.id)));
  document.getElementById('escolherOrdens').addEventListener('click', () => escolherOrdensPermuta(p.id));
  document.getElementById('addEntrega').addEventListener('click', () => lancamentoPermuta(p.id, 'entrega', null));
  document.getElementById('addPagamento').addEventListener('click', () => lancamentoPermuta(p.id, 'pagamento', null));

  el.querySelectorAll('[data-verordem]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const [col, oid] = b.dataset.verordem.split('/');
    irPara((col === 'oc' ? 'compras/' : 'servicos/') + oid);
  }));
  el.querySelectorAll('[data-tirar-ordem]').forEach((b) => b.addEventListener('click', async () => {
    const [col, oid] = b.dataset.tirarOrdem.split(':');
    const atual = achar('permuta', p.id);
    const alvo = vivosP(atual.ordens).find((x) => x.col === col && x.id === oid);
    if (!alvo) { toast('Esta ordem já saiu da permuta', 'ruim'); return; }
    if (!await confirmar('Tirar a ' + nomeOrdem(col, alvo.numero) +
      ' (' + fmt.brl(alvo.valor) + ') desta permuta?', { perigo: true, ok: 'Tirar' })) return;
    gravarPermuta(p.id, (base) => ({
      ordens: (base.ordens || []).map((x) => (x.col === col && x.id === oid && !x.apagadoEm)
        ? Object.assign({}, x, { apagadoEm: new Date().toISOString(), apagadoPor: S.quem || '—' }) : x)
    }), 'Tirou a ' + nomeOrdem(col, alvo.numero) + ' (' + fmt.brl(alvo.valor) + ')');
    render();
  }));

  el.querySelectorAll('[data-edlanc]').forEach((b) => b.addEventListener('click', () => {
    const l = vivosP(achar('permuta', p.id).lancamentos).find((x) => x.id === b.dataset.edlanc);
    if (l) lancamentoPermuta(p.id, l.tipo, l);
  }));
  el.querySelectorAll('[data-rmlanc]').forEach((b) => b.addEventListener('click', async () => {
    const l = vivosP(achar('permuta', p.id).lancamentos).find((x) => x.id === b.dataset.rmlanc);
    if (!l) return;
    if (!await confirmar('Remover o lançamento de ' + fmt.brl(l.valor) + '?', { perigo: true, ok: 'Remover' })) return;
    gravarPermuta(p.id, (base) => ({
      lancamentos: (base.lancamentos || []).map((x) => x.id === l.id
        ? Object.assign({}, x, { apagadoEm: new Date().toISOString(), apagadoPor: S.quem || '—' }) : x)
    }), 'Removeu lançamento de ' + fmt.brl(l.valor));
    render();
  }));
  el.querySelectorAll('[data-bxanexo]').forEach((b) => b.addEventListener('click', () => {
    const l = vivosP(achar('permuta', p.id).lancamentos).find((x) => x.id === b.dataset.bxanexo);
    if (l && l.anexo) baixar(l.anexo.arquivoId, l.anexo.nome);
  }));
}

// O nome da ordem na tela. `codigo` já vem "OC-0004"/"OS-0001"; prefixar de novo
// produzia "OC OC-0004". Quando o código ainda não foi carimbado pelo servidor
// (registro recém-criado offline), o prefixo entra para a linha não ficar muda.
function nomeOrdem(col, numero) {
  const n = String(numero || '').trim();
  if (n) return n;
  return col === 'oc' ? 'OC (sincronizando…)' : 'OS (sincronizando…)';
}

// Uma ordem aceita, com o que a tela precisa AVISAR ao lado do número.
function linhaOrdemPermuta(l) {
  const alerta = l.sumiu ? '<span class="etiqueta et-vencido">cancelada</span>'
    : l.mudou ? '<span class="etiqueta et-vencendo">valor mudou (era ' + fmt.brl(l.congelado) + ')</span>'
    : l.semConferir ? '<span class="etiqueta">não conferida</span>' : '';
  return '<div class="arquivo-solto"><span class="ic">' + (l.col === 'oc' ? '🧾' : '🛠️') + '</span>' +
    '<div style="flex:1;min-width:0">' +
      '<div class="nome">' + esc(nomeOrdem(l.col, l.numero)) + ' — ' + fmt.brl(l.valor) + '</div>' +
      '<div class="meta">' + (l.data ? fmt.data(l.data) : '—') + ' · ' + esc(l.parceiro) +
        (l.desconto > 0 ? ' · bruto ' + fmt.brl(l.bruto) + ' − desconto ' + fmt.brl(l.desconto) : '') +
        (alerta ? ' ' + alerta : '') + '</div></div>' +
    '<div class="acoes">' +
      '<button class="btn pequeno" data-verordem="' + esc(l.col + '/' + l.id) + '">Abrir</button>' +
      '<button class="btn pequeno" data-tirar-ordem="' + esc(l.col + ':' + l.id) + '">✕</button>' +
    '</div></div>';
}

function linhaLancPermuta(l) {
  return '<div class="arquivo-solto"><span class="ic">' + ladoPermuta(l.tipo).icone + '</span>' +
    '<div style="flex:1;min-width:0">' +
      '<div class="nome">' + fmt.brl(l.valor) + '</div>' +
      '<div class="meta">' + (l.data ? fmt.data(l.data) : '—') + ' · ' + esc(l.descricao || '(sem descrição)') +
        (l.anexo ? ' · 📎 ' + esc(l.anexo.nome || 'nota') : '') + '</div></div>' +
    '<div class="acoes">' +
      (l.anexo ? '<button class="btn pequeno primario" data-bxanexo="' + esc(l.id) + '">Nota</button>' : '') +
      '<button class="btn pequeno" data-edlanc="' + esc(l.id) + '">✎</button>' +
      '<button class="btn pequeno" data-rmlanc="' + esc(l.id) + '">✕</button>' +
    '</div></div>';
}

/* Gravação: relê do store, aplica a mudança e carimba o histórico.
   RELER é obrigatório — a tela fica aberta enquanto o sync roda, e gravar o
   retrato de quando ela abriu apagaria a ordem que o outro aparelho aceitou. */
function gravarPermuta(id, mudanca, textoHistorico) {
  const base = achar('permuta', id);
  if (!base) { toast('Permuta não encontrada — atualize a tela', 'ruim'); return null; }
  const n = Object.assign({}, base, mudanca(base));
  if (textoHistorico) n.historico = historiar(base, textoHistorico);
  return salvar('permuta', n);
}

/* ══════════════════════════════════════════════════════════════════════════
   MODAIS
   ══════════════════════════════════════════════════════════════════════════ */
// Fornecedores e prestadores na mesma lista: a permuta costuma abranger mais de
// uma empresa do MESMO dono, e o parceiro pode ser das duas naturezas.
function parceirosCadastrados() {
  return [
    ...lista('forn').map((x) => ({ id: x.id, nome: x.nome, cnpj: x.cnpj || '', col: 'forn' })),
    ...lista('prest').map((x) => ({ id: x.id, nome: x.nome, cnpj: x.cnpj || '', col: 'prest' }))
  ].filter((x) => x.nome).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
}

function editarPermuta(id) {
  const p = (id && achar('permuta', id)) || {};
  const cad = parceirosCadastrados();
  const ligados = new Set((p.parceiros || []).map((x) => x.id).filter(Boolean));
  abrirModal({
    titulo: id ? 'Editar permuta' : 'Nova permuta',
    largo: true,
    corpo: '<div id="fPerm">' +
      campo('Nome da permuta', entrada('nome', p.nome || '', { placeholder: 'Ex.: Terreno — família Andrade' })) +
      '<div class="campo"><label>Parceiros (fornecedores e prestadores desta troca)</label>' +
        '<div class="legenda" style="margin-bottom:6px">Marque todas as empresas do mesmo dono — a permuta ' +
          'costuma abranger mais de um CNPJ, e é por elas que as ordens são encontradas.</div>' +
        (cad.length ? '<div style="max-height:210px;overflow:auto;border:1px solid var(--borda);border-radius:9px;padding:6px">' +
          cad.map((x) => '<label class="arquivo-solto" style="cursor:pointer">' +
            '<input type="checkbox" data-parc="' + esc(x.id) + '"' + (ligados.has(x.id) ? ' checked' : '') + '>' +
            '<div style="flex:1;min-width:0"><div class="nome">' + esc(x.nome) + '</div>' +
            '<div class="meta">' + (x.col === 'forn' ? 'fornecedor' : 'prestador') +
              (x.cnpj ? ' · ' + esc(x.cnpj) : '') + '</div></div></label>').join('') + '</div>'
          : '<p class="legenda">Nenhum fornecedor ou prestador cadastrado ainda.</p>') + '</div>' +
      campo('O que foi combinado', areaTexto('obs', p.obs || '',
        'Ex.: terreno da Rua X por 4 apartamentos do Diamond, entregues no habite-se')) +
      (id ? campo('Situação', seletor('encerradaTxt', p.encerrada ? 'Encerrada' : 'Em aberto', ['Em aberto', 'Encerrada'])) : '') +
    '</div>',
    acoes: [
      (id ? { texto: 'Apagar', classe: 'perigo', aoClicar: async () => {
        fecharModal();
        if (!await confirmar('Apagar a permuta "' + (p.nome || '') + '"? Vai para a lixeira — a direção pode restaurar.',
          { perigo: true, ok: 'Apagar' })) return;
        if (!navigator.onLine) { toast('Sem internet agora — tente quando conectar', 'ruim'); return; }
        try { await api('apagar', { colecao: 'permuta', id }); }
        catch (e) { toast('Não consegui apagar: ' + e.message, 'ruim'); return; }
        await puxar(); irPara('permutas');
      } } : null),
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar', classe: 'primario', aoClicar: (fundo) => {
        const d = lerCampos(fundo.querySelector('#fPerm'));
        if (!d.nome.trim()) { toast('Dê um nome à permuta', 'ruim'); return; }
        const escolhidos = Array.from(fundo.querySelectorAll('[data-parc]:checked'))
          .map((c) => cad.find((x) => x.id === c.dataset.parc)).filter(Boolean)
          .map((x) => ({ id: x.id, nome: x.nome, cnpj: x.cnpj, col: x.col }));
        const base = (id && achar('permuta', id)) || {};
        const n = Object.assign({}, base, {
          id: id || undefined, nome: d.nome.trim(), obs: (d.obs || '').trim(),
          parceiros: escolhidos, encerrada: d.encerradaTxt === 'Encerrada'
        });
        n.historico = historiar(base, id ? 'Editou a permuta' : 'Permuta criada');
        const salvo = salvar('permuta', n);
        fecharModal();
        if (!id) irPara('permutas/' + salvo.id); else render();
      } }
    ].filter(Boolean)
  });
}

/* ESCOLHER AS ORDENS. Cada uma entra por um clique — a tela nunca decide
   sozinha quais ordens são da permuta, porque o mesmo fornecedor vende na
   permuta e vende à vista. A que já está em OUTRA permuta aparece bloqueada,
   com o nome de onde está: uma ordem só pode abater uma permuta. */
function escolherOrdensPermuta(id) {
  const p = achar('permuta', id);
  if (!p) return;
  if (!(p.parceiros || []).length) {
    toast('Ligue ao menos um fornecedor ou prestador à permuta primeiro (Editar)', 'ruim');
    return;
  }
  const cands = ordensDosParceiros(p);
  abrirModal({
    titulo: 'Escolher ordens desta permuta',
    largo: true,
    corpo: '<p class="legenda">Marque as ordens que fazem parte da troca. O valor de cada uma é ' +
      '<b>congelado no aceite</b> e conferido depois — se mudar no sistema, a tela avisa.</p>' +
      (cands.length
        ? '<div class="tabela-rolagem"><table><thead><tr><th></th><th>Ordem</th><th>Data</th>' +
          '<th>Parceiro</th><th class="num">Valor</th></tr></thead><tbody>' +
          cands.map((o) => '<tr' + (o.presaEm ? ' style="opacity:.5"' : '') + '>' +
            '<td>' + (o.presaEm
              ? '🔒'
              : '<input type="checkbox" data-ord="' + esc(o.col + ':' + o.id) + '"' + (o.nesta ? ' checked' : '') + '>') + '</td>' +
            '<td><b>' + esc(nomeOrdem(o.col, o.numero)) + '</b></td>' +
            '<td>' + (o.data ? fmt.data(o.data) : '—') + '</td>' +
            '<td>' + esc(o.parceiro) + (o.presaEm ? '<div class="legenda">já usada em: ' + esc(o.presaEm) + '</div>' : '') + '</td>' +
            '<td class="num">' + fmt.brl(o.valor) + '</td></tr>').join('') +
          '</tbody></table></div>'
        : '<div class="aviso atencao">Nenhuma ordem de compra ou de serviço encontrada para os parceiros ' +
          'desta permuta. Confira se as ordens estão com o fornecedor/prestador certo.</div>'),
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar escolha', classe: 'primario', aoClicar: (fundo) => {
        const marcadas = new Set(Array.from(fundo.querySelectorAll('[data-ord]:checked')).map((c) => c.dataset.ord));
        // RELÊ na hora de gravar: o modal fica aberto e o sync roda por baixo.
        const base = achar('permuta', id);
        if (!base) { toast('Permuta não encontrada', 'ruim'); return; }
        const antes = new Set(vivosP(base.ordens).map((x) => x.col + ':' + x.id));
        const ordens = (base.ordens || []).slice();
        const novas = [], tiradas = [];
        // liga o que foi marcado (ressuscitando o que estava apagado)
        for (const chave of marcadas) {
          if (antes.has(chave)) continue;
          const [col, oid] = chave.split(':');
          const o = achar(col, oid);
          if (!ordemViva(o)) continue;
          const i = ordens.findIndex((x) => x.col === col && x.id === oid);
          const ficha = fichaDaOrdem(o, col);
          if (i >= 0) { ordens[i] = Object.assign({}, ficha); delete ordens[i].apagadoEm; delete ordens[i].apagadoPor; }
          else ordens.push(ficha);
          novas.push(nomeOrdem(col, ficha.numero));
        }
        // desliga o que foi desmarcado
        for (const chave of antes) {
          if (marcadas.has(chave)) continue;
          const [col, oid] = chave.split(':');
          const i = ordens.findIndex((x) => x.col === col && x.id === oid && !x.apagadoEm);
          if (i >= 0) {
            tiradas.push(nomeOrdem(col, ordens[i].numero));
            ordens[i] = Object.assign({}, ordens[i], { apagadoEm: new Date().toISOString(), apagadoPor: S.quem || '—' });
          }
        }
        if (!novas.length && !tiradas.length) { fecharModal(); return; }
        const txt = [novas.length ? 'Aceitou ' + novas.join(', ') : '',
          tiradas.length ? 'Tirou ' + tiradas.join(', ') : ''].filter(Boolean).join(' · ');
        const n = Object.assign({}, base, { ordens });
        n.historico = historiar(base, txt);
        salvar('permuta', n);
        fecharModal(); render();
        toast(txt, 'bom');
      } }
    ]
  });
}

/* UM LANÇAMENTO. O mesmo formulário para os dois lados — o que muda é o rótulo,
   porque a operação é a mesma e duas telas quase iguais viram duas telas com
   defeitos diferentes. */
function lancamentoPermuta(id, tipo, existente) {
  const l = existente || {};
  const lado = ladoPermuta(tipo);
  abrirModal({
    titulo: (existente ? 'Editar — ' : 'Lançar — ') + lado.rotulo,
    corpo: '<div id="fLanc">' +
      '<div class="linha">' +
        campo('Data', entrada('data', l.data || hojeISO(), { tipo: 'date' })) +
        campo('Valor (R$)', entrada('valor', l.valor != null ? String(l.valor).replace('.', ',') : '', { inputmode: 'decimal' })) +
      '</div>' +
      campo(tipo === 'entrega' ? 'O que o parceiro entregou' : 'O que a Domo entregou',
        entrada('descricao', l.descricao || '', {
          placeholder: tipo === 'entrega' ? 'Ex.: terreno da Rua das Acácias' : 'Ex.: apartamento 704 do Diamond' })) +
      (l.anexo ? '<p class="legenda">Nota atual: ' + esc(l.anexo.nome || '—') + ' (enviar outra substitui)</p>' : '') +
      '<div class="campo"><label>Nota / documento (opcional)</label>' +
        '<input type="file" id="lancArq">' +
        '<div class="dica">A nota fica dentro desta entrada — documento solto não diz a qual valor pertence.</div>' +
        '<div class="progresso" id="lancProg" style="display:none"><i></i></div></div>' +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar', classe: 'primario', aoClicar: async (fundo) => {
        const d = lerCampos(fundo.querySelector('#fLanc'));
        const valor = numeroBR(d.valor);
        if (!(valor > 0)) { toast('Informe um valor', 'ruim'); return; }
        if (!d.data) { toast('Informe a data', 'ruim'); return; }
        let anexo = null;
        const inp = document.getElementById('lancArq');
        if (inp && inp.files && inp.files[0]) {
          const prog = document.getElementById('lancProg');
          prog.style.display = '';
          try {
            const meta = await enviarArquivo(inp.files[0], (pc) => {
              const b = prog.querySelector('i'); if (b) b.style.width = (pc * 100) + '%';
            });
            anexo = { arquivoId: meta.id, nome: inp.files[0].name, tamanho: inp.files[0].size };
          } catch (e) { toast('Falha ao enviar a nota: ' + e.message, 'ruim'); return; }
        }
        const base = achar('permuta', id);
        if (!base) { toast('Permuta não encontrada', 'ruim'); return; }
        const lancs = (base.lancamentos || []).slice();
        const item = { id: (l.id || idP()), data: d.data, descricao: (d.descricao || '').trim(),
          valor, tipo, anexo: anexo || l.anexo || null };
        const i = lancs.findIndex((x) => x.id === item.id);
        if (i >= 0) lancs[i] = Object.assign({}, lancs[i], item); else lancs.push(item);
        const n = Object.assign({}, base, { lancamentos: lancs });
        n.historico = historiar(base, (existente ? 'Editou' : 'Lançou') + ' ' + lado.curto.toLowerCase() +
          ' de ' + fmt.brl(valor) + (item.descricao ? ' (' + item.descricao + ')' : ''));
        salvar('permuta', n);
        fecharModal(); render();
        toast('Lançamento salvo', 'bom');
      } }
    ]
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   O EXTRATO EM PDF — o papel que vai à mesa com o parceiro
   ══════════════════════════════════════════════════════════════════════════
   A tela é dividida por TAREFA (lançar, escolher ordem, ver saldo), porque é
   assim que se trabalha. O papel é dividido por CONTA, porque é assim que se
   confere: de um lado tudo o que ele entregou — ordem e lançamento na MESMA
   lista, em ordem de data —, do outro tudo o que recebeu. E no fim a balança,
   que responde "e aí, quem deve a quem". */
async function pdfPermuta(p) {
  if (!p) return;
  const e = extratoDaPermuta(p);
  const cfg = S.cfg || {};
  const logo = await carregarLogo();
  const doc = novoDoc();
  const M = 14, UTIL = 182;
  let y = cabecalhoPDF(doc, logo, cfg, 'EXTRATO DE PERMUTA', p.nome || '');

  const titulo = (txt) => {
    if (y > 250) { doc.addPage(); y = cabecalhoPDF(doc, logo, cfg, 'EXTRATO DE PERMUTA', p.nome || ''); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 61, 168);
    doc.text(txt, M, y); y += 5;
    doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  };
  const linha = (esq, dir, negrito) => {
    if (y > 275) { doc.addPage(); y = cabecalhoPDF(doc, logo, cfg, 'EXTRATO DE PERMUTA', p.nome || ''); }
    doc.setFont('helvetica', negrito ? 'bold' : 'normal'); doc.setFontSize(8);
    doc.text(String(esq).slice(0, 92), M, y);
    doc.text(String(dir), M + UTIL, y, { align: 'right' });
    y += 4.6;
  };

  doc.setFontSize(8); doc.setTextColor(95, 95, 95);
  doc.text('Parceiros: ' + ((p.parceiros || []).map((x) => x.nome).join(' · ') || '—'), M, y); y += 4.4;
  doc.text('Emitido em ' + fmt.data(hojeISO()), M, y); y += 7;
  doc.setTextColor(0, 0, 0);

  titulo('O QUE O PARCEIRO ENTREGOU');
  if (!e.entregou.length) linha('Nada lançado.', '');
  for (const it of e.entregou) {
    linha(fmt.data(it.data) + '  ' + it.documento + '  ' + (it.descricao || '') +
      (it.alerta ? '  [' + it.alerta + ']' : ''), fmt.brl(it.valor));
  }
  linha('Total entregue pelo parceiro', fmt.brl(e.entregue), true);
  y += 4;

  titulo('O QUE A DOMO ENTREGOU');
  if (!e.recebeu.length) linha('Nada lançado.', '');
  for (const it of e.recebeu) {
    linha(fmt.data(it.data) + '  ' + (it.descricao || '') + (it.nota ? '  (nota: ' + it.nota + ')' : ''), fmt.brl(it.valor));
  }
  linha('Total entregue pela Domo', fmt.brl(e.pago), true);
  y += 6;

  // A BALANÇA — o resumo em três linhas, que é o que se lê primeiro.
  if (y > 240) { doc.addPage(); y = cabecalhoPDF(doc, logo, cfg, 'EXTRATO DE PERMUTA', p.nome || ''); }
  doc.setFillColor(234, 234, 234); doc.rect(M, y - 4, UTIL, 20, 'F');
  linha('Recebemos do parceiro', fmt.brl(e.balanca.recebemos), true);
  linha('Entregamos ao parceiro', fmt.brl(e.balanca.entregamos), true);
  const f = fraseDoSaldo(e.saldo);
  linha('Diferença — ' + f.txt.toUpperCase(), fmt.brl(Math.abs(e.saldo)), true);
  y += 8;

  if (e.sumiram || e.mudaram || e.semConferir) {
    doc.setFontSize(7.2); doc.setTextColor(168, 104, 0);
    const avisos = [e.mudaram ? e.mudaram + ' ordem(ns) mudaram de valor após o aceite' : '',
      e.sumiram ? e.sumiram + ' ordem(ns) canceladas ainda contam nesta conta' : '',
      e.semConferir ? 'valores não conferidos nesta emissão' : ''].filter(Boolean);
    doc.text('Observações: ' + avisos.join(' · '), M, y); y += 6;
    doc.setTextColor(0, 0, 0);
  }
  if (p.obs) {
    doc.setFontSize(7.5); doc.setTextColor(95, 95, 95);
    doc.text(doc.splitTextToSize('Combinado: ' + p.obs, UTIL), M, y);
    doc.setTextColor(0, 0, 0);
  }
  rodapePDF(doc, 'Extrato de permuta · ' + (p.nome || '') + ' · conferido com o parceiro');
  doc.save('Permuta-' + String(p.nome || 'extrato').replace(/[^\w]+/g, '-') + '.pdf');
}
