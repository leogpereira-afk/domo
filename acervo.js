/* Acervo — Projetos e Documentos.
   Arquivo grande sobe em partes (ver store.js) e volta remontado no navegador,
   então planta em PDF de 40MB funciona igual a um arquivo pequeno. */

const ICONES = { pdf: '📕', dwg: '📐', dxf: '📐', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', doc: '📄', docx: '📄', xls: '📊', xlsx: '📊', zip: '🗜️', rar: '🗜️' };
const iconeArquivo = (nome) => ICONES[String(nome || '').split('.').pop().toLowerCase()] || '📎';

/* Sobe um ou vários arquivos mostrando o progresso. Devolve os metadados. */
async function subirArquivos(files, aoTerminarCada) {
  const arquivos = Array.from(files || []);
  if (!arquivos.length) return [];
  // semFechar (um toque errado matava o envio de uma prancha de 40MB), mas com
  // saída consciente: o botão Cancelar interrompe entre as partes.
  const cancelar = { pedido: false };
  const fundo = abrirModal({
    titulo: 'Enviando ' + arquivos.length + ' arquivo(s)',
    corpo: '<div id="subLista"></div>',
    semFechar: true,
    acoes: [{ texto: 'Cancelar envio', classe: 'perigo', aoClicar: () => {
      cancelar.pedido = true;
      toast('Cancelando… aguarde a parte atual terminar.', 'ruim');
    } }]
  });
  const caixa = fundo.querySelector('#subLista');
  const metas = [];
  let falhas = 0;
  for (const f of arquivos) {
    if (cancelar.pedido) { falhas++; continue; }
    const linha = document.createElement('div');
    linha.className = 'arquivo-solto';
    linha.innerHTML = '<span class="ic">' + iconeArquivo(f.name) + '</span>' +
      '<div style="flex:1"><div class="nome">' + esc(f.name) + '</div>' +
      '<div class="meta">' + fmt.tamanho(f.size) + '</div>' +
      '<div class="progresso"><i></i></div></div>';
    caixa.appendChild(linha);
    const barra = linha.querySelector('.progresso i');
    try {
      const meta = await enviarArquivo(f, (p) => { barra.style.width = (p * 100) + '%'; }, cancelar);
      barra.style.background = 'var(--verde)';
      metas.push(meta);
      if (aoTerminarCada) aoTerminarCada(meta, f);
    } catch (e) {
      falhas++;
      linha.querySelector('.meta').innerHTML = '<span style="color:var(--vermelho)">falhou: ' + esc(e.message) + '</span>';
      barra.style.background = 'var(--vermelho)';
    }
  }
  fecharEste(fundo);
  if (falhas) toast(falhas + ' arquivo(s) não subiram.', 'ruim');
  return metas;
}

// Baixa mostrando barra de progresso: numa prancha de 40MB o usuário ficava
// olhando uma tela parada e clicava de novo, começando um segundo download.
let _baixando = false;
async function baixar(arquivoId, nome) {
  if (_baixando) { toast('Já tem um download em andamento', 'ruim'); return; }
  _baixando = true;
  const fundo = abrirModal({
    titulo: 'Baixando ' + (nome || 'arquivo'),
    corpo: '<div class="progresso"><i id="barraBaixa"></i></div>' +
      '<p class="legenda" style="margin-top:8px">Arquivo grande pode levar alguns minutos.</p>',
    semFechar: true, acoes: []
  });
  try {
    const { blob, meta } = await baixarArquivo(arquivoId, (p) => {
      const b = document.getElementById('barraBaixa');
      if (b) b.style.width = (p * 100) + '%';
    });
    fecharEste(fundo);
    salvarNoAparelho(blob, nome || meta.nome);
  } catch (e) {
    fecharEste(fundo);
    toast('Não consegui baixar: ' + e.message, 'ruim');
  } finally {
    _baixando = false;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   PROJETOS
   ══════════════════════════════════════════════════════════════════════════ */
TELAS.projetos = function (el) {
  const todos = lista('proj');
  const filtro = S.filtroProj || { obra: '', disciplina: '', busca: '' };
  S.filtroProj = filtro;
  const filtrados = todos.filter((p) =>
    (!filtro.obra || p.obraId === filtro.obra) &&
    (!filtro.disciplina || p.disciplina === filtro.disciplina) &&
    (!filtro.busca || (p.nome + ' ' + (p.descricao || '')).toLowerCase().includes(filtro.busca.toLowerCase())));

  const porDisciplina = {};
  for (const p of filtrados) (porDisciplina[p.disciplina || 'Outros'] || (porDisciplina[p.disciplina || 'Outros'] = [])).push(p);

  // Quem é da obra CONSULTA planta; quem sobe e revisa é o escritório. O
  // servidor recusa a gravação — mostrar o botão só fazia a pessoa preencher
  // um formulário que sumia depois.
  const podeMexer = typeof podeEscrever !== 'function' || podeEscrever('proj');
  cabecalho('Projetos', todos.length + ' arquivo(s) · sempre a versão mais nova',
    podeMexer ? '<button class="btn primario" id="subirProj">⬆️ Subir projeto</button>' : '');

  el.innerHTML =
    '<div class="filtros">' +
      '<input type="search" id="pjBusca" placeholder="Buscar projeto…" value="' + esc(filtro.busca) + '">' +
      '<select id="pjObra"><option value="">Todas as obras</option>' +
        obras().map((o) => '<option value="' + esc(o.id) + '"' + (filtro.obra === o.id ? ' selected' : '') + '>' + esc(o.nome) + '</option>').join('') +
      '</select>' +
      '<select id="pjDisc"><option value="">Todas as disciplinas</option>' +
        cfgLista('disciplinas').map((d) => '<option' + (filtro.disciplina === d ? ' selected' : '') + '>' + esc(d) + '</option>').join('') +
      '</select>' +
    '</div>' +
    (podeMexer ? '<div class="solta-aqui" id="solta">Arraste os arquivos aqui ou clique para escolher<br>' +
      '<small>PDF, DWG, imagens, planilhas — qualquer tamanho</small></div>' : '') +
    (filtrados.length ? Object.keys(porDisciplina).sort().map((d) =>
      '<div class="cartao"><h3>' + esc(d) + ' <span class="etiqueta">' + porDisciplina[d].length + '</span></h3>' +
      porDisciplina[d].map((p) =>
        '<div class="arquivo-solto">' +
          '<span class="ic">' + iconeArquivo(p.arquivoNome || p.nome) + '</span>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="nome">' + esc(p.nome) + ' <span class="etiqueta">' + esc(p.revisao || 'R00') + '</span></div>' +
            '<div class="meta">' + esc(nomeObra(p.obraId)) + ' · ' + fmt.tamanho(p.tamanho) + ' · enviado ' + fmt.quando(p.criadoEm) +
            ' por ' + esc(p.criadoPor || '—') + ((p.versoes || []).length ? ' · ' + (p.versoes.length + 1) + ' versões' : '') + '</div>' +
            (p.descricao ? '<div class="meta">' + esc(p.descricao) + '</div>' : '') +
          '</div>' +
          '<div class="acoes">' +
            '<button class="btn pequeno primario" data-baixar="' + esc(p.id) + '">Baixar</button>' +
            '<button class="btn pequeno" data-proj="' + esc(p.id) + '">⋯</button>' +
          '</div>' +
        '</div>').join('') + '</div>').join('')
      : '<div class="cartao">' + vazio('📐', 'Nenhum projeto', 'Suba as pranchas para o pessoal baixar direto da obra.') + '</div>');

  // Filtros
  const aplicar = () => {
    filtro.obra = document.getElementById('pjObra').value;
    filtro.disciplina = document.getElementById('pjDisc').value;
    render();
  };
  document.getElementById('pjObra').addEventListener('change', aplicar);
  document.getElementById('pjDisc').addEventListener('change', aplicar);
  let t;
  document.getElementById('pjBusca').addEventListener('input', (e) => {
    clearTimeout(t); const v = e.target.value;
    t = setTimeout(() => {
      filtro.busca = v; render();
      const c = document.getElementById('pjBusca'); if (c) c.focus();
    }, 400);
  });

  // Envio
  const escolher = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true;
    inp.addEventListener('change', () => formularioProjeto(inp.files));
    inp.click();
  };
  const bsp = document.getElementById('subirProj');
  if (bsp) bsp.addEventListener('click', escolher);
  const solta = document.getElementById('solta');
  if (solta) solta.addEventListener('click', escolher);
  if (solta) ['dragenter', 'dragover'].forEach((ev) => solta.addEventListener(ev, (e) => {
    e.preventDefault(); solta.classList.add('por-cima');
  }));
  if (solta) ['dragleave', 'drop'].forEach((ev) => solta.addEventListener(ev, (e) => {
    e.preventDefault(); solta.classList.remove('por-cima');
  }));
  if (solta) solta.addEventListener('drop', (e) => formularioProjeto(e.dataTransfer.files));

  el.querySelectorAll('[data-baixar]').forEach((b) => b.addEventListener('click', () => {
    const p = achar('proj', b.dataset.baixar);
    if (!p) { toast('Este projeto não existe mais — atualize a tela', 'ruim'); return; }
    baixar(p.arquivoId, p.arquivoNome || p.nome);
  }));
  el.querySelectorAll('[data-proj]').forEach((b) => b.addEventListener('click', () => menuProjeto(b.dataset.proj)));
};

// Pergunta obra/disciplina e só então manda os arquivos.
function formularioProjeto(files) {
  const arquivos = Array.from(files || []);
  if (!arquivos.length) return;
  abrirModal({
    titulo: 'Subir ' + arquivos.length + ' projeto(s)',
    corpo: '<div id="fProj">' +
      '<p class="legenda">' + arquivos.map((f) => esc(f.name) + ' (' + fmt.tamanho(f.size) + ')').join('<br>') + '</p>' +
      '<div class="linha">' +
        campo('Obra', seletor('obraId', (obras()[0] || {}).id, obras().map((o) => ({ v: o.id, t: o.nome })))) +
        campo('Disciplina', seletor('disciplina', 'Arquitetônico', cfgLista('disciplinas'))) +
        campo('Revisão', entrada('revisao', 'R00', { placeholder: 'R00' })) +
      '</div>' +
      campo('Descrição (opcional)', entrada('descricao', '', { placeholder: 'Ex.: planta de forma do 3º pavimento' })) +
    '</div>',
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Enviar', classe: 'primario', aoClicar: async (fundo) => {
        const d = lerCampos(fundo.querySelector('#fProj'));
        fecharEste(fundo);
        const metas = await subirArquivos(arquivos, (meta, file) => {
          salvar('proj', {
            nome: file.name.replace(/\.[^.]+$/, ''),
            arquivoNome: file.name,
            arquivoId: meta.id,
            tamanho: file.size,
            mime: file.type,
            obraId: d.obraId,
            obra: nomeObra(d.obraId),
            disciplina: d.disciplina,
            revisao: d.revisao || 'R00',
            descricao: d.descricao,
            versoes: []
          });
        });
        render();
        if (!metas.length) { toast('Nenhum arquivo subiu — nada foi salvo. Tente de novo.', 'ruim'); return; }
        toast(metas.length < arquivos.length
          ? metas.length + ' de ' + arquivos.length + ' projetos salvos'
          : 'Projeto disponível para a obra', metas.length < arquivos.length ? 'ruim' : 'bom');
      } }
    ]
  });
}

function menuProjeto(id) {
  const p = achar('proj', id);
  if (!p) return;
  abrirModal({
    titulo: p.nome,
    corpo:
      '<p class="legenda">' + esc(nomeObra(p.obraId)) + ' · ' + esc(p.disciplina) + ' · ' + esc(p.revisao || 'R00') +
      ' · ' + fmt.tamanho(p.tamanho) + '</p>' +
      ((p.versoes || []).length ? '<h3>Versões anteriores</h3>' +
        p.versoes.slice().reverse().map((v) =>
          '<div class="arquivo-solto"><span class="ic">🕓</span><div style="flex:1">' +
          '<div class="nome">' + esc(v.revisao) + '</div><div class="meta">' + fmt.dataHora(v.em) + ' · ' +
          esc(v.por || '') + ' · ' + fmt.tamanho(v.tamanho) + '</div></div>' +
          '<div class="acoes"><button class="btn pequeno" data-vbaixar="' + esc(v.arquivoId) + '" data-vnome="' + esc(v.arquivoNome || p.nome) + '">Baixar</button></div></div>').join('')
        : '<p class="legenda">Só existe a versão atual.</p>'),
    acoes: [
      ((typeof podeEscrever === 'function' && !podeEscrever('proj')) ? null :
      { texto: 'Nova revisão', aoClicar: () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.addEventListener('change', async () => {
          const file = inp.files[0];
          if (!file) return;
          const rev = await perguntar('Número da nova revisão', { titulo: 'Nova revisão', valor: proximaRevisao(p.revisao), ok: 'Enviar' });
          if (rev === null) return;
          const metas = await subirArquivos([file]);
          if (!metas.length) return;
          const versoes = [...(p.versoes || []), {
            id: p.arquivoId, revisao: p.revisao || 'R00', arquivoId: p.arquivoId,
            arquivoNome: p.arquivoNome, tamanho: p.tamanho, em: p.atualizadoEm || p.criadoEm, por: p.atualizadoPor || p.criadoPor
          }];
          salvar('proj', Object.assign({}, p, {
            arquivoId: metas[0].id, arquivoNome: file.name, tamanho: file.size, revisao: rev || proximaRevisao(p.revisao), versoes
          }));
          fecharModal(); render(); toast('Revisão enviada — a obra já baixa a nova', 'bom');
        });
        inp.click();
      } }),
      ((typeof podeEscrever === 'function' && !podeEscrever('proj')) ? null :
      { texto: 'Apagar', classe: 'perigo', aoClicar: async () => {
        if (!await confirmar('Apagar este projeto? Vai para a lixeira.', { perigo: true, ok: 'Apagar' })) return;
        try { await api('apagar', { colecao: 'proj', id: p.id }); } catch (e) { toast('Não consegui apagar: ' + e.message, 'ruim'); return; }
        await puxar(); fecharModal(); render();
      } }),
      { texto: 'Baixar atual', classe: 'primario', aoClicar: () => baixar(p.arquivoId, p.arquivoNome || p.nome) },
      { texto: 'Fechar', aoClicar: () => fecharModal() }
    ].filter(Boolean)
  });
  document.querySelectorAll('[data-vbaixar]').forEach((b) =>
    b.addEventListener('click', () => baixar(b.dataset.vbaixar, b.dataset.vnome)));
}

function proximaRevisao(atual) {
  const m = String(atual || 'R00').match(/^R?(\d+)$/i);
  if (!m) return 'R01';
  return 'R' + String(Number(m[1]) + 1).padStart(2, '0');
}

/* ══════════════════════════════════════════════════════════════════════════
   DOCUMENTOS
   ══════════════════════════════════════════════════════════════════════════ */
// Documentos que vencem nos próximos N dias (ou já venceram). Usado no painel.
function docsVencendo(dias) {
  return lista('doc').filter((d) => {
    if (!d.validadeEm) return false;
    const n = diasAte(d.validadeEm);
    return n !== null && n <= dias;
  }).sort((a, b) => String(a.validadeEm).localeCompare(String(b.validadeEm)));
}

function situacaoDoc(d) {
  if (!d.validadeEm) return { cls: '', txt: 'sem validade' };
  const n = diasAte(d.validadeEm);
  if (n < 0) return { cls: 'et-vencido', txt: 'vencido há ' + (-n) + ' dia(s)' };
  if (n <= 30) return { cls: 'et-vencendo', txt: 'vence em ' + n + ' dia(s)' };
  return { cls: 'et-valido', txt: 'válido' };
}

TELAS.documentos = function (el) {
  const todos = lista('doc');
  const vencendo = docsVencendo(30);
  const podeMexer = typeof podeEscrever !== 'function' || podeEscrever('doc');
  cabecalho('Documentos', todos.length + ' documento(s) da empresa e das obras',
    podeMexer ? '<button class="btn primario" id="novoDoc">+ Novo documento</button>' : '');

  const grupos = {};
  for (const d of todos) {
    const g = d.obraId && d.obraId !== 'empresa' ? nomeObra(d.obraId) : 'Empresa';
    (grupos[g] || (grupos[g] = [])).push(d);
  }

  el.innerHTML =
    (vencendo.length ? '<div class="aviso atencao"><b>' + vencendo.length + ' documento(s)</b> vencidos ou vencendo nos próximos 30 dias. ' +
      'Certidão vencida trava financiamento, licitação e liberação de obra.</div>' : '') +
    (podeMexer ? '<div class="solta-aqui" id="soltaDoc">Arraste um documento aqui ou clique para escolher</div>' : '') +
    (todos.length ? Object.keys(grupos).sort().map((g) =>
      '<div class="cartao"><h3>' + esc(g) + '</h3>' +
      '<div class="tabela-rolagem"><table><thead><tr><th>Tipo</th><th>Documento</th><th>Nº</th>' +
      '<th>Validade</th><th>Situação</th><th></th></tr></thead><tbody>' +
      grupos[g].map((d) => {
        const s = situacaoDoc(d);
        return '<tr><td><b>' + esc(d.tipo) + '</b></td>' +
          '<td>' + esc(d.nome || '—') + (d.orgao ? '<div style="font-size:.8rem;color:var(--texto-fraco)">' + esc(d.orgao) + '</div>' : '') + '</td>' +
          '<td>' + esc(d.numero || '—') + '</td>' +
          '<td>' + (d.validadeEm ? fmt.data(d.validadeEm) : '—') + '</td>' +
          '<td><span class="etiqueta ' + s.cls + '">' + esc(s.txt) + '</span></td>' +
          '<td class="num">' +
            (d.arquivoId ? '<button class="btn pequeno primario" data-dbaixar="' + esc(d.id) + '">Baixar</button> ' : '') +
            (podeMexer ? '<button class="btn pequeno" data-deditar="' + esc(d.id) + '">Editar</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>').join('')
      : '<div class="cartao">' + vazio('🗂️', 'Nenhum documento', 'Guarde CNPJ, contrato social, alvará e certidões aqui — ' +
        'assim ninguém mais procura em pasta de e-mail.') + '</div>');

  const bnd = document.getElementById('novoDoc');
  if (bnd) bnd.addEventListener('click', () => editarDocumento(null));
  const solta = document.getElementById('soltaDoc');
  const escolher = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.addEventListener('change', () => editarDocumento(null, inp.files[0]));
    inp.click();
  };
  if (solta) {
    solta.addEventListener('click', escolher);
    ['dragenter', 'dragover'].forEach((ev) => solta.addEventListener(ev, (e) => { e.preventDefault(); solta.classList.add('por-cima'); }));
    ['dragleave', 'drop'].forEach((ev) => solta.addEventListener(ev, (e) => { e.preventDefault(); solta.classList.remove('por-cima'); }));
    solta.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) editarDocumento(null, e.dataTransfer.files[0]); });
  }

  el.querySelectorAll('[data-dbaixar]').forEach((b) => b.addEventListener('click', () => {
    const d = achar('doc', b.dataset.dbaixar);
    if (!d) { toast('Este documento não existe mais — atualize a tela', 'ruim'); return; }
    baixar(d.arquivoId, d.arquivoNome || d.nome);
  }));
  el.querySelectorAll('[data-deditar]').forEach((b) => b.addEventListener('click', () => editarDocumento(b.dataset.deditar)));
};

function editarDocumento(id, arquivo) {
  const d = id ? achar('doc', id) : {};
  const opcoesObra = [{ v: 'empresa', t: 'Empresa (Domo)' }].concat(obras().map((o) => ({ v: o.id, t: o.nome })));
  abrirModal({
    titulo: id ? 'Editar documento' : 'Novo documento',
    corpo: '<div id="fDoc">' +
      (arquivo ? '<div class="aviso info">Arquivo: <b>' + esc(arquivo.name) + '</b> (' + fmt.tamanho(arquivo.size) + ')</div>' : '') +
      '<div class="linha">' +
        campo('Tipo', seletor('tipo', d.tipo || 'CNPJ', cfgLista('tiposDoc'))) +
        campo('Pertence a', seletor('obraId', d.obraId || 'empresa', opcoesObra)) +
      '</div>' +
      '<div class="linha">' +
        campo('Nome / descrição', entrada('nome', d.nome, { placeholder: 'Ex.: Alvará de construção' })) +
        campo('Número', entrada('numero', d.numero)) +
      '</div>' +
      '<div class="linha">' +
        campo('Órgão emissor', entrada('orgao', d.orgao, { placeholder: 'Ex.: Prefeitura de Montes Claros' })) +
        campo('Emissão', entrada('emissaoEm', d.emissaoEm, { tipo: 'date' })) +
        campo('Validade', entrada('validadeEm', d.validadeEm, { tipo: 'date' })) +
      '</div>' +
      campo('Observação', areaTexto('obs', d.obs)) +
      (id && d.arquivoId ? '<p class="legenda">Arquivo atual: ' + esc(d.arquivoNome || '—') + '</p>' : '') +
      (!arquivo ? '<div class="campo"><label>Arquivo (opcional)</label><input type="file" id="docArq"></div>' : '') +
    '</div>',
    acoes: [
      (id ? { texto: 'Apagar', classe: 'perigo', aoClicar: async () => {
        if (!await confirmar('Apagar este documento?', { perigo: true, ok: 'Apagar' })) return;
        try { await api('apagar', { colecao: 'doc', id }); } catch (e) { toast('Não consegui apagar: ' + e.message, 'ruim'); return; }
        await puxar(); fecharModal(); render();
      } } : null),
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar', classe: 'primario', aoClicar: async (fundo) => {
        const dados = lerCampos(fundo.querySelector('#fDoc'));
        const escolhido = arquivo || (fundo.querySelector('#docArq') && fundo.querySelector('#docArq').files[0]);
        if (!dados.nome.trim()) dados.nome = dados.tipo;
        // O formulário só fecha DEPOIS do upload: se o arquivo falhar, tudo que
        // foi digitado (tipo, número, órgão, validade) continua na tela.
        let extra = {};
        if (escolhido) {
          const metas = await subirArquivos([escolhido]);
          if (!metas.length) {
            toast('O arquivo não subiu — nada foi salvo. Confira a internet e tente de novo.', 'ruim');
            return;
          }
          extra = { arquivoId: metas[0].id, arquivoNome: escolhido.name, tamanho: escolhido.size, mime: escolhido.type };
        }
        fecharEste(fundo);
        salvar('doc', Object.assign({}, d, dados, extra, { obra: dados.obraId === 'empresa' ? 'Empresa' : nomeObra(dados.obraId) }));
        render();
        toast('Documento salvo', 'bom');
      } }
    ].filter(Boolean)
  });
}
