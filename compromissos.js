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
  lembrete:  { rotulo: 'Lembrete', icone: '🔔' },
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
// Nome de quem é o compromisso. Cai no donoNome que o servidor carimba (pega
// até quem já foi DESLIGADO, que não vem mais no roster) antes do id cru.
function nomeDono(dono, donoNome) {
  const p = pessoasComp().find((x) => x.id === dono);
  return (p && p.nome) || donoNome || (dono === 'equipe' ? 'Direção' : '') || dono || '—';
}
// O telefone só existe no cadastro completo (cfg.usuarios), que só a direção
// recebe. Para os outros, o WhatsApp abre pedindo o número.
function telefoneDono(dono) {
  const u = ((S.cfg && S.cfg.usuarios) || []).find((x) => x.id === dono);
  return (u && u.telefone) || '';
}

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
// Uma linha da agenda. Clicar no corpo abre a CONVERSA; o quadradinho e os
// botões pequenos agem sem abrir.
function linhaComp(c, dir, mostraDono) {
  const nAnexos = (c.anexos || []).filter((a) => a && !a.apagadoEm).length;
  const nFala = (c.historico || []).filter((h) => h && (h.tipo === 'comentario' || h.tipo === 'anexo')).length;
  return '<div class="arquivo-solto' + (c.feito ? ' feito-comp' : '') + '" style="align-items:flex-start">' +
      '<button class="check-comp' + (c.feito ? ' on' : '') + '" data-feito="' + esc(c.id) + '" title="' +
        (c.feito ? 'Reabrir' : 'Marcar como feito') + '">' + (c.feito ? '✓' : '') + '</button>' +
      '<div class="comp-corpo" data-abrir="' + esc(c.id) + '" style="flex:1;min-width:0;cursor:pointer;display:flex;gap:10px">' +
        '<span class="ic" title="' + esc(c.t.rotulo) + '">' + c.t.icone + '</span>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="nome"' + (c.feito ? ' style="text-decoration:line-through;color:var(--texto-fraco)"' : '') + '>' +
            esc(c.titulo) + '</div>' +
          '<div class="meta">' + [
            c.t.rotulo,
            c.referencia ? esc(c.referencia) : '',
            (mostraDono && c.dono !== meuDono()) ? '👤 ' + esc(nomeDono(c.dono, c.donoNome)) : '',
            (c.encaminhadoPor ? '↪ veio de ' + esc(c.encaminhadoPor) : ''),
            nFala ? '💬 ' + nFala : '',
            nAnexos ? '📎 ' + nAnexos : ''
          ].filter(Boolean).join(' · ') + '</div>' +
          (c.data ? '<div class="meta">' + fmt.data(c.data) + (c.hora ? ' às ' + esc(c.hora) : '') + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="acoes" style="flex-direction:column;align-items:flex-end">' +
        (c.feito ? '' : '<span class="etiqueta ' + c.pz.cls + '">' + esc(c.pz.txt) + '</span>') +
        '<div style="display:flex;gap:2px;margin-top:4px">' +
          (pessoasComp().some((p) => p.id !== c.dono) ? '<button class="btn pequeno" data-passar="' + esc(c.id) + '" title="Encaminhar">↪</button>' : '') +
          '<button class="btn pequeno" data-editcomp="' + esc(c.id) + '" title="Editar">✎</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}

// Liga os cliques comuns às linhas (abrir conversa, feito, editar, encaminhar).
function ligarLinhasComp(el) {
  el.querySelectorAll('[data-abrir]').forEach((b) => b.addEventListener('click', () => irPara('compromissos/' + b.dataset.abrir)));
  el.querySelectorAll('[data-feito]').forEach((b) => b.addEventListener('click', () => alternarFeitoComp(b.dataset.feito)));
  el.querySelectorAll('[data-editcomp]').forEach((b) => b.addEventListener('click', () => editarCompromisso(b.dataset.editcomp)));
  el.querySelectorAll('[data-passar]').forEach((b) => b.addEventListener('click', () => encaminharCompromisso(b.dataset.passar)));
}

TELAS.compromissos = function (el, args) {
  if (args[0]) return telaCompromisso(el, args[0]);

  const dir = ehDirecaoComp();
  // Direção pode ver por urgência ou AGRUPADO POR PESSOA (o padrão dela).
  const modo = dir ? (S.compModo || 'pessoa') : 'urgencia';

  const enriquece = (c) => {
    const dias = c.data ? diasAte(c.data) : null;
    return Object.assign({}, c, { dias, pz: prazoComp(dias), t: tipoComp(c.tipo) });
  };
  const todos = lista('comp')
    // Quem não é direção só vê os SEUS (defesa em profundidade além do servidor).
    .filter((c) => dir || c.dono === meuDono())
    .map(enriquece);
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

  // Monta os grupos conforme o modo.
  let grupos;
  if (modo === 'pessoa') {
    // Um bloco por pessoa, com os abertos dela por urgência dentro.
    const porDono = new Map();
    for (const c of abertos) {
      if (!porDono.has(c.dono)) porDono.set(c.dono, []);
      porDono.get(c.dono).push(c);
    }
    grupos = [...porDono.entries()]
      .map(([dono, itens]) => ({ nome: '👤 ' + nomeDono(dono, (itens[0] || {}).donoNome), itens }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  } else {
    grupos = [];
    for (const c of abertos) {
      let g = grupos.find((x) => x.nome === c.pz.grupo);
      if (!g) { g = { nome: c.pz.grupo, itens: [] }; grupos.push(g); }
      g.itens.push(c);
    }
    grupos.sort((a, b) => ORDEM_GRUPOS.indexOf(a.nome) - ORDEM_GRUPOS.indexOf(b.nome));
  }
  const mostraDono = dir && modo !== 'pessoa';

  el.innerHTML =
    '<div class="grade g4 compacto" style="margin-bottom:16px">' +
      indicador('Em aberto', String(abertos.length), semData ? semData + ' sem data' : 'tudo com data') +
      indicador('Atrasados', String(atrasados), atrasados ? 'passaram da data' : 'nada atrasado', atrasados ? 'alerta' : 'ok') +
      indicador('Hoje', String(hoje), hoje ? 'marcados para hoje' : 'nada para hoje', hoje ? 'atencao' : '') +
      indicador('Resolvidos', String(feitos.length), 'já concluídos', feitos.length ? 'ok' : '') +
    '</div>' +

    (dir
      ? '<div class="abas">' +
          '<button class="aba' + (modo === 'pessoa' ? ' ativa' : '') + '" data-modo="pessoa">👤 Por pessoa</button>' +
          '<button class="aba' + (modo === 'urgencia' ? ' ativa' : '') + '" data-modo="urgencia">🕒 Por urgência</button>' +
        '</div>'
      : '') +

    (grupos.length
      ? grupos.map((g) =>
          '<div class="cartao"><h3>' + esc(g.nome) + ' <span class="etiqueta">' + g.itens.length + '</span></h3>' +
          g.itens.map((c) => linhaComp(c, dir, mostraDono)).join('') + '</div>').join('')
      : '<div class="cartao">' + vazio('🗓️', 'Nada em aberto',
          'Use "Novo compromisso" para anotar uma visita, uma medição ou algo a resolver.') + '</div>') +

    (feitos.length
      ? '<div class="cartao"><h3>✅ Concluídos <span class="etiqueta">' + feitos.length + '</span></h3>' +
        '<div id="feitosComp" style="display:none">' + feitos.map((c) => linhaComp(c, dir, dir)).join('') + '</div>' +
        '<button class="btn pequeno" id="verFeitos" style="margin-top:4px">Mostrar concluídos</button></div>'
      : '');

  document.getElementById('novoComp').addEventListener('click', () => editarCompromisso(null));
  el.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => { S.compModo = b.dataset.modo; render(); }));
  ligarLinhasComp(el);
  const vf = document.getElementById('verFeitos');
  if (vf) vf.addEventListener('click', () => {
    const cx = document.getElementById('feitosComp');
    const aberto = cx.style.display !== 'none';
    cx.style.display = aberto ? 'none' : '';
    vf.textContent = aberto ? 'Mostrar concluídos' : 'Ocultar concluídos';
    if (!aberto) ligarLinhasComp(cx);
  });
};

/* ── Marcar feito / reabrir (otimista) ─────────────────────────────────────── */
// Cada mudança de estado vira uma linha na conversa — a história fica DENTRO do
// compromisso. O 'por' de fato quem é a autoria é carimbado no servidor.
function eventoComp(tipo, texto) {
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    em: new Date().toISOString(), por: S.quem || '—', tipo, texto };
}

function alternarFeitoComp(id) {
  const c = achar('comp', id);
  if (!c) return;
  const feito = !c.feito;
  salvar('comp', Object.assign({}, c, {
    feito, feitoEm: feito ? new Date().toISOString() : '',
    historico: [...(c.historico || []), eventoComp(feito ? 'feito' : 'reaberto', feito ? 'Marcou como feito' : 'Reabriu')]
  }));
  render();
}

/* ══════════════════════════════════════════════════════════════════════════
   A CONVERSA — o detalhe de um compromisso, com a história, os anexos e o
   espaço para comentar. Tudo mora dentro do próprio compromisso.
   ══════════════════════════════════════════════════════════════════════════ */
const ICONE_EVENTO = { criado: '✳️', encaminhado: '↪', feito: '✅', reaberto: '↩️', comentario: '💬', anexo: '📎' };

function telaCompromisso(el, id) {
  const c = achar('comp', id);
  if (!c) { cabecalho('Compromisso', ''); el.innerHTML = vazio('🤔', 'Compromisso não encontrado'); return; }
  const dir = ehDirecaoComp();
  const t = tipoComp(c.tipo);
  const dias = c.data ? diasAte(c.data) : null;
  const pz = prazoComp(dias);
  const tel = telefoneDono(c.dono);

  cabecalho(t.icone + ' ' + (c.titulo || 'Compromisso'),
    (c.feito ? 'Concluído' : pz.txt) + ' · ' + t.rotulo +
      (dir ? ' · 👤 ' + esc(nomeDono(c.dono, c.donoNome)) : ''),
    '<a class="btn" href="#/compromissos">← Voltar</a>' +
    '<button class="btn" id="cWhats"' + (tel ? '' : ' title="A pessoa não tem WhatsApp no cadastro"') + '>📲 WhatsApp (PDF)</button>' +
    '<button class="btn" id="cEditar">Editar</button>' +
    (pessoasComp().some((p) => p.id !== c.dono) ? '<button class="btn" id="cPassar">↪ Encaminhar</button>' : ''));

  const anexos = (c.anexos || []).filter((a) => a && !a.apagadoEm);
  // A história, do mais antigo para o mais novo (a conversa lê de cima para baixo).
  const fio = (c.historico || []).slice()
    .sort((a, b) => String(a.em || '').localeCompare(String(b.em || '')));

  el.innerHTML =
    '<div class="grade g2"><div>' +
      // ── cabeçalho do compromisso ──
      '<div class="cartao">' +
        '<div class="barra-acoes" style="justify-content:space-between;align-items:flex-start">' +
          '<div><h3 style="margin:0">' + esc(c.titulo) + '</h3>' +
            '<div class="legenda">' + esc(t.rotulo) + (c.referencia ? ' · ' + esc(c.referencia) : '') + '</div></div>' +
          '<button class="check-comp' + (c.feito ? ' on' : '') + '" id="cFeito" title="' +
            (c.feito ? 'Reabrir' : 'Marcar como feito') + '">' + (c.feito ? '✓' : '') + '</button>' +
        '</div>' +
        '<p style="margin-top:10px">' +
          (c.data ? '<b>Quando:</b> ' + fmt.data(c.data) + (c.hora ? ' às ' + esc(c.hora) : '') +
            ' <span class="etiqueta ' + pz.cls + '">' + esc(c.feito ? 'concluído' : pz.txt) + '</span><br>' : '<b>Sem data marcada.</b><br>') +
          '<b>De quem é:</b> ' + esc(nomeDono(c.dono, c.donoNome)) +
            (c.encaminhadoPor ? ' · <span style="color:var(--texto-fraco)">veio de ' + esc(c.encaminhadoPor) + '</span>' : '') + '<br>' +
          (c.obs ? '<b>Observação:</b> ' + esc(c.obs) : '') +
        '</p>' +
      '</div>' +

      // ── a conversa ──
      '<div class="cartao"><h3>💬 Conversa</h3>' +
        (fio.length
          ? '<div class="fio-comp">' + fio.map((h) =>
              '<div class="fio-item' + (h.tipo === 'comentario' ? ' fio-fala' : '') + '">' +
                '<span class="fio-ic">' + (ICONE_EVENTO[h.tipo] || '•') + '</span>' +
                '<div style="flex:1;min-width:0">' +
                  '<div class="fio-txt">' + esc(h.texto || '') + '</div>' +
                  '<div class="meta">' + esc(h.por || '—') + ' · ' + fmt.quando(h.em) + '</div>' +
                '</div></div>').join('') + '</div>'
          : '<p class="legenda">Ainda sem conversa. Comente abaixo, anexe um arquivo ou encaminhe.</p>') +
        '<div style="margin-top:12px;display:flex;gap:8px;align-items:flex-start">' +
          '<textarea id="cComentario" rows="2" placeholder="Escreva um comentário…" style="flex:1"></textarea>' +
          '<button class="btn primario" id="cEnviarComent">Comentar</button>' +
        '</div>' +
      '</div>' +
    '</div><div>' +

      // ── anexos ──
      '<div class="cartao"><h3>📎 Anexos</h3>' +
        (anexos.length
          ? anexos.map((a) =>
              '<div class="arquivo-solto"><span class="ic">' + iconeAnexo(a) + '</span>' +
              '<div style="flex:1;min-width:0"><div class="nome">' + esc(a.nome || 'arquivo') + '</div>' +
              '<div class="meta">' + (a.tamanho ? fmt.tamanho(a.tamanho) + ' · ' : '') + esc(a.por || '') +
                ' · ' + fmt.quando(a.em) + '</div></div>' +
              '<div class="acoes"><button class="btn pequeno" data-baixaanexo="' + esc(a.arquivoId) +
                '" data-nome="' + esc(a.nome || 'arquivo') + '">Baixar</button></div></div>').join('')
          : '<p class="legenda">Nenhum arquivo anexado.</p>') +
        '<div class="progresso" id="cAnexoProg" style="display:none;margin-top:8px"><i></i></div>' +
        '<button class="btn" id="cAnexar" style="margin-top:8px">📎 Anexar arquivo</button>' +
      '</div>' +

      '<div class="cartao"><button class="btn perigo" id="cApagar" style="width:100%">Apagar compromisso</button></div>' +
    '</div></div>';

  document.getElementById('cFeito').addEventListener('click', () => alternarFeitoComp(id));
  document.getElementById('cEditar').addEventListener('click', () => editarCompromisso(id));
  document.getElementById('cApagar').addEventListener('click', () => apagarCompromisso(id, true));
  const bp = document.getElementById('cPassar');
  if (bp) bp.addEventListener('click', () => encaminharCompromisso(id));
  document.getElementById('cWhats').addEventListener('click', () => enviarCompromissoWhats(id));
  document.getElementById('cEnviarComent').addEventListener('click', () => {
    const ta = document.getElementById('cComentario');
    const txt = (ta.value || '').trim();
    if (!txt) { toast('Escreva o comentário', 'ruim'); return; }
    comentarCompromisso(id, txt);
  });
  document.getElementById('cAnexar').addEventListener('click', () => anexarAoCompromisso(id));
  el.querySelectorAll('[data-baixaanexo]').forEach((b) => b.addEventListener('click', () => baixarAnexoComp(b.dataset.baixaanexo, b.dataset.nome)));
}

const iconeAnexo = (a) => {
  const m = String(a.mime || a.nome || '').toLowerCase();
  if (m.includes('pdf')) return '📕';
  if (m.match(/image|jpg|jpeg|png|heic/)) return '🖼️';
  if (m.match(/sheet|excel|xls|csv/)) return '📊';
  return '📄';
};

/* ── Comentar ──────────────────────────────────────────────────────────────── */
function comentarCompromisso(id, texto) {
  const c = achar('comp', id);
  if (!c) return;
  salvar('comp', Object.assign({}, c, {
    historico: [...(c.historico || []), eventoComp('comentario', texto)]
  }));
  render();
}

/* ── Anexar arquivo à conversa ─────────────────────────────────────────────── */
function anexarAoCompromisso(id) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.addEventListener('change', async () => {
    const file = inp.files[0];
    if (!file) return;
    const prog = document.getElementById('cAnexoProg');
    const btn = document.getElementById('cAnexar');
    if (btn) btn.disabled = true;
    if (prog) prog.style.display = '';
    try {
      const meta = await enviarArquivo(file, (p) => { if (prog) prog.querySelector('i').style.width = (p * 100) + '%'; });
      const base = achar('comp', id);   // relê: o upload pode ter demorado
      // Se o compromisso saiu da minha lista durante o upload (foi encaminhado),
      // NÃO crio um compromisso-fantasma só com o anexo — aviso e paro.
      if (!base) { toast('Este compromisso saiu da sua lista; o anexo não foi vinculado', 'ruim'); return; }
      const anexo = { id: meta.id, arquivoId: meta.id, nome: file.name,
        tamanho: file.size, mime: file.type || meta.mime || '', em: new Date().toISOString(), por: S.quem || '—' };
      salvar('comp', Object.assign({}, base, {
        anexos: [...(base.anexos || []), anexo],
        historico: [...(base.historico || []), eventoComp('anexo', 'Anexou ' + file.name)]
      }));
      toast('Arquivo anexado', 'bom');
    } catch (e) {
      toast('Não consegui anexar (precisa de internet): ' + e.message, 'ruim');
    } finally {
      if (prog) prog.style.display = 'none';
      if (btn) btn.disabled = false;
      render();
    }
  });
  inp.click();
}

function baixarAnexoComp(arquivoId, nome) {
  toast('Baixando…');
  baixarArquivo(arquivoId).then(({ blob }) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome || 'arquivo';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }).catch((e) => toast('Não consegui baixar: ' + e.message, 'ruim'));
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
        // Ao CRIAR, a conversa começa com o evento de abertura.
        if (!id) {
          const paraQuem = (dir && d.dono && d.dono !== meuDono()) ? ' e atribuiu a ' + nomeDono(d.dono) : '';
          reg.historico = [eventoComp('criado', 'Criou o compromisso' + paraQuem)];
        }
        const salvo = salvar('comp', reg);
        fecharEste(fundo);
        toast('Compromisso salvo', 'bom');
        // Recém-criado abre direto na conversa; edição volta para onde estava.
        if (!id) irPara('compromissos/' + salvo.id); else render();
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
        // O servidor registra o evento "encaminhou de X para Y" no fio da
        // conversa — aqui só muda o dono. O evento vem no próximo sync.
        salvar('comp', Object.assign({}, achar('comp', id) || c, { dono: para }));
        fecharEste(fundo);
        // Se eu não for da direção, o compromisso saiu da minha lista: volto
        // para a agenda. A direção continua vendo, então fica na conversa.
        if (!ehDirecaoComp()) irPara('compromissos'); else render();
        // O servidor filtra por dono: puxo de novo para refletir a mudança.
        try { await puxar(); render(); } catch { /* segue com o cache */ }
        toast('Encaminhado para ' + nome, 'bom');
      } }
    ]
  });
}

/* ── Apagar ────────────────────────────────────────────────────────────────
   Exclusão SUAVE via salvar (apagadoEm), não a rota 'apagar': assim funciona
   offline, passa pela checagem de dono do servidor (a rota 'apagar' é barrada
   para o perfil obra) e some da lista na hora. A rotina diária varre depois. */
async function apagarCompromisso(id, voltar) {
  const c = achar('comp', id);
  if (!c) return;
  if (!await confirmar('Apagar "' + (c.titulo || 'este compromisso') + '"?', { perigo: true, ok: 'Apagar' })) return;
  salvar('comp', Object.assign({}, c, { apagadoEm: new Date().toISOString(), apagadoPor: S.quem || '—' }));
  if (voltar) irPara('compromissos'); else render();
}

/* ══════════════════════════════════════════════════════════════════════════
   PDF + WHATSAPP — mandar o compromisso pronto para a pessoa.
   O wa.me só leva TEXTO, não anexa arquivo. Então: no celular, usamos o
   compartilhamento nativo (navigator.share com o PDF), que abre o WhatsApp já
   com o arquivo. Onde isso não existe (desktop), baixamos o PDF e abrimos a
   conversa com um resumo em texto, para a pessoa anexar o PDF na mão.
   ══════════════════════════════════════════════════════════════════════════ */
async function pdfCompromisso(c) {
  const logo = await carregarLogo();
  const doc = novoDoc();
  const t = tipoComp(c.tipo);
  let y = cabecalhoPDF(doc, logo, S.cfg, 'COMPROMISSO', t.rotulo);

  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  y += 2;
  doc.splitTextToSize(c.titulo || '—', 190).forEach((ln) => { doc.text(ln, 10, y); y += 6; });

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(60, 60, 60);
  const linhas = [
    c.data ? 'Quando: ' + fmt.data(c.data) + (c.hora ? ' às ' + c.hora : '') : 'Sem data marcada',
    'Responsável: ' + nomeDono(c.dono, c.donoNome),
    c.referencia ? 'Obra / quem: ' + c.referencia : '',
    c.feito ? 'Situação: CONCLUÍDO' : 'Situação: em aberto',
    c.obs ? 'Observação: ' + c.obs : ''
  ].filter(Boolean);
  y += 1;
  linhas.forEach((l) => { doc.splitTextToSize(l, 190).forEach((ln) => { doc.text(ln, 10, y); y += 5; }); });

  // A conversa
  const fio = (c.historico || []).slice().sort((a, b) => String(a.em || '').localeCompare(String(b.em || '')));
  if (fio.length) {
    y += 4; doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(0, 61, 168);
    doc.text('Histórico', 10, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6); doc.setTextColor(50, 50, 50);
    for (const h of fio) {
      if (y > 275) { doc.addPage(); y = 15; }
      const cab = fmt.dataHora(h.em) + ' · ' + (h.por || '—') + ':';
      doc.setFont('helvetica', 'bold'); doc.text(cab, 10, y); y += 4;
      doc.setFont('helvetica', 'normal');
      // Quebra de página DENTRO do comentário também: um comentário longo passava
      // do rodapé e as linhas seguintes sumiam da folha.
      doc.splitTextToSize(h.texto || '', 188).forEach((ln) => {
        if (y > 285) { doc.addPage(); y = 15; }
        doc.text(ln, 12, y); y += 4.2;
      });
      y += 1.5;
    }
  }
  const anexos = (c.anexos || []).filter((a) => a && !a.apagadoEm);
  if (anexos.length) {
    if (y > 265) { doc.addPage(); y = 15; }
    y += 3; doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(0, 61, 168);
    doc.text('Anexos', 10, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6); doc.setTextColor(50, 50, 50);
    anexos.forEach((a) => { doc.text('• ' + (a.nome || 'arquivo') + (a.tamanho ? ' (' + fmt.tamanho(a.tamanho) + ')' : ''), 12, y); y += 4.4; });
  }
  return doc;
}

async function enviarCompromissoWhats(id) {
  const c = achar('comp', id);
  if (!c) return;
  toast('Gerando o PDF…');
  let doc;
  try { doc = await pdfCompromisso(c); }
  catch (e) { toast('Não consegui gerar o PDF: ' + e.message, 'ruim'); return; }

  const nomeArq = 'compromisso-' + (c.titulo || 'domo').replace(/\W+/g, '_').slice(0, 30) + '.pdf';
  const blob = doc.output('blob');
  const file = new File([blob], nomeArq, { type: 'application/pdf' });

  const resumo = [
    '*' + ((S.cfg && S.cfg.empresa && S.cfg.empresa.nomeCurto) || 'Domo Construtora') + '* — compromisso',
    '',
    c.titulo,
    c.data ? '📅 ' + fmt.data(c.data) + (c.hora ? ' às ' + c.hora : '') : '',
    c.referencia ? '📍 ' + c.referencia : '',
    c.obs ? '📝 ' + c.obs : '',
    '',
    'Segue o PDF em anexo.'
  ].filter(Boolean).join('\n');

  // 1) Celular: compartilhamento nativo com o arquivo — abre o WhatsApp com o
  //    PDF já anexado.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: c.titulo || 'Compromisso', text: resumo });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // a pessoa fechou o menu
      /* sem suporte real: cai no plano B */
    }
  }

  // 2) Desktop / sem compartilhamento: baixa o PDF e abre a conversa com o
  //    resumo — a pessoa anexa o PDF que acabou de baixar.
  doc.save(nomeArq);
  const tel = telefoneDono(c.dono);
  const numero = tel || await perguntar('Para qual WhatsApp? (só números, com DDD)',
    { titulo: 'Enviar no WhatsApp', valor: '', ok: 'Abrir conversa' });
  // Fechou o modal (null) ou deixou em branco: não abre conversa sem número.
  if (!numero) return;
  window.open(linkWhats(numero, resumo + '\n\n(o PDF foi baixado no seu aparelho — anexe aqui)'), '_blank');
  toast('PDF baixado. Anexe-o na conversa que abriu.', 'bom');
}
