/* Cotação — a etapa entre a solicitação aprovada e a ordem de compra.
   O comprador convida os fornecedores, cada um responde pelo PRÓPRIO link
   (sem senha e sem ver o preço do concorrente), a tela compara lado a lado e
   a escolhida vira ordem de compra já preenchida. */

const cotacoes = () => lista('cot');

const totalCotacao = (c, f) =>
  (c.itens || []).reduce((s, i) => s + (Number((f.precos || {})[i.id]) || 0) * (Number(i.qtd) || 0), 0) +
  (Number(f.frete) || 0);

const respondeu = (f) => !!f.respondidoEm;

// Quantos itens o fornecedor realmente precificou. Proposta que cobre 1 de 3
// itens tem o MENOR total sem ser a mais barata — e virava ordem de compra com
// os outros dois itens a R$ 0,00.
const itensCotados = (c, f) => (c.itens || []).filter((i) => Number((f.precos || {})[i.id]) > 0);
const itensSemPreco = (c, f) => (c.itens || []).filter((i) => !(Number((f.precos || {})[i.id]) > 0));
const propostaCompleta = (c, f) => (c.itens || []).length > 0 && itensSemPreco(c, f).length === 0;

// Menor preço de cada item entre quem respondeu — é o que fica verde na tela.
function melhorPorItem(c) {
  const melhor = {};
  for (const i of (c.itens || [])) {
    let min = null;
    for (const f of (c.fornecedores || [])) {
      const p = Number((f.precos || {})[i.id]) || 0;
      if (p > 0 && (min == null || p < min)) min = p;
    }
    if (min != null) melhor[i.id] = min;
  }
  return melhor;
}

// Quanto se economiza escolhendo o menor total em vez do maior.
// Só entram propostas COMPLETAS: comparar quem cotou tudo com quem cotou um
// item só é comparar laranja com caminhão.
function economia(c) {
  const totais = (c.fornecedores || []).filter((f) => respondeu(f) && propostaCompleta(c, f))
    .map((f) => totalCotacao(c, f)).filter((v) => v > 0);
  if (totais.length < 2) return 0;
  return Math.max(...totais) - Math.min(...totais);
}

const linkCotacao = (c, f) =>
  location.origin + location.pathname + '#/cotar/' + c.id + '/' + (f.token || '');

/* ══════════════════════════════════════════════════════════════════════════
   LISTA
   ══════════════════════════════════════════════════════════════════════════ */
// Mostrar ou não as arquivadas fica FORA da função: sobrevive ao re-render que o
// próprio botão dispara (a variável reinicia se morar dentro da tela).
let verCotArquivadas = false;

TELAS.cotacoes = function (el, args) {
  if (args[0]) return telaCotacao(el, args[0]);

  const todas = cotacoes();
  const arquivadas = todas.filter((c) => c.arquivadaEm);
  // Sem nada arquivado o toggle some da tela; se ficasse preso em true, o
  // próximo "Arquivar" gravaria mas o cartão continuaria visível.
  if (!arquivadas.length) verCotArquivadas = false;
  const visiveis = verCotArquivadas ? todas : todas.filter((c) => !c.arquivadaEm);
  const abertas = todas.filter((c) => c.situacao === 'aberta');
  cabecalho('Cotações', abertas.length + ' em aberto',
    '<button class="btn primario" id="novaCot">+ Nova cotação</button>');

  el.innerHTML =
    '<div class="aviso info">Três preços antes de comprar é o que mais economiza dinheiro numa obra. ' +
    'Aqui você manda o pedido de preço no WhatsApp e o fornecedor responde sozinho, sem você redigitar nada.</div>' +
    // Cotação cancelada ou já resolvida polui a lista: some daqui e fica guardada
    // atrás deste botão (o histórico continua inteiro dentro dela).
    (arquivadas.length
      ? '<div class="barra-acoes" style="margin-bottom:10px">' +
        '<button class="btn pequeno' + (verCotArquivadas ? ' primario' : '') + '" id="toggleArq">' +
          (verCotArquivadas ? 'Ocultar arquivadas' : 'Ver arquivadas (' + arquivadas.length + ')') +
        '</button></div>'
      : '') +
    '<div class="cartao">' +
      (visiveis.length ?
        '<div class="tabela-rolagem"><table><thead><tr><th>Nº</th><th>Itens</th><th>Obra</th>' +
        '<th>Fornecedores</th><th class="num">Melhor preço</th><th>Situação</th></tr></thead><tbody>' +
        visiveis.map((c) => {
          const resp = (c.fornecedores || []).filter(respondeu);
          const menor = resp.length ? Math.min(...resp.map((f) => totalCotacao(c, f))) : 0;
          const venceu = (c.fornecedores || []).find((f) => f.escolhido);
          const arq = !!c.arquivadaEm;
          // Arquivar direto da lista só o que já saiu de cena (cancelada ou
          // aprovada); cotação aberta não some sob um clique.
          const podeArquivar = c.situacao !== 'aberta';
          return '<tr class="clicavel" data-id="' + esc(c.id) + '"' + (arq ? ' style="opacity:.55"' : '') + '>' +
            '<td><b>' + esc(c.codigo || '—') + '</b>' + (c._pendente ? ' <span class="pendente">enviando…</span>' : '') + '</td>' +
            '<td>' + (c.itens || []).length + ' item(ns)' +
              '<div style="font-size:.8rem;color:var(--texto-fraco)">' +
              esc((c.itens || []).map((i) => i.descricao).join(', ').slice(0, 60)) + '</div></td>' +
            '<td>' + esc(c.obra || nomeObra(c.obraId)) + '</td>' +
            '<td>' + resp.length + ' de ' + (c.fornecedores || []).length + ' responderam</td>' +
            '<td class="num">' + (menor ? fmt.brl(menor) : '—') +
              (venceu ? '<div style="font-size:.8rem;color:var(--verde)">' + esc(venceu.nome) + '</div>' : '') + '</td>' +
            '<td>' + etiqueta(c.situacao) +
              (arq ? ' <span class="etiqueta">arquivada</span>' : '') +
              (podeArquivar
                ? '<button class="btn pequeno" data-arq="' + esc(c.id) + '" style="margin-left:6px">' +
                  (arq ? 'Desarquivar' : 'Arquivar') + '</button>'
                : '') +
            '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : vazio('💵', verCotArquivadas ? 'Nada arquivado' : 'Nenhuma cotação',
            'Aprove uma solicitação e mande para cotação — ou crie uma direto aqui.')) +
    '</div>';

  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => irPara('cotacoes/' + tr.dataset.id)));
  el.querySelectorAll('[data-arq]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();   // clicar em Arquivar não abre a cotação
    arquivarCotacao(b.dataset.arq);
  }));
  const tg = document.getElementById('toggleArq');
  if (tg) tg.addEventListener('click', () => { verCotArquivadas = !verCotArquivadas; render(); });
  document.getElementById('novaCot').addEventListener('click', () => abrirNovaCotacao(null));
};

// Arquivar/desarquivar é gravação SUAVE (salvar com arquivadaEm), não a rota
// 'apagar': funciona offline, é reversível e o histórico da cotação registra.
function arquivarCotacao(id) {
  const c = achar('cot', id);
  if (!c) { toast('Cotação não encontrada — atualize a tela', 'ruim'); return; }
  const desarq = !!c.arquivadaEm;
  const n = Object.assign({}, c, desarq
    ? { arquivadaEm: null, arquivadaPor: null }
    : { arquivadaEm: new Date().toISOString(), arquivadaPor: S.quem || '—' });
  n.historico = historiar(c, desarq ? 'Cotação desarquivada' : 'Cotação arquivada');
  salvar('cot', n);
  render();
  toast(desarq ? 'Cotação desarquivada' : 'Cotação arquivada — saiu da lista principal', 'bom');
}

/* ══════════════════════════════════════════════════════════════════════════
   CRIAR (a partir de uma solicitação ou do zero)
   ══════════════════════════════════════════════════════════════════════════ */
// `convidados` são fornecedores já escolhidos (vêm da sugestão da solicitação):
// a cotação nasce com eles dentro, com link pronto, sem convidar um por um.
function abrirNovaCotacao(sc, convidados) {
  const itensIniciais = sc ? (sc.itens || []).map((i) => ({ id: i.id, descricao: i.descricao, unid: i.unid, qtd: i.qtd })) : [{}, {}];
  const prazo = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const pre = (convidados || []).filter(Boolean);

  abrirModal({
    titulo: sc ? 'Pedir cotação — ' + (sc.codigo || '') : 'Nova cotação',
    largo: true,
    corpo: '<div id="fCot">' +
      (pre.length
        ? '<div class="aviso info"><b>Vão receber o pedido de preço:</b> ' +
          esc(pre.map((f) => f.nome).join(' · ')) +
          (pre.some((f) => !f.telefone)
            ? '<br><span style="font-size:.85rem">Quem está sem WhatsApp entra na lista do mesmo jeito — ' +
              'depois é só copiar o link e mandar por onde der.</span>' : '') + '</div>'
        : '') +
      '<div class="linha">' +
        campo('Obra', seletor('obraId', (sc && sc.obraId) || (obras()[0] || {}).id, obras().map((o) => ({ v: o.id, t: o.nome })))) +
        campo('Responder até', entrada('prazoResposta', prazo, { tipo: 'date' })) +
      '</div>' +
      '<h3>O que vai ser cotado</h3>' +
      '<div id="itensCot">' + itensIniciais.map((i) => linhaItem(i, false)).join('') + '</div>' +
      '<button class="btn pequeno" id="maisItemCot">+ Item</button>' +
      campo('Observação para o fornecedor', areaTexto('observacoes', '',
        'Ex.: entrega no canteiro, informe prazo e condição de pagamento')) +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Criar cotação', classe: 'primario', aoClicar: (fundo) => {
        const itens = lerItens(fundo.querySelector('#itensCot'), false);
        if (!itens.length) { toast('Escreva pelo menos um item', 'ruim'); return; }
        const d = lerCampos(fundo.querySelector('#fCot'));
        const reg = {
          obraId: d.obraId, obra: nomeObra(d.obraId), itens,
          prazoResposta: d.prazoResposta, observacoes: d.observacoes,
          // O token de cada convite é gerado no servidor ao salvar — um por
          // fornecedor, para nenhum deles ver o preço do outro.
          fornecedores: pre.map((f, n) => ({
            id: Date.now().toString(36) + n + Math.random().toString(36).slice(2, 4),
            fornecedorId: f.id, nome: f.nome, telefone: f.telefone, contato: f.contato,
            precos: {}, convidadoEm: new Date().toISOString()
          })),
          situacao: 'aberta', scIds: sc ? [sc.id] : []
        };
        reg.historico = historiar(reg, 'Cotação aberta' + (sc ? ' a partir da ' + (sc.codigo || 'solicitação') : '') +
          (pre.length ? ' — convidados: ' + pre.map((f) => f.nome).join(', ') : ''));
        const salvo = salvar('cot', reg);

        if (sc) {
          const ns = Object.assign({}, sc, {
            situacao: 'em_cotacao',
            cotIds: Array.from(new Set([...(sc.cotIds || []), salvo.id]))
          });
          if (sc.situacao === 'nova') ns.historico = historiar(sc, 'Aprovada ao mandar para cotação');
          ns.historico = historiar(ns, 'Mandada para cotação');
          salvar('sc', ns);
        }
        fecharEste(fundo);
        irPara('cotacoes/' + salvo.id);
        toast(pre.length
          ? pre.length + ' fornecedor(es) convidados — agora mande o link no WhatsApp'
          : 'Cotação criada — agora convide os fornecedores', 'bom');
      } }
    ]
  });

  const caixa = document.getElementById('itensCot');
  const ligar = (linha) => linha.querySelector('[data-tirar]').addEventListener('click', () => {
    if (caixa.children.length > 1) linha.remove();
  });
  Array.from(caixa.children).forEach(ligar);
  document.getElementById('maisItemCot').addEventListener('click', () => {
    caixa.insertAdjacentHTML('beforeend', linhaItem({}, false));
    ligar(caixa.lastElementChild);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   DETALHE — o quadro de comparação
   ══════════════════════════════════════════════════════════════════════════ */
function telaCotacao(el, id) {
  const c = achar('cot', id);
  // Cotação na lixeira (apagadoEm) não abre viva — senão reapareceria com
  // Arquivar/Excluir depois de já ter sido excluída.
  if (!c || c.apagadoEm) { cabecalho('Cotação', ''); el.innerHTML = vazio('🤔', 'Não encontrada'); return; }

  const fs = c.fornecedores || [];
  const respondidos = fs.filter(respondeu);
  const melhor = melhorPorItem(c);
  const econ = economia(c);
  const pronta = !!c.codigo;
  const aberta = c.situacao === 'aberta';

  cabecalho(c.codigo || 'Cotação (sincronizando…)',
    (c.itens || []).length + ' item(ns) · ' + respondidos.length + ' de ' + fs.length + ' responderam',
    '<a class="btn" href="#/cotacoes">← Voltar</a>' +
    (aberta ? '<button class="btn primario" id="convidar"' + (pronta ? '' : ' disabled title="aguardando sincronizar"') +
      '>+ Convidar fornecedor</button>' : ''));

  const cabFornec = fs.map((f) => {
    const parcial = respondeu(f) && !propostaCompleta(c, f);
    const cad = f.fornecedorId ? achar('forn', f.fornecedorId) : null;
    const q = cad ? notaFornecedor(cad) : null;
    return '<th class="num">' + esc(f.nome) +
      (f.escolhido ? ' <span class="etiqueta et-entregue">escolhido</span>' : '') +
      (parcial ? ' <span class="etiqueta et-vencendo">parcial</span>' : '') +
      // A qualificação fica ao lado do preço: é aqui que a decisão acontece, e
      // o mais barato nem sempre é o que entrega.
      (q ? '<div style="font-weight:400;margin-top:3px">' + selo(q.nota, { provisorio: q.provisorio }) + '</div>' : '') +
      '<div style="font-weight:400;text-transform:none;font-size:.75rem">' +
        (respondeu(f)
          ? (parcial
              ? '<span style="color:var(--ambar)">cotou ' + itensCotados(c, f).length + ' de ' +
                (c.itens || []).length + ' itens</span>'
              : 'respondeu ' + fmt.quando(f.respondidoEm))
          : '<span style="color:var(--ambar)">aguardando</span>') +
      '</div></th>';
  }).join('');

  el.innerHTML =
    (econ > 0
      ? '<div class="aviso bom">Entre a maior e a menor proposta há <b>' + fmt.brl(econ) + '</b> de diferença.</div>'
      : '') +
    (!fs.length
      ? '<div class="aviso atencao">Nenhum fornecedor convidado ainda. Clique em <b>Convidar fornecedor</b> — ' +
        'cada um recebe um link próprio no WhatsApp e responde sozinho.</div>'
      : '') +

    '<div class="cartao">' +
      '<h3>Comparação</h3>' +
      '<div class="tabela-rolagem"><table><thead><tr>' +
        '<th>Item</th><th class="num">Qtd</th>' + cabFornec +
      '</tr></thead><tbody>' +
      (c.itens || []).map((i) =>
        '<tr><td>' + esc(i.descricao) + '</td>' +
        '<td class="num">' + fmt.numero(i.qtd) + ' ' + esc(i.unid || '') + '</td>' +
        fs.map((f) => {
          const p = Number((f.precos || {})[i.id]) || 0;
          const eMelhor = p > 0 && melhor[i.id] === p;
          return '<td class="num"' + (eMelhor ? ' style="color:var(--verde);font-weight:700"' : '') + '>' +
            (p > 0 ? fmt.brl(p) : '—') + '</td>';
        }).join('') + '</tr>').join('') +
      '</tbody><tfoot>' +
        '<tr><td colspan="2">Frete</td>' +
          fs.map((f) => '<td class="num">' + (f.frete ? fmt.brl(f.frete) : '—') + '</td>').join('') + '</tr>' +
        '<tr><td colspan="2"><b>Total</b></td>' +
          fs.map((f) => {
            const t = totalCotacao(c, f);
            // Verde só entre propostas COMPLETAS: quem cotou 1 de 3 itens tinha
            // o menor total e era pintado como o mais barato.
            const completas = respondidos.filter((x) => propostaCompleta(c, x));
            const menor = completas.length ? Math.min(...completas.map((x) => totalCotacao(c, x))) : 0;
            const eMenor = t > 0 && t === menor && propostaCompleta(c, f);
            return '<td class="num"><b' + (eMenor ? ' style="color:var(--verde)"' : '') + '>' +
              (t > 0 ? fmt.brl(t) : '—') + '</b>' +
              (respondeu(f) && !propostaCompleta(c, f)
                ? '<div style="font-size:.72rem;color:var(--ambar);font-weight:400">só parte dos itens</div>' : '') +
              '</td>';
          }).join('') + '</tr>' +
        '<tr><td colspan="2">Prazo de entrega</td>' +
          fs.map((f) => '<td class="num">' + esc(f.prazoEntrega || '—') + '</td>').join('') + '</tr>' +
        '<tr><td colspan="2">Pagamento</td>' +
          fs.map((f) => '<td class="num">' + esc(f.condicaoPagamento || '—') + '</td>').join('') + '</tr>' +
      '</tfoot></table></div>' +
    '</div>' +

    '<div class="grade g2"><div>' +
      '<div class="cartao"><h3>Fornecedores convidados</h3>' +
        (fs.length ? fs.map((f) =>
          '<div class="arquivo-solto"><span class="ic">' + (respondeu(f) ? '✅' : '⏳') + '</span>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="nome">' + esc(f.nome) + (f.escolhido ? ' <span class="etiqueta et-entregue">escolhido</span>' : '') + '</div>' +
            '<div class="meta">' + esc(fmt.telefone(f.telefone) || 'sem telefone') +
              (respondeu(f) ? ' · ' + fmt.brl(totalCotacao(c, f)) : ' · ainda não respondeu') +
              (f.obs ? '<br>' + esc(f.obs) : '') + '</div>' +
          '</div>' +
          '<div class="acoes">' +
            (f.telefone ? '<button class="btn pequeno zap" data-zapf="' + esc(f.id) + '">Pedir preço</button>' : '') +
            '<button class="btn pequeno" data-linkf="' + esc(f.id) + '">Link</button>' +
            (aberta && respondeu(f) ? '<button class="btn pequeno primario" data-escolher="' + esc(f.id) + '">Escolher</button>' : '') +
          '</div></div>').join('')
          : '<p class="legenda">Ninguém convidado ainda.</p>') +
      '</div>' +
    '</div><div>' +
      '<div class="cartao"><h3>Dados</h3><p>' +
        '<b>Obra:</b> ' + esc(c.obra || nomeObra(c.obraId)) + '<br>' +
        '<b>Responder até:</b> ' + (c.prazoResposta ? fmt.data(c.prazoResposta) : '—') + '<br>' +
        '<b>Situação:</b> ' + etiqueta(c.situacao) +
        (c.ocId ? '<br><b>Virou:</b> ' + esc((achar('oc', c.ocId) || {}).codigo || 'ordem de compra') : '') +
      '</p>' +
      (c.observacoes ? '<p class="legenda">' + esc(c.observacoes) + '</p>' : '') +
      (c.ocId ? '<button class="btn" data-veroc="' + esc(c.ocId) + '" style="width:100%">Abrir ordem de compra</button>' : '') +
      '</div>' +
      '<div class="cartao"><h3>Histórico</h3>' + linhaTempo(c.historico) + '</div>' +
      (aberta
        ? '<div class="cartao"><button class="btn perigo" id="cancelarCot" style="width:100%">Cancelar cotação</button></div>'
        // Cotação já resolvida (cancelada/aprovada): dá para tirar da lista sem
        // perder o registro. Excluir de vez (lixeira) fica só para a cancelada —
        // uma cotação aprovada é prova da pesquisa de preço, não se joga fora.
        : '<div class="cartao">' +
            '<div class="barra-acoes">' +
              '<button class="btn" id="arquivarCot" style="flex:1">' +
                (c.arquivadaEm ? 'Desarquivar' : 'Arquivar') + '</button>' +
              (c.situacao === 'cancelada' && perfilAtual() !== 'obra'
                ? '<button class="btn perigo" id="excluirCot" style="flex:1">Excluir</button>' : '') +
            '</div>' +
            (c.arquivadaEm
              ? '<p class="legenda" style="margin-top:8px">Arquivada em ' + fmt.data(c.arquivadaEm) +
                '. Sai da lista principal; o histórico continua aqui dentro.</p>'
              : '') +
          '</div>') +
    '</div></div>';

  const bc = document.getElementById('convidar');
  if (bc) bc.addEventListener('click', () => convidarFornecedor(c));

  el.querySelectorAll('[data-zapf]').forEach((b) => b.addEventListener('click', () => {
    const f = (achar('cot', c.id).fornecedores || []).find((x) => x.id === b.dataset.zapf);
    if (!f) { toast('Fornecedor não encontrado — atualize a tela', 'ruim'); return; }
    pedirPrecoWhats(achar('cot', c.id), f);
  }));
  el.querySelectorAll('[data-linkf]').forEach((b) => b.addEventListener('click', () => {
    const f = (achar('cot', c.id).fornecedores || []).find((x) => x.id === b.dataset.linkf);
    if (!f) return;
    const url = linkCotacao(c, f);
    abrirModal({
      titulo: 'Link de ' + f.nome,
      corpo: '<p class="legenda">Só este fornecedor abre por aqui. Ele não vê o preço dos outros.</p>' +
        '<div class="campo"><input type="text" id="linkCot" value="' + esc(url) + '" readonly></div>',
      acoes: [
        { texto: 'Copiar', classe: 'primario', aoClicar: () => {
          if (!navigator.clipboard) { const i = document.getElementById('linkCot'); if (i) i.select(); toast('Selecione e copie', 'ruim'); return; }
          navigator.clipboard.writeText(url).then(() => toast('Link copiado', 'bom'))
            .catch(() => toast('Não consegui copiar', 'ruim'));
        } },
        { texto: 'Fechar', aoClicar: () => fecharModal() }
      ]
    });
  }));
  el.querySelectorAll('[data-escolher]').forEach((b) => b.addEventListener('click', () => escolherFornecedor(c, b.dataset.escolher)));
  el.querySelectorAll('[data-veroc]').forEach((b) => b.addEventListener('click', () => irPara('compras/' + b.dataset.veroc)));

  const bx = document.getElementById('cancelarCot');
  if (bx) bx.addEventListener('click', async () => {
    const m = await perguntar('Por que está cancelando?', { titulo: 'Cancelar cotação', multi: true, obrigatorio: true, ok: 'Cancelar' });
    if (!m) return;
    const atual = achar('cot', c.id) || c;
    const n = Object.assign({}, atual, { situacao: 'cancelada', motivoCancelamento: m });
    n.historico = historiar(atual, 'Cotação cancelada: ' + m);
    salvar('cot', n);
    // A solicitação volta a ser um pedido aprovado esperando decisão — antes
    // ficava presa em "Em cotação" para sempre, sem cotação nenhuma.
    for (const sid of (atual.scIds || [])) recalcularSC(sid, 'Cotação ' + (atual.codigo || '') + ' cancelada');
    render();
  });

  const ba = document.getElementById('arquivarCot');
  if (ba) ba.addEventListener('click', () => arquivarCotacao(c.id));

  const bex = document.getElementById('excluirCot');
  if (bex) bex.addEventListener('click', async () => {
    if (!await confirmar('Excluir esta cotação? Vai para a lixeira — a direção pode restaurar.',
      { perigo: true, ok: 'Excluir' })) return;
    // 'apagar' vai direto ao servidor (não passa pela fila offline): sem sinal,
    // avisa em vez de estourar um "Failed to fetch" técnico na obra.
    if (!navigator.onLine) { toast('Sem internet agora — tente quando conectar', 'ruim'); return; }
    try { await api('apagar', { colecao: 'cot', id: c.id }); }
    catch (e) { toast('Não consegui excluir: ' + e.message, 'ruim'); return; }
    await puxar();
    irPara('cotacoes');
  });
}

/* ── Convidar fornecedor ───────────────────────────────────────────────────── */
function convidarFornecedor(c) {
  // Quem já vende esse material sobe para o topo da lista, com ⭐.
  const jaConvidados = new Set((c.fornecedores || []).map((f) => f.fornecedorId).filter(Boolean));
  const sugeridos = sugerirFornecedores(c.itens, 8)
    .map((x) => x.forn).filter((f) => !jaConvidados.has(f.id));
  const idsSug = new Set(sugeridos.map((f) => f.id));
  const resto = fornecedoresAtivos().filter((f) => !idsSug.has(f.id) && !jaConvidados.has(f.id));
  const cadastrados = [...sugeridos, ...resto];

  abrirModal({
    titulo: 'Convidar fornecedor para cotar',
    corpo: '<div id="fConv">' +
      campo('Escolher cadastrado', '<select id="selFornCot"><option value="">— digitar abaixo —</option>' +
        cadastrados.map((x) => {
          const q = notaFornecedor(x);
          const c2 = classeDe(q.nota);
          return '<option value="' + esc(x.id) + '">' +
            (idsSug.has(x.id) ? '⭐ ' : '') + esc(x.nome) +
            (c2 ? '  [' + c2.letra + ' · ' + fmt.numero(q.nota, 1) + ']' : '  [sem histórico]') +
            '</option>';
        }).join('') + '</select>',
        sugeridos.length
          ? 'As ⭐ já forneceram material parecido. A letra é a qualificação: A é preferencial, D é para evitar.'
          : 'A letra é a qualificação: A é preferencial, D é para evitar.') +
      '<div class="linha">' +
        campo('Nome', entrada('nome', '')) +
        campo('WhatsApp', entrada('telefone', '', { tipo: 'tel' })) +
      '</div>' +
      campo('Contato', entrada('contato', '')) +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Convidar', classe: 'primario', aoClicar: (fundo) => {
        const d = lerCampos(fundo.querySelector('#fConv'));
        if (!d.nome.trim()) { toast('Informe o nome do fornecedor', 'ruim'); return; }
        const atual = achar('cot', c.id) || c;
        const novo = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          fornecedorId: fundo.querySelector('#selFornCot').value || '',
          nome: d.nome.trim(), telefone: d.telefone, contato: d.contato,
          precos: {}, convidadoEm: new Date().toISOString()
        };
        // Fornecedor digitado na mão entra no cadastro — senão a agenda da
        // empresa nunca cresce e todo mundo redigita telefone para sempre.
        if (!novo.fornecedorId) {
          const chave = (x) => String(x || '').trim().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
          const doc = String(d.cnpj || '').replace(/\D/g, '');
          const ja = fornecedoresAtivos().find((x) =>
            (doc && String(x.cnpj || '').replace(/\D/g, '') === doc) || chave(x.nome) === chave(novo.nome));
          if (ja) novo.fornecedorId = ja.id;
          else {
            const f = salvar('forn', { nome: novo.nome, telefone: novo.telefone, contato: novo.contato });
            novo.fornecedorId = f.id;
          }
        }
        const n = Object.assign({}, atual, { fornecedores: [...(atual.fornecedores || []), novo] });
        n.historico = historiar(atual, 'Fornecedor convidado: ' + novo.nome);
        salvar('cot', n);
        fecharEste(fundo);
        render();
        toast('Convidado. Agora mande o link no WhatsApp.', 'bom');
      } }
    ]
  });
  document.getElementById('selFornCot').addEventListener('change', (e) => {
    const x = achar('forn', e.target.value);
    if (!x) return;
    const set = (n, v) => { const cpo = document.querySelector('[data-campo=' + n + ']'); if (cpo) cpo.value = v || ''; };
    set('nome', x.nome); set('telefone', x.telefone); set('contato', x.contato);
  });
}

/* ── Pedido de preço no WhatsApp ───────────────────────────────────────────── */
function pedirPrecoWhats(c, f) {
  if (!f.token) { toast('Aguarde sincronizar para gerar o link do fornecedor', 'ruim'); return; }
  const linhas = [
    '*' + ((S.cfg.empresa || {}).nomeCurto || 'Domo Construtora') + '* — Pedido de cotação *' + (c.codigo || '') + '*',
    'Obra: ' + (c.obra || ''),
    '',
    ...(c.itens || []).map((i, n) => (n + 1) + '. ' + i.descricao + ' — ' + fmt.numero(i.qtd) + ' ' + (i.unid || '')),
    '',
    c.prazoResposta ? 'Precisamos da resposta até ' + fmt.data(c.prazoResposta) + '.' : '',
    c.observacoes || '',
    '',
    'Responda direto por aqui, é rápido: ' + linkCotacao(c, f)
  ].filter((x) => x !== '');
  window.open(linkWhats(f.telefone, linhas.join('\n')), '_blank');
}

/* ── Escolher e virar ordem de compra ──────────────────────────────────────── */
async function escolherFornecedor(c, fid) {
  const atual = achar('cot', c.id) || c;
  const f = (atual.fornecedores || []).find((x) => x.id === fid);
  if (!f) return;

  // Cotação já decidida não gera uma segunda ordem: duas pessoas abrindo a
  // mesma tela ao mesmo tempo compravam o material duas vezes.
  if (atual.ocId || atual.situacao === 'atendida') {
    const jaOC = achar('oc', atual.ocId);
    toast('Esta cotação já foi decidida' + (jaOC ? ' — ordem ' + (jaOC.codigo || '') : '') + '.', 'ruim');
    if (jaOC) irPara('compras/' + jaOC.id);
    return;
  }

  const outros = (atual.fornecedores || []).filter((x) => x.id !== fid && respondeu(x));
  const t = totalCotacao(atual, f);
  // Só propostas completas entram na comparação de "mais barata".
  const completas = [f, ...outros].filter((x) => propostaCompleta(atual, x));
  const menor = completas.length ? Math.min(...completas.map((x) => totalCotacao(atual, x))) : t;
  const faltando = itensSemPreco(atual, f);
  const naoEMenor = faltando.length ? false : t > menor + 0.005;

  if (faltando.length) {
    const nomes = faltando.map((i) => i.descricao).join(', ');
    if (!await confirmar('Esta proposta não tem preço para: ' + nomes + '. ' +
      'A ordem de compra vai sair com esses itens ZERADOS e você precisa comprá-los à parte. Continuar?',
      { perigo: true, ok: 'Continuar assim mesmo' })) return;
  }

  const motivo = await perguntar(
    faltando.length
      ? 'Proposta parcial (' + itensCotados(atual, f).length + ' de ' + (atual.itens || []).length +
        ' itens). Por que escolher ' + f.nome + '?'
      : naoEMenor
        ? 'Esta não é a proposta mais barata (a menor completa é ' + fmt.brl(menor) + '). Por que escolher ' + f.nome + '?'
        : 'Por que escolher ' + f.nome + '?',
    { titulo: 'Escolher proposta', valor: (naoEMenor || faltando.length) ? '' : 'Melhor preço',
      obrigatorio: naoEMenor || !!faltando.length, multi: naoEMenor || !!faltando.length,
      ok: 'Escolher e gerar ordem' });
  if (motivo === null) return;

  // 1. marca a escolhida
  const fornecedores = (atual.fornecedores || []).map((x) =>
    Object.assign({}, x, { escolhido: x.id === fid, motivo: x.id === fid ? motivo : x.motivo }));

  // 2. gera a ordem de compra já preenchida com os preços que ele mandou
  const oc = salvar('oc', {
    obraId: atual.obraId, obra: atual.obra,
    fornecedorId: f.fornecedorId || '',
    fornecedor: { nome: f.nome, telefone: f.telefone, contato: f.contato, email: f.email || '', cnpj: f.cnpj || '' },
    // Item sem preço fica FORA da ordem: entrava com R$ 0,00 e o PDF ia para o
    // WhatsApp do fornecedor cobrando material de graça.
    itens: itensCotados(atual, f).map((i) => ({
      id: i.id, descricao: i.descricao, unid: i.unid, qtd: i.qtd,
      preco: Number((f.precos || {})[i.id]) || 0
    })),
    frete: Number(f.frete) || 0,
    prazoEntrega: f.prazoEntrega || '',
    condicaoPagamento: f.condicaoPagamento || '',
    validadeProposta: f.validade || '',
    dataEmissao: hojeISO(),
    cotacaoId: atual.id,
    scIds: atual.scIds || [],
    situacao: 'rascunho',
    ipiPerc: 0, icmsPerc: 0, seguro: 0, desconto: 0
  });
  const tot = totaisOC(achar('oc', oc.id) || oc);
  salvar('oc', Object.assign({}, achar('oc', oc.id) || oc, {
    total: tot.total, totalLiquido: tot.totalLiquido,
    historico: historiar({ historico: [] }, 'Gerada da cotação ' + (atual.codigo || '') + ' — ' + f.nome + ' (' + motivo + ')')
  }));

  // 3. fecha a cotação e liga tudo
  const n = Object.assign({}, atual, { fornecedores, situacao: 'aprovada', ocId: oc.id });
  n.historico = historiar(atual, 'Escolhido ' + f.nome + ' por ' + fmt.brl(t) + ': ' + motivo);
  salvar('cot', n);

  for (const sid of (atual.scIds || [])) {
    const s = achar('sc', sid);
    if (!s) continue;
    const ns = Object.assign({}, s, {
      situacao: 'em_compra',
      ocIds: Array.from(new Set([...(s.ocIds || []), oc.id]))
    });
    ns.historico = historiar(s, 'Cotação fechada com ' + f.nome + ' — virou ordem de compra');
    salvar('sc', ns);
  }

  irPara('compras/' + oc.id);
  toast('Ordem de compra criada com os preços da cotação', 'bom');
}

/* ══════════════════════════════════════════════════════════════════════════
   PÚBLICO — o fornecedor responde por aqui, sem senha
   ══════════════════════════════════════════════════════════════════════════ */
async function telaCotarPublico(args) {
  const [id, token] = args;
  molduraPublica('<div class="cartao"><p class="legenda">Abrindo o pedido de cotação…</p></div>', '');

  let r;
  try {
    r = await api('verCotacao', { id, t: token }, { publico: true });
  } catch (e) {
    molduraPublica('<div class="cartao"><div class="aviso ruim">' + esc(e.message) + '</div></div>', '');
    return;
  }

  const c = r.cotacao;
  const meu = r.minhaResposta;
  const jaRespondeu = !!meu.respondidoEm;

  molduraPublica(
    '<div class="cartao">' +
      '<h2>Pedido de cotação ' + esc(c.codigo) + '</h2>' +
      '<p class="legenda">' + esc(r.empresa.nome) + ' · obra ' + esc(c.obra) +
        (c.prazoResposta ? ' · responder até ' + fmt.data(c.prazoResposta) : '') + '</p>' +
      (c.observacoes ? '<div class="aviso info">' + esc(c.observacoes) + '</div>' : '') +
      (jaRespondeu ? '<div class="aviso bom">Você já respondeu ' + fmt.quando(meu.respondidoEm) +
        '. Pode alterar e enviar de novo se quiser.</div>' : '') +
      (c.encerrada ? '<div class="aviso atencao">Esta cotação já foi encerrada.</div>' : '') +

      '<div id="fResp">' +
        campo('Quem está respondendo', '<input type="text" id="rContato" value="' + esc(meu.contato || '') + '" placeholder="Seu nome">') +
        '<h3 style="margin-top:14px">Preço por item</h3>' +
        '<div class="medicao-grade">' +
          '<div class="med-cab"><span>Item</span><span>Quantidade</span><span>Preço unitário</span><span>Total</span></div>' +
          c.itens.map((i) =>
            '<div class="med-linha" data-item="' + esc(i.id) + '">' +
              '<div class="med-etapa"><b>' + esc(i.descricao) + '</b></div>' +
              '<div class="med-ant"><span class="med-rot">Quantidade</span>' + fmt.numero(i.qtd) + ' ' + esc(i.unid || '') + '</div>' +
              '<div class="med-perc"><span class="med-rot">Preço unitário (R$)</span>' +
                '<input type="text" inputmode="decimal" data-preco="' + esc(i.id) + '" ' +
                'value="' + esc(meu.precos[i.id] != null ? String(meu.precos[i.id]).replace('.', ',') : '') + '" placeholder="0,00"></div>' +
              '<div class="med-valor"><span class="med-rot">Total do item</span>' +
                '<b data-tot="' + esc(i.id) + '">R$ 0,00</b></div>' +
            '</div>').join('') +
        '</div>' +
        '<div class="linha" style="margin-top:12px">' +
          campo('Frete (R$)', '<input type="text" id="rFrete" inputmode="decimal" value="' + esc(meu.frete != null ? String(meu.frete).replace('.', ',') : '') + '">') +
          campo('Prazo de entrega', '<input type="text" id="rPrazo" value="' + esc(meu.prazoEntrega || '') + '" placeholder="Ex.: 5 dias úteis">') +
        '</div>' +
        '<div class="linha">' +
          campo('Condição de pagamento', '<input type="text" id="rCond" value="' + esc(meu.condicaoPagamento || '') + '" placeholder="Ex.: 28 dias">') +
          campo('Validade da proposta', '<input type="text" id="rVal" value="' + esc(meu.validade || '') + '" placeholder="Ex.: 15 dias">') +
        '</div>' +
        campo('Observação', '<textarea id="rObs" placeholder="Marca oferecida, condição especial…">' + esc(meu.obs || '') + '</textarea>') +
        '<div class="indicador ok" style="margin:10px 0"><div class="rotulo">Total da sua proposta</div>' +
          '<div class="valor" id="rTotal">R$ 0,00</div></div>' +
        (c.encerrada ? '' : '<button class="btn primario" id="rEnviar" style="width:100%">Enviar proposta</button>') +
        '<div id="rErro" style="margin-top:10px"></div>' +
      '</div>' +
    '</div>',
    'Cotação');

  const recalc = () => {
    let total = 0;
    for (const i of c.itens) {
      const inp = document.querySelector('[data-preco="' + i.id + '"]');
      const v = numeroBR(inp ? inp.value : 0) * (Number(i.qtd) || 0);
      total += v;
      const cel = document.querySelector('[data-tot="' + i.id + '"]');
      if (cel) cel.textContent = fmt.brl(v);
    }
    total += numeroBR(document.getElementById('rFrete').value);
    document.getElementById('rTotal').textContent = fmt.brl(total);
  };
  document.querySelectorAll('[data-preco]').forEach((i) => i.addEventListener('input', recalc));
  document.getElementById('rFrete').addEventListener('input', recalc);
  recalc();

  const botao = document.getElementById('rEnviar');
  if (botao) botao.addEventListener('click', async () => {
    const erro = document.getElementById('rErro');
    const precos = {};
    for (const i of c.itens) {
      const v = numeroBR(document.querySelector('[data-preco="' + i.id + '"]').value);
      if (v > 0) precos[i.id] = v;
    }
    if (!Object.keys(precos).length) {
      erro.innerHTML = '<div class="aviso ruim">Informe o preço de pelo menos um item.</div>';
      return;
    }
    botao.disabled = true;
    erro.innerHTML = '<div class="aviso info">Enviando…</div>';
    try {
      const resp = await api('responderCotacao', {
        id, t: token, precos,
        frete: numeroBR(document.getElementById('rFrete').value),
        prazoEntrega: document.getElementById('rPrazo').value,
        condicaoPagamento: document.getElementById('rCond').value,
        validade: document.getElementById('rVal').value,
        obs: document.getElementById('rObs').value,
        contato: document.getElementById('rContato').value
      }, { publico: true });
      molduraPublica(
        '<div class="cartao" style="text-align:center">' +
          '<div style="font-size:3rem">✅</div>' +
          '<h2>Proposta enviada</h2>' +
          '<p>Total: <b style="font-size:1.3rem;color:var(--azul)">' + fmt.brl(resp.total) + '</b></p>' +
          '<p class="legenda">A ' + esc(r.empresa.nomeCurto) + ' recebeu sua proposta e vai te retornar. ' +
          'Guarde este link caso queira alterar.</p>' +
        '</div>', 'Cotação ' + esc(c.codigo));
    } catch (e) {
      botao.disabled = false;
      erro.innerHTML = '<div class="aviso ruim">' + esc(e.message) + '</div>';
    }
  });
}
