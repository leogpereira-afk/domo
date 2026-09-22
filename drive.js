/* Drive — a pasta da Domo no Google Drive, vista de dentro do sistema.

   O navegador NUNCA recebe crachá do Google: ele pede "lista essa pasta" e
   recebe só o que o servidor já conferiu estar dentro da pasta configurada
   (ver supabase/functions/domo-drive). Por isso tudo aqui passa por apiDrive. */

const API_DRIVE = SUPABASE_URL + '/functions/v1/domo-drive';
const apiDrive = (action, dados = {}, opts = {}) =>
  api(action, dados, Object.assign({ url: API_DRIVE }, opts));

/* Estado só desta tela: a pasta aberta e as migalhas do caminho. Não vai para o
   cache do app — é uma janela para fora, não dado da obra. */
const _drv = { pasta: '', caminho: [], itens: [], status: null, carregando: false, erro: '' };

const driveIcone = (it) => it.pasta ? '📁' : (
  /image\//.test(it.tipo) ? '🖼️' :
  /pdf/.test(it.tipo) ? '📕' :
  /spreadsheet|excel|sheet/.test(it.tipo) ? '📊' :
  /document|word/.test(it.tipo) ? '📄' :
  /presentation|powerpoint/.test(it.tipo) ? '📽️' :
  /zip|compressed/.test(it.tipo) ? '🗜️' :
  /dwg|dxf|autocad/i.test(it.nome) ? '📐' : '📎');

const driveTamanho = (n) => !n ? '' :
  n < 1024 ? n + ' B' :
  n < 1048576 ? (n / 1024).toFixed(0) + ' KB' :
  (n / 1048576).toFixed(1) + ' MB';

async function driveAbrirPasta(id) {
  _drv.carregando = true; _drv.erro = '';
  pintarDrive();
  try {
    const r = await apiDrive('pasta', id ? { id } : {});
    if (r.precisaAutorizar) { _drv.status = Object.assign({}, _drv.status, { conectado: false }); }
    else if (r.semRaiz) { _drv.status = Object.assign({}, _drv.status, { raiz: '' }); }
    else { _drv.pasta = (r.caminho && r.caminho.length ? r.caminho[r.caminho.length - 1].id : '') || id || ''; _drv.itens = r.itens || []; _drv.caminho = r.caminho || []; }
  } catch (e) {
    _drv.erro = e.message || 'Não deu para abrir a pasta.';
  } finally {
    _drv.carregando = false;
    pintarDrive();
  }
}

/* Baixa em pedaços, como o acervo faz com a planta de 40MB: o 4G da obra não
   aguenta um arquivo inteiro numa resposta só. */
async function driveBaixar(it) {
  const fundo = abrirModal({
    titulo: 'Baixando ' + it.nome,
    corpo: '<div class="arquivo-solto"><span>0%</span></div>',
    semFechar: true, acoes: []
  });
  const marcador = fundo.querySelector('span');
  try {
    const pedacos = [];
    let i = 0, total = 1, meta = null;
    while (i < total) {
      const r = await apiDrive('arquivo', { id: it.id, i }, { prazoMs: 180000 });
      if (r.precisaAutorizar) throw new Error('A conexão com o Google caiu. Avise a direção.');
      meta = meta || r;
      total = r.partes || 1;
      pedacos.push(base64ParaBytes(r.dados));
      i++;
      if (marcador) marcador.textContent = Math.round(i / total * 100) + '%';
    }
    fecharSilencioso(fundo);
    salvarNoAparelho(new Blob(pedacos, { type: (meta && meta.mime) || 'application/octet-stream' }),
      (meta && meta.nome) || it.nome);
    toast('Baixado ✓');
  } catch (e) {
    fecharSilencioso(fundo);
    toast(e.message || 'Não deu para baixar', 'ruim');
  }
}

function driveConectar() {
  abrirModal({
    titulo: 'Conectar o Google Drive',
    corpo: '<p>Você vai para o Google, entra com a conta da <b>Domo</b> e autoriza a leitura. ' +
      'O sistema pede um acesso só: <b>ver e baixar</b>. Nunca apagar, mover ou renomear — ' +
      'e nada de Gmail ou agenda.</p>' +
      '<p class="dica">A autorização fica guardada no servidor. Quem abre a tela vê só a pasta ' +
      'que a direção escolher, não o Drive inteiro.</p>',
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
          await driveStatus(); await driveAbrirPasta('');
        } catch (e) {
          b.disabled = false; b.textContent = 'Salvar';
          toast(e.message || 'Não deu para salvar', 'ruim');
        }
      } }
    ]
  });
}

async function driveStatus() {
  try { _drv.status = await apiDrive('status'); }
  catch (e) { _drv.erro = e.message || 'Não deu para falar com o servidor.'; }
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
  } else if (_drv.carregando && !_drv.itens.length) {
    corpo = '<div class="cartao"><p class="dica">Abrindo a pasta…</p></div>';
  } else {
    const migalhas = (_drv.caminho || []).map((c, i, a) =>
      i === a.length - 1 ? '<b>' + esc(c.nome) + '</b>'
        : '<a href="#" data-pasta="' + esc(c.id) + '">' + esc(c.nome) + '</a>').join(' <span>›</span> ');
    const linhas = _drv.itens.map((it) =>
      '<tr>' +
        '<td>' + driveIcone(it) + ' ' + (it.pasta
          ? '<a href="#" data-pasta="' + esc(it.id) + '"><b>' + esc(it.nome) + '</b></a>'
          : esc(it.nome)) + '</td>' +
        '<td class="num">' + esc(driveTamanho(it.tamanho)) + '</td>' +
        '<td class="num">' + esc(it.em ? fmt.data(it.em.slice(0, 10)) : '') + '</td>' +
        '<td class="num">' + (it.pasta ? '' :
          '<button class="btn pequeno" data-baixar="' + esc(it.id) + '">Baixar</button>') + '</td>' +
      '</tr>').join('');
    corpo =
      '<div class="cartao">' +
        '<div class="migalhas">' + migalhas + '</div>' +
        (_drv.itens.length
          ? '<div class="tabela-rolagem"><table class="tabela"><thead><tr>' +
            '<th>Nome</th><th class="num">Tamanho</th><th class="num">Alterado</th><th></th>' +
            '</tr></thead><tbody>' + linhas + '</tbody></table></div>'
          : vazio('📂', 'Pasta vazia', 'Não há nada dentro dela.')) +
      '</div>';
  }
  document.getElementById('pagina').innerHTML = corpo;

  const bt = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
  bt('drvConectar', driveConectar);
  bt('drvPasta', driveDefinirPasta);
  bt('drvSair', async () => {
    if (!await confirmar('Desconectar o Google Drive? Os arquivos somem desta tela até alguém conectar de novo.')) return;
    try { await apiDrive('desconectar'); toast('Desconectado'); await driveStatus(); pintarDrive(); }
    catch (e) { toast(e.message || 'Não deu para desconectar', 'ruim'); }
  });
  document.querySelectorAll('[data-pasta]').forEach((a) => a.onclick = (e) => {
    e.preventDefault(); driveAbrirPasta(a.dataset.pasta);
  });
  document.querySelectorAll('[data-baixar]').forEach((b) => b.onclick = () => {
    const it = _drv.itens.find((x) => x.id === b.dataset.baixar);
    if (it) driveBaixar(it);
  });
}

TELAS.drive = async function (el) {
  cabecalho('Drive da Domo', 'Arquivos da empresa');
  el.innerHTML = '<div class="cartao"><p class="dica">Consultando o Drive…</p></div>';
  await driveStatus();
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
  }
  if (_drv.status && _drv.status.conectado && _drv.status.raiz) await driveAbrirPasta('');
  else pintarDrive();
};
