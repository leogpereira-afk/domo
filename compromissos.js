/* Compromissos — a agenda pessoal de cada pessoa cadastrada no sistema:
   visita à obra, medição, reunião, pagamento, vistoria, renovar licença,
   ligação, e o que ficou para resolver sem data marcada.

   Igual ao da Impresilk, adaptado para a Domo:
   • cada pessoa vê só os SEUS compromissos (o servidor separa por dono);
   • a direção vê os de todo mundo e filtra por pessoa;
   • dá para ENCAMINHAR um compromisso para outra pessoa da equipe.

   A tela abre pelo que está ATRASADO, depois hoje — é assim que o problema
   chega. Prazo em palavras vale mais que a data crua. */

// Cada tipo tem ícone: numa lista de 20 linhas, o ícone diz o que é antes de a
// pessoa ler o título. Vocabulário de obra, não de vendas.
const TIPOS_COMP = {
  visita:    { rotulo: 'Visita à obra', icone: '🏗️' },
  reuniao:   { rotulo: 'Reunião', icone: '🤝' },
  medicao:   { rotulo: 'Medição', icone: '📏' },
  pagamento: { rotulo: 'Pagamento / cobrança', icone: '💰' },
  vistoria:  { rotulo: 'Vistoria / fiscalização', icone: '🔍' },
  documento: { rotulo: 'Documento / licença', icone: '🗂️' },
  ligacao:   { rotulo: 'Ligação / retorno', icone: '📞' },
  entrega:   { rotulo: 'Acompanhar entrega', icone: '🚚' },
  outro:     { rotulo: 'Outro', icone: '📌' }
};
const tipoComp = (t) => TIPOS_COMP[t] || TIPOS_COMP.outro;

// Quem posso ver/atribuir. A direção mexe na agenda de todos; os outros só na
// própria. 'equipe' é a caixa compartilhada de quem entra pela senha da equipe.
const ehDirecaoComp = () => typeof ehDirecao === 'function' ? ehDirecao() : true;
const meuDono = () => (S.acessoProprio && S.usuarioId) ? S.usuarioId : 'equipe';

function pessoasComp() {
  // O roster mínimo (id + nome) que o servidor manda para TODO mundo no
  // snapshot. Sem ele, quem não é da direção não via nome nenhum e não conseguia
  // encaminhar. Cai para 'usuarios' só por compatibilidade com cache antigo.
  const fonte = (S.cfg && (S.cfg.pessoas || S.cfg.usuarios)) || [];
  const us = fonte.filter((u) => u.ativo !== false).map((u) => ({ id: u.id, nome: u.nome }));
  // A caixa da direção (senha da equipe) sempre existe como destino.
  if (!us.some((p) => p.id === 'equipe')) us.unshift({ id: 'equipe', nome: 'Direção' });
  return us;
}
const nomeDono = (dono) => (pessoasComp().find((p) => p.id === dono) || {}).nome || dono || '—';

// A frase antes do número. Também dá o grupo e o peso de ordenação.
function prazoComp(dias) {
  if (dias == null) return { txt: 'sem data', cls: '', peso: 5000, grupo: 'Sem data marcada' };
  if (dias < 0) { const d = -dias; return { txt: 'atrasado ' + d + (d === 1 ? ' dia' : ' dias'), cls: 'et-vencido', peso: -1000 + dias, grupo: 'Atrasados' }; }
  if (dias === 0) return { txt: 'HOJE', cls: 'et-vencido', peso: 0, grupo: 'Hoje' };
  if (dias === 1) return { txt: 'amanhã', cls: 'et-vencendo', peso: 1, grupo: 'Amanhã' };
  if (dias <= 7) return { txt: 'em ' + dias + ' dias', cls: 'et-vencendo', peso: dias, grupo: 'Próximos 7 dias' };
  return { txt: 'em ' + dias + ' dias', cls: '', peso: dias, grupo: 'Mais para frente' };
}
const ORDEM_GRUPOS = ['Atrasados', 'Hoje', 'Amanhã', 'Próximos 7 dias', 'Mais para frente', 'Sem data marcada'];

// Filtro da direção por pessoa (guardado no S para sobreviver ao re-render).
function compromissosAbertos(dono) {
  return lista('comp').filter((c) => !c.feito && (!dono || c.dono === dono));
}
// Contagem para a bolha do menu: o que é MEU e está atrasado ou é hoje.
function meusCompromissosUrgentes() {
  const meu = ehDirecaoComp() ? null : meuDono();
  return compromissosAbertos(meu).filter((c) => {
    const d = c.data ? diasAte(c.data) : null;
    return d != null && d <= 0;
  }).length;
}

/* ══════════════════════════════════════════════════════════════════════════
   TELA
   ══════════════════════════════════════════════════════════════════════════ */
TELAS.compromissos = function (el) {
  const dir = ehDirecaoComp();
  const filtro = dir ? (S.compDePessoa || null) : null;

  const todos = lista('comp')
    // Quem não é da direção só vê os SEUS — defesa em profundidade além do
    // filtro do servidor: a carência de sync do puxar pode deixar por segundos
    // um compromisso recém-encaminhado no cache local.
    .filter((c) => dir ? (!filtro || c.dono === filtro) : c.dono === meuDono())
    .map((c) => {
      const dias = c.data ? diasAte(c.data) : null;
      return Object.assign({}, c, { dias, pz: prazoComp(dias), t: tipoComp(c.tipo) });
    });
  const abertos = todos.filter((c) => !c.feito).sort((a, b) => a.pz.peso - b.pz.peso);
  const feitos = todos.filter((c) => c.feito)
    .sort((a, b) => String(b.feitoEm || '').localeCompare(String(a.feitoEm || '')));

  const hoje = abertos.filter((c) => c.dias === 0).length;
  const atrasados = abertos.filter((c) => c.dias != null && c.dias < 0).length;
  const semData = abertos.filter((c) => c.dias == null).length;

  cabecalho('Compromissos',
    dir ? 'A agenda da equipe: visitas, medições, pagamentos e o que ficou para resolver.'
        : 'Suas visitas, medições, retornos e o que você tem para resolver. Só você vê esta lista.',
    '<button class="btn primario" id="novoComp">+ Novo compromisso</button>');

  // Cartão de uma linha da agenda.
  const linha = (c) =>
    '<div class="arquivo-solto' + (c.feito ? ' feito-comp' : '') + '" style="align-items:flex-start">' +
      '<button class="check-comp' + (c.feito ? ' on' : '') + '" data-feito="' + esc(c.id) + '" title="' +
        (c.feito ? 'Reabrir' : 'Marcar como feito') + '">' + (c.feito ? '✓' : '') + '</button>' +
      '<span class="ic" title="' + esc(c.t.rotulo) + '">' + c.t.icone + '</span>' +
      '<div style="flex:1;min-width:0">' +
        '<div class="nome"' + (c.feito ? ' style="text-decoration:line-through;color:var(--texto-fraco)"' : '') + '>' +
          esc(c.titulo) + '</div>' +
        '<div class="meta">' + [
          c.t.rotulo,
          c.referencia ? esc(c.referencia) : '',
          (dir && !filtro && c.dono !== meuDono()) ? '👤 ' + esc(nomeDono(c.dono)) : '',
          (c.encaminhadoPor ? 'veio de ' + esc(c.encaminhadoPor) : ''),
          c.obs ? esc(c.obs) : ''
        ].filter(Boolean).join(' · ') + '</div>' +
        (c.data ? '<div class="meta">' + fmt.data(c.data) + (c.hora ? ' às ' + esc(c.hora) : '') + '</div>' : '') +
      '</div>' +
      '<div class="acoes" style="flex-direction:column;align-items:flex-end">' +
        (c.feito ? '' : '<span class="etiqueta ' + c.pz.cls + '">' + esc(c.pz.txt) + '</span>') +
        '<div style="display:flex;gap:2px;margin-top:4px">' +
          (pessoasComp().some((p) => p.id !== c.dono) ? '<button class="btn pequeno" data-passar="' + esc(c.id) + '" title="Encaminhar">↪</button>' : '') +
          '<button class="btn pequeno" data-editcomp="' + esc(c.id) + '" title="Editar">✎</button>' +
          '<button class="btn pequeno perigo" data-delcomp="' + esc(c.id) + '" title="Apagar">🗑</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  // Agrupa os abertos por prazo.
  const grupos = [];
  for (const c of abertos) {
    let g = grupos.find((x) => x.nome === c.pz.grupo);
    if (!g) { g = { nome: c.pz.grupo, itens: [] }; grupos.push(g); }
    g.itens.push(c);
  }
  grupos.sort((a, b) => ORDEM_GRUPOS.indexOf(a.nome) - ORDEM_GRUPOS.indexOf(b.nome));

  // Chips por pessoa (só direção, e só se houver mais de uma pessoa com agenda).
  const donos = dir ? [...new Set(lista('comp').map((c) => c.dono).filter(Boolean))] : [];

  el.innerHTML =
    '<div class="grade g4 compacto" style="margin-bottom:16px">' +
      indicador('Em aberto', String(abertos.length), semData ? semData + ' sem data' : 'tudo com data') +
      indicador('Atrasados', String(atrasados), atrasados ? 'passaram da data' : 'nada atrasado', atrasados ? 'alerta' : 'ok') +
      indicador('Hoje', String(hoje), hoje ? 'marcados para hoje' : 'nada para hoje', hoje ? 'atencao' : '') +
      indicador('Resolvidos', String(feitos.length), 'já concluídos', feitos.length ? 'ok' : '') +
    '</div>' +

    (dir && donos.length > 1
      ? '<div class="filtros" style="margin-bottom:14px">' +
        '<button class="btn pequeno' + (!filtro ? ' primario' : '') + '" data-pessoa="">Equipe toda</button>' +
        donos.map((d) => {
          const n = compromissosAbertos(d).length;
          return '<button class="btn pequeno' + (filtro === d ? ' primario' : '') + '" data-pessoa="' + esc(d) + '">' +
            esc(nomeDono(d)) + (n ? ' (' + n + ')' : '') + '</button>';
        }).join('') + '</div>'
      : '') +

    (grupos.length
      ? grupos.map((g) =>
          '<div class="cartao"><h3>' + esc(g.nome) + ' <span class="etiqueta">' + g.itens.length + '</span></h3>' +
          g.itens.map(linha).join('') + '</div>').join('')
      : '<div class="cartao">' + vazio('🗓️', 'Nada em aberto' + (filtro ? ' para esta pessoa' : ''),
          'Use "Novo compromisso" para anotar uma visita, uma medição ou algo a resolver.') + '</div>') +

    (feitos.length
      ? '<div class="cartao"><h3>✅ Concluídos <span class="etiqueta">' + feitos.length + '</span></h3>' +
        '<div id="feitosComp" style="display:none">' + feitos.map(linha).join('') + '</div>' +
        '<button class="btn pequeno" id="verFeitos" style="margin-top:4px">Mostrar concluídos</button></div>'
      : '');

  document.getElementById('novoComp').addEventListener('click', () => editarCompromisso(null));
  el.querySelectorAll('[data-pessoa]').forEach((b) => b.addEventListener('click', () => {
    S.compDePessoa = b.dataset.pessoa || null;
    render();
  }));
  el.querySelectorAll('[data-feito]').forEach((b) => b.addEventListener('click', () => alternarFeitoComp(b.dataset.feito)));
  el.querySelectorAll('[data-editcomp]').forEach((b) => b.addEventListener('click', () => editarCompromisso(b.dataset.editcomp)));
  el.querySelectorAll('[data-delcomp]').forEach((b) => b.addEventListener('click', () => apagarCompromisso(b.dataset.delcomp)));
  el.querySelectorAll('[data-passar]').forEach((b) => b.addEventListener('click', () => encaminharCompromisso(b.dataset.passar)));
  const vf = document.getElementById('verFeitos');
  if (vf) vf.addEventListener('click', () => {
    const cx = document.getElementById('feitosComp');
    const aberto = cx.style.display !== 'none';
    cx.style.display = aberto ? 'none' : '';
    vf.textContent = aberto ? 'Mostrar concluídos' : 'Ocultar concluídos';
  });
};

/* ── Marcar feito / reabrir (otimista) ─────────────────────────────────────── */
function alternarFeitoComp(id) {
  const c = achar('comp', id);
  if (!c) return;
  const feito = !c.feito;
  salvar('comp', Object.assign({}, c, {
    feito, feitoEm: feito ? new Date().toISOString() : ''
  }));
  render();
}

/* ── Criar / editar ────────────────────────────────────────────────────────── */
function editarCompromisso(id) {
  const c = id ? achar('comp', id) : null;
  const dir = ehDirecaoComp();
  const pessoas = pessoasComp();

  abrirModal({
    titulo: id ? 'Editar compromisso' : 'Novo compromisso',
    largo: true,
    corpo: '<div id="fComp">' +
      campo('O que precisa ser feito', entrada('titulo', c && c.titulo, { placeholder: 'Ex.: Vistoriar a laje do 6º pavimento' })) +
      '<div class="linha">' +
        campo('Tipo', seletor('tipo', (c && c.tipo) || 'visita',
          Object.keys(TIPOS_COMP).map((k) => ({ v: k, t: TIPOS_COMP[k].icone + ' ' + TIPOS_COMP[k].rotulo })))) +
        campo('Obra / fornecedor / quem (opcional)', entrada('referencia', c && c.referencia,
          { placeholder: 'Ex.: Edifício Diamond' })) +
      '</div>' +
      '<div class="linha">' +
        campo('Data', entrada('data', c && c.data, { tipo: 'date' })) +
        campo('Hora', entrada('hora', c && c.hora, { tipo: 'time' })) +
        // Só a direção escolhe de quem é: os outros criam sempre para si.
        (dir && pessoas.length > 1
          ? campo('De quem é', seletor('dono', (c && c.dono) || meuDono(),
              pessoas.map((p) => ({ v: p.id, t: p.nome }))))
          : '') +
      '</div>' +
      campo('Observação', areaTexto('obs', c && c.obs, 'Endereço, telefone, o que levar…')) +
    '</div>',
    acoes: [
      (id ? { texto: 'Apagar', classe: 'perigo', aoClicar: () => { fecharModal(); apagarCompromisso(id); } } : null),
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: id ? 'Salvar' : 'Cadastrar', classe: 'primario', aoClicar: (fundo) => {
        const d = lerCampos(fundo.querySelector('#fComp'));
        if (!d.titulo.trim()) { toast('Escreva o que precisa ser feito', 'ruim'); return; }
        // RELÊ do store na hora de gravar. O modal fica aberto enquanto o sync
        // roda; gravar por cima do retrato de quando ele abriu apagaria um
        // "feito" marcado por outro aparelho ou o histórico. Só os campos do
        // formulário mudam.
        const base = (id && achar('comp', id)) || {};
        const reg = Object.assign({}, base, {
          id: id || undefined,
          titulo: d.titulo.trim(), tipo: d.tipo, referencia: (d.referencia || '').trim(),
          data: d.data, hora: d.hora, obs: (d.obs || '').trim()
        });
        // A direção pode atribuir; os outros vão sempre para a própria agenda
        // (o servidor carimba o dono de qualquer jeito, isto é só a intenção).
        if (dir && d.dono) reg.dono = d.dono;
        else if (!id) reg.dono = meuDono();
        salvar('comp', reg);
        fecharEste(fundo); render();
        toast('Compromisso salvo', 'bom');
      } }
    ].filter(Boolean)
  });
}

/* ── Encaminhar para outra pessoa ──────────────────────────────────────────── */
function encaminharCompromisso(id) {
  const c = achar('comp', id);
  if (!c) return;
  const outros = pessoasComp().filter((p) => p.id !== c.dono);
  if (!outros.length) { toast('Não há outra pessoa cadastrada para receber', 'ruim'); return; }
  abrirModal({
    titulo: 'Encaminhar compromisso',
    corpo: '<p class="legenda">"' + esc(c.titulo) + '" vai para a agenda de outra pessoa. ' +
      'Depois de encaminhar, ele sai da sua lista.</p>' +
      campo('Passar para', seletor('para', outros[0].id, outros.map((p) => ({ v: p.id, t: p.nome })))),
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Encaminhar', classe: 'primario', aoClicar: async (fundo) => {
        const para = fundo.querySelector('[data-campo=para]').value;
        const nome = nomeDono(para);
        salvar('comp', Object.assign({}, c, { dono: para }));
        fecharEste(fundo);
        // O servidor filtra por dono: para ele sair da minha lista, puxo de novo.
        try { await puxar(); } catch { /* segue com o cache */ }
        render();
        toast('Encaminhado para ' + nome, 'bom');
      } }
    ]
  });
}

/* ── Apagar ────────────────────────────────────────────────────────────────
   Exclusão SUAVE via salvar (apagadoEm), não a rota 'apagar': assim funciona
   offline, passa pela checagem de dono do servidor (a rota 'apagar' é barrada
   para o perfil obra) e some da lista na hora. A rotina diária varre depois. */
async function apagarCompromisso(id) {
  const c = achar('comp', id);
  if (!c) return;
  if (!await confirmar('Apagar "' + (c.titulo || 'este compromisso') + '"?', { perigo: true, ok: 'Apagar' })) return;
  salvar('comp', Object.assign({}, c, { apagadoEm: new Date().toISOString(), apagadoPor: S.quem || '—' }));
  render();
}
