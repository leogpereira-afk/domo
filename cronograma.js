/* Cronograma da obra — as etapas com data e quem é o responsável por cada uma
   (quem entrega o ferro, quem concreta, quem levanta a alvenaria).

   O ponto do módulo: cada responsável recebe UM link e, ali, confirma data por
   data se consegue atender. Cronograma que ninguém confirmou é só desejo. */

const cronogramas = () => lista('crono');

const etapasVivas = (c) => ((c && c.etapas) || []).filter((e) => e && !e.apagadoEm);
const responsaveisVivos = (c) => ((c && c.responsaveis) || []).filter((r) => r && !r.apagadoEm);

// Situação da etapa do ponto de vista do gestor.
function situacaoEtapa(e) {
  if (e.concluidaEm) return { cls: 'et-entregue', txt: 'Concluída', ordem: 4 };
  const r = e.resposta;
  if (r && r.atende === false) return { cls: 'et-recusada', txt: 'Não atende', ordem: 0 };
  if (r && r.atende === true) return { cls: 'et-entregue', txt: 'Confirmada', ordem: 3 };
  const d = e.inicio ? diasAte(e.inicio) : null;
  if (d != null && d < 0) return { cls: 'et-vencido', txt: 'Sem resposta e já passou', ordem: 1 };
  if (d != null && d <= 7) return { cls: 'et-vencendo', txt: 'Sem resposta — chega perto', ordem: 2 };
  return { cls: '', txt: 'Aguardando confirmação', ordem: 5 };
}

const linkPrazos = (c, r) =>
  location.origin + location.pathname + '#/prazo/' + c.id + '/' + (r.token || '');

// Quantas etapas de cada responsável ainda não voltaram, e quantas ele recusou.
function resumoResponsavel(c, r) {
  const minhas = etapasVivas(c).filter((e) => e.responsavelId === r.id);
  return {
    total: minhas.length,
    confirmadas: minhas.filter((e) => e.resposta && e.resposta.atende === true).length,
    recusadas: minhas.filter((e) => e.resposta && e.resposta.atende === false).length,
    semResposta: minhas.filter((e) => !e.resposta).length
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   LISTA — a MESMA coisa vista de dois ângulos, numa aba só:
     · Por fornecedor  → o que você manda pra ele acompanhar (entrada do dia a dia)
     · Por obra        → a linha do tempo inteira, com todos os fornecedores juntos
   Cronograma e acompanhamento sempre foram o mesmo dado; separar em duas abas
   só obrigava a cadastrar a mesma data duas vezes.
   ══════════════════════════════════════════════════════════════════════════ */
let _abaCrono = 'forn';

TELAS.cronogramas = function (el, args) {
  if (args[0] && args[1]) return telaAcompanhaFornecedor(el, args[0], args[1]);
  if (args[0]) return telaCronograma(el, args[0]);

  const porForn = paraAcompanhar();
  const cs = cronogramas();
  const ativos = cs.filter((c) => c.situacao === 'ativo');
  const comProblema = porForn.filter((a) => a.peso <= 1).length;

  cabecalho('Cronograma e entregas',
    porForn.filter((a) => a.tipo === 'entrega').length + ' entrega(s) de material · ' +
    porForn.filter((a) => a.tipo === 'servico').length + ' serviço(s) em andamento',
    '<button class="btn primario" id="novoAcomp">+ Acompanhar fornecedor</button>' +
    (_abaCrono === 'obra' ? '<button class="btn" id="novoCrono">+ Cronograma da obra</button>' : ''));

  el.innerHTML =
    '<div class="abas">' +
      '<button class="aba' + (_abaCrono === 'forn' ? ' ativa' : '') + '" data-aba="forn">🤝 Por fornecedor</button>' +
      '<button class="aba' + (_abaCrono === 'obra' ? ' ativa' : '') + '" data-aba="obra">📅 Linha do tempo da obra</button>' +
    '</div>' +
    (_abaCrono === 'forn' ? htmlPorFornecedor(porForn, comProblema) : htmlPorObra(cs));

  el.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => {
    _abaCrono = b.dataset.aba;
    render();
  }));
  document.getElementById('novoAcomp').addEventListener('click', novoAcompanhamento);
  const bc = document.getElementById('novoCrono');
  if (bc) bc.addEventListener('click', novoCronograma);

  if (_abaCrono === 'forn') ligarBotoesFornecedor(el);
  else el.querySelectorAll('tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => irPara('cronogramas/' + tr.dataset.id)));
};

/* ── Aba "Por obra": a linha do tempo com todo mundo junto ─────────────────── */
function htmlPorObra(todos) {
  return '<div class="aviso info">A obra inteira numa linha só: todas as etapas, de todos os fornecedores, ' +
    'com o aviso de quando a compra que abastece a etapa está atrasada.</div>' +
    '<div class="cartao">' +
      (todos.length ?
        '<div class="tabela-rolagem"><table><thead><tr><th>Nº</th><th>Cronograma</th><th>Obra</th>' +
        '<th>Etapas</th><th>Fornecedores</th><th>Confirmação</th><th>Situação</th></tr></thead><tbody>' +
        todos.map((c) => {
          const es = etapasVivas(c);
          const conf = es.filter((e) => e.resposta && e.resposta.atende === true).length;
          const rec = es.filter((e) => e.resposta && e.resposta.atende === false).length;
          return '<tr class="clicavel" data-id="' + esc(c.id) + '">' +
            '<td><b>' + esc(c.codigo || '—') + '</b></td>' +
            '<td>' + esc(c.nome || 'Cronograma') + '</td>' +
            '<td>' + esc(c.obra || nomeObra(c.obraId)) + '</td>' +
            '<td>' + es.length + '</td>' +
            '<td>' + responsaveisVivos(c).length + '</td>' +
            '<td>' + conf + ' confirmada(s)' +
              (rec ? ' · <span style="color:var(--vermelho)">' + rec + ' recusada(s)</span>' : '') + '</td>' +
            '<td>' + etiqueta(c.situacao === 'ativo' ? 'andamento' : 'concluida') + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : vazio('📅', 'Nenhum cronograma',
            'Cadastre um fornecedor em "Por fornecedor" que o cronograma da obra nasce junto.')) +
    '</div>';
}

function novoCronograma() {
  abrirModal({
    titulo: 'Novo cronograma',
    corpo: '<div id="fCrono">' +
      '<div class="linha">' +
        campo('Obra', seletor('obraId', (obras()[0] || {}).id, obras().map((o) => ({ v: o.id, t: o.nome })))) +
        campo('Nome', entrada('nome', '', { placeholder: 'Ex.: Cronograma da estrutura' })) +
      '</div>' +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Criar', classe: 'primario', aoClicar: (fundo) => {
        const d = lerCampos(fundo.querySelector('#fCrono'));
        const reg = {
          obraId: d.obraId, obra: nomeObra(d.obraId),
          nome: d.nome.trim() || 'Cronograma da obra',
          responsaveis: [], etapas: [], situacao: 'ativo'
        };
        reg.historico = historiar(reg, 'Cronograma criado');
        const salvo = salvar('crono', reg);
        fecharEste(fundo);
        irPara('cronogramas/' + salvo.id);
      } }
    ]
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   DETALHE — a linha do tempo e as confirmações
   ══════════════════════════════════════════════════════════════════════════ */
function telaCronograma(el, id) {
  const c = achar('crono', id);
  if (!c) { cabecalho('Cronograma', ''); el.innerHTML = vazio('🤔', 'Não encontrado'); return; }

  const rs = responsaveisVivos(c);
  const es = etapasVivas(c).slice().sort((a, b) => String(a.inicio || '9999').localeCompare(String(b.inicio || '9999')));
  const recusadas = es.filter((e) => e.resposta && e.resposta.atende === false);
  const semResposta = es.filter((e) => !e.resposta);
  const ativo = c.situacao === 'ativo';
  const pronta = !!c.codigo;

  cabecalho(c.codigo || 'Cronograma (sincronizando…)', (c.nome || '') + ' · ' + (c.obra || nomeObra(c.obraId)),
    '<a class="btn" href="#/cronogramas">← Voltar</a>' +
    (ativo ? '<button class="btn" id="novoResp"' + (pronta ? '' : ' disabled') + '>+ Responsável</button>' +
      '<button class="btn primario" id="novaEtapa">+ Etapa</button>' : ''));

  el.innerHTML =
    (function () {
      const comAtraso = es.filter((e) => {
        if (!e.vinculoId || e.concluidaEm) return false;
        const [tipo, vid] = String(e.vinculoId).split(':');
        const doc = achar(tipo, vid);
        return tipo === 'oc' && doc && doc.entregaPrevista && diasAte(doc.entregaPrevista) < 0 &&
          !['entregue', 'cancelada'].includes(doc.situacao);
      });
      // Avisar DEPOIS que a compra atrasou não serve para nada: quando o
      // engenheiro lê, a obra já parou. O aviso que resolve é o de antes —
      // "a concretagem é dia 7 e o cimento ainda não foi nem comprado".
      const semCompra = es.filter((e) => {
        if (e.concluidaEm || !e.inicio) return false;
        const d = diasAte(e.inicio);
        if (d == null || d < 0 || d > 15) return false;
        if (!e.vinculoId) return true;              // nem vínculo tem
        const [tipo, vid] = String(e.vinculoId).split(':');
        const doc = achar(tipo, vid);
        // Ordem ainda em rascunho ou cancelada não abastece obra nenhuma.
        return !doc || ['rascunho', 'cancelada'].includes(doc.situacao);
      });
      return (semCompra.length
        ? '<div class="aviso atencao"><b>' + semCompra.length + ' etapa(s) começam em menos de 15 dias ' +
          'e o material ainda não foi comprado:</b> ' +
          esc(semCompra.map((e) => e.nome + (e.inicio ? ' (' + fmt.data(e.inicio) + ')' : '')).join(' · ')) +
          '. Dá tempo de resolver agora.</div>'
        : '') +
      (comAtraso.length
        ? '<div class="aviso ruim"><b>' + comAtraso.length + ' etapa(s) dependem de compra atrasada:</b> ' +
          esc(comAtraso.map((e) => e.nome).join(' · ')) + '. A data do cronograma está em risco.</div>'
        : '');
    })() +
    (function () {
      const sug = es.filter((e) => e.pendenteAprovacao);
      return sug.length
        ? '<div class="aviso atencao"><b>' + sug.length + ' sugestão(ões) de fornecedor esperando você:</b> ' +
          esc(sug.map((e) => e.nome).join(' · ')) + '. Aprove para entrar no cronograma.</div>'
        : '';
    })() +
    (recusadas.length
      ? '<div class="aviso ruim"><b>' + recusadas.length + ' etapa(s) o fornecedor disse que NÃO atende.</b> ' +
        'Isso é problema de cronograma antes de virar obra parada — resolva agora.</div>'
      : '') +
    (!rs.length
      ? '<div class="aviso atencao">Cadastre primeiro os responsáveis (quem fornece o ferro, quem concreta…). ' +
        'Depois lance as etapas de cada um e mande o link.</div>'
      : '') +

    '<div class="cartao">' +
      '<h3>📅 Etapas</h3>' +
      (es.length ?
        '<div class="tabela-rolagem"><table><thead><tr><th>Etapa</th><th>Responsável</th>' +
        '<th>Início</th><th>Fim</th><th>Confirmação</th><th></th></tr></thead><tbody>' +
        es.map((e) => {
          const s = situacaoEtapa(e);
          const r = rs.find((x) => x.id === e.responsavelId);
          const resp = e.resposta;
          return '<tr>' +
            '<td><b>' + esc(e.nome) + '</b>' +
              (e.pendenteAprovacao
                ? ' <span class="etiqueta et-vencendo">sugerida por ' + esc(e.sugeridaPor || 'fornecedor') + '</span>' : '') +
              (e.qtd ? '<div style="font-size:.8rem;color:var(--texto-fraco)">' +
                fmt.numero(e.qtd) + ' ' + esc(e.unid || '') + '</div>' : '') +
              (e.obs ? '<div style="font-size:.8rem;color:var(--texto-fraco)">' + esc(e.obs) + '</div>' : '') +
              ((e.remessas || []).length
                ? '<div style="font-size:.78rem;color:var(--azul);margin-top:3px">📅 ' +
                  esc(e.remessas.map((x) => (x.data ? fmt.data(x.data) : '?') +
                    (x.qtd ? ' (' + fmt.numero(x.qtd) + ')' : '')).join(' · ')) + '</div>' : '') +
              ((e.entregas || []).length
                ? '<div style="font-size:.78rem;color:var(--verde);margin-top:3px">🚚 ' +
                  esc(e.entregas.map((x) => (x.data ? fmt.data(x.data) : '') +
                    (x.qtd ? ' ' + fmt.numero(x.qtd) : '') + (x.nf ? ' NF ' + x.nf : '')).join(' · ')) +
                  ' <i>(informado pelo fornecedor)</i></div>' : '') + '</td>' +
            '<td>' + esc(r ? r.nome : '—') +
              (function () {
                if (!e.vinculoId) return '';
                const [tipo, vid] = String(e.vinculoId).split(':');
                const doc = achar(tipo, vid);
                if (!doc) return '<div style="font-size:.78rem;color:var(--texto-fraco)">vínculo não encontrado</div>';
                const atras = tipo === 'oc' && doc.entregaPrevista && diasAte(doc.entregaPrevista) < 0 &&
                  !['entregue', 'cancelada'].includes(doc.situacao);
                return '<div style="font-size:.78rem;' + (atras ? 'color:var(--vermelho);font-weight:600' : 'color:var(--texto-fraco)') + '">' +
                  (tipo === 'oc' ? '🧾 ' : '🛠️ ') + esc(doc.codigo || '') +
                  (atras ? ' atrasada ' + (-diasAte(doc.entregaPrevista)) + 'd' : ' · ' + esc((SITUACOES[doc.situacao] || {}).txt || '')) +
                  '</div>';
              })() + '</td>' +
            '<td>' + (e.inicio ? fmt.data(e.inicio) : '—') + '</td>' +
            '<td>' + (e.fim ? fmt.data(e.fim) : '—') + '</td>' +
            '<td><span class="etiqueta ' + s.cls + '">' + esc(s.txt) + '</span>' +
              (resp && resp.atende === false
                ? '<div style="font-size:.8rem;color:var(--vermelho)">' +
                  (resp.novaData ? 'propôs ' + fmt.data(resp.novaData) + ' — ' : '') + esc(resp.justificativa || '') + '</div>'
                : resp ? '<div style="font-size:.8rem;color:var(--texto-fraco)">' + fmt.quando(resp.em) + '</div>' : '') +
            '</td>' +
            '<td class="num">' + (!ativo ? '' : e.pendenteAprovacao
              ? '<button class="btn pequeno primario" data-aprovar="' + esc(e.id) + '">Aprovar</button> ' +
                '<button class="btn pequeno perigo" data-recusar="' + esc(e.id) + '">Recusar</button>'
              : '<button class="btn pequeno" data-etapa="' + esc(e.id) + '">Editar</button>' +
                (e.concluidaEm ? '' : ' <button class="btn pequeno verde" data-concluir="' + esc(e.id) + '">Concluir</button>')
            ) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<p class="legenda">Nenhuma etapa lançada.</p>') +
    '</div>' +

    '<div class="grade g2"><div>' +
      '<div class="cartao"><h3>👷 Responsáveis</h3>' +
        (rs.length ? rs.map((r) => {
          const q = resumoResponsavel(c, r);
          return '<div class="arquivo-solto"><span class="ic">' +
            (q.recusadas ? '⛔' : q.semResposta ? '⏳' : '✅') + '</span>' +
            '<div style="flex:1;min-width:0"><div class="nome">' + esc(r.nome) + '</div>' +
            '<div class="meta">' + q.total + ' etapa(s) · ' + q.confirmadas + ' confirmada(s)' +
              (q.recusadas ? ' · <span style="color:var(--vermelho)">' + q.recusadas + ' recusada(s)</span>' : '') +
              (q.semResposta ? ' · ' + q.semResposta + ' sem resposta' : '') + '</div></div>' +
            '<div class="acoes">' +
              (r.telefone ? '<button class="btn pequeno zap" data-zapr="' + esc(r.id) + '">Mandar datas</button>' : '') +
              '<button class="btn pequeno" data-linkr="' + esc(r.id) + '">Link</button>' +
              '<a class="btn pequeno primario" href="#/cronogramas/' + esc(c.id) + '/' + esc(r.id) + '">Abrir</a>' +
            '</div></div>';
        }).join('') : '<p class="legenda">Nenhum responsável cadastrado.</p>') +
      '</div>' +
    '</div><div>' +
      '<div class="cartao"><h3>Resumo</h3><p>' +
        '<b>Etapas:</b> ' + es.length + '<br>' +
        '<b>Confirmadas:</b> ' + es.filter((e) => e.resposta && e.resposta.atende === true).length + '<br>' +
        '<b>Recusadas:</b> ' + recusadas.length + '<br>' +
        '<b>Sem resposta:</b> ' + semResposta.length +
      '</p></div>' +
      '<div class="cartao"><h3>Histórico</h3>' + linhaTempo(c.historico) + '</div>' +
      (ativo ? '<div class="cartao"><button class="btn" id="encerrarCrono" style="width:100%">Encerrar cronograma</button></div>' : '') +
    '</div></div>';

  const br = document.getElementById('novoResp');
  if (br) br.addEventListener('click', () => editarResponsavel(c, null));
  const be = document.getElementById('novaEtapa');
  if (be) be.addEventListener('click', () => {
    if (!responsaveisVivos(achar('crono', c.id) || c).length) {
      toast('Cadastre primeiro quem é o responsável', 'ruim');
      return;
    }
    editarEtapa(c, null);
  });

  el.querySelectorAll('[data-etapa]').forEach((b) => b.addEventListener('click', () => editarEtapa(c, b.dataset.etapa)));
  el.querySelectorAll('[data-concluir]').forEach((b) => b.addEventListener('click', () => concluirEtapa(c, b.dataset.concluir)));
  el.querySelectorAll('[data-aprovar]').forEach((b) => b.addEventListener('click', () => decidirSugestao(c, b.dataset.aprovar, true)));
  el.querySelectorAll('[data-recusar]').forEach((b) => b.addEventListener('click', () => decidirSugestao(c, b.dataset.recusar, false)));
  el.querySelectorAll('[data-zapr]').forEach((b) => b.addEventListener('click', () => mandarDatasWhats(c, b.dataset.zapr)));
  el.querySelectorAll('[data-linkr]').forEach((b) => b.addEventListener('click', () => {
    const atual = achar('crono', c.id) || c;
    const r = responsaveisVivos(atual).find((x) => x.id === b.dataset.linkr);
    if (!r) return;
    const url = linkPrazos(atual, r);
    abrirModal({
      titulo: 'Link de ' + r.nome,
      corpo: '<p class="legenda">Ele vê só as etapas dele e confirma data por data.</p>' +
        '<div class="campo"><input type="text" id="linkPr" value="' + esc(url) + '" readonly></div>',
      acoes: [
        { texto: 'Copiar', classe: 'primario', aoClicar: () => {
          if (!navigator.clipboard) { const i = document.getElementById('linkPr'); if (i) i.select(); toast('Selecione e copie', 'ruim'); return; }
          navigator.clipboard.writeText(url).then(() => toast('Link copiado', 'bom')).catch(() => toast('Não consegui copiar', 'ruim'));
        } },
        { texto: 'Fechar', aoClicar: () => fecharModal() }
      ]
    });
  }));

  const bx = document.getElementById('encerrarCrono');
  if (bx) bx.addEventListener('click', async () => {
    if (!await confirmar('Encerrar este cronograma? Os responsáveis param de poder responder.', { ok: 'Encerrar' })) return;
    const atual = achar('crono', c.id) || c;
    const n = Object.assign({}, atual, { situacao: 'encerrado' });
    n.historico = historiar(atual, 'Cronograma encerrado');
    salvar('crono', n);
    render();
  });
}

/* ── Responsável ───────────────────────────────────────────────────────────── */
function editarResponsavel(c, rid) {
  const atual = achar('crono', c.id) || c;
  const r = rid ? (atual.responsaveis || []).find((x) => x.id === rid) || {} : {};
  const cadastrados = [...fornecedoresAtivos(), ...(typeof prestadores === 'function' ? prestadores() : [])];

  abrirModal({
    titulo: rid ? 'Editar responsável' : 'Quem é o responsável',
    corpo: '<div id="fResp">' +
      campo('Puxar de um cadastro', '<select id="selResp"><option value="">— digitar abaixo —</option>' +
        cadastrados.map((x) => '<option value="' + esc(x.id) + '">' + esc(x.nome) + '</option>').join('') + '</select>') +
      '<div class="linha">' +
        campo('Nome', entrada('nome', r.nome)) +
        campo('WhatsApp', entrada('telefone', r.telefone, { tipo: 'tel' })) +
      '</div>' +
      campo('Contato', entrada('contato', r.contato)) +
      campo('O que ele fornece / faz', entrada('escopo', r.escopo, { placeholder: 'Ex.: aço CA-50 e telas' })) +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar', classe: 'primario', aoClicar: (fundo) => {
        const d = lerCampos(fundo.querySelector('#fResp'));
        if (!d.nome.trim()) { toast('Informe o nome', 'ruim'); return; }
        const base = achar('crono', c.id) || c;
        const sel = fundo.querySelector('#selResp').value;
        const novo = Object.assign({}, r, d, {
          id: rid || (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
          origemId: r.origemId || sel || ''
        });
        // Quem é cadastrado aqui também entra na agenda da empresa, senão o
        // mesmo telefone é digitado de novo na próxima obra.
        if (!novo.origemId) {
          const ch = (x) => String(x || '').trim().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
          const ja = fornecedoresAtivos().find((x) => ch(x.nome) === ch(novo.nome));
          novo.origemId = ja ? ja.id
            : salvar('forn', { nome: novo.nome, telefone: novo.telefone, contato: novo.contato, categorias: novo.escopo }).id;
        }
        const responsaveis = rid
          ? (base.responsaveis || []).map((x) => x.id === rid ? novo : x)
          : [...(base.responsaveis || []), novo];
        const n = Object.assign({}, base, { responsaveis });
        n.historico = historiar(base, (rid ? 'Responsável atualizado: ' : 'Responsável incluído: ') + novo.nome);
        salvar('crono', n);
        fecharEste(fundo); render();
      } }
    ]
  });
  document.getElementById('selResp').addEventListener('change', (e) => {
    const x = achar('forn', e.target.value) || achar('prest', e.target.value);
    if (!x) return;
    const set = (n, v) => { const cpo = document.querySelector('[data-campo=' + n + ']'); if (cpo) cpo.value = v || ''; };
    set('nome', x.nome); set('telefone', x.telefone); set('contato', x.contato);
  });
}

/* ── Etapa ─────────────────────────────────────────────────────────────────── */
function editarEtapa(c, eid, respPadrao) {
  const atual = achar('crono', c.id) || c;
  const e = eid ? etapasVivas(atual).find((x) => x.id === eid) || {} : (respPadrao ? { responsavelId: respPadrao } : {});
  const rs = responsaveisVivos(atual);

  abrirModal({
    titulo: eid ? 'Editar etapa' : 'Nova etapa do cronograma',
    largo: true,
    corpo: '<div id="fEtapa">' +
      campo('Etapa', entrada('nome', e.nome, { placeholder: 'Ex.: Concretagem da laje do 6º pavimento' })) +
      '<div class="linha">' +
        campo('Responsável', seletor('responsavelId', e.responsavelId, rs.map((r) => ({ v: r.id, t: r.nome })))) +
        campo('Quantidade', entrada('qtd', e.qtd, { inputmode: 'decimal' })) +
        campo('Unidade', seletor('unid', e.unid || 'm³', unidades())) +
      '</div>' +
      '<div class="linha">' +
        campo('Data prevista (início)', entrada('inicio', e.inicio, { tipo: 'date' })) +
        campo('Data prevista (fim)', entrada('fim', e.fim, { tipo: 'date' })) +
      '</div>' +
      // Elo com a compra: é isso que faz o cronograma avisar "a concretagem é
      // dia 7 e o cimento dela está atrasado".
      campo('Depende de qual compra/serviço? (opcional)',
        seletor('vinculoId', e.vinculoId, [
          ...lista('oc').filter((x) => x.situacao !== 'cancelada')
            .map((x) => ({ v: 'oc:' + x.id, t: '🧾 ' + (x.codigo || '—') + ' · ' + ((x.fornecedor || {}).nome || '') })),
          ...lista('os').filter((x) => x.situacao !== 'cancelada')
            .map((x) => ({ v: 'os:' + x.id, t: '🛠️ ' + (x.codigo || '—') + ' · ' + ((x.empreiteiro || {}).nome || '') }))
        ], '— nenhum —'),
        'Assim o cronograma avisa quando a entrega que abastece a etapa atrasa.') +
      campo('Observação para o fornecedor', areaTexto('obs', e.obs,
        'Ex.: bomba lança precisa estar na obra 7h; concreto FCK 30 bombeável')) +
      (e.resposta
        ? '<div class="aviso ' + (e.resposta.atende ? 'bom' : 'ruim') + '">' +
          (e.resposta.atende ? 'Já confirmada pelo fornecedor. ' : 'O fornecedor disse que NÃO atende. ') +
          'Se você mudar a data, a resposta dele é apagada e ele precisa confirmar de novo.</div>'
        : '') +
    '</div>',
    acoes: [
      (eid ? { texto: 'Apagar', classe: 'perigo', aoClicar: async () => {
        if (!await confirmar('Apagar esta etapa?', { perigo: true, ok: 'Apagar' })) return;
        const base = achar('crono', c.id) || c;
        const etapas = (base.etapas || []).map((x) => x.id === eid
          ? Object.assign({}, x, { apagadoEm: new Date().toISOString(), apagadoPor: S.quem || '—' }) : x);
        const n = Object.assign({}, base, { etapas });
        n.historico = historiar(base, 'Etapa apagada: ' + (e.nome || ''));
        salvar('crono', n);
        fecharModal(); render();
      } } : null),
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar', classe: 'primario', aoClicar: (fundo) => {
        const d = lerCampos(fundo.querySelector('#fEtapa'));
        if (!d.nome.trim()) { toast('Dê um nome à etapa', 'ruim'); return; }
        if (!d.responsavelId) { toast('Escolha o responsável', 'ruim'); return; }
        if (d.inicio && d.fim && d.inicio > d.fim) { toast('A data de fim é antes do início', 'ruim'); return; }

        const base = achar('crono', c.id) || c;
        const mudouData = eid && (e.inicio !== d.inicio || e.fim !== d.fim);
        const novo = Object.assign({}, e, d, {
          id: eid || (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
          qtd: numeroBR(d.qtd)
        });
        // Data mudou = a confirmação anterior não vale mais.
        // Tem que ser `null`, não `delete`: o servidor agora JUNTA as etapas
        // item a item (para não apagar o que o fornecedor respondeu pelo link),
        // e uma chave ausente é entendida como "não mexi nela" — a resposta
        // velha voltaria e a data nova apareceria como já confirmada.
        if (mudouData && novo.resposta) novo.resposta = null;

        const etapas = eid
          ? (base.etapas || []).map((x) => x.id === eid ? novo : x)
          : [...(base.etapas || []), novo];
        const n = Object.assign({}, base, { etapas });
        const quem = (responsaveisVivos(base).find((r) => r.id === d.responsavelId) || {}).nome || '';
        n.historico = historiar(base, (eid ? 'Etapa alterada: ' : 'Etapa lançada: ') + novo.nome +
          (novo.inicio ? ' (' + fmt.data(novo.inicio) + ')' : '') + ' — ' + quem +
          (mudouData ? ' · data mudou, confirmação zerada' : ''));
        salvar('crono', n);
        fecharEste(fundo); render();
      } }
    ].filter(Boolean)
  });
}

// Sugestão do fornecedor só entra no cronograma se o engenheiro aprovar —
// quem manda na data da obra é a obra.
async function decidirSugestao(c, eid, aprovar) {
  const base = achar('crono', c.id) || c;
  const e = etapasVivas(base).find((x) => x.id === eid);
  if (!e) return;
  let motivo = '';
  if (!aprovar) {
    motivo = await perguntar('Por que não vai entrar no cronograma?',
      { titulo: 'Recusar sugestão', multi: true, obrigatorio: true, ok: 'Recusar' });
    if (!motivo) return;
  }
  const etapas = (base.etapas || []).map((x) => {
    if (x.id !== eid) return x;
    const y = Object.assign({}, x);
    y.pendenteAprovacao = false;   // false, não delete: o servidor une por id
    if (aprovar) { y.aprovadaEm = new Date().toISOString(); y.aprovadaPor = S.quem || '—'; }
    else { y.apagadoEm = new Date().toISOString(); y.recusadaEm = new Date().toISOString(); y.motivoRecusa = motivo; }
    return y;
  });
  const n = Object.assign({}, base, { etapas });
  n.historico = historiar(base, (aprovar ? 'Sugestão aprovada: ' : 'Sugestão recusada: ') + e.nome +
    (motivo ? ' — ' + motivo : ''));
  salvar('crono', n);
  render();
  toast(aprovar ? 'Etapa entrou no cronograma' : 'Sugestão recusada', aprovar ? 'bom' : '');
}

function concluirEtapa(c, eid) {
  const base = achar('crono', c.id) || c;
  const e = etapasVivas(base).find((x) => x.id === eid);
  if (!e) return;
  const etapas = (base.etapas || []).map((x) => x.id === eid
    ? Object.assign({}, x, { concluidaEm: new Date().toISOString(), concluidaPor: S.quem || '—' }) : x);
  const n = Object.assign({}, base, { etapas });
  n.historico = historiar(base, 'Etapa concluída: ' + e.nome);
  salvar('crono', n);
  render();
}

/* ── Mandar as datas no WhatsApp ───────────────────────────────────────────── */
function mandarDatasWhats(c, rid) {
  const atual = achar('crono', c.id) || c;
  const r = responsaveisVivos(atual).find((x) => x.id === rid);
  if (!r) return;
  if (!r.token) { toast('Aguarde sincronizar para gerar o link', 'ruim'); return; }
  const minhas = etapasVivas(atual).filter((e) => e.responsavelId === r.id);
  if (!minhas.length) { toast('Este responsável ainda não tem etapa lançada', 'ruim'); return; }

  const linhas = [
    '*' + ((S.cfg.empresa || {}).nomeCurto || 'Domo Construtora') + '* — Cronograma da obra ' + (atual.obra || ''),
    '',
    'Estas são as datas que precisamos de você:',
    ...minhas.map((e) => '• ' + e.nome +
      (e.qtd ? ' (' + fmt.numero(e.qtd) + ' ' + (e.unid || '') + ')' : '') +
      ' — ' + (e.inicio ? fmt.data(e.inicio) : 'a definir') +
      (e.fim && e.fim !== e.inicio ? ' a ' + fmt.data(e.fim) : '')),
    '',
    'Confirme aqui se consegue atender cada uma (leva 1 minuto):',
    linkPrazos(atual, r)
  ];
  window.open(linkWhats(r.telefone, linhas.join('\n')), '_blank');
}

/* ══════════════════════════════════════════════════════════════════════════
   PÚBLICO — o fornecedor confirma as datas dele
   ══════════════════════════════════════════════════════════════════════════ */
async function telaPrazoPublico(args) {
  const [id, token] = args;
  molduraPublica('<div class="cartao"><p class="legenda">Abrindo o cronograma…</p></div>', '');

  let r;
  try {
    r = await api('verPrazos', { id, t: token }, { publico: true });
  } catch (e) {
    molduraPublica('<div class="cartao"><div class="aviso ruim">' + esc(e.message) + '</div></div>', '');
    return;
  }

  const recarregar = async () => {
    try { r = await api('verPrazos', { id, t: token }, { publico: true }); } catch { /* mantém o que tem */ }
    pintar();
  };

  const cartaoEtapa = (e) => {
    const resp = e.resposta;
    const remessas = e.remessas || [];
    const entregas = e.entregas || [];
    return '<div class="cartao">' +
      '<h3 style="margin-bottom:2px">' + esc(e.nome) +
        (e.pendenteAprovacao ? ' <span class="etiqueta et-vencendo">sugestão sua — esperando aprovação</span>' : '') +
        (e.concluida ? ' <span class="etiqueta et-entregue">concluída</span>' : '') + '</h3>' +
      '<p class="legenda">' +
        (e.qtd ? fmt.numero(e.qtd) + ' ' + esc(e.unid || '') + ' · ' : '') +
        (e.inicio ? '<b>' + fmt.data(e.inicio) + '</b>' : 'data a definir') +
        (e.fim && e.fim !== e.inicio ? ' a <b>' + fmt.data(e.fim) + '</b>' : '') +
      '</p>' +
      (e.obs ? '<p class="legenda">' + esc(e.obs) + '</p>' : '') +

      // 1. a confirmação
      (resp
        ? '<div class="aviso ' + (resp.atende ? 'bom' : 'ruim') + '">' +
          (resp.atende ? '✅ Você confirmou esta data.' :
            '⛔ Você informou que não consegue atender.' +
            (resp.novaData ? ' Data proposta: <b>' + fmt.data(resp.novaData) + '</b>.' : '') +
            (resp.justificativa ? '<br>' + esc(resp.justificativa) : '')) +
          (r.cronograma.encerrado ? '' :
            '<div style="margin-top:6px"><button class="btn pequeno" data-mudar="' + esc(e.id) + '">Mudar resposta</button></div>') +
          '</div>'
        : (r.cronograma.encerrado || e.pendenteAprovacao ? '' :
          '<div class="barra-acoes">' +
            '<button class="btn verde" data-sim="' + esc(e.id) + '">✓ Consigo atender</button>' +
            '<button class="btn perigo" data-nao="' + esc(e.id) + '">✕ Não consigo</button>' +
          '</div>')) +

      // 2. a programação de remessas
      (remessas.length
        ? '<h4 style="margin:12px 0 4px">Sua programação</h4>' +
          '<table><tbody>' + remessas.map((x) =>
            '<tr><td>' + (x.data ? fmt.data(x.data) : '—') + '</td>' +
            '<td class="num">' + (x.qtd ? fmt.numero(x.qtd) + ' ' + esc(e.unid || '') : '—') + '</td>' +
            '<td>' + esc(x.obs || '') + '</td></tr>').join('') + '</tbody></table>'
        : '') +

      // 3. o que ele já entregou
      (entregas.length
        ? '<h4 style="margin:12px 0 4px">Entregas informadas</h4>' +
          entregas.map((x) => '<div class="arquivo-solto"><span class="ic">🚚</span><div>' +
            '<div class="nome">' + (x.data ? fmt.data(x.data) : fmt.data(x.em)) +
              (x.qtd ? ' · ' + fmt.numero(x.qtd) + ' ' + esc(e.unid || '') : '') + '</div>' +
            '<div class="meta">' + (x.nf ? 'NF ' + esc(x.nf) : 'sem nota informada') +
              (x.obs ? ' · ' + esc(x.obs) : '') + '</div></div></div>').join('')
        : '') +

      (r.cronograma.encerrado || e.pendenteAprovacao ? '' :
        '<div class="barra-acoes" style="margin-top:10px">' +
          '<button class="btn pequeno" data-prog="' + esc(e.id) + '">📅 ' +
            (remessas.length ? 'Alterar programação' : 'Informar minha programação') + '</button>' +
          '<button class="btn pequeno" data-entreguei="' + esc(e.id) + '">🚚 Já entreguei</button>' +
        '</div>') +
    '</div>';
  };

  function pintar() {
    molduraPublica(
      '<div class="cartao">' +
        '<h2>' + esc(r.cronograma.nome || 'Cronograma') + '</h2>' +
        '<p class="legenda">' + esc(r.empresa.nome) + ' · obra ' + esc(r.cronograma.obra) + '</p>' +
        '<p>Olá, <b>' + esc(r.responsavel.nome) + '</b>. Estas são as datas que a obra precisa de você. ' +
        'Confirme cada uma, informe como pretende entregar e avise quando entregar.</p>' +
        (r.cronograma.encerrado ? '<div class="aviso atencao">Este cronograma foi encerrado.</div>' : '') +
      '</div>' +
      (r.etapas.length ? r.etapas.map(cartaoEtapa).join('')
        : '<div class="cartao">' + vazio('📅', 'Nenhuma etapa para você ainda') + '</div>') +
      (r.cronograma.encerrado ? '' :
        '<div class="cartao" style="text-align:center">' +
          '<p class="legenda">Precisa de alguma coisa da obra que não está aqui? ' +
          '(liberação de área, acesso para o caminhão, prazo antes da sua entrega)</p>' +
          '<button class="btn" id="sugerir">💡 Sugerir uma etapa</button>' +
        '</div>'),
      'Cronograma');

    document.querySelectorAll('[data-sim]').forEach((b) => b.addEventListener('click', () => responder(b.dataset.sim, true)));
    document.querySelectorAll('[data-nao]').forEach((b) => b.addEventListener('click', () => responder(b.dataset.nao, false)));
    document.querySelectorAll('[data-mudar]').forEach((b) => b.addEventListener('click', () => {
      const e = r.etapas.find((x) => x.id === b.dataset.mudar);
      if (e) { e.resposta = null; pintar(); }
    }));
    document.querySelectorAll('[data-prog]').forEach((b) => b.addEventListener('click', () => programar(b.dataset.prog)));
    document.querySelectorAll('[data-entreguei]').forEach((b) => b.addEventListener('click', () => relatar(b.dataset.entreguei)));
    const bs = document.getElementById('sugerir');
    if (bs) bs.addEventListener('click', sugerir);
  }

  // ── confirmar / recusar ─────────────────────────────────────────────────
  const responder = async (etapaId, atende) => {
    let novaData = '', justificativa = '';
    if (!atende) {
      const seguiu = await new Promise((resolve) => {
        abrirModal({
          titulo: 'Não consigo nesta data',
          corpo:
            '<p class="legenda">Isso ajuda a obra a se reorganizar a tempo. Quanto antes souberem, melhor.</p>' +
            '<div class="campo"><label>Que data você consegue?</label><input type="date" id="pNova"></div>' +
            '<div class="campo"><label>Por quê?</label><textarea id="pJust" placeholder="Ex.: fábrica só entrega o aço na semana seguinte"></textarea></div>',
          aoFechar: () => resolve(false),
          acoes: [
            { texto: 'Voltar', aoClicar: () => fecharModal() },
            { texto: 'Enviar', classe: 'perigo', aoClicar: (f) => {
              const j = f.querySelector('#pJust').value.trim();
              if (!j) { toast('Escreva o motivo', 'ruim'); return; }
              novaData = f.querySelector('#pNova').value;
              justificativa = j;
              fecharSilencioso(f); resolve(true);
            } }
          ]
        });
      });
      if (!seguiu) return;
    }
    try {
      await api('responderPrazo', { id, t: token, etapaId, atende, novaData, justificativa,
        por: r.responsavel.nome }, { publico: true });
      toast(atende ? 'Data confirmada. Obrigado!' : 'Resposta enviada — a obra já foi avisada.', atende ? 'bom' : '');
      await recarregar();
    } catch (err) { toast(err.message, 'ruim'); }
  };

  // ── programação de remessas ─────────────────────────────────────────────
  const programar = (etapaId) => {
    const e = r.etapas.find((x) => x.id === etapaId);
    if (!e) return;
    const linha = (x = {}) =>
      '<div class="item-linha desconto-linha" data-rem>' +
        '<div class="campo descricao"><label>Observação</label>' +
          '<input type="text" data-r="obs" value="' + esc(x.obs || '') + '" placeholder="Ex.: 1º caminhão, bitola 12,5"></div>' +
        '<div class="campo"><label>Data</label><input type="date" data-r="data" value="' + esc(x.data || '') + '"></div>' +
        '<div class="campo"><label>Quantidade</label><input type="text" inputmode="decimal" data-r="qtd" value="' +
          esc(x.qtd != null ? String(x.qtd).replace('.', ',') : '') + '"></div>' +
        '<button class="lixeira" data-tirar>✕</button>' +
      '</div>';
    const atuais = (e.remessas || []).length ? e.remessas : [{}, {}];

    abrirModal({
      titulo: 'Como você vai entregar',
      largo: true,
      corpo: '<p class="legenda">Se a entrega vem parcelada, diga quantos caminhões e em que dias. ' +
        'A obra se programa em cima disso.</p>' +
        '<div id="remessas">' + atuais.map(linha).join('') + '</div>' +
        '<button class="btn pequeno" id="maisRem">+ Remessa</button>',
      acoes: [
        { texto: 'Voltar', aoClicar: () => fecharModal() },
        { texto: 'Enviar programação', classe: 'primario', aoClicar: async (f) => {
          const remessas = Array.from(f.querySelectorAll('[data-rem]')).map((l) => ({
            data: l.querySelector('[data-r=data]').value,
            qtd: numeroBR(l.querySelector('[data-r=qtd]').value),
            obs: l.querySelector('[data-r=obs]').value.trim()
          })).filter((x) => x.data || x.qtd);
          if (!remessas.length) { toast('Informe pelo menos uma remessa', 'ruim'); return; }
          try {
            await api('responderPrazo', {
              id, t: token, etapaId,
              atende: e.resposta ? e.resposta.atende : true,
              novaData: (e.resposta && e.resposta.novaData) || '',
              justificativa: (e.resposta && e.resposta.justificativa) || '',
              por: r.responsavel.nome, remessas
            }, { publico: true });
            fecharSilencioso(f);
            toast('Programação enviada', 'bom');
            await recarregar();
          } catch (err) { toast(err.message, 'ruim'); }
        } }
      ]
    });
    const caixa = document.getElementById('remessas');
    const ligar = (l) => l.querySelector('[data-tirar]').addEventListener('click', () => {
      if (caixa.children.length > 1) l.remove();
    });
    Array.from(caixa.children).forEach(ligar);
    document.getElementById('maisRem').addEventListener('click', () => {
      caixa.insertAdjacentHTML('beforeend', linha());
      ligar(caixa.lastElementChild);
    });
  };

  // ── relatar entrega ─────────────────────────────────────────────────────
  const relatar = (etapaId) => {
    const e = r.etapas.find((x) => x.id === etapaId);
    if (!e) return;
    abrirModal({
      titulo: 'Informar entrega',
      corpo:
        '<p class="legenda">Isso aparece na hora para a obra e fica ao lado do que o almoxarifado conferir.</p>' +
        '<div class="linha">' +
          '<div class="campo"><label>Data da entrega</label><input type="date" id="eData" value="' + esc(hojeISO()) + '"></div>' +
          '<div class="campo"><label>Quantidade' + (e.unid ? ' (' + esc(e.unid) + ')' : '') + '</label>' +
            '<input type="text" id="eQtd" inputmode="decimal" value="' + esc(e.qtd != null ? String(e.qtd).replace('.', ',') : '') + '"></div>' +
        '</div>' +
        '<div class="campo"><label>Nota fiscal nº</label><input type="text" id="eNf"></div>' +
        '<div class="campo"><label>Observação</label><textarea id="eObs" placeholder="Ex.: entregue no portão às 8h, recebido pelo Chico"></textarea></div>',
      acoes: [
        { texto: 'Voltar', aoClicar: () => fecharModal() },
        { texto: 'Enviar', classe: 'verde', aoClicar: async (f) => {
          try {
            await api('relatarEntrega', {
              id, t: token, etapaId,
              data: f.querySelector('#eData').value,
              qtd: numeroBR(f.querySelector('#eQtd').value),
              nf: f.querySelector('#eNf').value,
              obs: f.querySelector('#eObs').value,
              por: r.responsavel.nome
            }, { publico: true });
            fecharSilencioso(f);
            toast('Entrega informada. Obrigado!', 'bom');
            await recarregar();
          } catch (err) { toast(err.message, 'ruim'); }
        } }
      ]
    });
  };

  // ── sugerir etapa ───────────────────────────────────────────────────────
  const sugerir = () => {
    abrirModal({
      titulo: 'Sugerir uma etapa',
      corpo:
        '<p class="legenda">Vai como sugestão: quem decide a data da obra é o engenheiro. ' +
        'Ele recebe e aprova ou não.</p>' +
        '<div class="campo"><label>O que precisa acontecer</label>' +
          '<input type="text" id="sNome" placeholder="Ex.: liberar a laje 2 dias antes para montar a bomba"></div>' +
        '<div class="linha">' +
          '<div class="campo"><label>De</label><input type="date" id="sIni"></div>' +
          '<div class="campo"><label>Até</label><input type="date" id="sFim"></div>' +
        '</div>' +
        '<div class="campo"><label>Por quê</label><textarea id="sObs"></textarea></div>',
      acoes: [
        { texto: 'Voltar', aoClicar: () => fecharModal() },
        { texto: 'Enviar sugestão', classe: 'primario', aoClicar: async (f) => {
          const nome = f.querySelector('#sNome').value.trim();
          if (!nome) { toast('Escreva o que precisa acontecer', 'ruim'); return; }
          try {
            await api('sugerirEtapa', {
              id, t: token, nome,
              inicio: f.querySelector('#sIni').value, fim: f.querySelector('#sFim').value,
              obs: f.querySelector('#sObs').value
            }, { publico: true });
            fecharSilencioso(f);
            toast('Sugestão enviada para a obra', 'bom');
            await recarregar();
          } catch (err) { toast(err.message, 'ruim'); }
        } }
      ]
    });
  };

  pintar();
}

/* ══════════════════════════════════════════════════════════════════════════
   ACOMPANHAMENTO DE FORNECEDOR
   Mesma engrenagem do cronograma, mas a entrada é pelo FORNECEDOR: você joga
   as datas dele, manda no WhatsApp e ele responde se entrega ou não.
   ══════════════════════════════════════════════════════════════════════════ */

// Junta, de todos os cronogramas, cada responsável com as etapas dele.
function acompanhamentos() {
  const saida = [];
  for (const c of cronogramas()) {
    if (c.situacao !== 'ativo') continue;
    for (const r of responsaveisVivos(c)) {
      const minhas = etapasVivas(c)
        .filter((e) => e.responsavelId === r.id)
        .sort((a, b) => String(a.inicio || '9999').localeCompare(String(b.inicio || '9999')));
      if (!minhas.length) continue;
      const recusadas = minhas.filter((e) => e.resposta && e.resposta.atende === false);
      const semResposta = minhas.filter((e) => !e.resposta && !e.pendenteAprovacao);
      const pendentes = minhas.filter((e) => !e.concluidaEm && !e.pendenteAprovacao);
      const proxima = pendentes.find((e) => e.inicio) || pendentes[0];
      saida.push({
        crono: c, resp: r, etapas: minhas, recusadas, semResposta, proxima,
        confirmadas: minhas.filter((e) => e.resposta && e.resposta.atende === true).length,
        concluidas: minhas.filter((e) => e.concluidaEm).length,
        // Ordem de urgência: recusa primeiro, depois quem não respondeu e a
        // data está chegando, depois o resto.
        peso: recusadas.length ? 0
          : (semResposta.length && proxima && proxima.inicio && diasAte(proxima.inicio) <= 7) ? 1
          : semResposta.length ? 2 : 3
      });
    }
  }
  return saida.sort((a, b) => a.peso - b.peso ||
    String((a.proxima || {}).inicio || '9999').localeCompare(String((b.proxima || {}).inicio || '9999')));
}

// O prestador de serviço também é fornecedor — só que entrega mão de obra em vez
// de material. A ordem de serviço vira um cartão de acompanhamento igual, com o
// avanço medido no lugar da data de entrega.
function acompanhamentosServico() {
  return lista('os')
    .filter((o) => !['concluida', 'cancelada', 'rascunho'].includes(o.situacao))
    .map((o) => {
      const t = totaisOS(o);
      const p = prestadorDaOS(o);
      const graves = p ? pendenciasPrestador(p).filter((x) => x.grave).length : 0;
      const d = o.dataTerminoPrevista ? diasAte(o.dataTerminoPrevista) : null;
      const aAprovar = medicoesValidas(o).filter((m) => m.situacao === 'rascunho').length;
      const aPagar = medicoesValidas(o).filter((m) => m.situacao === 'aprovada').length;
      return {
        tipo: 'servico', os: o, prest: p, dias: d, totais: t, graves, aAprovar, aPagar,
        nome: (o.empreiteiro || {}).nome || (p && p.nome) || '—',
        telefone: (o.empreiteiro || {}).telefone || (p && p.telefone) || '',
        escopo: o.escopo || o.localizacao || '',
        obra: o.obra || nomeObra(o.obraId),
        // Mesma régua da entrega: documento vencido ou prazo estourado é o que
        // para a obra; medição esperando decisão vem logo depois.
        peso: (graves || (d != null && d < 0)) ? 0
          : (aAprovar || aPagar) ? 1
          : (d != null && d <= 7) ? 2 : 3
      };
    })
    .sort((a, b) => a.peso - b.peso || (a.dias == null ? 9999 : a.dias) - (b.dias == null ? 9999 : b.dias));
}

// A lista da aba: entregas de material e serviços juntos, por urgência.
function paraAcompanhar() {
  const entregas = acompanhamentos().map((a) => Object.assign({ tipo: 'entrega' }, a));
  return [...entregas, ...acompanhamentosServico()].sort((a, b) => a.peso - b.peso);
}

// Rota antiga (#/acompanhamento) — os links já mandados continuam abrindo.
// replace, não irPara: empilhar no histórico deixava o botão "voltar" do
// navegador preso, indo e voltando entre o endereço velho e o novo.
TELAS.acompanhamento = function (el, args) {
  _abaCrono = 'forn';
  location.replace('#/cronogramas' + (args[0] ? '/' + args.join('/') : ''));
};

/* ── Aba "Por fornecedor": um cartão por quem entrega ──────────────────────── */
function htmlPorFornecedor(todos, comProblema) {
  return (comProblema
      ? '<div class="aviso ruim"><b>' + comProblema + ' precisam de você agora</b> — ' +
        'recusaram a data, não responderam com a entrega chegando, ou o serviço travou.</div>'
      : '<div class="aviso info">Material e mão de obra no mesmo lugar: jogue as datas do fornecedor, mande no WhatsApp ' +
        'e ele responde se entrega — e acompanhe o avanço de cada ordem de serviço.</div>') +

    (todos.length
      ? todos.map((a) => a.tipo === 'servico' ? cartaoServico(a) : cartaoEntrega(a)).join('')
      : '<div class="cartao">' + vazio('🤝', 'Nada em acompanhamento',
          'Comece pelo que mais atrasa obra: ferro, concreto, esquadria.') + '</div>');
}

/* Serviço (ordem de serviço) — o mesmo cartão, medido em % em vez de data. */
function cartaoServico(a) {
  const o = a.os;
  const cor = a.peso === 0 ? 'var(--vermelho)' : a.peso === 1 ? 'var(--ambar)' : 'var(--borda)';
  return '<div class="cartao" style="border-left:4px solid ' + cor + '">' +
    '<div class="barra-acoes" style="justify-content:space-between;align-items:flex-start">' +
      '<div>' +
        '<h3 style="margin:0">🛠️ ' + esc(a.nome) + '</h3>' +
        '<div class="legenda">' + esc(o.codigo || '') + (a.escopo ? ' · ' + esc(a.escopo) : '') +
          ' · ' + esc(a.obra) + '</div>' +
      '</div>' +
      '<div style="text-align:right">' +
        (a.graves ? '<span class="etiqueta et-vencido">' + a.graves + ' documento(s) vencido(s)</span>'
          : a.aAprovar ? '<span class="etiqueta et-vencendo">' + a.aAprovar + ' medição a aprovar</span>'
          : a.aPagar ? '<span class="etiqueta et-emitida">' + a.aPagar + ' medição a pagar</span>'
          : etiqueta(o.situacao)) +
      '</div>' +
    '</div>' +

    // Quem não abre Ordens de serviço também não vê o contrato aqui. A fusão
    // trouxe a O.S. para esta aba e, junto, o valor que a tela de serviços
    // esconde de propósito do pessoal do canteiro.
    (function () {
      const comDinheiro = typeof podeVer !== 'function' || podeVer('servicos');
      return '<div class="arquivo-solto" style="margin-top:8px">' +
      '<span class="ic">📐</span>' +
      '<div style="flex:1;min-width:0">' +
        '<div class="nome">Executado: ' + fmt.numero(a.totais.percFisico, 0) + '%' +
          (comDinheiro ? ' de ' + fmt.brl(a.totais.contrato) : '') + '</div>' +
        '<div class="progresso" style="margin-top:5px"><i style="width:' + Math.min(100, a.totais.percFisico) + '%"></i></div>' +
        (comDinheiro
          ? '<div class="meta" style="margin-top:4px">' + fmt.brl(a.totais.medido) + ' medido' +
            (a.totais.aPagar ? ' · <b>' + fmt.brl(a.totais.aPagar) + ' aprovado a pagar</b>' : '') + '</div>'
          : '') +
      '</div>' +
      '<div class="acoes">' + (a.dias == null ? ''
        : a.dias < 0 ? '<span class="etiqueta et-vencido">' + (-a.dias) + 'd de atraso</span>'
        : a.dias === 0 ? '<span class="etiqueta et-vencendo">termina hoje</span>'
        : '<span class="etiqueta">faltam ' + a.dias + 'd</span>') + '</div>' +
    '</div>';
    })() +

    (a.graves
      ? '<div class="aviso ruim" style="margin-top:8px">Documento vencido na pasta dele — a medição fica travada até resolver.</div>'
      : '') +

    '<div class="barra-acoes" style="margin-top:10px">' +
      (a.telefone ? '<button class="btn zap" data-zapos="' + esc(o.id) + '">Cobrar no WhatsApp</button>' : '') +
      ((a.prest && (typeof podeVer !== 'function' || podeVer('prestadores')))
        ? '<a class="btn" href="#/prestadores/' + esc(a.prest.id) + '">Pasta do prestador</a>' : '') +
      // Os dois botões abaixo caíam em "Sem acesso" — só sinalizavam o buraco.
      ((typeof podeVer !== 'function' || podeVer('servicos'))
        ? '<a class="btn primario" href="#/servicos/' + esc(o.id) + '">Abrir a O.S.</a>' : '') +
    '</div>' +
  '</div>';
}

/* Entrega de material (etapa de cronograma). */
function cartaoEntrega(a) {
          const d = a.proxima && a.proxima.inicio ? diasAte(a.proxima.inicio) : null;
          const cor = a.recusadas.length ? 'var(--vermelho)' : (d != null && d < 0) ? 'var(--vermelho)'
            : (d != null && d <= 7) ? 'var(--ambar)' : 'var(--borda)';
          return '<div class="cartao" style="border-left:4px solid ' + cor + '">' +
            '<div class="barra-acoes" style="justify-content:space-between;align-items:flex-start">' +
              '<div>' +
                '<h3 style="margin:0">🚚 ' + esc(a.resp.nome) + '</h3>' +
                '<div class="legenda">' + esc(a.resp.escopo || a.crono.nome || '') +
                  ' · ' + esc(a.crono.obra || nomeObra(a.crono.obraId)) + '</div>' +
              '</div>' +
              '<div style="text-align:right">' +
                (a.recusadas.length
                  ? '<span class="etiqueta et-recusada">' + a.recusadas.length + ' recusada(s)</span>'
                  : a.semResposta.length
                    ? '<span class="etiqueta et-vencendo">' + a.semResposta.length + ' sem resposta</span>'
                    : '<span class="etiqueta et-entregue">tudo confirmado</span>') +
              '</div>' +
            '</div>' +

            (a.proxima
              ? '<div class="arquivo-solto" style="margin-top:8px">' +
                '<span class="ic">' + (a.recusadas.includes(a.proxima) ? '⛔' : '📌') + '</span>' +
                '<div style="flex:1;min-width:0">' +
                  '<div class="nome">Próxima: ' + esc(a.proxima.nome) + '</div>' +
                  '<div class="meta">' + (a.proxima.inicio ? fmt.data(a.proxima.inicio) : 'sem data') +
                    (a.proxima.qtd ? ' · ' + fmt.numero(a.proxima.qtd) + ' ' + esc(a.proxima.unid || '') : '') +
                    ' · ' + esc(situacaoEtapa(a.proxima).txt) + '</div>' +
                '</div>' +
                '<div class="acoes">' + (d == null ? '' : d < 0
                  ? '<span class="etiqueta et-vencido">' + (-d) + 'd de atraso</span>'
                  : d === 0 ? '<span class="etiqueta et-vencendo">é hoje</span>'
                  : '<span class="etiqueta">em ' + d + 'd</span>') + '</div></div>'
              : '') +

            '<div class="legenda" style="margin-top:8px">' +
              a.etapas.length + ' etapa(s) · ' + a.confirmadas + ' confirmada(s) · ' +
              a.concluidas + ' concluída(s)</div>' +

            '<div class="barra-acoes" style="margin-top:10px">' +
              (a.resp.telefone
                ? '<button class="btn zap" data-zap="' + esc(a.crono.id) + '|' + esc(a.resp.id) + '">Mandar datas no WhatsApp</button>'
                : '') +
              '<button class="btn" data-copiar="' + esc(a.crono.id) + '|' + esc(a.resp.id) + '">Copiar link</button>' +
              '<button class="btn primario" data-abrir="' + esc(a.crono.id) + '|' + esc(a.resp.id) + '">Abrir</button>' +
            '</div>' +
          '</div>';
}

function ligarBotoesFornecedor(el) {
  el.querySelectorAll('[data-zapos]').forEach((b) => b.addEventListener('click', () => {
    const o = achar('os', b.dataset.zapos);
    if (!o) { toast('Ordem de serviço não encontrada — atualize a tela', 'ruim'); return; }
    const t = totaisOS(o);
    const p = prestadorDaOS(o);
    const fone = (o.empreiteiro || {}).telefone || (p && p.telefone) || '';
    const d = o.dataTerminoPrevista ? diasAte(o.dataTerminoPrevista) : null;
    const linhas = [
      '*' + ((S.cfg.empresa || {}).nomeCurto || 'Domo Construtora') + '* — ' + (o.codigo || 'Ordem de serviço'),
      (o.escopo || o.localizacao || '') + ' · ' + (o.obra || nomeObra(o.obraId)),
      '',
      'Executado até agora: ' + fmt.numero(t.percFisico, 0) + '%.',
      (d == null ? '' : d < 0 ? 'O prazo venceu há ' + (-d) + ' dia(s).'
        : 'Prazo de término: ' + fmt.data(o.dataTerminoPrevista) + ' (faltam ' + d + ' dia(s)).'),
      '',
      'Como está o andamento?'
    ].filter(Boolean);
    window.open(linkWhats(fone, linhas.join('\n')), '_blank');
  }));
  el.querySelectorAll('[data-abrir]').forEach((b) => b.addEventListener('click', () =>
    irPara('cronogramas/' + b.dataset.abrir.split('|').join('/'))));
  el.querySelectorAll('[data-zap]').forEach((b) => b.addEventListener('click', () => {
    const [cid, rid] = b.dataset.zap.split('|');
    mandarDatasWhats(achar('crono', cid), rid);
  }));
  el.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', () => {
    const [cid, rid] = b.dataset.copiar.split('|');
    const c = achar('crono', cid);
    const r = responsaveisVivos(c).find((x) => x.id === rid);
    if (!r || !r.token) { toast('Aguarde sincronizar para gerar o link', 'ruim'); return; }
    const url = linkPrazos(c, r);
    if (!navigator.clipboard) { toast('O link é: ' + url, 'ruim'); return; }
    navigator.clipboard.writeText(url).then(() => toast('Link copiado', 'bom'))
      .catch(() => toast('Não consegui copiar. O link é: ' + url, 'ruim'));
  }));
}

/* ── Criar acompanhamento: fornecedor + datas numa tela só ─────────────────── */
function novoAcompanhamento() {
  const cadastrados = [...fornecedoresAtivos(), ...(typeof prestadores === 'function' ? prestadores() : [])];
  const linhaEt = () =>
    '<div class="item-linha" data-et>' +
      '<div class="campo descricao"><label>O que ele precisa entregar/fazer</label>' +
        '<input type="text" data-e="nome" placeholder="Ex.: entrega do aço da laje do 6º"></div>' +
      '<div class="campo"><label>Quando</label><input type="date" data-e="inicio"></div>' +
      '<div class="campo"><label>Qtd</label><input type="text" data-e="qtd" inputmode="decimal"></div>' +
      '<div class="campo"><label>Unid.</label><select data-e="unid">' +
        unidades().map((u) => '<option' + (u === 'kg' ? ' selected' : '') + '>' + esc(u) + '</option>').join('') +
      '</select></div>' +
      '<button class="lixeira" data-tirar>✕</button>' +
    '</div>';

  abrirModal({
    titulo: 'Acompanhar um fornecedor',
    largo: true,
    corpo: '<div id="fAcomp">' +
      '<div class="linha">' +
        campo('Obra', seletor('obraId', (obras()[0] || {}).id, obras().map((o) => ({ v: o.id, t: o.nome })))) +
        campo('Puxar de um cadastro', '<select id="selAcomp"><option value="">— digitar abaixo —</option>' +
          cadastrados.map((x) => '<option value="' + esc(x.id) + '">' + esc(x.nome) + '</option>').join('') + '</select>') +
      '</div>' +
      '<div class="linha">' +
        campo('Fornecedor', entrada('nome', '')) +
        campo('WhatsApp', entrada('telefone', '', { tipo: 'tel' })) +
        campo('O que ele fornece', entrada('escopo', '', { placeholder: 'Ex.: aço CA-50' })) +
      '</div>' +
      '<h3 style="margin-top:14px">As datas que você precisa dele</h3>' +
      '<div id="etapasAcomp">' + linhaEt() + linhaEt() + '</div>' +
      '<button class="btn pequeno" id="maisEt">+ Data</button>' +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Criar e gerar o link', classe: 'primario', aoClicar: (fundo) => {
        const d = lerCampos(fundo.querySelector('#fAcomp'));
        if (!d.nome.trim()) { toast('Informe o fornecedor', 'ruim'); return; }
        const etapas = Array.from(fundo.querySelectorAll('[data-et]')).map((l) => ({
          nome: l.querySelector('[data-e=nome]').value.trim(),
          inicio: l.querySelector('[data-e=inicio]').value,
          qtd: numeroBR(l.querySelector('[data-e=qtd]').value),
          // Sem unidade, "4,2" chegava ao fornecedor sem dizer se era kg ou t.
          unid: l.querySelector('[data-e=unid]').value
        })).filter((x) => x.nome);
        if (!etapas.length) { toast('Lance pelo menos uma data', 'ruim'); return; }

        // Reaproveita o cronograma da obra; se não existir, cria um.
        let c = cronogramas().find((x) => x.obraId === d.obraId && x.situacao === 'ativo');
        if (!c) {
          c = salvar('crono', {
            obraId: d.obraId, obra: nomeObra(d.obraId),
            nome: 'Acompanhamento de fornecedores',
            responsaveis: [], etapas: [], situacao: 'ativo',
            historico: historiar({}, 'Cronograma criado pelo acompanhamento de fornecedor')
          });
        }
        const base = achar('crono', c.id) || c;

        const sel = fundo.querySelector('#selAcomp').value;
        const chave = (x) => String(x || '').trim().toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
        let resp = responsaveisVivos(base).find((x) =>
          (sel && x.origemId === sel) || chave(x.nome) === chave(d.nome));
        let responsaveis = base.responsaveis || [];
        if (!resp) {
          // Fornecedor digitado na mão ENTRA no cadastro da empresa — igual ao
          // que a cotação já faz. Sem isso, o telefone dele existia só dentro
          // deste cronograma e era redigitado a cada obra nova.
          let origemId = sel;
          if (!origemId) {
            const ja = fornecedoresAtivos().find((x) => chave(x.nome) === chave(d.nome));
            if (ja) {
              origemId = ja.id;
              if (!ja.telefone && d.telefone) salvar('forn', Object.assign({}, ja, { telefone: d.telefone }));
            } else {
              origemId = salvar('forn', {
                nome: d.nome.trim(), telefone: d.telefone, categorias: d.escopo
              }).id;
            }
          }
          resp = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            nome: d.nome.trim(), telefone: d.telefone, escopo: d.escopo, origemId: origemId || ''
          };
          responsaveis = [...responsaveis, resp];
        }
        const novas = etapas.map((e, n) => Object.assign({}, e, {
          id: Date.now().toString(36) + n + Math.random().toString(36).slice(2, 4),
          responsavelId: resp.id
        }));
        const n2 = Object.assign({}, base, { responsaveis, etapas: [...(base.etapas || []), ...novas] });
        n2.historico = historiar(base, 'Acompanhamento de ' + resp.nome + ': ' + novas.length + ' data(s) lançada(s)');
        salvar('crono', n2);
        fecharEste(fundo);
        irPara('cronogramas/' + base.id + '/' + resp.id);
        toast('Pronto — agora mande as datas no WhatsApp', 'bom');
      } }
    ]
  });

  document.getElementById('selAcomp').addEventListener('change', (e) => {
    const x = achar('forn', e.target.value) || achar('prest', e.target.value);
    if (!x) return;
    const set = (n, v) => { const cpo = document.querySelector('[data-campo=' + n + ']'); if (cpo) cpo.value = v || ''; };
    set('nome', x.nome); set('telefone', x.telefone); set('escopo', x.categorias || x.especialidade || '');
  });
  const caixa = document.getElementById('etapasAcomp');
  const ligar = (l) => l.querySelector('[data-tirar]').addEventListener('click', () => {
    if (caixa.children.length > 1) l.remove();
  });
  Array.from(caixa.children).forEach(ligar);
  document.getElementById('maisEt').addEventListener('click', () => {
    caixa.insertAdjacentHTML('beforeend', linhaEt());
    ligar(caixa.lastElementChild);
  });
}

/* ── Detalhe: só o que é daquele fornecedor ────────────────────────────────── */
function telaAcompanhaFornecedor(el, cid, rid) {
  const c = achar('crono', cid);
  const r = c ? responsaveisVivos(c).find((x) => x.id === rid) : null;
  if (!c || !r) { cabecalho('Acompanhamento', ''); el.innerHTML = vazio('🤔', 'Fornecedor não encontrado'); return; }

  const es = etapasVivas(c).filter((e) => e.responsavelId === rid)
    .sort((a, b) => String(a.inicio || '9999').localeCompare(String(b.inicio || '9999')));
  const pronto = !!r.token;

  cabecalho(r.nome, (r.escopo ? r.escopo + ' · ' : '') + (c.obra || nomeObra(c.obraId)),
    '<a class="btn" href="#/cronogramas">← Voltar</a>' +
    '<a class="btn" href="#/cronogramas/' + esc(c.id) + '">📅 Obra inteira</a>' +
    (r.telefone ? '<button class="btn zap" id="acZap"' + (pronto ? '' : ' disabled') + '>Mandar datas</button>' : '') +
    '<button class="btn primario" id="acEtapa">+ Data</button>');

  el.innerHTML =
    (pronto
      ? '<div class="cartao"><h3>🔗 Link do fornecedor</h3>' +
        '<p class="legenda">Ele abre sem senha, vê só as datas dele, confirma se entrega, informa a programação ' +
        'e avisa quando entregar.</p>' +
        '<div class="campo"><input type="text" value="' + esc(linkPrazos(c, r)) + '" readonly id="acLink"></div>' +
        '<button class="btn pequeno" id="acCopiar">Copiar link</button></div>'
      : '<div class="aviso atencao">Aguardando sincronizar para gerar o link do fornecedor.</div>') +

    '<div class="cartao"><h3>📅 Datas</h3>' +
      (es.length
        ? es.map((e) => {
            const s = situacaoEtapa(e);
            const resp = e.resposta;
            const d = e.inicio ? diasAte(e.inicio) : null;
            return '<div class="arquivo-solto" style="align-items:flex-start">' +
              '<span class="ic">' + (e.concluidaEm ? '✅' : resp && !resp.atende ? '⛔' : resp ? '👍' : '⏳') + '</span>' +
              '<div style="flex:1;min-width:0">' +
                '<div class="nome">' + esc(e.nome) +
                  (e.pendenteAprovacao ? ' <span class="etiqueta et-vencendo">sugestão dele</span>' : '') + '</div>' +
                '<div class="meta">' + (e.inicio ? fmt.data(e.inicio) : 'sem data') +
                  (e.qtd ? ' · ' + fmt.numero(e.qtd) + ' ' + esc(e.unid || '') : '') +
                  ' · <span class="etiqueta ' + s.cls + '">' + esc(s.txt) + '</span></div>' +
                (resp && resp.atende === false
                  ? '<div class="meta" style="color:var(--vermelho)">' +
                    (resp.novaData ? 'propôs ' + fmt.data(resp.novaData) + ' — ' : '') + esc(resp.justificativa || '') + '</div>'
                  : '') +
                ((e.remessas || []).length
                  ? '<div class="meta" style="color:var(--azul)">📅 programação: ' +
                    esc(e.remessas.map((x) => (x.data ? fmt.data(x.data) : '?') +
                      (x.qtd ? ' (' + fmt.numero(x.qtd) + ')' : '')).join(' · ')) + '</div>' : '') +
                ((e.entregas || []).length
                  ? '<div class="meta" style="color:var(--verde)">🚚 informou entrega: ' +
                    esc(e.entregas.map((x) => (x.data ? fmt.data(x.data) : '') +
                      (x.nf ? ' NF ' + x.nf : '')).join(' · ')) + '</div>' : '') +
              '</div>' +
              '<div class="acoes" style="flex-direction:column">' +
                (d != null && !e.concluidaEm
                  ? (d < 0 ? '<span class="etiqueta et-vencido">' + (-d) + 'd atraso</span>'
                     : '<span class="etiqueta">em ' + d + 'd</span>')
                  : '') +
                (e.pendenteAprovacao
                  ? '<button class="btn pequeno primario" data-aprovar="' + esc(e.id) + '">Aprovar</button>' +
                    '<button class="btn pequeno perigo" data-recusar="' + esc(e.id) + '">Recusar</button>'
                  : '<button class="btn pequeno" data-etapa="' + esc(e.id) + '">Editar</button>' +
                    (e.concluidaEm ? '' : '<button class="btn pequeno verde" data-concluir="' + esc(e.id) + '">Concluir</button>')) +
              '</div></div>';
          }).join('')
        : '<p class="legenda">Nenhuma data lançada para ele.</p>') +
    '</div>' +

    '<div class="cartao"><h3>Histórico deste fornecedor</h3>' +
      linhaTempo((c.historico || []).filter((h) => String(h.o_que || '').includes(r.nome))) + '</div>';

  const bz = document.getElementById('acZap');
  if (bz) bz.addEventListener('click', () => mandarDatasWhats(achar('crono', cid), rid));
  const bc = document.getElementById('acCopiar');
  if (bc) bc.addEventListener('click', () => {
    const url = linkPrazos(c, r);
    if (!navigator.clipboard) { const i = document.getElementById('acLink'); if (i) i.select(); toast('Selecione e copie', 'ruim'); return; }
    navigator.clipboard.writeText(url).then(() => toast('Link copiado', 'bom')).catch(() => toast('Não consegui copiar', 'ruim'));
  });
  document.getElementById('acEtapa').addEventListener('click', () => editarEtapa(c, null, rid));
  el.querySelectorAll('[data-etapa]').forEach((b) => b.addEventListener('click', () => editarEtapa(c, b.dataset.etapa)));
  el.querySelectorAll('[data-concluir]').forEach((b) => b.addEventListener('click', () => concluirEtapa(c, b.dataset.concluir)));
  el.querySelectorAll('[data-aprovar]').forEach((b) => b.addEventListener('click', () => decidirSugestao(c, b.dataset.aprovar, true)));
  el.querySelectorAll('[data-recusar]').forEach((b) => b.addEventListener('click', () => decidirSugestao(c, b.dataset.recusar, false)));
}
