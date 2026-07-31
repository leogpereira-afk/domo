/* Compras — o miolo do sistema:
   solicitação da obra → aprovação → cotação → ordem de compra → WhatsApp →
   a caminho → recebimento com foto → entregue.
   Também cuida das ordens de serviço (empreiteiros) e dos fornecedores. */

/* ── Apoio ─────────────────────────────────────────────────────────────────── */
// Fotos já baixadas, por id de arquivo. Evita rebaixar tudo a cada redesenho.
const CACHE_FOTOS = new Map();
const obras = () => (S.cfg && S.cfg.obras) || [];
// Lista de configuração à prova de cfg ainda não carregado (login que deu certo
// com o snapshot falhando deixava S.cfg nulo e a tela estourava).
const cfgLista = (nome) => (S.cfg && Array.isArray(S.cfg[nome]) ? S.cfg[nome] : []);
const nomeObra = (id) => (obras().find((o) => o.id === id) || {}).nome || '';
const unidades = () => (cfgLista('unidades').length ? S.cfg.unidades : ['un']);

function fornecedoresAtivos() {
  return lista('forn').sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
}

/* ══════════════════════════════════════════════════════════════════════════
   QUEM FORNECE ISSO — casa o material pedido com o cadastro e com o histórico
   Sem isso, quem recebe a solicitação abre a agenda e tenta lembrar de cabeça
   quem vende telha. O sistema já sabe: ele guardou toda compra e toda cotação.
   ══════════════════════════════════════════════════════════════════════════ */

// Palavras que não distinguem material nenhum (unidade, embalagem, enchimento).
const PALAVRA_VAZIA = new Set(['para', 'com', 'sem', 'pra', 'dos', 'das', 'nos', 'nas',
  'tipo', 'marca', 'unid', 'saco', 'sacos', 'caixa', 'caixas', 'pacote', 'rolo', 'rolos',
  'metro', 'metros', 'litro', 'litros', 'peca', 'pecas', 'material', 'obra', 'novo', 'nova',
  'qualidade', 'primeira', 'comum', 'kit', 'jogo', 'par', 'und', 'pct']);

function palavrasChave(txt) {
  return String(txt || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((p) => p.length >= 3 && !PALAVRA_VAZIA.has(p) && !/^\d+$/.test(p));
}

// Índice do que cada fornecedor já vendeu (OC) ou cotou com preço.
function historicoDeVenda() {
  const idx = new Map();
  const por = (id, nome, txt, onde, vendeu) => {
    const k = id || chaveNome(nome);
    if (!k || !txt) return;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push({ txt, onde, vendeu });
  };
  for (const o of lista('oc')) {
    if (o.situacao === 'cancelada') continue;
    for (const i of (o.itens || [])) por(o.fornecedorId, (o.fornecedor || {}).nome, i.descricao, o.codigo, true);
  }
  // Ter dado preço numa cotação também conta: ele trabalha com o material,
  // mesmo que a compra tenha ficado com outro.
  for (const c of lista('cot')) {
    for (const f of (c.fornecedores || [])) {
      if (!f.respondidoEm) continue;
      for (const i of (c.itens || [])) {
        if ((f.precos || {})[i.id] != null) por(f.fornecedorId, f.nome, i.descricao, c.codigo, false);
      }
    }
  }
  return idx;
}

// Fornecedores que casam com os itens pedidos, do mais provável para o menos.
// Já ter vendido o material pesa mais que estar escrito no cadastro.
function sugerirFornecedores(itens, limite = 6) {
  const alvo = (itens || [])
    .map((i) => ({ desc: i.descricao, pal: new Set(palavrasChave(i.descricao)) }))
    .filter((x) => x.pal.size);
  if (!alvo.length) return [];

  const hist = historicoDeVenda();
  const saida = [];

  for (const f of fornecedoresAtivos()) {
    const cad = new Set(palavrasChave(f.categorias));
    const vendas = hist.get(f.id) || hist.get(chaveNome(f.nome)) || [];
    let pontos = 0;
    const motivos = [];

    for (const a of alvo) {
      let jaVendeu = null;
      let maisPalavras = 0;
      for (const v of vendas) {
        const pv = new Set(palavrasChave(v.txt));
        const n = [...a.pal].filter((p) => pv.has(p)).length;
        // Empate: a venda de verdade ganha da cotação.
        if (n > maisPalavras || (n === maisPalavras && n > 0 && v.vendeu && !(jaVendeu || {}).vendeu)) {
          maisPalavras = n; jaVendeu = v;
        }
      }
      if (jaVendeu) {
        pontos += maisPalavras * (jaVendeu.vendeu ? 3 : 2);
        motivos.push((jaVendeu.vendeu ? 'já forneceu <b>' : 'já deu preço em <b>') + esc(jaVendeu.txt) + '</b>' +
          (jaVendeu.onde ? ' na ' + esc(jaVendeu.onde) : ''));
        continue;
      }
      const noCadastro = [...a.pal].filter((p) => cad.has(p)).length;
      if (noCadastro) {
        pontos += noCadastro;
        motivos.push('cadastro: ' + esc(f.categorias || ''));
      }
    }

    if (pontos) {
      // Quem já provou que entrega sobe na lista: a sugestão deixa de ser só
      // "quem tem o material" e passa a ser "quem tem o material E cumpre".
      const q = notaFornecedor(f);
      saida.push({ forn: f, pontos, vendas: vendas.length, nota: q.nota,
        motivos: [...new Set(motivos)].slice(0, 3) });
    }
  }

  return saida.sort((a, b) =>
    b.pontos - a.pontos ||
    (b.nota == null ? -1 : b.nota) - (a.nota == null ? -1 : a.nota) ||
    b.vendas - a.vendas).slice(0, limite);
}

// Linha de item usada nos formulários (com ou sem preço).
function linhaItem(it = {}, comPreco = false) {
  const uns = unidades();
  return '<div class="item-linha' + (comPreco ? ' com-preco' : '') + '" data-item' +
    (it.id ? ' data-id="' + esc(it.id) + '"' : '') + '>' +
    '<div class="campo descricao"><label>Descrição</label>' +
      '<input type="text" data-i="descricao" value="' + esc(it.descricao || '') + '" placeholder="Material / serviço"></div>' +
    '<div class="campo"><label>Unid.</label><select data-i="unid">' +
      uns.map((u) => '<option' + (u === (it.unid || 'un') ? ' selected' : '') + '>' + esc(u) + '</option>').join('') +
    '</select></div>' +
    '<div class="campo"><label>Qtd</label><input type="text" data-i="qtd" inputmode="decimal" value="' + esc(it.qtd != null ? it.qtd : '') + '"></div>' +
    (comPreco ?
      '<div class="campo"><label>Preço unit.</label><input type="text" data-i="preco" inputmode="decimal" value="' + esc(it.preco != null ? it.preco : '') + '"></div>' +
      '<div class="campo"><label>Marca / obs</label><input type="text" data-i="marca" value="' + esc(it.marca || '') + '"></div>'
      : '') +
    '<button class="lixeira" data-tirar title="Tirar item">✕</button>' +
  '</div>';
}

function lerItens(raiz, comPreco) {
  return Array.from(raiz.querySelectorAll('[data-item]')).map((l, i) => {
    const v = (n) => { const e = l.querySelector('[data-i=' + n + ']'); return e ? e.value : ''; };
    return {
      id: l.dataset.id || (Date.now().toString(36) + i),
      n: i + 1,
      descricao: v('descricao').trim(),
      unid: v('unid'),
      qtd: numeroBR(v('qtd')),
      preco: comPreco ? numeroBR(v('preco')) : undefined,
      marca: comPreco ? v('marca').trim() : undefined
    };
  }).filter((x) => x.descricao);
}

function ligarItens(caixa, comPreco) {
  const ligar = (linha) => {
    const b = linha.querySelector('[data-tirar]');
    if (b) b.addEventListener('click', () => { linha.remove(); if (caixa.dataset.recalcula) recalcularOC(); });
    if (comPreco) linha.querySelectorAll('input').forEach((i) => i.addEventListener('input', () => {
      if (caixa.dataset.recalcula) recalcularOC();
    }));
  };
  Array.from(caixa.children).forEach(ligar);
  return ligar;
}

/* ── Totais da ordem de compra ─────────────────────────────────────────────── */
function totaisOC(oc) {
  const total = (oc.itens || []).reduce((s, i) => s + (Number(i.qtd) || 0) * (Number(i.preco) || 0), 0);
  const ipi = total * (Number(oc.ipiPerc) || 0) / 100;
  const icms = total * (Number(oc.icmsPerc) || 0) / 100;
  const liquido = total + ipi + icms + (Number(oc.frete) || 0) + (Number(oc.seguro) || 0) - Math.abs(Number(oc.desconto) || 0);
  return { total, ipi, icms, totalLiquido: liquido };
}

/* ══════════════════════════════════════════════════════════════════════════
   SOLICITAÇÕES
   ══════════════════════════════════════════════════════════════════════════ */
TELAS.solicitacoes = function (el, args) {
  if (args[0]) return telaSolicitacao(el, args[0]);

  const todas = lista('sc');
  const filtro = S.filtroSC || { situacao: '', obra: '', busca: '' };
  S.filtroSC = filtro;

  const filtradas = todas.filter((s) =>
    (!filtro.situacao || s.situacao === filtro.situacao) &&
    (!filtro.obra || s.obraId === filtro.obra) &&
    (!filtro.busca || JSON.stringify(s).toLowerCase().includes(filtro.busca.toLowerCase())));

  cabecalho('Solicitações de compra', todas.length + ' no total',
    '<button class="btn" data-acao="linkObra">🔗 Link da obra</button>' +
    '<button class="btn primario" id="scNova">+ Nova solicitação</button>');

  el.innerHTML =
    '<div class="filtros">' +
      '<input type="search" id="fBusca" placeholder="Buscar material, quem pediu…" value="' + esc(filtro.busca) + '">' +
      '<select id="fSit"><option value="">Todas as situações</option>' +
        ['nova', 'aprovada', 'em_cotacao', 'em_compra', 'recusada', 'atendida'].map((s) =>
          '<option value="' + s + '"' + (filtro.situacao === s ? ' selected' : '') + '>' + esc(SITUACOES[s].txt) + '</option>').join('') +
      '</select>' +
      '<select id="fObra"><option value="">Todas as obras</option>' +
        obras().map((o) => '<option value="' + esc(o.id) + '"' + (filtro.obra === o.id ? ' selected' : '') + '>' + esc(o.nome) + '</option>').join('') +
      '</select>' +
    '</div>' +
    '<div class="cartao">' +
      (filtradas.length ?
        '<div class="tabela-rolagem"><table><thead><tr>' +
          '<th>Nº</th><th>Quem pediu</th><th>Obra / setor</th><th>Itens</th><th>Situação</th><th>Quando</th>' +
        '</tr></thead><tbody>' +
        filtradas.map((s) =>
          '<tr class="clicavel" data-id="' + esc(s.id) + '">' +
            '<td><b>' + esc(s.codigo || '—') + '</b>' + (s._pendente ? ' <span class="pendente">enviando…</span>' : '') + '</td>' +
            '<td>' + esc((s.solicitante || {}).nome || '—') + '<div style="font-size:.8rem;color:var(--texto-fraco)">' +
              esc((s.solicitante || {}).funcao || '') + '</div></td>' +
            '<td>' + esc(s.obra || nomeObra(s.obraId)) + '<div style="font-size:.8rem;color:var(--texto-fraco)">' + esc(s.setor || '') + '</div></td>' +
            '<td>' + (s.itens || []).length + '</td>' +
            '<td>' + etiqueta(s.situacao) + ' ' + etiquetaUrgencia(s.urgencia) + '</td>' +
            '<td>' + fmt.quando(s.criadoEm) + '</td>' +
          '</tr>').join('') +
        '</tbody></table></div>'
        : vazio('📋', 'Nenhuma solicitação', 'Mande o link da obra para o pessoal pedir material.')) +
    '</div>';

  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => irPara('solicitacoes/' + tr.dataset.id)));
  const aplicar = () => {
    filtro.busca = document.getElementById('fBusca').value;
    filtro.situacao = document.getElementById('fSit').value;
    filtro.obra = document.getElementById('fObra').value;
    render();
  };
  document.getElementById('fSit').addEventListener('change', aplicar);
  document.getElementById('fObra').addEventListener('change', aplicar);
  let t;
  document.getElementById('fBusca').addEventListener('input', (e) => {
    clearTimeout(t); const v = e.target.value;
    t = setTimeout(() => {
      filtro.busca = v; render();
      const c = document.getElementById('fBusca'); if (c) c.focus();
    }, 400);
  });
  document.getElementById('scNova').addEventListener('click', novaSolicitacaoInterna);
  document.querySelectorAll('[data-acao="linkObra"]').forEach((b) => b.addEventListener('click', mostrarLinkObra));
};

function novaSolicitacaoInterna() {
  abrirModal({
    titulo: 'Nova solicitação',
    largo: true,
    corpo: '<div id="fSC">' +
      '<div class="linha">' +
        campo('Obra', seletor('obraId', obras()[0] && obras()[0].id, obras().map((o) => ({ v: o.id, t: o.nome })))) +
        campo('Setor', seletor('setor', '', cfgLista('setores'))) +
        campo('Precisa até', entrada('necessidadeEm', hojeISO(), { tipo: 'date' })) +
      '</div>' +
      '<div class="linha">' +
        campo('Quem está pedindo', entrada('solicitante.nome', S.quem)) +
        campo('Urgência', seletor('urgencia', 'normal', [{ v: 'normal', t: 'Normal' }, { v: 'urgente', t: 'Urgente' }, { v: 'critica', t: 'Parou a obra' }])) +
      '</div>' +
      '<h3>Itens</h3><div id="itensSC">' + linhaItem() + linhaItem() + '</div>' +
      '<button class="btn pequeno" id="maisItemSC">+ Item</button>' +
      campo('Observação', areaTexto('justificativa', '')) +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Criar solicitação', classe: 'primario', aoClicar: (fundo) => {
        const caixa = fundo.querySelector('#itensSC');
        const itens = lerItens(caixa, false);
        if (!itens.length) { toast('Escreva pelo menos um item', 'ruim'); return; }
        const d = lerCampos(fundo.querySelector('#fSC'));
        const reg = Object.assign({}, d, {
          obra: nomeObra(d.obraId),
          itens,
          situacao: 'nova',
          origem: 'painel'
        });
        reg.historico = historiar(reg, 'Solicitação criada no painel');
        salvar('sc', reg);
        fecharEste(fundo); render(); toast('Solicitação criada', 'bom');
      } }
    ]
  });
  const caixa = document.getElementById('itensSC');
  const ligar = ligarItens(caixa, false);
  document.getElementById('maisItemSC').addEventListener('click', () => {
    caixa.insertAdjacentHTML('beforeend', linhaItem());
    ligar(caixa.lastElementChild);
  });
}

function telaSolicitacao(el, id) {
  const s = achar('sc', id);
  if (!s) { el.innerHTML = vazio('🤔', 'Solicitação não encontrada'); cabecalho('Solicitação', ''); return; }

  const podeAprovar = s.situacao === 'nova';
  const decide = typeof podeVer !== 'function' || podeVer('cotacoes');
  cabecalho(s.codigo || 'Solicitação', (s.obra || '') + ' · ' + (s.setor || ''),
    '<a class="btn" href="#/solicitacoes">← Voltar</a>');

  el.innerHTML =
    '<div class="grade g2">' +
      '<div>' +
        '<div class="cartao">' +
          '<div class="barra-acoes" style="justify-content:space-between;margin-bottom:8px">' +
            '<h3 style="margin:0">Itens pedidos</h3>' + etiqueta(s.situacao) + ' ' + etiquetaUrgencia(s.urgencia) +
          '</div>' +
          '<table><thead><tr><th>#</th><th>Material</th><th class="num">Qtd</th></tr></thead><tbody>' +
          (s.itens || []).map((i, n) => '<tr><td>' + (n + 1) + '</td><td>' + esc(i.descricao) +
            (i.obs ? '<div style="font-size:.8rem;color:var(--texto-fraco)">' + esc(i.obs) + '</div>' : '') + '</td>' +
            '<td class="num">' + fmt.numero(i.qtd) + ' ' + esc(i.unid || '') + '</td></tr>').join('') +
          '</tbody></table>' +
          (s.justificativa ? '<p style="margin-top:12px"><b>Observação:</b> ' + esc(s.justificativa) + '</p>' : '') +
          (s.motivoRecusa ? '<div class="aviso ruim" style="margin-top:12px"><b>Recusada:</b> ' + esc(s.motivoRecusa) + '</div>' : '') +
          '<div class="barra-acoes" style="margin-top:14px">' +
            // Quem é da obra pede material, mas não decide a compra — nem na
            // tela nem no servidor.
            (decide && podeAprovar ? '<button class="btn verde" id="aprovar">✓ Aprovar</button>' +
              '<button class="btn perigo" id="recusar">✕ Recusar</button>' : '') +
            (decide && ['nova', 'aprovada', 'em_cotacao', 'em_compra'].includes(s.situacao)
              ? '<button class="btn primario" id="pedirCot">💵 Pedir cotação (3 preços)</button>' +
                '<button class="btn" id="gerarOC">🧾 Comprar direto</button>' : '') +
            ((s.solicitante || {}).telefone ? '<button class="btn zap" id="zapSolic">Falar com quem pediu</button>' : '') +
            (decide ? '<button class="btn fantasma" id="apagarSC">Apagar</button>' : '') +
          '</div>' +
          (decide ? '' : '<p class="legenda" style="margin-top:10px">Quem aprova e compra é o escritório. ' +
            'Você acompanha por aqui.</p>') +
        '</div>' +
        // Quem recebe a solicitação não precisa lembrar de cabeça quem vende
        // telha: o sistema procura no cadastro e no histórico de compras.
        (function () {
          if (!['nova', 'aprovada', 'em_cotacao'].includes(s.situacao)) return '';
          const sug = sugerirFornecedores(s.itens);
          if (!sug.length) {
            return '<div class="cartao"><h3>🔎 Quem pode fornecer isso</h3>' +
              '<p class="legenda">Nenhum fornecedor do cadastro casa com esses materiais ainda. ' +
              'A cada compra o sistema aprende quem vende o quê e passa a sugerir sozinho — ' +
              'você também pode preencher "o que fornece" na ficha de cada um.</p></div>';
          }
          return '<div class="cartao"><h3>🔎 Quem pode fornecer isso</h3>' +
            '<p class="legenda">Achei no cadastro e no histórico de compras. ' +
            'Marque quem você quer que dê preço — os três primeiros já vêm marcados.</p>' +
            sug.map((x, n) => {
              const f = x.forn;
              return '<label class="arquivo-solto" style="cursor:pointer;align-items:flex-start">' +
                '<input type="checkbox" data-sug="' + esc(f.id) + '"' + (n < 3 ? ' checked' : '') +
                  ' style="width:18px;height:18px;margin-top:3px;flex:none">' +
                '<div style="flex:1;min-width:0">' +
                  '<div class="nome">' + esc(f.nome) + '</div>' +
                  '<div class="meta">' + x.motivos.join(' · ') + '</div>' +
                '</div>' +
                '<div class="acoes">' +
                  selo(x.nota, { provisorio: x.provisorio }) +
                  (x.vendas ? '<span class="etiqueta et-valido">' + x.vendas + ' compra(s)</span>' : '') +
                  (f.telefone ? '' : '<span class="etiqueta et-vencendo">sem WhatsApp</span>') +
                '</div></label>';
            }).join('') +
            '<div class="barra-acoes" style="margin-top:12px">' +
              '<button class="btn primario" id="cotarSug">💵 Pedir preço aos marcados</button>' +
            '</div></div>';
        })() +
        (s.cotIds && s.cotIds.length ? '<div class="cartao"><h3>Cotações</h3>' +
          s.cotIds.map((cid) => { const c = achar('cot', cid); return c ?
            '<div class="arquivo-solto"><span class="ic">💵</span><div><div class="nome">' + esc(c.codigo || '—') + '</div>' +
            '<div class="meta">' + (c.fornecedores || []).filter((f) => f.respondidoEm).length + ' de ' +
            (c.fornecedores || []).length + ' responderam</div></div>' +
            '<div class="acoes">' + etiqueta(c.situacao) +
            '<button class="btn pequeno" data-vercot="' + esc(c.id) + '">Abrir</button></div></div>' : ''; }).join('') +
          '</div>' : '') +
        (s.ocIds && s.ocIds.length ? '<div class="cartao"><h3>Compras geradas</h3>' +
          s.ocIds.map((oid) => { const o = achar('oc', oid); return o ?
            '<div class="arquivo-solto"><span class="ic">🧾</span><div><div class="nome">' + esc(o.codigo) + '</div>' +
            '<div class="meta">' + esc((o.fornecedor || {}).nome || 'sem fornecedor') + ' · ' + fmt.brl(o.totalLiquido) + '</div></div>' +
            '<div class="acoes">' + etiqueta(o.situacao) + '<button class="btn pequeno" data-veroc="' + esc(o.id) + '">Abrir</button></div></div>' : ''; }).join('') +
          '</div>' : '') +
      '</div>' +
      '<div>' +
        '<div class="cartao">' +
          '<h3>Quem pediu</h3>' +
          '<p><b>' + esc((s.solicitante || {}).nome || '—') + '</b><br>' +
            esc((s.solicitante || {}).funcao || '') + '<br>' +
            esc(fmt.telefone((s.solicitante || {}).telefone)) + '</p>' +
          '<p class="legenda">Pedido em ' + fmt.dataHora(s.criadoEm) +
            (s.necessidadeEm ? ' · precisa até ' + fmt.data(s.necessidadeEm) : '') +
            ' · ' + esc(s.origem || '') + '</p>' +
        '</div>' +
        '<div class="cartao"><h3>Andamento</h3>' + linhaTempo(s.historico) + '</div>' +
      '</div>' +
    '</div>';

  const marcar = (situacao, texto, extra = {}) => {
    const novo = Object.assign({}, s, extra, { situacao });
    novo.historico = historiar(s, texto);
    salvar('sc', novo);
    render();
  };

  if (decide && podeAprovar) {
    document.getElementById('aprovar').addEventListener('click', () => marcar('aprovada', 'Aprovada por ' + (S.quem || '—')));
    document.getElementById('recusar').addEventListener('click', async () => {
      const m = await perguntar('Por que está sendo recusada?', { titulo: 'Recusar solicitação', multi: true, obrigatorio: true, ok: 'Recusar' });
      if (m) marcar('recusada', 'Recusada: ' + m, { motivoRecusa: m });
    });
  }
  const bpc = document.getElementById('pedirCot');
  if (bpc) bpc.addEventListener('click', () => abrirNovaCotacao(s));
  const bcs = document.getElementById('cotarSug');
  if (bcs) bcs.addEventListener('click', () => {
    const ids = Array.from(el.querySelectorAll('[data-sug]:checked')).map((x) => x.dataset.sug);
    if (!ids.length) { toast('Marque pelo menos um fornecedor', 'ruim'); return; }
    abrirNovaCotacao(s, ids.map((id) => achar('forn', id)).filter(Boolean));
  });
  const bg = document.getElementById('gerarOC');
  // "Comprar direto" existe de propósito: exigir 3 preços para uma caixa de
  // parafuso urgente só atrasa a obra. Cotação é o caminho padrão, não o único.
  if (bg) bg.addEventListener('click', () => irPara('compras/nova/' + s.id));
  const bz = document.getElementById('zapSolic');
  if (bz) bz.addEventListener('click', () => {
    window.open(linkWhats((s.solicitante || {}).telefone,
      'Olá ' + ((s.solicitante || {}).nome || '') + ', sobre sua solicitação ' + (s.codigo || '') + ':'), '_blank');
  });
  const bap = document.getElementById('apagarSC');
  if (bap) bap.addEventListener('click', async () => {
    if (await confirmar('Apagar esta solicitação? Ela vai para a lixeira.', { perigo: true, ok: 'Apagar' })) {
      try { await api('apagar', { colecao: 'sc', id: s.id }); } catch (e) { toast('Não consegui apagar: ' + e.message, 'ruim'); return; }
      await puxar(); irPara('solicitacoes');
    }
  });
  el.querySelectorAll('[data-veroc]').forEach((b) => b.addEventListener('click', () => irPara('compras/' + b.dataset.veroc)));
  el.querySelectorAll('[data-vercot]').forEach((b) => b.addEventListener('click', () => irPara('cotacoes/' + b.dataset.vercot)));
}

/* A situação da solicitação é CONSEQUÊNCIA do que existe ligado a ela — não um
   campo que alguém esqueceu de mexer. Sem isto, cancelar a cotação deixava a
   solicitação presa em "Em cotação" para sempre, e apagar a ordem de compra
   deixava em "Em compra" sem nenhuma compra. */
function recalcularSC(scId, motivo) {
  const sc = achar('sc', scId);
  if (!sc || sc.apagadoEm || ['recusada', 'atendida'].includes(sc.situacao)) return;

  const ocs = (sc.ocIds || []).map((id) => achar('oc', id))
    .filter((o) => o && !o.apagadoEm && o.situacao !== 'cancelada');
  const cots = (sc.cotIds || []).map((id) => achar('cot', id))
    .filter((c) => c && !c.apagadoEm && !['cancelada', 'recusada'].includes(c.situacao));

  let nova;
  if (ocs.length) nova = ocs.every((o) => o.situacao === 'entregue') ? 'atendida' : 'em_compra';
  else if (cots.length) nova = 'em_cotacao';
  else nova = sc.aprovadaEm || ['aprovada', 'em_cotacao', 'em_compra'].includes(sc.situacao) ? 'aprovada' : 'nova';

  if (nova === sc.situacao) return;
  const n = Object.assign({}, sc, { situacao: nova });
  n.historico = historiar(sc, (motivo ? motivo + '. ' : '') + 'Voltou para: ' + ((SITUACOES[nova] || {}).txt || nova));
  salvar('sc', n);
}

function linhaTempo(historico) {
  const h = (historico || []).slice().sort((a, b) => String(b.em).localeCompare(String(a.em)));
  if (!h.length) return '<p class="legenda">Sem registros ainda.</p>';
  return '<ul class="tempo">' + h.map((x) =>
    '<li><div class="quando">' + fmt.dataHora(x.em) + ' · ' + esc(x.por || '—') + '</div>' + esc(x.o_que) + '</li>').join('') + '</ul>';
}

/* ══════════════════════════════════════════════════════════════════════════
   ORDENS DE COMPRA
   ══════════════════════════════════════════════════════════════════════════ */
TELAS.compras = function (el, args) {
  if (args[0] === 'nova') return editorOC(el, null, args[1]);
  if (args[0] && args[1] === 'editar') return editorOC(el, args[0]);
  if (args[0]) return telaOC(el, args[0]);

  const todas = lista('oc');
  const filtro = S.filtroOC || { situacao: '', busca: '' };
  S.filtroOC = filtro;
  const filtradas = todas.filter((o) =>
    (!filtro.situacao || o.situacao === filtro.situacao) &&
    (!filtro.busca || JSON.stringify(o).toLowerCase().includes(filtro.busca.toLowerCase())));
  const somaAberta = todas.filter((o) => ['emitida', 'enviada', 'confirmada', 'transito', 'parcial'].includes(o.situacao))
    .reduce((s, o) => s + (Number(o.totalLiquido) || 0), 0);

  cabecalho('Ordens de compra', fmt.brl(somaAberta) + ' em aberto',
    '<a class="btn primario" href="#/compras/nova">+ Nova ordem de compra</a>');

  el.innerHTML =
    '<div class="filtros">' +
      '<input type="search" id="oBusca" placeholder="Buscar fornecedor, material, nº…" value="' + esc(filtro.busca) + '">' +
      '<select id="oSit"><option value="">Todas as situações</option>' +
        ['rascunho', 'emitida', 'enviada', 'confirmada', 'transito', 'parcial', 'entregue', 'cancelada'].map((s) =>
          '<option value="' + s + '"' + (filtro.situacao === s ? ' selected' : '') + '>' + esc(SITUACOES[s].txt) + '</option>').join('') +
      '</select>' +
    '</div>' +
    '<div class="cartao">' +
      (filtradas.length ?
        '<div class="tabela-rolagem"><table><thead><tr><th>Nº</th><th>Fornecedor</th><th>Obra</th>' +
        '<th class="num">Valor</th><th>Situação</th><th>Entrega</th></tr></thead><tbody>' +
        filtradas.map((o) => {
          const d = o.entregaPrevista ? diasAte(o.entregaPrevista) : null;
          const atraso = d != null && d < 0 && !['entregue', 'cancelada'].includes(o.situacao);
          return '<tr class="clicavel" data-id="' + esc(o.id) + '">' +
            '<td><b>' + esc(o.codigo || '—') + '</b>' + (o._pendente ? ' <span class="pendente">enviando…</span>' : '') + '</td>' +
            '<td>' + esc((o.fornecedor || {}).nome || '—') + '</td>' +
            '<td>' + esc(o.obra || nomeObra(o.obraId)) + '</td>' +
            '<td class="num">' + fmt.brl(o.totalLiquido) + '</td>' +
            '<td>' + etiqueta(o.situacao) + '</td>' +
            '<td>' + (o.entregaPrevista ? fmt.data(o.entregaPrevista) +
              (atraso ? ' <span class="etiqueta et-vencido">atrasada</span>' : '') : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : vazio('🧾', 'Nenhuma ordem de compra', 'Crie a primeira a partir de uma solicitação aprovada.')) +
    '</div>';

  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => irPara('compras/' + tr.dataset.id)));
  document.getElementById('oSit').addEventListener('change', (e) => { filtro.situacao = e.target.value; render(); });
  let t;
  document.getElementById('oBusca').addEventListener('input', (e) => {
    clearTimeout(t); const v = e.target.value;
    t = setTimeout(() => {
      filtro.busca = v; render();
      const c = document.getElementById('oBusca'); if (c) c.focus();
    }, 400);
  });
};

/* ── Editor da OC ──────────────────────────────────────────────────────────── */
function editorOC(el, id, scId) {
  S.formAberto = true;
  S.scPuxadas = [];
  const existente = id ? achar('oc', id) : null;
  const sc = scId ? achar('sc', scId) : null;
  const oc = existente || {
    obraId: (sc && sc.obraId) || (obras()[0] || {}).id,
    dataEmissao: hojeISO(),
    modalidade: 'CIF',
    notaFiscalObrigatoria: true,
    situacao: 'rascunho',
    itens: sc ? (sc.itens || []).map((i) => ({ id: i.id, descricao: i.descricao, unid: i.unid, qtd: i.qtd, preco: 0 })) : [],
    scIds: sc ? [sc.id] : [],
    ipiPerc: 0, icmsPerc: 0, frete: 0, seguro: 0, desconto: 0
  };
  if (!oc.itens.length) oc.itens = [{}, {}];
  const f = oc.fornecedor || {};

  cabecalho(existente ? 'Editar ' + (oc.codigo || 'ordem de compra') : 'Nova ordem de compra',
    sc ? 'a partir da solicitação ' + sc.codigo : '',
    '<button class="btn" id="cancelarOC">Cancelar</button><button class="btn primario" id="salvarOC">Salvar</button>');

  el.innerHTML =
    '<div id="fOC">' +
      '<div class="cartao">' +
        '<h3>🏢 Fornecedor</h3>' +
        '<div class="linha">' +
          campo('Escolher cadastrado', '<select id="selForn"><option value="">— digitar abaixo —</option>' +
            fornecedoresAtivos().map((x) => '<option value="' + esc(x.id) + '"' + (oc.fornecedorId === x.id ? ' selected' : '') + '>' +
              esc(x.nome) + '</option>').join('') + '</select>') +
          campo('Nome / razão social', entrada('fornecedor.nome', f.nome)) +
          campo('CNPJ', entrada('fornecedor.cnpj', f.cnpj, { inputmode: 'numeric' })) +
        '</div>' +
        '<div class="linha">' +
          campo('Contato / representante', entrada('fornecedor.contato', f.contato)) +
          campo('WhatsApp', entrada('fornecedor.telefone', f.telefone, { tipo: 'tel' })) +
          campo('E-mail', entrada('fornecedor.email', f.email, { tipo: 'email' })) +
        '</div>' +
        '<div class="linha">' +
          campo('Endereço', entrada('fornecedor.endereco', f.endereco)) +
          campo('Inscrição estadual', entrada('fornecedor.ie', f.ie)) +
        '</div>' +
      '</div>' +

      '<div class="cartao">' +
        '<h3>📦 Condições</h3>' +
        '<div class="linha">' +
          campo('Obra', seletor('obraId', oc.obraId, obras().map((o) => ({ v: o.id, t: o.nome })))) +
          campo('Data de emissão', entrada('dataEmissao', oc.dataEmissao, { tipo: 'date' })) +
          campo('Entrega prevista', entrada('entregaPrevista', oc.entregaPrevista, { tipo: 'date' })) +
        '</div>' +
        '<div class="linha">' +
          campo('Local de entrega', entrada('localEntrega', oc.localEntrega, { placeholder: 'Canteiro da obra' })) +
          campo('Prazo de entrega', entrada('prazoEntrega', oc.prazoEntrega, { placeholder: 'Ex.: 10 dias úteis' })) +
          campo('Validade da proposta', entrada('validadeProposta', oc.validadeProposta, { placeholder: 'Ex.: 15 dias' })) +
        '</div>' +
        '<div class="linha">' +
          campo('Modalidade', seletor('modalidade', oc.modalidade, ['CIF', 'FOB'])) +
          campo('Condição de pagamento', entrada('condicaoPagamento', oc.condicaoPagamento, { placeholder: 'Ex.: 28 dias' })) +
          campo('Forma de pagamento', seletor('formaPagamento', oc.formaPagamento, ['Boleto', 'PIX/TED', 'Cheque', 'Cartão', 'Outro'], '—')) +
        '</div>' +
        '<div class="linha">' +
          campo('Dados bancários', entrada('dadosBancarios', oc.dadosBancarios)) +
          campo('Garantia', entrada('garantia', oc.garantia, { placeholder: 'Ex.: 12 meses' })) +
        '</div>' +
      '</div>' +

      '<div class="cartao">' +
        '<h3>🧱 Itens</h3>' +
        '<div id="itensOC" data-recalcula="1">' + oc.itens.map((i) => linhaItem(i, true)).join('') + '</div>' +
        '<div class="barra-acoes">' +
          '<button class="btn pequeno" id="maisItem">+ Item</button>' +
          '<button class="btn pequeno" id="puxarSC">Puxar de solicitações em aberto</button>' +
        '</div>' +
      '</div>' +

      '<div class="cartao">' +
        '<h3>💰 Impostos, frete e desconto</h3>' +
        '<div class="linha estreita">' +
          campo('IPI (%)', entrada('ipiPerc', oc.ipiPerc, { inputmode: 'decimal' })) +
          campo('ICMS/ST (%)', entrada('icmsPerc', oc.icmsPerc, { inputmode: 'decimal' })) +
          campo('Frete (R$)', entrada('frete', oc.frete, { inputmode: 'decimal' })) +
          campo('Seguro (R$)', entrada('seguro', oc.seguro, { inputmode: 'decimal' })) +
          campo('Desconto (R$)', entrada('desconto', oc.desconto, { inputmode: 'decimal' })) +
        '</div>' +
        '<div class="grade g2" style="margin-top:6px">' +
          '<div class="indicador"><div class="rotulo">Soma dos itens</div><div class="valor" id="vTotal">R$ 0,00</div></div>' +
          '<div class="indicador ok"><div class="rotulo">Valor líquido final</div><div class="valor" id="vLiquido">R$ 0,00</div></div>' +
        '</div>' +
        campo('Observações / condições gerais', areaTexto('observacoes', oc.observacoes)) +
      '</div>' +
    '</div>';

  const caixa = document.getElementById('itensOC');
  const ligar = ligarItens(caixa, true);
  document.getElementById('maisItem').addEventListener('click', () => {
    caixa.insertAdjacentHTML('beforeend', linhaItem({}, true));
    ligar(caixa.lastElementChild);
    caixa.lastElementChild.querySelector('input').focus();
  });
  el.querySelectorAll('[data-campo^="ipi"],[data-campo^="icms"],[data-campo=frete],[data-campo=seguro],[data-campo=desconto]')
    .forEach((i) => i.addEventListener('input', recalcularOC));
  document.getElementById('selForn').addEventListener('change', (e) => {
    const x = achar('forn', e.target.value);
    if (!x) return;
    const set = (n, v) => { const c = el.querySelector('[data-campo="fornecedor.' + n + '"]'); if (c) c.value = v || ''; };
    ['nome', 'cnpj', 'ie', 'endereco', 'contato', 'telefone', 'email'].forEach((n) => set(n, x[n]));
    const banco = el.querySelector('[data-campo=dadosBancarios]');
    if (banco && !banco.value && x.banco) banco.value = x.banco;
  });
  document.getElementById('puxarSC').addEventListener('click', () => puxarDeSolicitacoes(caixa, ligar));
  recalcularOC();

  document.getElementById('cancelarOC').addEventListener('click', () => {
    S.formAberto = false;
    irPara(existente ? 'compras/' + existente.id : 'compras');
  });
  document.getElementById('salvarOC').addEventListener('click', () => {
    const d = lerCampos(document.getElementById('fOC'));
    const itens = lerItens(caixa, true);
    if (!itens.length) { toast('Inclua pelo menos um item', 'ruim'); return; }
    if (!d.fornecedor.nome.trim()) { toast('Informe o fornecedor', 'ruim'); return; }

    const novo = Object.assign({}, oc, d, {
      itens,
      obra: nomeObra(d.obraId),
      // Voltar para "— digitar abaixo —" desliga o vínculo com o cadastrado.
      fornecedorId: document.getElementById('selForn').value,
      ipiPerc: numeroBR(d.ipiPerc), icmsPerc: numeroBR(d.icmsPerc),
      frete: numeroBR(d.frete), seguro: numeroBR(d.seguro), desconto: numeroBR(d.desconto)
    });
    const t = totaisOC(novo);
    novo.total = t.total;
    novo.totalLiquido = t.totalLiquido;
    if (!existente) {
      novo.historico = historiar(novo, 'Ordem de compra criada');
    } else {
      const antes = totaisOC(existente).totalLiquido;
      const depois = t.totalLiquido;
      const mudouValor = Math.abs(antes - depois) > 0.005;
      const assinatura = (x) => JSON.stringify((x.itens || []).map((i) => [i.descricao, i.unid, i.qtd, i.preco]));
      const mudouItens = assinatura(existente) !== assinatura(novo);
      const fornAntes = (existente.fornecedor || {}).nome || '';
      const mudouForn = fornAntes !== (novo.fornecedor || {}).nome;
      const cond = (x) => [x.prazoEntrega, x.entregaPrevista, x.condicaoPagamento, x.formaPagamento, x.localEntrega].join('|');
      const mudouCond = cond(existente) !== cond(novo);
      if (mudouValor || mudouItens || mudouForn || mudouCond) {
        const partes = [];
        if (mudouValor) partes.push('valor de ' + fmt.brl(antes) + ' para ' + fmt.brl(depois));
        if (mudouItens) partes.push('itens alterados (' + itens.length + ')');
        if (mudouForn) partes.push('fornecedor: ' + (fornAntes || '—') + ' → ' + ((novo.fornecedor || {}).nome || '—'));
        if (mudouCond) partes.push('condições alteradas');
        novo.historico = historiar(existente, 'Ordem editada: ' + partes.join('; '));
      }
    }

    // Solicitações ligadas: a de origem mais as que tiveram itens puxados.
    const ligadas = Array.from(new Set([...(oc.scIds || []), ...(sc ? [sc.id] : []), ...(S.scPuxadas || [])]));
    novo.scIds = ligadas;

    const salvo = salvar('oc', novo);

    for (const sid of ligadas) {
      const s = achar('sc', sid);
      if (!s) continue;
      const ocIds = Array.from(new Set([...(s.ocIds || []), salvo.id]));
      // "Em compra" e não "atendida": o material ainda não chegou, e pode ter
      // sobrado item da solicitação para uma segunda ordem. 'atendida' só no
      // recebimento completo.
      const nsc = Object.assign({}, s, { ocIds, situacao: 'em_compra' });
      // Aprovação implícita: gerar a OC de uma solicitação ainda 'nova' fazia
      // os botões de aprovar/recusar sumirem sem ninguém ter aprovado nada.
      if (s.situacao === 'nova') nsc.historico = historiar(s, 'Aprovada ao gerar a ordem de compra');
      nsc.historico = historiar(nsc, 'Entrou na ordem de compra ' + (salvo.codigo || '(aguardando número)'));
      salvar('sc', nsc);
    }
    S.scPuxadas = [];
    // Cadastra o fornecedor novo, se ainda não existir.
    if (!novo.fornecedorId && novo.fornecedor.nome) {
      const jaTem = fornecedoresAtivos().find((x) => x.nome.toLowerCase() === novo.fornecedor.nome.toLowerCase());
      if (!jaTem) salvar('forn', Object.assign({}, novo.fornecedor, { banco: novo.dadosBancarios || '' }));
    }
    S.formAberto = false;
    irPara('compras/' + salvo.id);
    toast('Ordem de compra salva', 'bom');
  });
}

function recalcularOC() {
  const caixa = document.getElementById('itensOC');
  if (!caixa) return;
  const raiz = document.getElementById('fOC');
  const g = (n) => numeroBR((raiz.querySelector('[data-campo=' + n + ']') || {}).value || 0);
  const oc = {
    itens: lerItens(caixa, true),
    ipiPerc: g('ipiPerc'), icmsPerc: g('icmsPerc'), frete: g('frete'), seguro: g('seguro'), desconto: g('desconto')
  };
  const t = totaisOC(oc);
  const a = document.getElementById('vTotal');
  const b = document.getElementById('vLiquido');
  if (a) a.textContent = fmt.brl(t.total);
  if (b) b.textContent = fmt.brl(t.totalLiquido);
}

function puxarDeSolicitacoes(caixa, ligar) {
  const aprovadas = lista('sc').filter((s) => ['nova', 'aprovada', 'em_cotacao', 'em_compra'].includes(s.situacao));
  if (!aprovadas.length) { toast('Nenhuma solicitação em aberto', 'ruim'); return; }
  abrirModal({
    titulo: 'Puxar itens de solicitações',
    largo: true,
    corpo: aprovadas.map((s) =>
      '<div class="cartao" style="box-shadow:none;margin-bottom:10px">' +
        '<b>' + esc(s.codigo) + '</b> · ' + esc((s.solicitante || {}).nome || '') + ' · ' + esc(s.setor || '') + ' ' + etiqueta(s.situacao) +
        (s.itens || []).map((i, n) => {
          // Já entrou em alguma ordem viva? Marca, senão o mesmo material é
          // comprado duas vezes por quem não lembra o que já pediu.
          const jaEm = (s.ocIds || []).map((oid) => achar('oc', oid))
            .filter((oc) => oc && oc.situacao !== 'cancelada' &&
              (oc.itens || []).some((x) => x.descricao === i.descricao))
            .map((oc) => oc.codigo || '(sem número)');
          return '<label class="arquivo-solto" style="cursor:pointer' + (jaEm.length ? ';opacity:.6' : '') + '">' +
            '<input type="checkbox" data-sc="' + esc(s.id) + '" data-idx="' + n + '" style="width:auto;min-height:auto">' +
            '<div><div class="nome">' + esc(i.descricao) +
              (jaEm.length ? ' <span class="etiqueta et-comprado">já em ' + esc(jaEm.join(', ')) + '</span>' : '') + '</div>' +
            '<div class="meta">' + fmt.numero(i.qtd) + ' ' + esc(i.unid || '') + '</div></div></label>';
        }).join('') +
      '</div>').join(''),
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Trazer marcados', classe: 'primario', aoClicar: (fundo) => {
        const marcados = Array.from(fundo.querySelectorAll('input[type=checkbox]:checked'));
        if (!marcados.length) { toast('Marque pelo menos um item', 'ruim'); return; }
        for (const c of marcados) {
          const s = achar('sc', c.dataset.sc);
          const it = (s.itens || [])[Number(c.dataset.idx)];
          if (!it) continue;
          caixa.insertAdjacentHTML('beforeend', linhaItem({ descricao: it.descricao, unid: it.unid, qtd: it.qtd }, true));
          ligar(caixa.lastElementChild);
        }
        // Guarda a ligação para marcar as solicitações como atendidas ao salvar.
        S.scPuxadas = Array.from(new Set([...(S.scPuxadas || []), ...marcados.map((c) => c.dataset.sc)]));
        fecharEste(fundo);
        recalcularOC();
        toast(marcados.length + ' item(ns) trazido(s)', 'bom');
      } }
    ]
  });
}

/* ── Detalhe da OC ─────────────────────────────────────────────────────────── */
function telaOC(el, id) {
  const o = achar('oc', id);
  if (!o) { cabecalho('Ordem de compra', ''); el.innerHTML = vazio('🤔', 'Não encontrada'); return; }
  const t = totaisOC(o);
  const podeEditar = ['rascunho', 'emitida'].includes(o.situacao);
  const linkPublico = location.origin + location.pathname + '#/ver/oc/' + o.id + '/' + (o.tokenPublico || '');

  // codigo e tokenPublico nascem no SERVIDOR: enquanto não voltarem, mandar o
  // link para o fornecedor entregaria um endereço quebrado.
  const pronta = !!(o.codigo && o.tokenPublico);
  cabecalho(o.codigo || 'Ordem de compra (sincronizando…)', (o.fornecedor || {}).nome || '',
    '<a class="btn" href="#/compras">← Voltar</a>' +
    (podeEditar ? '<a class="btn" href="#/compras/' + esc(o.id) + '/editar">Editar</a>' : '') +
    '<button class="btn" id="ocPdf">📄 PDF</button>' +
    '<button class="btn zap" id="ocZap"' + (pronta ? '' : ' disabled title="aguardando o número do servidor"') +
    '>Enviar no WhatsApp</button>');

  el.innerHTML =
    '<div class="grade g2">' +
      '<div>' +
        '<div class="cartao">' +
          '<div class="barra-acoes" style="justify-content:space-between;margin-bottom:10px">' +
            '<h3 style="margin:0">Itens</h3>' + etiqueta(o.situacao) +
          '</div>' +
          '<div class="tabela-rolagem"><table><thead><tr><th>#</th><th>Descrição</th><th class="num">Qtd</th>' +
          '<th class="num">Unit.</th><th class="num">Total</th></tr></thead><tbody>' +
          (o.itens || []).map((i, n) => '<tr><td>' + (n + 1) + '</td><td>' + esc(i.descricao) +
            (i.marca ? '<div style="font-size:.8rem;color:var(--texto-fraco)">' + esc(i.marca) + '</div>' : '') + '</td>' +
            '<td class="num">' + fmt.numero(i.qtd) + ' ' + esc(i.unid || '') + '</td>' +
            '<td class="num">' + fmt.brl(i.preco) + '</td>' +
            '<td class="num">' + fmt.brl((Number(i.qtd) || 0) * (Number(i.preco) || 0)) + '</td></tr>').join('') +
          '</tbody><tfoot>' +
            '<tr><td colspan="4">Soma dos itens</td><td class="num">' + fmt.brl(t.total) + '</td></tr>' +
            (o.ipiPerc ? '<tr><td colspan="4">IPI ' + fmt.numero(o.ipiPerc) + '%</td><td class="num">' + fmt.brl(t.ipi) + '</td></tr>' : '') +
            (o.icmsPerc ? '<tr><td colspan="4">ICMS/ST ' + fmt.numero(o.icmsPerc) + '%</td><td class="num">' + fmt.brl(t.icms) + '</td></tr>' : '') +
            (o.frete ? '<tr><td colspan="4">Frete</td><td class="num">' + fmt.brl(o.frete) + '</td></tr>' : '') +
            (o.seguro ? '<tr><td colspan="4">Seguro</td><td class="num">' + fmt.brl(o.seguro) + '</td></tr>' : '') +
            (o.desconto ? '<tr><td colspan="4">Desconto</td><td class="num">-' + fmt.brl(Math.abs(o.desconto)) + '</td></tr>' : '') +
            '<tr><td colspan="4"><b>Valor líquido</b></td><td class="num"><b>' + fmt.brl(t.totalLiquido) + '</b></td></tr>' +
          '</tfoot></table></div>' +
          (o.observacoes ? '<p style="margin-top:12px"><b>Observações:</b> ' + esc(o.observacoes) + '</p>' : '') +
        '</div>' +

        '<div class="cartao"><h3>💵 Cotações</h3>' +
          '<p class="legenda">Guarde os preços que você pesquisou. Fica registrado por que este fornecedor foi escolhido.</p>' +
          ((o.cotacoes || []).length ?
            '<table><thead><tr><th>Fornecedor</th><th class="num">Valor</th><th>Prazo</th><th></th></tr></thead><tbody>' +
            o.cotacoes.map((c) => '<tr><td>' + esc(c.fornecedor) + (c.escolhido ? ' <span class="etiqueta et-entregue">escolhido</span>' : '') +
              (c.motivo ? '<div style="font-size:.8rem;color:var(--texto-fraco)">' + esc(c.motivo) + '</div>' : '') + '</td>' +
              '<td class="num">' + fmt.brl(c.valor) + '</td><td>' + esc(c.prazo || '—') + '</td>' +
              '<td class="num">' + (c.escolhido ? '' : '<button class="btn pequeno" data-escolher="' + esc(c.id) + '">Escolher</button>') + '</td></tr>').join('') +
            '</tbody></table>' +
            (o.cotacoes.length > 1 ? (() => {
              const vals = o.cotacoes.map((c) => Number(c.valor) || 0).filter((v) => v > 0);
              const menor = Math.min(...vals), maior = Math.max(...vals);
              return menor < maior ? '<div class="aviso bom" style="margin-top:10px">Diferença entre a maior e a menor cotação: <b>' +
                fmt.brl(maior - menor) + '</b> (' + fmt.numero(((maior - menor) / maior) * 100, 1) + '%).</div>' : '';
            })() : '')
            : '<p class="legenda">Nenhuma cotação registrada.</p>') +
          '<button class="btn pequeno" id="novaCotacao">+ Registrar cotação</button>' +
        '</div>' +

        ((o.recebimentos || []).length ? '<div class="cartao"><h3>📦 Recebimentos</h3>' +
          o.recebimentos.map((r) =>
            '<div class="arquivo-solto"><span class="ic">' + (r.fotosPendentes ? '📷' : '✅') + '</span>' +
            '<div style="flex:1;min-width:0">' +
              '<div class="nome">' + fmt.dataHora(r.em) + ' · ' + esc(r.por || '—') + '</div>' +
              '<div class="meta">' + (r.itens || []).map((i) => esc(i.descricao) + ': ' + fmt.numero(i.qtd)).join(' · ') +
              (r.nf ? ' · NF ' + esc(r.nf) : '') + (r.obs ? ' · ' + esc(r.obs) : '') + '</div>' +
              (r.fotosPendentes
                ? '<div class="meta" style="color:var(--vermelho)">' + r.fotosPendentes +
                  ' foto(s) não subiram na obra — anexe aqui</div>' : '') + '</div>' +
            '<div class="acoes"><button class="btn pequeno" data-anexarfoto="' + esc(r.id) + '">' +
              (r.fotosPendentes ? '📷 Anexar foto' : 'Anexar foto') + '</button></div></div>' +
            ((r.fotos || []).length ? '<div class="miniaturas" data-fotos="' + esc(r.id) + '"></div>' : '')).join('') +
          '</div>' : '') +
      '</div>' +

      '<div>' +
        '<div class="cartao">' +
          '<h3>Andamento da compra</h3>' +
          '<div class="barra-acoes" style="flex-direction:column;align-items:stretch">' + botoesFluxoOC(o) + '</div>' +
        '</div>' +
        '<div class="cartao">' +
          '<h3>Dados</h3>' +
          '<p>' +
            '<b>Obra:</b> ' + esc(o.obra || nomeObra(o.obraId)) + '<br>' +
            '<b>Emissão:</b> ' + fmt.data(o.dataEmissao) + '<br>' +
            '<b>Entrega prevista:</b> ' + (o.entregaPrevista ? fmt.data(o.entregaPrevista) : '—') + '<br>' +
            '<b>Prazo:</b> ' + esc(o.prazoEntrega || '—') + '<br>' +
            '<b>Pagamento:</b> ' + esc(o.condicaoPagamento || '—') + ' ' + esc(o.formaPagamento || '') + '<br>' +
            '<b>Modalidade:</b> ' + esc(o.modalidade || '—') + '<br>' +
            '<b>Contato:</b> ' + esc((o.fornecedor || {}).contato || '—') + ' ' + esc(fmt.telefone((o.fornecedor || {}).telefone)) +
            (function () {
              const f = achar('forn', o.fornecedorId);
              if (!f) return '';
              const q = notaFornecedor(f);
              return '<br><b>Qualificação:</b> ' + selo(q.nota, { txt: true, provisorio: q.provisorio }) +
                ' <a href="#/fornecedores/' + esc(f.id) + '">ver ficha</a>';
            })() +
            (o.cotacaoId ? '<br><b>Veio da cotação:</b> ' + esc((achar('cot', o.cotacaoId) || {}).codigo || '—') : '') +
          '</p>' +
          (pronta
            ? '<div class="campo"><label>Link para o fornecedor (não pede senha)</label>' +
              '<input type="text" value="' + esc(linkPublico) + '" readonly id="linkOC"></div>' +
              '<button class="btn pequeno" id="copiarLinkOC">Copiar link</button>'
            : '<div class="aviso atencao">Aguardando o número da ordem chegar do servidor. ' +
              'O link do fornecedor e o WhatsApp liberam assim que sincronizar.</div>') +
        '</div>' +
        '<div class="cartao"><h3>Histórico</h3>' + linhaTempo(o.historico) + '</div>' +
        '<div class="cartao"><button class="btn perigo" id="apagarOC" style="width:100%">Apagar ordem de compra</button></div>' +
      '</div>' +
    '</div>';

  // Ações de fluxo
  el.querySelectorAll('[data-fluxo]').forEach((b) => b.addEventListener('click', () => avancarOC(o, b.dataset.fluxo)));

  document.getElementById('ocPdf').addEventListener('click', () => pdfOC(o, S.cfg));
  document.getElementById('ocZap').addEventListener('click', () => enviarOCWhats(o, linkPublico));
  const btnCopiar = document.getElementById('copiarLinkOC');
  if (btnCopiar) btnCopiar.addEventListener('click', () => {
    navigator.clipboard.writeText(linkPublico).then(() => toast('Link copiado', 'bom'));
  });
  document.getElementById('novaCotacao').addEventListener('click', () => registrarCotacao(o));
  el.querySelectorAll('[data-escolher]').forEach((b) => b.addEventListener('click', () => escolherCotacao(o, b.dataset.escolher)));
  document.getElementById('apagarOC').addEventListener('click', async () => {
    if (await confirmar('Apagar esta ordem de compra? Vai para a lixeira.', { perigo: true, ok: 'Apagar' })) {
      try { await api('apagar', { colecao: 'oc', id: o.id }); } catch (e) { toast('Não consegui apagar: ' + e.message, 'ruim'); return; }
      await puxar();
      // A solicitação não pode ficar "em compra" sem compra nenhuma.
      for (const sid of (o.scIds || [])) recalcularSC(sid, 'Ordem ' + (o.codigo || '') + ' apagada');
      irPara('compras');
    }
  });
  // Anexar foto depois: a obra registra o recebimento sem sinal e as fotos
  // ficam devendo. Aqui elas entram no MESMO recebimento, sem refazer nada.
  el.querySelectorAll('[data-anexarfoto]').forEach((b) => b.addEventListener('click', () =>
    anexarFotoRecebimento(o.id, b.dataset.anexarfoto)));

  // Miniaturas das fotos de recebimento. O endereço de cada foto fica guardado
  // em CACHE: telaOC roda inteira a cada sincronização, e sem isso as fotos eram
  // baixadas de novo (parte por parte) e vazavam um objectURL por redesenho.
  (o.recebimentos || []).forEach((r) => {
    const caixa = el.querySelector('[data-fotos="' + r.id + '"]');
    if (!caixa) return;
    (r.fotos || []).forEach(async (fid) => {
      try {
        let url = CACHE_FOTOS.get(fid);
        if (!url) {
          const { blob } = await baixarArquivo(fid);
          url = URL.createObjectURL(blob);
          CACHE_FOTOS.set(fid, url);
        }
        if (!caixa.isConnected) return;   // a tela já mudou enquanto baixava
        const img = document.createElement('img');
        img.src = url;
        img.addEventListener('click', () => window.open(url, '_blank'));
        caixa.appendChild(img);
      } catch { /* foto ainda subindo */ }
    });
  });
}

function botoesFluxoOC(o) {
  const b = (fluxo, texto, classe) => '<button class="btn ' + (classe || '') + '" data-fluxo="' + fluxo + '">' + texto + '</button>';
  const passos = [];
  if (o.situacao === 'rascunho') passos.push(b('emitida', '1. Emitir ordem de compra', 'primario'));
  if (o.situacao === 'emitida') passos.push(b('enviada', '2. Marcar como enviada ao fornecedor', 'primario'));
  if (['emitida', 'enviada'].includes(o.situacao)) passos.push(b('confirmada', '3. Fornecedor confirmou (comprado)', 'verde'));
  if (['confirmada', 'enviada'].includes(o.situacao)) passos.push(b('transito', '4. Saiu para entrega (a caminho)', ''));
  if (['confirmada', 'transito', 'parcial', 'enviada'].includes(o.situacao)) passos.push(b('receber', '5. Registrar recebimento', 'verde'));
  // Fornecedor entregou 118 de 120 e avisou que o resto não vem: sem esta saída
  // a ordem ficava presa em "recebida em parte" para sempre.
  if (o.situacao === 'parcial') passos.push(b('encerrar', 'Encerrar mesmo com falta', ''));
  if (!['cancelada', 'entregue'].includes(o.situacao)) passos.push(b('cancelada', 'Cancelar ordem', 'perigo'));
  if (o.situacao === 'entregue') {
    passos.push('<div class="aviso bom">Compra concluída e recebida na obra.</div>');
    // A avaliação vale para a PRÓXIMA cotação: é ela que diz se chama de novo.
    passos.push(o.avaliacao
      ? '<div class="aviso info">Fornecedor avaliado: <b>' + fmt.numero(o.avaliacao.media, 1) + ' de 5</b>' +
        (o.avaliacao.obs ? ' — ' + esc(o.avaliacao.obs) : '') + '</div>'
      : '<button class="btn primario" data-fluxo="avaliar">⭐ Avaliar o fornecedor</button>');
  }
  return passos.join('');
}

async function avancarOC(o, destino) {
  if (destino === 'receber') return telaReceberOC(o);
  if (destino === 'avaliar') return avaliarFornecedor(o);
  if (destino === 'encerrar') {
    const m = await perguntar('O que ficou faltando e por quê?', {
      titulo: 'Encerrar mesmo com falta', multi: true, obrigatorio: true, ok: 'Encerrar'
    });
    if (!m) return;
    const n = Object.assign({}, o, { situacao: 'entregue', encerradaComFalta: m });
    n.historico = historiar(o, 'Encerrada mesmo com falta: ' + m);
    salvar('oc', n);
    // Só fecha a solicitação quando TODAS as ordens dela chegaram: um pedido
    // dividido em duas compras virava "atendida" na primeira entrega e o resto
    // do material sumia do radar.
    for (const sid of (o.scIds || [])) recalcularSC(sid, 'Compra ' + (o.codigo || '') + ' encerrada');
    render();
    return;
  }
  if (destino === 'cancelada') {
    const m = await perguntar('Por que está cancelando?', { titulo: 'Cancelar ordem', multi: true, obrigatorio: true, ok: 'Cancelar ordem' });
    if (!m) return;
    const n = Object.assign({}, o, { situacao: 'cancelada', motivoCancelamento: m });
    n.historico = historiar(o, 'Cancelada: ' + m);
    salvar('oc', n);
    // Solicitação ligada volta para a fila — senão ficava presa em "em compra"
    // para sempre, com o material que parou a obra sem ninguém ver.
    for (const sid of (o.scIds || [])) recalcularSC(sid, 'Ordem ' + (o.codigo || '') + ' cancelada');
    render(); return;
  }
  const textos = {
    emitida: 'Ordem emitida',
    enviada: 'Enviada ao fornecedor',
    confirmada: 'Fornecedor confirmou o pedido (comprado)',
    transito: 'Material saiu para entrega'
  };
  const extra = {};
  if (destino === 'confirmada' && !o.entregaPrevista) {
    const d = await perguntarData('Data prevista de entrega', { titulo: 'Entrega prevista' });
    if (d) extra.entregaPrevista = d;
  }
  if (destino === 'transito') {
    const nf = await perguntar('Número da nota fiscal (se já tiver)', { titulo: 'A caminho', ok: 'Salvar' });
    if (nf) extra.nf = nf;
  }
  const n = Object.assign({}, o, extra, { situacao: destino });
  n.historico = historiar(o, textos[destino] || destino);
  salvar('oc', n);
  render();
  toast(textos[destino] || 'Atualizado', 'bom');
}

function normalizarData(s) {
  const t = String(s || '').trim();
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return br[3] + '-' + br[2] + '-' + br[1];
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return '';
}

function enviarOCWhats(o, link) {
  const linhas = [
    '*' + ((S.cfg.empresa || {}).nomeCurto || 'Domo Construtora') + '* — Ordem de Compra *' + (o.codigo || '') + '*',
    'Obra: ' + (o.obra || ''),
    '',
    ...(o.itens || []).map((i, n) => (n + 1) + '. ' + i.descricao + ' — ' + fmt.numero(i.qtd) + ' ' + (i.unid || '')),
    '',
    'Valor total: ' + fmt.brl(o.totalLiquido),
    o.prazoEntrega ? 'Prazo de entrega: ' + o.prazoEntrega : '',
    o.condicaoPagamento ? 'Pagamento: ' + o.condicaoPagamento : '',
    o.localEntrega ? 'Entregar em: ' + o.localEntrega : '',
    '',
    'Pedido completo (PDF): ' + link,
    '',
    'Favor confirmar o recebimento deste pedido.'
  ].filter((x) => x !== '');
  window.open(linkWhats((o.fornecedor || {}).telefone, linhas.join('\n')), '_blank');
  if (o.situacao === 'emitida' || o.situacao === 'rascunho') {
    const n = Object.assign({}, o, { situacao: 'enviada' });
    // Rascunho que vai direto pro WhatsApp registra as DUAS etapas: sem isso a
    // emissão ficava sem linha nenhuma no histórico e o botão sumia para sempre.
    n.historico = o.situacao === 'rascunho'
      ? historiar(Object.assign({}, o, { historico: historiar(o, 'Ordem emitida') }), 'Enviada ao fornecedor pelo WhatsApp')
      : historiar(o, 'Enviada ao fornecedor pelo WhatsApp');
    salvar('oc', n);
    setTimeout(render, 400);
  }
}

function registrarCotacao(o) {
  abrirModal({
    titulo: 'Registrar cotação',
    corpo: '<div id="fCot">' +
      '<div class="linha">' +
        campo('Fornecedor', entrada('fornecedor', '')) +
        campo('Valor total (R$)', entrada('valor', '', { inputmode: 'decimal' })) +
      '</div>' +
      '<div class="linha">' +
        campo('Prazo de entrega', entrada('prazo', '')) +
        campo('Condição de pagamento', entrada('condicao', '')) +
      '</div>' +
      campo('Observação', entrada('motivo', '')) +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar cotação', classe: 'primario', aoClicar: (fundo) => {
        const d = lerCampos(fundo.querySelector('#fCot'));
        if (!d.fornecedor.trim()) { toast('Informe o fornecedor', 'ruim'); return; }
        const c = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          fornecedor: d.fornecedor.trim(), valor: numeroBR(d.valor), prazo: d.prazo,
          condicao: d.condicao, motivo: d.motivo, em: new Date().toISOString(), por: S.quem
        };
        const n = Object.assign({}, o, { cotacoes: [...(o.cotacoes || []), c] });
        n.historico = historiar(o, 'Cotação registrada: ' + c.fornecedor + ' — ' + fmt.brl(c.valor));
        salvar('oc', n); fecharEste(fundo); render();
      } }
    ]
  });
}

async function escolherCotacao(o, cid) {
  const c = (o.cotacoes || []).find((x) => x.id === cid);
  if (!c) return;
  const motivo = await perguntar('Por que escolher ' + c.fornecedor + '?', {
    titulo: 'Escolher cotação', valor: 'Melhor preço', ok: 'Escolher'
  });
  if (motivo === null) return;
  const cotacoes = (o.cotacoes || []).map((x) => Object.assign({}, x, { escolhido: x.id === cid, motivo: x.id === cid ? motivo : x.motivo }));
  const n = Object.assign({}, o, { cotacoes });
  n.historico = historiar(o, 'Cotação escolhida: ' + c.fornecedor + ' (' + motivo + ')');
  salvar('oc', n);
  render();
}

/* ══════════════════════════════════════════════════════════════════════════
   RECEBIMENTO NA OBRA
   ══════════════════════════════════════════════════════════════════════════ */
TELAS.recebimento = function (el) {
  const esperando = lista('oc').filter((o) => SIT_ESPERANDO.includes(o.situacao));
  cabecalho('Recebimento na obra', esperando.length + ' compra(s) para chegar', '');

  el.innerHTML =
    '<div class="aviso info">Confira o material com o caminhão ainda na obra. Tire foto da nota e da carga: ' +
    'é a sua prova se faltar peça ou vier errado.</div>' +
    (esperando.length ? esperando.map((o) => {
      const d = o.entregaPrevista ? diasAte(o.entregaPrevista) : null;
      return '<div class="cartao">' +
        '<div class="barra-acoes" style="justify-content:space-between">' +
          '<div><h3 style="margin:0">' + esc(o.codigo || '—') + ' · ' + esc((o.fornecedor || {}).nome || '') + '</h3>' +
          '<div class="legenda">' + esc(o.obra || nomeObra(o.obraId)) + ' · ' + fmt.brl(o.totalLiquido) + '</div></div>' +
          '<div>' + etiqueta(o.situacao) +
            (d != null ? ' <span class="etiqueta ' + (d < 0 ? 'et-vencido' : d === 0 ? 'et-vencendo' : '') + '">' +
              (d < 0 ? (-d) + ' dia(s) de atraso' : d === 0 ? 'chega hoje' : 'em ' + d + ' dia(s)') + '</span>' : '') +
          '</div>' +
        '</div>' +
        // O que vem no caminhão, na cara do conferente: ele bate a carga sem
        // precisar abrir a ordem.
        '<table style="margin-top:8px"><tbody>' +
          (o.itens || []).map((i) => {
            const ja = jaRecebido(o, i.id);
            const falta = Math.max(0, (Number(i.qtd) || 0) - ja);
            return '<tr><td>' + esc(i.descricao) + '</td>' +
              '<td class="num"><b>' + fmt.numero(falta) + ' ' + esc(i.unid || '') + '</b>' +
              (ja ? '<div style="font-size:.78rem;color:var(--texto-fraco)">' + fmt.numero(ja) + ' já recebido</div>' : '') +
              '</td></tr>';
          }).join('') +
        '</tbody></table>' +
        '<div class="barra-acoes" style="margin-top:10px">' +
          '<button class="btn verde" data-receber="' + esc(o.id) + '">📦 Registrar recebimento</button>' +
          '<button class="btn" data-abrir="' + esc(o.id) + '">Ver ordem</button>' +
          ((o.fornecedor || {}).telefone ? '<button class="btn zap" data-cobrar="' + esc(o.id) + '">Cobrar entrega</button>' : '') +
        '</div>' +
      '</div>';
    }).join('')
      : '<div class="cartao">' + vazio('📭', 'Nada para receber', 'Quando uma compra for confirmada ela aparece aqui.') + '</div>');

  el.querySelectorAll('[data-receber]').forEach((b) => b.addEventListener('click', () => {
    const oc = achar('oc', b.dataset.receber);
    if (!oc) { toast('Esta ordem não existe mais — atualize a tela', 'ruim'); return; }
    telaReceberOC(oc);
  }));
  el.querySelectorAll('[data-abrir]').forEach((b) => b.addEventListener('click', () => irPara('compras/' + b.dataset.abrir)));
  el.querySelectorAll('[data-cobrar]').forEach((b) => b.addEventListener('click', () => {
    const o = achar('oc', b.dataset.cobrar);
    if (!o) { toast('Esta ordem não existe mais — atualize a tela', 'ruim'); return; }
    window.open(linkWhats((o.fornecedor || {}).telefone,
      'Olá! Sobre a ordem de compra ' + (o.codigo || '') + ' da ' + ((S.cfg.empresa || {}).nomeCurto || 'Domo') +
      ': poderia confirmar a data de entrega? Obrigado.'), '_blank');
  }));
};

// Quanto de cada item já foi recebido em entregas anteriores.
function jaRecebido(o, itemId) {
  return (o.recebimentos || []).reduce((s, r) => {
    const achado = (r.itens || []).find((i) => i.itemId === itemId);
    return s + ((achado && Number(achado.qtd)) || 0);
  }, 0);
}

function telaReceberOC(o) {
  if (!o) return;
  const fotos = [];
  // Fotos que não subiram (obra sem sinal). Ficam marcadas na tela e o
  // recebimento avisa quantas faltam anexar.
  const fotosPendentes = [];
  // Quantas fotos ainda estão subindo. Confirmar no meio do upload gravava o
  // recebimento sem foto nenhuma — justamente a prova de que o material chegou.
  const enviandoFotos = { qtd: 0, get tem() { return this.qtd > 0; } };
  abrirModal({
    titulo: 'Recebimento — ' + (o.codigo || ''),
    largo: true,
    corpo:
      '<p class="legenda">Confira item por item. Se veio só uma parte, escreva o que chegou de verdade — o resto continua pendente.</p>' +
      '<div id="fRec">' +
        '<table><thead><tr><th>Item</th><th class="num">Pedido</th><th class="num">Já recebido</th><th class="num">Chegou agora</th></tr></thead><tbody>' +
        (o.itens || []).map((i) => {
          const ja = jaRecebido(o, i.id);
          const falta = Math.max(0, (Number(i.qtd) || 0) - ja);
          return '<tr><td>' + esc(i.descricao) + '</td>' +
            '<td class="num">' + fmt.numero(i.qtd) + ' ' + esc(i.unid || '') + '</td>' +
            '<td class="num">' + fmt.numero(ja) + '</td>' +
            '<td class="num"><input type="text" inputmode="decimal" data-rec="' + esc(i.id) + '" value="' +
            esc(String(Math.round(falta * 1000) / 1000).replace('.', ',')) + '" style="max-width:110px"></td></tr>';
        }).join('') +
        '</tbody></table>' +
        '<div class="linha" style="margin-top:12px">' +
          campo('Nota fiscal nº', entrada('nf', o.nf || '')) +
          campo('Quem recebeu', entrada('por', S.quem)) +
        '</div>' +
        campo('Observação (avaria, falta, item trocado…)', areaTexto('obs', '')) +
        '<div class="campo"><label>Fotos da nota e da carga</label>' +
          '<input type="file" id="recFotos" accept="image/*" capture="environment" multiple>' +
          '<div class="miniaturas" id="recMini" style="margin-top:8px"></div>' +
          '<div class="progresso" id="recProg" style="display:none;margin-top:8px"><i></i></div></div>' +
      '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Confirmar recebimento', classe: 'verde', aoClicar: async (fundo) => {
        const d = lerCampos(fundo.querySelector('#fRec'));
        const recebidos = Array.from(fundo.querySelectorAll('[data-rec]')).map((inp) => {
          const item = (o.itens || []).find((x) => x.id === inp.dataset.rec) || {};
          return { itemId: inp.dataset.rec, descricao: item.descricao, unid: item.unid, qtd: numeroBR(inp.value) };
        }).filter((x) => x.qtd > 0);
        if (!recebidos.length) { toast('Escreva o que chegou', 'ruim'); return; }

        // Chegou mais do que foi pedido? Pode ser erro de digitação — confirma.
        const excesso = recebidos.filter((r) => {
          const item = (o.itens || []).find((x) => x.id === r.itemId) || {};
          return r.qtd + jaRecebido(o, r.itemId) > (Number(item.qtd) || 0) + 0.001;
        });
        if (excesso.length && !await confirmar(
          excesso.map((r) => r.descricao + ': ' + fmt.numero(r.qtd + jaRecebido(o, r.itemId)) + ' de ' +
            fmt.numero(((o.itens || []).find((x) => x.id === r.itemId) || {}).qtd)).join(' · ') +
          '. Chegou mais do que foi pedido. Confirma assim mesmo?', { titulo: 'Confere a quantidade', ok: 'Confirmar' })) return;

        if (enviandoFotos.tem) { toast('Espere as fotos terminarem de subir', 'ruim'); return; }

        const reg = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          em: new Date().toISOString(), por: d.por || S.quem,
          itens: recebidos, nf: d.nf, obs: d.obs, fotos: fotos.slice(),
          // Foto que não subiu fica anotada aqui para ser anexada depois.
          fotosPendentes: fotosPendentes.length
        };
        // RELÊ a ordem antes de gravar. Este modal fica minutos aberto esperando
        // foto subir no 4G da obra: gravar o retrato de quando ele abriu desfazia
        // a correção que o escritório fez no meio do caminho — e chegava a
        // ressuscitar uma compra cancelada.
        const base = achar('oc', o.id) || o;
        const recebimentos = [...(base.recebimentos || []), reg];
        // Completo quando todo item bateu a quantidade pedida.
        const completo = (base.itens || []).every((i) => {
          const total = recebimentos.reduce((s, r) => s + (((r.itens || []).find((x) => x.itemId === i.id) || {}).qtd || 0), 0);
          return total + 0.001 >= (Number(i.qtd) || 0);
        });
        const cancelada = base.situacao === 'cancelada';
        const n = Object.assign({}, base, {
          recebimentos,
          // Compra cancelada enquanto o modal estava aberto continua cancelada:
          // a entrega fica registrada, mas quem decide o rumo é o escritório.
          situacao: cancelada ? 'cancelada' : (completo ? 'entregue' : 'parcial'),
          nf: d.nf || base.nf,
          recebidoEm: (completo && !cancelada) ? new Date().toISOString() : base.recebidoEm
        });
        n.historico = historiar(base, (completo ? 'Recebimento completo' : 'Recebimento parcial') +
          ' — ' + recebidos.map((r) => r.descricao + ': ' + fmt.numero(r.qtd)).join(', ') + (d.obs ? ' (' + d.obs + ')' : '') +
          (fotosPendentes.length ? ' · ' + fotosPendentes.length + ' foto(s) ainda não subiram' : ''));
        salvar('oc', n);
        // Quem fecha a solicitação é o SERVIDOR (nucleo.mjs, ao juntar os
        // recebimentos dos dois aparelhos). Fazer isso aqui também era
        // redundante E era o que fazia o servidor recusar o pacote inteiro do
        // pessoal da obra, levando o recebimento junto.
        fecharEste(fundo); render();
        if (cancelada) toast('Atenção: esta compra foi CANCELADA no escritório. A entrega ficou registrada.', 'ruim');
        else if (fotosPendentes.length) toast('Recebimento salvo, mas ' + fotosPendentes.length +
          ' foto(s) não subiram — anexe quando a internet voltar', 'ruim');
        else toast(completo ? 'Recebimento completo registrado' : 'Recebimento parcial registrado', 'bom');
      } }
    ]
  });

  // Fotos: sobem na hora, em partes, com barra de progresso.
  const campoFotos = document.getElementById('recFotos');
  const mini = document.getElementById('recMini');
  const prog = document.getElementById('recProg');
  campoFotos.addEventListener('change', async () => {
    for (const file of Array.from(campoFotos.files || [])) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.style.opacity = '.45';
      mini.appendChild(img);
      prog.style.display = '';
      enviandoFotos.qtd++;
      try {
        const menor = await encolherFoto(file);
        const meta = await enviarArquivo(menor, (p) => { prog.querySelector('i').style.width = (p * 100) + '%'; });
        fotos.push(meta.id);
        img.style.opacity = '1';
      } catch (e) {
        // Sem sinal a foto sumia da tela e o recebimento ia sem prova nenhuma.
        // Agora ela fica marcada e pode ser anexada depois, pela própria tela
        // de recebimento.
        fotosPendentes.push(file);
        img.style.opacity = '.35';
        img.style.outline = '2px solid var(--vermelho)';
        img.title = 'Não subiu — anexe de novo quando a internet voltar';
        toast('A foto não subiu (sem internet). Ela fica marcada para você anexar depois.', 'ruim');
      } finally {
        enviandoFotos.qtd--;
      }
    }
    prog.style.display = 'none';
    campoFotos.value = '';
  });
}

function anexarFotoRecebimento(ocId, recId) {
  const enviando = { qtd: 0 };
  const novas = [];
  abrirModal({
    titulo: 'Anexar foto ao recebimento',
    corpo: '<p class="legenda">Use quando a foto não subiu na obra por falta de sinal. ' +
      'Ela entra neste mesmo recebimento — não precisa lançar a entrega de novo.</p>' +
      '<div class="campo"><label>Foto da nota ou da carga</label>' +
      '<input type="file" id="anexFoto" accept="image/*" multiple></div>' +
      '<div class="progresso" id="anexProg" style="display:none"><i></i></div>' +
      '<div class="miniaturas" id="anexMini"></div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar', classe: 'primario', aoClicar: (fundo) => {
        if (enviando.qtd) { toast('Espere a foto terminar de subir', 'ruim'); return; }
        if (!novas.length) { toast('Escolha pelo menos uma foto', 'ruim'); return; }
        const base = achar('oc', ocId);
        if (!base) { toast('Ordem não encontrada', 'ruim'); return; }
        const recebimentos = (base.recebimentos || []).map((r) => {
          if (r.id !== recId) return r;
          const faltavam = Number(r.fotosPendentes) || 0;
          return Object.assign({}, r, {
            fotos: [...(r.fotos || []), ...novas],
            fotosPendentes: Math.max(0, faltavam - novas.length)
          });
        });
        const n = Object.assign({}, base, { recebimentos });
        n.historico = historiar(base, novas.length + ' foto(s) anexada(s) ao recebimento');
        salvar('oc', n);
        fecharEste(fundo); render();
        toast('Foto anexada', 'bom');
      } }
    ]
  });
  const campo = document.getElementById('anexFoto');
  const mini = document.getElementById('anexMini');
  const prog = document.getElementById('anexProg');
  campo.addEventListener('change', async () => {
    for (const file of Array.from(campo.files || [])) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.style.opacity = '.45';
      mini.appendChild(img);
      prog.style.display = '';
      enviando.qtd++;
      try {
        const menor = await encolherFoto(file);
        const meta = await enviarArquivo(menor, (p) => { prog.querySelector('i').style.width = (p * 100) + '%'; });
        novas.push(meta.id);
        img.style.opacity = '1';
      } catch (e) {
        img.remove();
        toast('Ainda sem internet para subir a foto: ' + e.message, 'ruim');
      } finally { enviando.qtd--; }
    }
    prog.style.display = 'none';
    campo.value = '';
  });
}

// Foto de celular vem com 5MB; 1600px de largura já dá pra ler nota fiscal.
function encolherFoto(file, maxLado = 1600, qualidade = 0.82) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return resolve(file);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * escala);
      c.height = Math.round(img.height * escala);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => {
        URL.revokeObjectURL(img.src);
        if (!b) return reject(new Error('falha ao processar'));
        b.name = (file.name || 'foto').replace(/\.\w+$/, '') + '.jpg';
        resolve(new File([b], b.name, { type: 'image/jpeg' }));
      }, 'image/jpeg', qualidade);
    };
    img.onerror = () => reject(new Error('imagem inválida'));
    img.src = URL.createObjectURL(file);
  });
}
/* ══════════════════════════════════════════════════════════════════════════
   FORNECEDORES
   ══════════════════════════════════════════════════════════════════════════ */
/* A agenda da empresa numa tela só: quem vende MATERIAL (fornecedor) e quem
   vende MÃO DE OBRA (prestador). Eram duas abas idênticas no menu; o cadastro é
   a mesma coisa, muda o que se guarda de cada um. */
let _abaForn = 'mat';

TELAS.fornecedores = function (el, args) {
  if (args[0]) return fichaFornecedor(el, args[0]);

  const fs = fornecedoresAtivos();
  const ps = typeof prestadores === 'function' ? prestadores() : [];
  const pend = typeof prestadoresComPendencia === 'function' ? prestadoresComPendencia() : 0;

  cabecalho('Fornecedores e prestadores',
    fs.length + ' fornecedor(es) de material · ' + ps.length + ' prestador(es) de serviço',
    _abaForn === 'mat'
      ? '<button class="btn primario" id="novoForn">+ Novo fornecedor</button>'
      : '<button class="btn primario" id="novoPrest">+ Novo prestador</button>');

  el.innerHTML =
    '<div class="abas">' +
      '<button class="aba' + (_abaForn === 'mat' ? ' ativa' : '') + '" data-abaf="mat">🏢 Material (' + fs.length + ')</button>' +
      '<button class="aba' + (_abaForn === 'mo' ? ' ativa' : '') + '" data-abaf="mo">👷 Mão de obra (' + ps.length + ')' +
        (pend ? ' <span class="bolha">' + pend + '</span>' : '') + '</button>' +
    '</div>' +
    (_abaForn === 'mat' ? htmlFornecedores(fs) : htmlPrestadores());

  el.querySelectorAll('[data-abaf]').forEach((b) => b.addEventListener('click', () => {
    _abaForn = b.dataset.abaf;
    render();
  }));

  if (_abaForn === 'mo') {
    document.getElementById('novoPrest').addEventListener('click', () => editarPrestador(null));
    ligarPrestadores(el);
    return;
  }

  document.getElementById('novoForn').addEventListener('click', () => editarFornecedor(null));
  el.querySelectorAll('tr[data-ficha]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;   // Zap e Editar continuam valendo
    irPara('fornecedores/' + tr.dataset.ficha);
  }));
  el.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => editarFornecedor(b.dataset.editar)));
  el.querySelectorAll('[data-zap]').forEach((b) => b.addEventListener('click', () => {
    const f = achar('forn', b.dataset.zap);
    if (!f) { toast('Este fornecedor não existe mais — atualize a tela', 'ruim'); return; }
    window.open(linkWhats(f.telefone, 'Olá ' + (f.contato || '') + ', aqui é da ' +
      ((S.cfg.empresa || {}).nomeCurto || 'Domo Construtora') + '.'), '_blank');
  }));
};

function htmlFornecedores(todos) {
  // Melhor nota em cima: a lista vira a ordem de quem chamar primeiro.
  const comNota = todos.map((f) => Object.assign({ f }, notaFornecedor(f)))
    .sort((a, b) => (b.nota == null ? -1 : b.nota) - (a.nota == null ? -1 : a.nota) ||
      String(a.f.nome || '').localeCompare(String(b.f.nome || '')));
  const bons = comNota.filter((x) => x.nota != null && x.nota >= 8.5).length;
  const ruins = comNota.filter((x) => x.nota != null && x.nota < 5).length;

  return (comNota.some((x) => x.nota != null)
    ? '<div class="aviso info"><b>' + bons + ' preferencial(is)</b> e <b>' + ruins + ' para evitar</b>. ' +
      'A nota é 60% do que o sistema mediu (prazo de entrega, entrega completa, resposta a cotação) ' +
      'e 40% das estrelas que a equipe deu. Clique no fornecedor para ver de onde saiu cada ponto.</div>'
    : '<div class="aviso info">A nota aparece sozinha conforme as compras acontecem — ' +
      'e melhora quando a equipe avalia cada entrega.</div>') +
    '<div class="cartao">' +
    (comNota.length ?
      '<div class="tabela-rolagem"><table><thead><tr><th>Nome</th><th>Nota</th><th>Contato</th>' +
      '<th>Fornece</th><th class="num">Compras</th><th>No prazo</th><th></th></tr></thead><tbody>' +
      comNota.map(({ f, nota, desempenho, estrelas, provisorio }) =>
        '<tr class="clicavel" data-ficha="' + esc(f.id) + '"><td><b>' + esc(f.nome) + '</b>' +
          '<div style="font-size:.8rem;color:var(--texto-fraco)">' + esc(fmt.cnpj(f.cnpj)) + '</div></td>' +
          '<td>' + selo(nota, { provisorio }) +
            (estrelas != null ? '<div style="font-size:.8rem;color:var(--dourado)">' + estrelasDe(estrelas) + '</div>' : '') + '</td>' +
          '<td>' + esc(f.contato || '') + '<div style="font-size:.8rem;color:var(--texto-fraco)">' + esc(fmt.telefone(f.telefone)) + '</div></td>' +
          '<td>' + esc(f.categorias || '—') + '</td>' +
          '<td class="num">' + desempenho.compras +
            '<div style="font-size:.8rem;color:var(--texto-fraco)">' + fmt.brl(desempenho.totalComprado) + '</div></td>' +
          '<td>' + (desempenho.pontualidade == null ? '—'
            : fmt.numero(desempenho.pontualidade * 100, 0) + '%' +
              (desempenho.atrasoMedio ? '<div style="font-size:.78rem;color:var(--vermelho)">+' +
                fmt.numero(desempenho.atrasoMedio, 1) + 'd</div>' : '')) + '</td>' +
          '<td class="num">' + (f.telefone ? '<button class="btn pequeno zap" data-zap="' + esc(f.id) + '">Zap</button> ' : '') +
          '<button class="btn pequeno" data-editar="' + esc(f.id) + '">Editar</button></td></tr>').join('') +
      '</tbody></table></div>'
      : vazio('🏢', 'Nenhum fornecedor', 'Eles também entram sozinhos quando você cria uma ordem de compra.')) +
    '</div>';
}

function editarFornecedor(id) {
  const f = id ? achar('forn', id) : {};
  abrirModal({
    titulo: id ? 'Editar fornecedor' : 'Novo fornecedor',
    largo: true,
    corpo: '<div id="fForn">' +
      '<div class="linha">' +
        campo('Nome / razão social', entrada('nome', f.nome)) +
        campo('CNPJ', entrada('cnpj', f.cnpj, { inputmode: 'numeric' })) +
        campo('Inscrição estadual', entrada('ie', f.ie)) +
      '</div>' +
      '<div class="linha">' +
        campo('Contato', entrada('contato', f.contato)) +
        campo('WhatsApp', entrada('telefone', f.telefone, { tipo: 'tel' })) +
        campo('E-mail', entrada('email', f.email, { tipo: 'email' })) +
      '</div>' +
      '<div class="linha">' +
        campo('Endereço', entrada('endereco', f.endereco)) +
        campo('O que fornece', entrada('categorias', f.categorias, { placeholder: 'Ex.: cimento, areia, brita' })) +
      '</div>' +
      '<div class="linha">' +
        campo('Dados bancários', entrada('banco', f.banco)) +
        campo('Condição de pagamento habitual', entrada('condicao', f.condicao)) +
      '</div>' +
      campo('Observações', areaTexto('obs', f.obs)) +
    '</div>',
    acoes: [
      (id ? { texto: 'Apagar', classe: 'perigo', aoClicar: async () => {
        if (await confirmar('Apagar este fornecedor?', { perigo: true, ok: 'Apagar' })) {
          try { await api('apagar', { colecao: 'forn', id }); } catch (e) { toast('Não consegui apagar: ' + e.message, 'ruim'); return; }
          await puxar(); fecharModal(); render();
        }
      } } : null),
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar', classe: 'primario', aoClicar: (fundo) => {
        const d = lerCampos(fundo.querySelector('#fForn'));
        if (!d.nome.trim()) { toast('Informe o nome', 'ruim'); return; }
        salvar('forn', Object.assign({}, f, d));
        fecharEste(fundo); render(); toast('Fornecedor salvo', 'bom');
      } }
    ].filter(Boolean)
  });
}
