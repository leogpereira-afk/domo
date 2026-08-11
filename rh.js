/* rh.js — RH resumido do Domo. NÃO puxa nada da Impresilk (aquele sistema é só
   referência de modelo): estes são dados do próprio Domo, no projeto do Domo, e
   TUDO é digitado à mão (sem Mubisys). Quatro coisas por colaborador —
   Documentos, Quanto recebeu, Férias e ASOs — mais um Calendário que junta as
   datas de todo mundo.

   Só a DIREÇÃO enxerga: salário e saúde (ASO) são sensíveis. A trava de verdade
   é no servidor (a coleção 'pessoa' é filtrada no snapshot, barrada na gravação
   e no download de arquivo para quem não é direção); aqui o menu e o roteador
   só escondem a porta. */

const TIPOS_DOC_PESSOA = ['RG', 'CPF', 'CTPS (Carteira de trabalho)', 'Contrato de trabalho',
  'Comprovante de residência', 'Título de eleitor', 'Certificado de reservista', 'PIS/PASEP',
  'Exame admissional', 'Certificado (NR/curso)', 'Outro'];
const TIPOS_PGTO = ['Salário', 'Adiantamento (vale)', '13º salário', 'Férias', 'Rescisão',
  'Bônus / comissão', 'Reembolso', 'Outro'];
const TIPOS_ASO = ['Admissional', 'Periódico', 'Mudança de função', 'Retorno ao trabalho', 'Demissional'];
const RESULT_ASO = ['Apto', 'Apto com restrição', 'Inapto'];
const STATUS_FERIAS = ['Agendada', 'Em gozo', 'Gozada'];

/* ── Leitura ────────────────────────────────────────────────────────────────── */
const pessoas = () => lista('pessoa');
const vivosRH = (arr) => (arr || []).filter((x) => x && !x.apagadoEm);
const docsP = (p) => vivosRH(p.documentos);
const pgtosP = (p) => vivosRH(p.pagamentos);
const feriasP = (p) => vivosRH(p.ferias);
const asosP = (p) => vivosRH(p.asos);
const totalRecebido = (p) => pgtosP(p).reduce((s, x) => s + (Number(x.valor) || 0), 0);
const idRH = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ASO vigente = o de exame mais recente; a validade dele é que rege o alerta.
function asoVigente(p) {
  return asosP(p).slice().sort((a, b) => String(b.realizadoEm || '').localeCompare(String(a.realizadoEm || '')))[0] || null;
}
// Colaboradores ativos com ASO vencido ou a menos de `dias` de vencer (ou sem
// ASO nenhum) — é a conta que vira a bolha do menu e o alerta do painel.
function asosVencendo(dias) {
  return pessoas().filter((p) => p.ativo !== false).filter((p) => {
    const a = asoVigente(p);
    if (!a || !a.validadeEm) return true;      // sem ASO válido também é pendência
    return diasAte(a.validadeEm) <= dias;
  });
}
// Dias de férias, contando início e fim (inclusive).
function diasFerias(inicio, fim) {
  if (!inicio || !fim) return 0;
  const a = new Date(inicio + 'T00:00:00'), b = new Date(fim + 'T00:00:00');
  const d = Math.round((b - a) / 86400000) + 1;
  return d > 0 ? d : 0;
}
// 'YYYY-MM' → 'MM/AAAA'.
function fmtCompetencia(c) {
  if (!c) return '—';
  const [a, m] = String(c).split('-');
  return m ? m + '/' + a : c;
}

/* ── Gravação de sub-registro (relê antes, para não atropelar outro aparelho) ── */
function upsertSub(pessoaId, campo, item, texto) {
  const base = achar('pessoa', pessoaId);
  if (!base) { toast('Colaborador não encontrado — atualize a tela', 'ruim'); return false; }
  const arr = (base[campo] || []).slice();
  const i = arr.findIndex((x) => x.id === item.id);
  if (i >= 0) arr[i] = Object.assign({}, arr[i], item);
  // `item` traz `id: undefined` no cadastro novo (os modais montam { id: x.id }
  // com x vazio). Se ele fosse o último de Object.assign, apagava o idRH() e dois
  // itens novos nasciam com id undefined — o 2º sobrescrevia o 1º. O id vem por
  // último, sempre real.
  else arr.unshift(Object.assign({ criadoEm: new Date().toISOString() }, item, { id: item.id || idRH() }));
  const n = Object.assign({}, base, { [campo]: arr });
  n.historico = historiar(base, texto);
  salvar('pessoa', n);
  return true;
}
function apagarSub(pessoaId, campo, itemId, texto) {
  const base = achar('pessoa', pessoaId);
  if (!base) return;
  const arr = (base[campo] || []).map((x) => x.id === itemId
    ? Object.assign({}, x, { apagadoEm: new Date().toISOString(), apagadoPor: S.quem || '—' }) : x);
  const n = Object.assign({}, base, { [campo]: arr });
  n.historico = historiar(base, texto);
  salvar('pessoa', n);
}

// Sobe o arquivo do input (se houver) e devolve os campos de arquivo, ou null.
async function subirArquivoRH(inputId, progId) {
  const inp = document.getElementById(inputId);
  const file = inp && inp.files && inp.files[0];
  if (!file) return null;
  const prog = document.getElementById(progId);
  if (prog) prog.style.display = '';
  const meta = await enviarArquivo(file, (pc) => {
    const b = prog && prog.querySelector('i'); if (b) b.style.width = (pc * 100) + '%';
  });
  return { arquivoId: meta.id, arquivoNome: file.name, tamanho: file.size, mime: file.type };
}

/* ══════════════════════════════════════════════════════════════════════════
   LISTA DE COLABORADORES
   ══════════════════════════════════════════════════════════════════════════ */
TELAS.pessoas = function (el, args) {
  if (args[0]) return telaPessoa(el, args[0]);

  const todas = pessoas().slice().sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
  const ativos = todas.filter((p) => p.ativo !== false);
  cabecalho('Colaboradores', ativos.length + ' ativo(s)' + (todas.length > ativos.length ? ' · ' + (todas.length - ativos.length) + ' inativo(s)' : ''),
    '<button class="btn primario" id="novaPessoa">+ Colaborador</button>');

  const pend = asosVencendo(30);
  el.innerHTML =
    '<div class="aviso info">Cadastro do próprio Domo, tudo digitado à mão. Aqui ficam os documentos, ' +
    'quanto cada um recebeu, as férias e os ASOs — e o <a href="#/calendario">calendário</a> junta as datas.</div>' +
    (pend.length
      ? '<div class="aviso atencao"><b>' + pend.length + '</b> colaborador(es) com ASO vencido, vencendo ou ausente — ' +
        'trabalhar sem ASO em dia é responsabilidade da empresa.</div>'
      : '') +
    '<div class="cartao">' +
      (todas.length ?
        '<div class="tabela-rolagem"><table><thead><tr><th>Nome</th><th>Cargo</th><th>Admissão</th>' +
        '<th>ASO</th><th class="num">Recebido</th></tr></thead><tbody>' +
        todas.map((p) => {
          const a = asoVigente(p);
          const s = a ? situacaoDoc({ validadeEm: a.validadeEm }) : { cls: 'et-vencido', txt: 'sem ASO' };
          return '<tr class="clicavel" data-id="' + esc(p.id) + '"' + (p.ativo === false ? ' style="opacity:.55"' : '') + '>' +
            '<td><b>' + esc(p.nome || '—') + '</b>' + (p.ativo === false ? ' <span class="etiqueta">inativo</span>' : '') + '</td>' +
            '<td>' + esc(p.cargo || '—') + '</td>' +
            '<td>' + (p.admissao ? fmt.data(p.admissao) : '—') + '</td>' +
            '<td><span class="etiqueta ' + s.cls + '">' + s.txt + '</span></td>' +
            '<td class="num">' + fmt.brl(totalRecebido(p)) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : vazio('👥', 'Nenhum colaborador', 'Cadastre a equipe do Domo para guardar documentos, pagamentos, férias e ASOs.')) +
    '</div>';

  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => irPara('pessoas/' + tr.dataset.id)));
  document.getElementById('novaPessoa').addEventListener('click', () => editarPessoa(null));
};

/* ══════════════════════════════════════════════════════════════════════════
   FICHA DE UM COLABORADOR
   ══════════════════════════════════════════════════════════════════════════ */
function telaPessoa(el, id) {
  const p = achar('pessoa', id);
  if (!p || p.apagadoEm) { cabecalho('Colaborador', ''); el.innerHTML = vazio('🤔', 'Não encontrado'); return; }

  const a = asoVigente(p);
  cabecalho(p.nome || 'Colaborador',
    (p.cargo || '—') + (p.admissao ? ' · admitido em ' + fmt.data(p.admissao) : '') + (p.ativo === false ? ' · INATIVO' : ''),
    '<a class="btn" href="#/pessoas">← Voltar</a>' +
    '<button class="btn" id="editPessoa">Editar</button>' +
    '<button class="btn perigo" id="apagarPessoa">Apagar</button>');

  const docs = docsP(p).slice().sort((x, y) => String(x.validadeEm || '9').localeCompare(String(y.validadeEm || '9')));
  const pgtos = pgtosP(p).slice().sort((x, y) => String(y.competencia || '').localeCompare(String(x.competencia || '')));
  const fers = feriasP(p).slice().sort((x, y) => String(y.inicio || '').localeCompare(String(x.inicio || '')));
  const asos = asosP(p).slice().sort((x, y) => String(y.realizadoEm || '').localeCompare(String(x.realizadoEm || '')));

  el.innerHTML =
    // Alerta grande de ASO no topo da ficha (é o que dá multa). Só para quem está
    // ativo — o ASO vencido de um ex-colaborador não é pendência.
    (p.ativo !== false && (!a || !a.validadeEm || diasAte(a.validadeEm) <= 30)
      ? '<div class="aviso ' + (!a || (a.validadeEm && diasAte(a.validadeEm) < 0) ? 'atencao' : 'info') + '">' +
        (!a ? 'Sem nenhum ASO cadastrado.'
            : !a.validadeEm ? 'ASO vigente <b>sem data de validade</b> cadastrada.'
            : diasAte(a.validadeEm) < 0 ? 'ASO vigente <b>vencido</b> desde ' + fmt.data(a.validadeEm) + '.'
            : 'ASO vigente vence em ' + diasAte(a.validadeEm) + ' dia(s) (' + fmt.data(a.validadeEm) + ').') +
        '</div>'
      : '') +

    '<div class="grade g2">' +

    // 📄 DOCUMENTOS
    '<div class="cartao"><div class="barra-acoes" style="justify-content:space-between">' +
      '<h3 style="margin:0">📄 Documentos</h3><button class="btn pequeno" id="addDoc">+ Documento</button></div>' +
      (docs.length ? docs.map((d) => {
        const s = situacaoDoc({ validadeEm: d.validadeEm });
        return '<div class="arquivo-solto"><span class="ic">' + (d.arquivoId ? '📎' : '📄') + '</span>' +
          '<div style="flex:1;min-width:0"><div class="nome">' + esc(d.tipo || 'Documento') +
            (d.nome ? ' — ' + esc(d.nome) : '') + '</div>' +
            '<div class="meta"><span class="etiqueta ' + s.cls + '">' + s.txt + '</span>' +
              (d.validadeEm ? ' · vence ' + fmt.data(d.validadeEm) : '') + '</div></div>' +
          '<div class="acoes">' +
            (d.arquivoId ? '<button class="btn pequeno primario" data-bxd="' + esc(d.id) + '">Baixar</button>' : '') +
            '<button class="btn pequeno" data-eddoc="' + esc(d.id) + '">Editar</button>' +
            '<button class="btn pequeno" data-rmdoc="' + esc(d.id) + '">✕</button>' +
          '</div></div>';
      }).join('') : '<p class="legenda">Nenhum documento.</p>') +
    '</div>' +

    // 💰 QUANTO RECEBEU
    '<div class="cartao"><div class="barra-acoes" style="justify-content:space-between">' +
      '<h3 style="margin:0">💰 Quanto recebeu</h3><button class="btn pequeno" id="addPgto">+ Lançamento</button></div>' +
      '<div class="indicador ok" style="margin:4px 0 10px"><div class="rotulo">Total lançado</div>' +
        '<div class="valor">' + fmt.brl(totalRecebido(p)) + '</div></div>' +
      (pgtos.length ? '<div class="tabela-rolagem"><table><thead><tr><th>Competência</th><th>Tipo</th>' +
        '<th class="num">Valor</th><th>Pago em</th><th></th></tr></thead><tbody>' +
        pgtos.map((x) => '<tr><td>' + esc(fmtCompetencia(x.competencia)) + '</td><td>' + esc(x.tipo || '—') + '</td>' +
          '<td class="num">' + fmt.brl(x.valor) + '</td><td>' + (x.pagoEm ? fmt.data(x.pagoEm) : '—') + '</td>' +
          '<td class="num"><button class="btn pequeno" data-edpg="' + esc(x.id) + '">✎</button> ' +
          '<button class="btn pequeno" data-rmpg="' + esc(x.id) + '">✕</button></td></tr>').join('') +
        '</tbody></table></div>' : '<p class="legenda">Nenhum lançamento.</p>') +
    '</div>' +

    // 🏖️ FÉRIAS
    '<div class="cartao"><div class="barra-acoes" style="justify-content:space-between">' +
      '<h3 style="margin:0">🏖️ Férias</h3><button class="btn pequeno" id="addFeria">+ Período</button></div>' +
      (fers.length ? fers.map((f) => {
        const futuro = f.inicio && f.inicio >= hojeISO();
        return '<div class="arquivo-solto"><span class="ic">🏖️</span>' +
          '<div style="flex:1;min-width:0"><div class="nome">' + fmt.data(f.inicio) + ' → ' + fmt.data(f.fim) +
            ' <span class="legenda">(' + (f.dias || diasFerias(f.inicio, f.fim)) + ' dias)</span></div>' +
            '<div class="meta"><span class="etiqueta ' + (futuro ? 'et-vencendo' : '') + '">' + esc(f.status || 'Agendada') + '</span>' +
              (f.obs ? ' · ' + esc(f.obs) : '') + '</div></div>' +
          '<div class="acoes"><button class="btn pequeno" data-edfer="' + esc(f.id) + '">✎</button> ' +
            '<button class="btn pequeno" data-rmfer="' + esc(f.id) + '">✕</button></div></div>';
      }).join('') : '<p class="legenda">Nenhum período de férias.</p>') +
    '</div>' +

    // 🩺 ASOs
    '<div class="cartao"><div class="barra-acoes" style="justify-content:space-between">' +
      '<h3 style="margin:0">🩺 ASOs</h3><button class="btn pequeno" id="addAso">+ ASO</button></div>' +
      (asos.length ? asos.map((x) => {
        const s = situacaoDoc({ validadeEm: x.validadeEm });
        const vig = a && x.id === a.id;
        return '<div class="arquivo-solto"><span class="ic">' + (x.arquivoId ? '📎' : '🩺') + '</span>' +
          '<div style="flex:1;min-width:0"><div class="nome">' + esc(x.tipo || 'ASO') +
            (vig ? ' <span class="etiqueta et-entregue">vigente</span>' : '') + '</div>' +
            '<div class="meta">' + (x.realizadoEm ? 'feito ' + fmt.data(x.realizadoEm) : '') +
              (x.resultado ? ' · ' + esc(x.resultado) : '') +
              ' · <span class="etiqueta ' + s.cls + '">' + s.txt + '</span></div></div>' +
          '<div class="acoes">' +
            (x.arquivoId ? '<button class="btn pequeno primario" data-bxaso="' + esc(x.id) + '">Baixar</button>' : '') +
            '<button class="btn pequeno" data-edaso="' + esc(x.id) + '">✎</button> ' +
            '<button class="btn pequeno" data-rmaso="' + esc(x.id) + '">✕</button></div></div>';
      }).join('') : '<p class="legenda">Nenhum ASO.</p>') +
    '</div>' +

    '</div>';

  // Cabeçalho
  document.getElementById('editPessoa').addEventListener('click', () => editarPessoa(p.id));
  document.getElementById('apagarPessoa').addEventListener('click', async () => {
    if (!await confirmar('Apagar ' + (p.nome || 'este colaborador') + '? Vai para a lixeira — a direção pode restaurar.',
      { perigo: true, ok: 'Apagar' })) return;
    try { await api('apagar', { colecao: 'pessoa', id: p.id }); }
    catch (e) { toast('Não consegui apagar: ' + e.message, 'ruim'); return; }
    await puxar(); irPara('pessoas');
  });

  // Documentos
  document.getElementById('addDoc').addEventListener('click', () => docModal(p.id, null));
  el.querySelectorAll('[data-eddoc]').forEach((b) => b.addEventListener('click', () => docModal(p.id, docsP(achar('pessoa', p.id)).find((d) => d.id === b.dataset.eddoc))));
  el.querySelectorAll('[data-bxd]').forEach((b) => b.addEventListener('click', () => { const d = docsP(p).find((x) => x.id === b.dataset.bxd); if (d) baixar(d.arquivoId, d.arquivoNome || d.nome); }));
  el.querySelectorAll('[data-rmdoc]').forEach((b) => b.addEventListener('click', async () => {
    const d = docsP(p).find((x) => x.id === b.dataset.rmdoc);
    if (d && await confirmar('Remover o documento "' + (d.tipo || '') + (d.nome ? ' — ' + d.nome : '') + '"?', { perigo: true, ok: 'Remover' })) {
      apagarSub(p.id, 'documentos', d.id, 'Removeu documento: ' + (d.tipo || '')); render();
    }
  }));

  // Pagamentos
  document.getElementById('addPgto').addEventListener('click', () => pgtoModal(p.id, null));
  el.querySelectorAll('[data-edpg]').forEach((b) => b.addEventListener('click', () => pgtoModal(p.id, pgtosP(achar('pessoa', p.id)).find((x) => x.id === b.dataset.edpg))));
  el.querySelectorAll('[data-rmpg]').forEach((b) => b.addEventListener('click', async () => {
    const x = pgtosP(p).find((y) => y.id === b.dataset.rmpg);
    if (x && await confirmar('Remover o lançamento de ' + fmt.brl(x.valor) + ' (' + fmtCompetencia(x.competencia) + ')?', { perigo: true, ok: 'Remover' })) {
      apagarSub(p.id, 'pagamentos', x.id, 'Removeu lançamento de ' + fmt.brl(x.valor)); render();
    }
  }));

  // Férias
  document.getElementById('addFeria').addEventListener('click', () => feriaModal(p.id, null));
  el.querySelectorAll('[data-edfer]').forEach((b) => b.addEventListener('click', () => feriaModal(p.id, feriasP(achar('pessoa', p.id)).find((x) => x.id === b.dataset.edfer))));
  el.querySelectorAll('[data-rmfer]').forEach((b) => b.addEventListener('click', async () => {
    const x = feriasP(p).find((y) => y.id === b.dataset.rmfer);
    if (x && await confirmar('Remover as férias de ' + fmt.data(x.inicio) + ' a ' + fmt.data(x.fim) + '?', { perigo: true, ok: 'Remover' })) {
      apagarSub(p.id, 'ferias', x.id, 'Removeu férias ' + fmt.data(x.inicio)); render();
    }
  }));

  // ASOs
  document.getElementById('addAso').addEventListener('click', () => asoModal(p.id, null));
  el.querySelectorAll('[data-edaso]').forEach((b) => b.addEventListener('click', () => asoModal(p.id, asosP(achar('pessoa', p.id)).find((x) => x.id === b.dataset.edaso))));
  el.querySelectorAll('[data-bxaso]').forEach((b) => b.addEventListener('click', () => { const x = asosP(p).find((y) => y.id === b.dataset.bxaso); if (x) baixar(x.arquivoId, x.arquivoNome || 'ASO'); }));
  el.querySelectorAll('[data-rmaso]').forEach((b) => b.addEventListener('click', async () => {
    const x = asosP(p).find((y) => y.id === b.dataset.rmaso);
    if (x && await confirmar('Remover o ASO ' + (x.tipo || '') + ' de ' + fmt.data(x.realizadoEm) + '?', { perigo: true, ok: 'Remover' })) {
      apagarSub(p.id, 'asos', x.id, 'Removeu ASO ' + (x.tipo || '')); render();
    }
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
   MODAIS
   ══════════════════════════════════════════════════════════════════════════ */
function editarPessoa(id) {
  const p = (id && achar('pessoa', id)) || {};
  abrirModal({
    titulo: id ? 'Editar colaborador' : 'Novo colaborador',
    corpo: '<div id="fPessoa">' +
      campo('Nome completo', entrada('nome', p.nome || '')) +
      '<div class="linha">' +
        campo('Cargo', entrada('cargo', p.cargo || '')) +
        campo('Admissão', entrada('admissao', p.admissao || '', { tipo: 'date' })) +
      '</div>' +
      '<div class="linha">' +
        campo('CPF', entrada('cpf', p.cpf || '', { placeholder: '000.000.000-00' })) +
        campo('Telefone', entrada('telefone', p.telefone || '')) +
        campo('Situação', seletor('ativoTxt', p.ativo === false ? 'Inativo' : 'Ativo', ['Ativo', 'Inativo'])) +
      '</div>' +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar', classe: 'primario', aoClicar: (fundo) => {
        const d = lerCampos(fundo.querySelector('#fPessoa'));
        if (!d.nome.trim()) { toast('Informe o nome', 'ruim'); return; }
        const base = (id && achar('pessoa', id)) || {};
        const n = Object.assign({}, base, {
          id: id || undefined, nome: d.nome.trim(), cargo: d.cargo.trim(),
          admissao: d.admissao, cpf: d.cpf.trim(), telefone: d.telefone.trim(),
          ativo: d.ativoTxt !== 'Inativo'
        });
        n.historico = historiar(base, id ? 'Editou o cadastro' : 'Colaborador cadastrado');
        const salvo = salvar('pessoa', n);
        fecharModal();
        if (!id) irPara('pessoas/' + salvo.id); else render();
      } }
    ]
  });
}

function docModal(pessoaId, doc) {
  const d = doc || {};
  abrirModal({
    titulo: doc ? 'Editar documento' : 'Novo documento',
    corpo: '<div id="fDoc">' +
      '<div class="linha">' +
        campo('Tipo', seletor('tipo', d.tipo || '', TIPOS_DOC_PESSOA, 'Escolha…')) +
        campo('Validade (se tiver)', entrada('validadeEm', d.validadeEm || '', { tipo: 'date' })) +
      '</div>' +
      campo('Descrição / número', entrada('nome', d.nome || '', { placeholder: 'Ex.: CTPS 12345 série 001' })) +
      (d.arquivoId ? '<p class="legenda">Arquivo atual: ' + esc(d.arquivoNome || '—') + ' (enviar outro substitui)</p>' : '') +
      '<div class="campo"><label>Arquivo (opcional)</label><input type="file" id="docArqRH"></div>' +
      '<div class="progresso" id="docProg" style="display:none"><i></i></div>' +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar', classe: 'primario', aoClicar: async (fundo) => {
        const v = lerCampos(fundo.querySelector('#fDoc'));
        if (!v.tipo) { toast('Escolha o tipo', 'ruim'); return; }
        let arq = null;
        try { arq = await subirArquivoRH('docArqRH', 'docProg'); }
        catch (e) { toast('Falha ao enviar o arquivo: ' + e.message, 'ruim'); return; }
        const item = Object.assign({ id: d.id }, { tipo: v.tipo, nome: v.nome, validadeEm: v.validadeEm }, arq || {});
        if (!upsertSub(pessoaId, 'documentos', item, (doc ? 'Editou' : 'Anexou') + ' documento: ' + v.tipo)) return;
        fecharModal(); render();
      } }
    ]
  });
}

function pgtoModal(pessoaId, pg) {
  const x = pg || {};
  abrirModal({
    titulo: pg ? 'Editar lançamento' : 'Quanto recebeu',
    corpo: '<div id="fPg">' +
      '<div class="linha">' +
        campo('Competência (mês)', entrada('competencia', x.competencia || hojeISO().slice(0, 7), { tipo: 'month' })) +
        campo('Tipo', seletor('tipo', x.tipo || 'Salário', TIPOS_PGTO)) +
      '</div>' +
      '<div class="linha">' +
        campo('Valor (R$)', entrada('valor', x.valor != null ? String(x.valor).replace('.', ',') : '', { inputmode: 'decimal' })) +
        campo('Pago em', entrada('pagoEm', x.pagoEm || '', { tipo: 'date' })) +
      '</div>' +
      campo('Observação', entrada('obs', x.obs || '')) +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar', classe: 'primario', aoClicar: (fundo) => {
        const v = lerCampos(fundo.querySelector('#fPg'));
        const valor = numeroBR(v.valor);
        if (!(valor > 0)) { toast('Informe um valor', 'ruim'); return; }
        const item = { id: x.id, competencia: v.competencia, tipo: v.tipo, valor, pagoEm: v.pagoEm, obs: v.obs };
        if (!upsertSub(pessoaId, 'pagamentos', item, (pg ? 'Editou' : 'Lançou') + ' ' + fmt.brl(valor) + ' (' + (v.tipo || '') + ')')) return;
        fecharModal(); render();
      } }
    ]
  });
}

function feriaModal(pessoaId, f) {
  const x = f || {};
  abrirModal({
    titulo: f ? 'Editar férias' : 'Novo período de férias',
    corpo: '<div id="fFer">' +
      '<div class="linha">' +
        campo('Início', entrada('inicio', x.inicio || '', { tipo: 'date' })) +
        campo('Fim', entrada('fim', x.fim || '', { tipo: 'date' })) +
        campo('Situação', seletor('status', x.status || 'Agendada', STATUS_FERIAS)) +
      '</div>' +
      campo('Observação', entrada('obs', x.obs || '', { placeholder: 'Ex.: vendeu 10 dias (abono)' })) +
      '<p class="legenda" id="ferDias"></p>' +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar', classe: 'primario', aoClicar: (fundo) => {
        const v = lerCampos(fundo.querySelector('#fFer'));
        if (!v.inicio || !v.fim) { toast('Informe início e fim', 'ruim'); return; }
        if (v.fim < v.inicio) { toast('O fim não pode ser antes do início', 'ruim'); return; }
        const dias = diasFerias(v.inicio, v.fim);
        const item = { id: x.id, inicio: v.inicio, fim: v.fim, dias, status: v.status, obs: v.obs };
        if (!upsertSub(pessoaId, 'ferias', item, (f ? 'Editou' : 'Agendou') + ' férias (' + dias + ' dias)')) return;
        fecharModal(); render();
      } }
    ]
  });
  // Mostra a contagem de dias enquanto edita.
  const atualiza = () => {
    const i = document.querySelector('#fFer [data-campo=inicio]'), f2 = document.querySelector('#fFer [data-campo=fim]');
    const d = document.getElementById('ferDias');
    if (i && f2 && d) d.textContent = (i.value && f2.value && f2.value >= i.value) ? diasFerias(i.value, f2.value) + ' dia(s)' : '';
  };
  document.querySelectorAll('#fFer [data-campo=inicio], #fFer [data-campo=fim]').forEach((c) => c.addEventListener('change', atualiza));
  atualiza();
}

function asoModal(pessoaId, aso) {
  const x = aso || {};
  abrirModal({
    titulo: aso ? 'Editar ASO' : 'Novo ASO',
    corpo: '<div id="fAso">' +
      '<div class="linha">' +
        campo('Tipo', seletor('tipo', x.tipo || 'Periódico', TIPOS_ASO)) +
        campo('Resultado', seletor('resultado', x.resultado || 'Apto', RESULT_ASO)) +
      '</div>' +
      '<div class="linha">' +
        campo('Realizado em', entrada('realizadoEm', x.realizadoEm || '', { tipo: 'date' })) +
        campo('Válido até', entrada('validadeEm', x.validadeEm || '', { tipo: 'date' })) +
      '</div>' +
      '<div class="linha">' +
        campo('Clínica', entrada('clinica', x.clinica || '')) +
        campo('Médico', entrada('medico', x.medico || '')) +
      '</div>' +
      (x.arquivoId ? '<p class="legenda">Arquivo atual: ' + esc(x.arquivoNome || 'ASO') + ' (enviar outro substitui)</p>' : '') +
      '<div class="campo"><label>Arquivo do ASO (opcional)</label><input type="file" id="asoArqRH"></div>' +
      '<div class="progresso" id="asoProg" style="display:none"><i></i></div>' +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar', classe: 'primario', aoClicar: async (fundo) => {
        const v = lerCampos(fundo.querySelector('#fAso'));
        if (!v.realizadoEm) { toast('Informe a data do exame', 'ruim'); return; }
        let arq = null;
        try { arq = await subirArquivoRH('asoArqRH', 'asoProg'); }
        catch (e) { toast('Falha ao enviar o arquivo: ' + e.message, 'ruim'); return; }
        const item = Object.assign({ id: x.id }, {
          tipo: v.tipo, resultado: v.resultado, realizadoEm: v.realizadoEm,
          validadeEm: v.validadeEm, clinica: v.clinica, medico: v.medico
        }, arq || {});
        if (!upsertSub(pessoaId, 'asos', item, (aso ? 'Editou' : 'Registrou') + ' ASO ' + v.tipo)) return;
        fecharModal(); render();
      } }
    ]
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   CALENDÁRIO — junta férias, vencimento de ASO e pagamentos de todo mundo
   ══════════════════════════════════════════════════════════════════════════ */
let calMes = null;   // 'YYYY-MM'; fora da função para sobreviver ao re-render

// Todos os eventos do mês pedido, indexados por dia ('YYYY-MM-DD').
function eventosDoMes(ymd) {
  const porDia = {};
  const add = (dia, ev) => { (porDia[dia] || (porDia[dia] = [])).push(ev); };
  const noMes = (d) => d && d.slice(0, 7) === ymd;
  // RH (férias / ASO / pagamentos) — só a direção recebe a coleção 'pessoa'; para
  // os outros pessoas() vem vazia, então nada de RH aparece no calendário deles.
  for (const p of pessoas()) {
    if (p.apagadoEm || p.ativo === false) continue;   // inativo não gera alerta
    const nome = (p.nome || '—').split(' ')[0];
    const irP = 'pessoas/' + p.id;
    for (const f of feriasP(p)) {
      if (!f.inicio || !f.fim) continue;
      if (f.fim.slice(0, 7) < ymd) continue;                       // período já passou
      // Começa no mês visto, nunca no início do período (que pode ser anos antes
      // — varreria milhares de dias por render).
      let dia = f.inicio < ymd + '-01' ? ymd + '-01' : f.inicio;
      for (; dia <= f.fim; dia = proximoDia(dia)) {
        if (dia.slice(0, 7) > ymd) break;
        if (noMes(dia)) add(dia, { cor: 'azul', txt: nome + ' — férias', ir: irP });
      }
    }
    for (const a of asosP(p)) {
      if (noMes(a.validadeEm)) {
        const venc = diasAte(a.validadeEm) < 0;
        add(a.validadeEm, { cor: venc ? 'vermelho' : 'ambar', txt: nome + ' — ASO vence', ir: irP });
      }
    }
    for (const x of pgtosP(p)) {
      if (noMes(x.pagoEm)) add(x.pagoEm, { cor: 'verde', txt: nome + ' — ' + fmt.brl(x.valor), ir: irP });
    }
  }
  // Compromissos com data no mês — o servidor já entrega só os do próprio dono
  // para quem não é direção, então cada um vê a própria agenda (a direção, todas).
  for (const c of lista('comp')) {
    if (c.apagadoEm || c.feito || !noMes(c.data)) continue;
    const t = (typeof tipoComp === 'function') ? tipoComp(c.tipo) : { icone: '📌' };
    add(c.data, { cor: 'roxo', txt: t.icone + ' ' + (c.titulo || 'Compromisso'), ir: 'compromissos/' + c.id });
  }
  return porDia;
}
// 'YYYY-MM-DD' + 1 dia, seguro de fuso (constrói a data em UTC).
function proximoDia(ymd) {
  const [a, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

// Lembrete = um compromisso do tipo 'lembrete' (🔔). Modal enxuto, e ao salvar
// FICA no calendário (não pula para a conversa como o compromisso normal). O
// dono sai de meuDono() e o servidor carimba de novo — o lembrete é de quem cria.
function novoLembrete(dia) {
  abrirModal({
    titulo: '🔔 Novo lembrete',
    corpo: '<div id="fLemb">' +
      campo('Lembrar de quê?', entrada('titulo', '', { placeholder: 'Ex.: Ligar para o cartório' })) +
      '<div class="linha">' +
        campo('Data', entrada('data', dia || hojeISO(), { tipo: 'date' })) +
        campo('Hora (opcional)', entrada('hora', '', { tipo: 'time' })) +
      '</div>' +
      campo('Observação', entrada('obs', '', { placeholder: 'Detalhe, telefone, o que levar…' })) +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar lembrete', classe: 'primario', aoClicar: (fundo) => {
        const d = lerCampos(fundo.querySelector('#fLemb'));
        if (!d.titulo.trim()) { toast('Escreva o lembrete', 'ruim'); return; }
        if (!d.data) { toast('Escolha a data', 'ruim'); return; }
        const criado = (typeof eventoComp === 'function')
          ? eventoComp('criado', 'Criou o lembrete')
          : { id: idRH(), em: new Date().toISOString(), por: S.quem || '—', tipo: 'criado', texto: 'Criou o lembrete' };
        salvar('comp', {
          titulo: d.titulo.trim(), tipo: 'lembrete', data: d.data, hora: d.hora, obs: (d.obs || '').trim(),
          dono: (typeof meuDono === 'function' ? meuDono() : 'equipe'),
          historico: [criado]
        });
        fecharModal(); render();
        toast('Lembrete adicionado', 'bom');
      } }
    ]
  });
}

TELAS.calendario = function (el) {
  if (!calMes) calMes = hojeISO().slice(0, 7);
  const [ano, mes] = calMes.split('-').map(Number);
  const nm = new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const nomeMes = nm.charAt(0).toUpperCase() + nm.slice(1);   // "Setembro de 2026"
  // A direção vê o calendário completo (agenda + RH); os outros só a própria
  // agenda de compromissos (o RH nem chega no aparelho deles).
  const dir = typeof ehDirecao === 'function' && ehDirecao();
  cabecalho('Calendário', dir ? 'Compromissos, férias, ASOs vencendo e pagamentos' : 'Seus compromissos',
    '<button class="btn primario" id="calLembrete">🔔 + Lembrete</button>' +
    (dir ? '<a class="btn" href="#/pessoas">← Colaboradores</a>' : ''));

  const eventos = eventosDoMes(calMes);
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const primeiroDiaSemana = new Date(ano, mes - 1, 1).getDay();   // 0=Dom
  const hoje = hojeISO();
  const pad = (n) => String(n).padStart(2, '0');

  const celulas = [];
  for (let i = 0; i < primeiroDiaSemana; i++) celulas.push('<div class="cal-cel vazia"></div>');
  for (let dia = 1; dia <= diasNoMes; dia++) {
    const iso = ano + '-' + pad(mes) + '-' + pad(dia);
    const evs = eventos[iso] || [];
    const chips = evs.slice(0, 3).map((e) =>
      '<div class="cal-ev cal-' + e.cor + '" data-ir="' + esc(e.ir) + '" title="' + esc(e.txt) + '">' + esc(e.txt) + '</div>').join('') +
      (evs.length > 3 ? '<div class="cal-mais">+' + (evs.length - 3) + '</div>' : '');
    // A célula é clicável para criar um lembrete naquele dia (o chip para em cima
    // com stopPropagation e navega em vez de abrir o lembrete).
    celulas.push('<div class="cal-cel' + (iso === hoje ? ' cal-hoje' : '') + '" data-dia="' + iso +
      '" title="Adicionar lembrete em ' + fmt.data(iso) + '">' +
      '<div class="cal-dia">' + dia + '</div>' + chips + '</div>');
  }

  el.innerHTML =
    '<div class="cartao">' +
      '<div class="barra-acoes" style="justify-content:space-between;align-items:center">' +
        '<button class="btn pequeno" id="calAnt">←</button>' +
        '<h3 style="margin:0">' + esc(nomeMes) + '</h3>' +
        '<div><button class="btn pequeno" id="calHoje">Hoje</button> ' +
          '<button class="btn pequeno" id="calProx">→</button></div>' +
      '</div>' +
      '<div class="cal-legenda">' +
        '<span><i class="cal-roxo"></i>Compromisso</span>' +
        (dir
          ? '<span><i class="cal-azul"></i>Férias</span>' +
            '<span><i class="cal-ambar"></i>ASO vencendo</span>' +
            '<span><i class="cal-vermelho"></i>ASO vencido</span>' +
            '<span><i class="cal-verde"></i>Pagamento</span>'
          : '') + '</div>' +
      '<div class="cal-cab">' + ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => '<div>' + d + '</div>').join('') + '</div>' +
      '<div class="cal-grade">' + celulas.join('') + '</div>' +
    '</div>';

  const passo = (delta) => {
    let a = ano, m = mes + delta;
    if (m < 1) { m = 12; a--; } if (m > 12) { m = 1; a++; }
    calMes = a + '-' + pad(m); render();
  };
  document.getElementById('calAnt').addEventListener('click', () => passo(-1));
  document.getElementById('calProx').addEventListener('click', () => passo(1));
  document.getElementById('calHoje').addEventListener('click', () => { calMes = hojeISO().slice(0, 7); render(); });
  document.getElementById('calLembrete').addEventListener('click', () => novoLembrete(hojeISO()));
  // Chip: navega para o item e NÃO deixa o clique chegar na célula (que criaria lembrete).
  el.querySelectorAll('.cal-ev[data-ir]').forEach((c) => c.addEventListener('click', (ev) => { ev.stopPropagation(); irPara(c.dataset.ir); }));
  // Clique na célula (dia) cria um lembrete já com a data.
  el.querySelectorAll('.cal-cel[data-dia]').forEach((c) => c.addEventListener('click', () => novoLembrete(c.dataset.dia)));
};
