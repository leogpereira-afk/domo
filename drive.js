/* Drive — a pasta da Domo no Google Drive, vista de dentro do sistema.

   O navegador NUNCA recebe crachá do Google: ele pede "lista essa pasta" e
   recebe só o que o servidor já conferiu estar dentro da pasta configurada
   (ver supabase/functions/domo-drive). Por isso tudo aqui passa por apiDrive.

   A tela usa as peças que já existem no acervo — .arquivo-solto, iconeArquivo,
   fmt.tamanho, baixar() — em vez de reescrevê-las: a primeira versão tinha uma
   tabela de 4 colunas que não cabia no celular e um formatador que mostrava
   2 GB como "2048.0 MB". */

const API_DRIVE = SUPABASE_URL + '/functions/v1/domo-drive';
const apiDrive = (action, dados = {}, opts = {}) =>
  api(action, dados, Object.assign({ url: API_DRIVE }, opts));

/* Estado só desta tela. A PASTA ABERTA mora no endereço (#/drive/<id>), não
   aqui: o app redesenha a tela inteira a cada sincronização, e quem estivesse
   três pastas adentro voltava para o começo sem ter clicado em nada. No
   endereço, o botão Voltar do navegador também passa a funcionar. */
const _drv = { itens: [], caminho: [], status: null, carregando: false, erro: '', busca: '', truncado: false, pasta: '' };

async function driveStatus(forcar) {
  if (_drv.status && !forcar) return _drv.status;
  try { _drv.status = await apiDrive('status'); }
  catch (e) { _drv.erro = e.message || 'Não deu para falar com o servidor.'; }
  return _drv.status;
}

async function driveCarregar(idPasta) {
  _drv.carregando = true; _drv.erro = '';
  pintarDrive();
  try {
    const r = _drv.busca
      ? await apiDrive('buscar', { termo: _drv.busca })
      : await apiDrive('pasta', idPasta ? { id: idPasta } : {});
    if (r.precisaAutorizar) { _drv.status = Object.assign({}, _drv.status, { conectado: false }); }
    else if (r.semRaiz) { _drv.status = Object.assign({}, _drv.status, { raiz: '' }); }
    else {
      _drv.itens = r.itens || [];
      _drv.caminho = r.caminho || [];
      _drv.truncado = !!r.truncado;
      _drv.pasta = idPasta || '';
    }
  } catch (e) {
    _drv.erro = e.message || 'Não deu para abrir a pasta.';
  } finally {
    _drv.carregando = false;
    pintarDrive();
  }
}

/* Usa o baixar() do acervo — a trava de download duplo e a barra de progresso
   vêm junto. O `bilhete` é o que evita reconferir a árvore do Drive a cada
   pedaço de 2 MB: o primeiro confere de verdade e devolve o comprovante. */
function driveBaixar(it) {
  let bilhete = '';
  baixar(null, it.nome, async (i) => {
    const r = await apiDrive('arquivo', { id: it.id, i, bilhete }, { prazoMs: 180000 });
    if (r.precisaAutorizar) throw new Error('A conexão com o Google caiu. Avise a direção.');
    if (r.bilhete) bilhete = r.bilhete;
    return r;
  });
}

function driveConectar() {
  abrirModal({
    titulo: 'Conectar o Google Drive',
    corpo: '<p>Você vai para o Google, entra com a conta da <b>Domo</b> e autoriza a leitura. ' +
      'O sistema pede um acesso só: <b>ver e baixar</b>. Nunca apagar, mover ou renomear — ' +
      'e nada de Gmail ou agenda.</p>' +
      '<p class="dica">A autorização fica guardada no servidor. Quem abre a tela vê só a pasta ' +
      'que a direção escolher, não o Drive inteiro. Quem conectou, quem trocou a pasta e quem ' +
      'baixou cada arquivo fica registrado no histórico.</p>',
    acoes: [
      { texto: 'Cancelar', aoClicar: fecharModal },
      { texto: 'Ir para o Google', classe: 'primario', aoClicar: async (f) => {
        const b = f.querySelector('footer .primario'); b.disabled = true; b.textContent = 'abrindo…';
        try {
          const r = await apiDrive('autorizarUrl');
          if (!r.url) throw new Error('O servidor não devolveu o endereço do Google.');
          location.href = r.url;
        } catch (e) {
          b.disabled = false; b.textContent = 'Ir para o Google';
          toast(e.message || 'Não deu para começar', 'ruim');
        }
      } }
    ]
  });
}

function driveDefinirPasta() {
  abrirModal({
    titulo: 'Qual pasta o sistema enxerga',
    corpo: campo('Link da pasta no Drive',
      entrada('pasta', (_drv.status && _drv.status.raiz) || '', { placeholder: 'https://drive.google.com/drive/folders/…' }),
      'Abra a pasta no Drive e copie o endereço da barra. Só ela e o que está dentro dela aparecem aqui.'),
    acoes: [
      { texto: 'Cancelar', aoClicar: fecharModal },
      { texto: 'Salvar', classe: 'primario', aoClicar: async (f) => {
        const v = lerCampos(f).pasta;
        const b = f.querySelector('footer .primario'); b.disabled = true; b.textContent = 'conferindo…';
        try {
          const r = await apiDrive('definirRaiz', { pasta: v });
          if (r.precisaAutorizar) throw new Error('Conecte o Google primeiro.');
          fecharModal();
          toast('Pasta definida: ' + r.nomeRaiz);
          await driveStatus(true);
          irPara('drive');
        } catch (e) {
          b.disabled = false; b.textContent = 'Salvar';
          toast(e.message || 'Não deu para salvar', 'ruim');
        }
      } }
    ]
  });
}

/* Documento nativo do Google (Docs, Planilhas, Slides) não tem bytes — o Drive
   devolve tamanho vazio. Mostrar "0 B" seria afirmar que o arquivo está vazio;
   melhor dizer o que ele é, já que é assim que ele vai sair ao baixar. */
const TIPOS_GOOGLE = { document: 'documento do Google · baixa em PDF', spreadsheet: 'planilha do Google · baixa em Excel',
  presentation: 'apresentação do Google · baixa em PDF', drawing: 'desenho do Google · baixa em PDF', form: 'formulário do Google' };
function driveMedida(it) {
  const m = /application\/vnd\.google-apps\.([a-z]+)/.exec(it.tipo || '');
  if (m) return TIPOS_GOOGLE[m[1]] || 'arquivo do Google';
  return it.tamanho ? fmt.tamanho(it.tamanho) : 'tamanho não informado';
}

function pintarDrive() {
  const el = document.getElementById('pagina');
  if (!el || rotaAtual().tela !== 'drive') return;
  const s = _drv.status || {};
  const acoes = s.podeConectar
    ? (s.conectado
      ? '<button class="btn" id="drvPasta">Trocar a pasta</button><button class="btn perigo" id="drvSair">Desconectar</button>'
      : '<button class="btn primario" id="drvConectar">Conectar o Google Drive</button>')
    : '';
  cabecalho('Drive da Domo', s.nomeRaiz ? 'Pasta: ' + s.nomeRaiz : 'Arquivos da empresa', acoes);

  let corpo;
  if (_drv.erro) {
    corpo = '<div class="cartao">' + vazio('⚠️', 'Não deu para abrir o Drive', esc(_drv.erro)) + '</div>';
  } else if (!s.conectado) {
    corpo = '<div class="cartao">' + vazio('🔌', 'O Drive ainda não está conectado',
      s.podeConectar ? 'Conecte a conta Google da Domo para ver os arquivos aqui.'
        : 'Peça à direção para conectar a conta Google da Domo.') + '</div>';
  } else if (!s.raiz) {
    corpo = '<div class="cartao">' + vazio('📁', 'Falta escolher a pasta',
      s.podeConectar ? 'Escolha qual pasta do Drive este sistema enxerga.'
        : 'A direção ainda não escolheu qual pasta aparece aqui.') + '</div>';
  } else {
    const migalhas = _drv.busca
      ? '<a href="#/drive">← voltar às pastas</a> <span>›</span> <b>' + esc(_drv.busca) + '</b>'
      : (_drv.caminho || []).map((c, i, a) =>
        i === a.length - 1 ? '<b>' + esc(c.nome) + '</b>'
          : '<a href="#/drive' + (c.id === s.raiz ? '' : '/' + encodeURIComponent(c.id)) + '">' + esc(c.nome) + '</a>').join(' <span>›</span> ');

    const linhas = _drv.itens.map((it) =>
      '<div class="arquivo-solto">' +
        '<span class="ic">' + iconeArquivo(it.nome, it.tipo) + '</span>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="nome">' + (it.pasta
            ? '<a href="#/drive/' + encodeURIComponent(it.id) + '">' + esc(it.nome) + '</a>'
            : esc(it.nome)) + '</div>' +
          '<div class="meta">' + (it.pasta ? 'pasta' : driveMedida(it)) +
            (it.em ? ' · alterado ' + fmt.data(it.em.slice(0, 10)) : '') +
            (it.caminho ? ' · em ' + esc(it.caminho) : '') + '</div>' +
        '</div>' +
        '<div class="acoes">' + (it.pasta
          ? '<a class="btn pequeno" href="#/drive/' + encodeURIComponent(it.id) + '">Abrir</a>'
          : '<button class="btn pequeno primario" data-baixar="' + esc(it.id) + '">Baixar</button>') + '</div>' +
      '</div>').join('');

    corpo =
      '<div class="cartao">' +
        '<div class="migalhas">' + migalhas + '</div>' +
        '<div class="filtros"><input id="drvBusca" type="search" placeholder="🔎 buscar arquivo em todas as pastas" value="' + esc(_drv.busca) + '"></div>' +
        (_drv.carregando ? '<p class="dica">Consultando o Drive…</p>' : '') +
        (_drv.itens.length ? linhas
          : _drv.carregando ? ''
          : _drv.busca ? vazio('🔎', 'Nada encontrado', 'Nenhum arquivo com esse nome dentro da pasta da Domo.')
          : vazio('📂', 'Pasta vazia', 'Não há nada dentro dela.')) +
        // Falta tem de aparecer como falta: antes a lista parava em 200 e, pelo
        // silêncio, afirmava que era tudo o que existia na pasta.
        (_drv.truncado ? '<p class="dica">⚠️ Tem mais arquivos do que cabe nesta lista. Use a busca para achar o que procura.</p>' : '') +
      '</div>';
  }
  el.innerHTML = corpo;

  const bt = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
  bt('drvConectar', driveConectar);
  bt('drvPasta', driveDefinirPasta);
  bt('drvSair', async () => {
    if (!await confirmar('Desconectar o Google Drive? Os arquivos somem desta tela até alguém conectar de novo.')) return;
    try { await apiDrive('desconectar'); toast('Desconectado'); await driveStatus(true); pintarDrive(); }
    catch (e) { toast(e.message || 'Não deu para desconectar', 'ruim'); }
  });
  document.querySelectorAll('[data-baixar]').forEach((b) => b.onclick = () => {
    const it = _drv.itens.find((x) => x.id === b.dataset.baixar);
    if (it) driveBaixar(it);
  });
  const caixa = document.getElementById('drvBusca');
  if (caixa) {
    let t;
    caixa.oninput = (e) => {
      clearTimeout(t); const v = e.target.value.trim();
      t = setTimeout(() => {
        if (v === _drv.busca) return;
        _drv.busca = v.length >= 2 ? v : '';
        driveCarregar(_drv.busca ? '' : _drv.pasta).then(() => {
          const c = document.getElementById('drvBusca');
          if (c) { c.focus(); c.setSelectionRange(c.value.length, c.value.length); }
        });
      }, 400);
    };
  }
}

TELAS.drive = async function (el, args) {
  const alvo = (args && args[0]) ? decodeURIComponent(args[0]) : '';
  cabecalho('Drive da Domo', 'Arquivos da empresa');
  // Erro na volta do Google chega pela barra de endereços — dizer qual foi, em
  // vez de mostrar uma tela vazia sem explicação.
  const erro = new URLSearchParams(location.search).get('drive_erro');
  if (erro) {
    const QUAL = {
      negado: 'A autorização foi recusada na tela do Google.',
      bilhete: 'O pedido de autorização venceu. Tente conectar de novo.',
      'sem-renovacao': 'O Google não devolveu a chave de renovação. Tente de novo marcando "permitir sempre".',
      config: 'Faltam as chaves do Google no servidor.'
    };
    toast(QUAL[erro] || ('O Google recusou (' + erro + ')'), 'ruim');
    history.replaceState(null, '', location.pathname + location.hash);
    await driveStatus(true);
  } else {
    if (!_drv.status) el.innerHTML = '<div class="cartao"><p class="dica">Consultando o Drive…</p></div>';
    await driveStatus();
  }
  if (_drv.status && _drv.status.conectado && _drv.status.raiz) await driveCarregar(alvo);
  else pintarDrive();
};
