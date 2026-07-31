/* UI — peças que todas as telas usam: formatação, etiquetas, modal, aviso.
   Tudo que vem do usuário passa por esc() antes de virar HTML. */

/* Situações em que a ordem de compra ainda está para chegar na obra.
   Uma constante só: menu, tela de recebimento e painel precisam concordar. */
const SIT_ESPERANDO = ['enviada', 'confirmada', 'transito', 'parcial'];

/* Registro das telas. Precisa ser declarado AQUI, antes de compras.js e
   acervo.js, porque são eles que preenchem (TELAS.solicitacoes = ...). Se a
   declaração ficasse no app.js — que carrega por último — a atribuição
   estouraria e as telas simplesmente não existiriam. */
const TELAS = {};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmt = {
  brl(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  },
  numero(n, casas = 2) {
    return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
  },
  data(iso) {
    if (!iso) return '—';
    const s = String(iso);
    const d = s.length === 10 ? new Date(s + 'T12:00:00') : new Date(s);
    return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR');
  },
  dataHora(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  },
  quando(iso) {
    if (!iso) return '';
    const seg = (Date.now() - new Date(iso).getTime()) / 1000;
    if (seg < 60) return 'agora';
    if (seg < 3600) return Math.floor(seg / 60) + ' min';
    if (seg < 86400) return Math.floor(seg / 3600) + ' h';
    if (seg < 172800) return 'ontem';
    if (seg < 2592000) return Math.floor(seg / 86400) + ' dias';
    return fmt.data(iso);
  },
  tamanho(b) {
    const n = Number(b) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  },
  telefone(t) {
    const d = String(t || '').replace(/\D/g, '');
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return t || '';
  },
  cnpj(v) {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length !== 14) return v || '';
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  },
  // Prestador pode ser PJ (CNPJ) ou pessoa física (CPF) — o mesmo campo serve
  // para os dois, então quem formata precisa reconhecer os dois.
  doc(v) {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length === 14) return fmt.cnpj(d);
    if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return v || '';
  }
};

const hojeISO = () => new Date().toISOString().slice(0, 10);

function diasAte(dataISO) {
  if (!dataISO) return null;
  const d = new Date(String(dataISO).slice(0, 10) + 'T12:00:00');
  if (isNaN(d)) return null;
  return Math.round((d - new Date(new Date().toDateString())) / 86400000);
}

/* ── Etiquetas de situação ─────────────────────────────────────────────────── */
const SITUACOES = {
  // solicitação
  nova: { txt: 'Nova', cls: 'et-nova' },
  aprovada: { txt: 'Aprovada', cls: 'et-aprovada' },
  cotacao: { txt: 'Em cotação', cls: 'et-cotacao' },
  em_cotacao: { txt: 'Em cotação', cls: 'et-cotacao' },
  em_compra: { txt: 'Em compra', cls: 'et-cotacao' },
  // cotação
  aberta: { txt: 'Aguardando preços', cls: 'et-nova' },
  recusada: { txt: 'Recusada', cls: 'et-recusada' },
  atendida: { txt: 'Atendida', cls: 'et-atendida' },
  // ordem de compra
  rascunho: { txt: 'Rascunho', cls: 'et-rascunho' },
  emitida: { txt: 'Emitida', cls: 'et-emitida' },
  enviada: { txt: 'Enviada ao fornecedor', cls: 'et-enviada' },
  confirmada: { txt: 'Confirmada/comprada', cls: 'et-comprado' },
  transito: { txt: 'A caminho', cls: 'et-transito' },
  parcial: { txt: 'Recebida em parte', cls: 'et-parcial' },
  entregue: { txt: 'Entregue', cls: 'et-entregue' },
  cancelada: { txt: 'Cancelada', cls: 'et-cancelada' },
  // ordem de serviço
  andamento: { txt: 'Em andamento', cls: 'et-transito' },
  concluida: { txt: 'Concluída', cls: 'et-concluida' }
};

const etiqueta = (s) => {
  const e = SITUACOES[s] || { txt: s || '—', cls: '' };
  return '<span class="etiqueta ' + e.cls + '">' + esc(e.txt) + '</span>';
};

const URGENCIAS = {
  normal: { txt: 'Normal', cls: '' },
  urgente: { txt: 'Urgente', cls: 'et-urgente' },
  critica: { txt: 'Parou a obra', cls: 'et-critica' }
};
const etiquetaUrgencia = (u) => {
  const e = URGENCIAS[u] || URGENCIAS.normal;
  return u && u !== 'normal' ? '<span class="etiqueta ' + e.cls + '">' + esc(e.txt) + '</span>' : '';
};

/* ── Avisos rápidos ────────────────────────────────────────────────────────── */
function toast(msg, tipo = '') {
  let caixa = document.getElementById('toasts');
  if (!caixa) {
    caixa = document.createElement('div');
    caixa.id = 'toasts';
    document.body.appendChild(caixa);
  }
  const t = document.createElement('div');
  t.className = 'toast ' + tipo;
  t.textContent = msg;
  caixa.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 3200);
  setTimeout(() => t.remove(), 3600);
}

/* ── Modal ─────────────────────────────────────────────────────────────────── */
// Os modais ficam EMPILHADOS: abrir uma confirmação de dentro de um formulário
// não pode apagar o que já foi digitado embaixo.
// E o toque no fundo NÃO fecha: no canteiro, um toque torto ao rolar a tela
// apagava o recebimento inteiro (fotos já enviadas inclusive).
let _modalAberto = null;
const _pilhaModais = [];

function abrirModal({ titulo, corpo, acoes = [], largo = false, aoFechar = null, semFechar = false }) {
  if (_modalAberto) {
    _modalAberto.foco = document.activeElement;
    _modalAberto.fundo.style.display = 'none';
    _pilhaModais.push(_modalAberto);
  }
  const fundo = document.createElement('div');
  fundo.className = 'fundo-modal';
  fundo.innerHTML =
    '<div class="modal' + (largo ? ' largo' : '') + '" role="dialog" aria-modal="true">' +
      '<header><h2>' + esc(titulo) + '</h2>' +
      (semFechar ? '' : '<button class="fechar" data-fechar aria-label="Fechar">&times;</button>') + '</header>' +
      '<div class="corpo"></div>' +
      (acoes.length ? '<footer></footer>' : '') +
    '</div>';
  fundo.querySelector('.corpo').innerHTML = corpo;
  const rodape = fundo.querySelector('footer');
  acoes.forEach((a, i) => {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.classe || '');
    b.textContent = a.texto;
    b.dataset.i = i;
    b.addEventListener('click', () => a.aoClicar && a.aoClicar(fundo));
    rodape.appendChild(b);
  });
  fundo.addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-fechar')) fecharModal();
  });
  document.body.appendChild(fundo);
  _modalAberto = { fundo, aoFechar, semFechar };
  const primeiro = fundo.querySelector('input,select,textarea');
  if (primeiro && window.innerWidth > 900) setTimeout(() => primeiro.focus(), 60);
  return fundo;
}

function fecharModal() {
  if (!_modalAberto) return;
  const { fundo, aoFechar } = _modalAberto;
  tirarDaPilha(fundo);
  fundo.remove();
  if (aoFechar) aoFechar();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _modalAberto && !_modalAberto.semFechar) fecharModal();
});

// Fecha sem disparar o aoFechar (usado quando a própria ação já resolveu a
// promessa). Precisa devolver a pilha ao estado certo, senão o modal de baixo
// fica escondido para sempre.
function fecharSilencioso(fundo) {
  tirarDaPilha(fundo);
  fundo.remove();
}

// Fecha ESTE modal (o do handler), não "o que estiver por cima". Depois de um
// await pode ter aparecido outro modal em cima — fechar o errado embaralha tudo.
function fecharEste(fundo) {
  if (!fundo) return fecharModal();
  const dono = (_modalAberto && _modalAberto.fundo === fundo)
    ? _modalAberto : _pilhaModais.find((m) => m.fundo === fundo);
  tirarDaPilha(fundo);
  fundo.remove();
  if (dono && dono.aoFechar) dono.aoFechar();
}

function tirarDaPilha(fundo) {
  if (_modalAberto && _modalAberto.fundo === fundo) {
    _modalAberto = _pilhaModais.pop() || null;
    if (_modalAberto) {
      _modalAberto.fundo.style.display = '';
      if (_modalAberto.foco && _modalAberto.foco.focus) _modalAberto.foco.focus();
    }
    return;
  }
  const i = _pilhaModais.findIndex((m) => m.fundo === fundo);
  if (i >= 0) _pilhaModais.splice(i, 1);
}

function confirmar(texto, opts = {}) {
  return new Promise((resolve) => {
    abrirModal({
      titulo: opts.titulo || 'Confirmar',
      corpo: '<p>' + esc(texto) + '</p>',
      aoFechar: () => resolve(false),
      acoes: [
        { texto: opts.cancelar || 'Voltar', aoClicar: () => fecharModal() },
        {
          texto: opts.ok || 'Confirmar',
          classe: opts.perigo ? 'perigo' : 'primario',
          aoClicar: (fundo) => { fecharSilencioso(fundo); resolve(true); }
        }
      ]
    });
  });
}

// Caixa de texto simples (motivo, observação...). Devolve o texto ou null.
function perguntar(rotulo, opts = {}) {
  return new Promise((resolve) => {
    const id = 'pg' + Math.random().toString(36).slice(2, 7);
    const campo = opts.multi
      ? '<textarea id="' + id + '">' + esc(opts.valor || '') + '</textarea>'
      : '<input type="text" id="' + id + '" value="' + esc(opts.valor || '') + '">';
    abrirModal({
      titulo: opts.titulo || 'Informe',
      corpo: '<div class="campo"><label for="' + id + '">' + esc(rotulo) + '</label>' + campo + '</div>',
      aoFechar: () => resolve(null),
      acoes: [
        { texto: 'Voltar', aoClicar: () => fecharModal() },
        {
          texto: opts.ok || 'Salvar',
          classe: 'primario',
          aoClicar: (fundo) => {
            const v = fundo.querySelector('#' + id).value.trim();
            if (opts.obrigatorio && !v) { toast('Preencha o campo', 'ruim'); return; }
            fecharSilencioso(fundo); resolve(v);
          }
        }
      ]
    });
  });
}

// Pergunta uma data usando o calendário do aparelho. Texto livre já gravou
// data vazia em silêncio quando o formato digitado não batia.
function perguntarData(rotulo, opts = {}) {
  return new Promise((resolve) => {
    const id = 'dt' + Math.random().toString(36).slice(2, 7);
    abrirModal({
      titulo: opts.titulo || 'Informe a data',
      corpo: '<div class="campo"><label for="' + id + '">' + esc(rotulo) + '</label>' +
        '<input type="date" id="' + id + '" value="' + esc(opts.valor || '') + '"></div>',
      aoFechar: () => resolve(null),
      acoes: [
        { texto: 'Pular', aoClicar: () => fecharModal() },
        { texto: opts.ok || 'Salvar', classe: 'primario', aoClicar: (fundo) => {
          const v = fundo.querySelector('#' + id).value;
          if (!v) { toast('Escolha uma data', 'ruim'); return; }
          fecharSilencioso(fundo); resolve(v);
        } }
      ]
    });
  });
}

/* ── Peças de formulário ───────────────────────────────────────────────────── */
function campo(rot, html, dica) {
  return '<div class="campo"><label>' + esc(rot) + '</label>' + html +
    (dica ? '<div class="dica">' + esc(dica) + '</div>' : '') + '</div>';
}

function entrada(nome, valor, opts = {}) {
  const attrs = [
    'type="' + (opts.tipo || 'text') + '"',
    'data-campo="' + esc(nome) + '"',
    'value="' + esc(valor == null ? '' : valor) + '"',
    opts.placeholder ? 'placeholder="' + esc(opts.placeholder) + '"' : '',
    opts.inputmode ? 'inputmode="' + opts.inputmode + '"' : '',
    opts.passo ? 'step="' + opts.passo + '"' : '',
    opts.somenteLeitura ? 'readonly' : '',
    opts.max ? 'maxlength="' + opts.max + '"' : ''
  ].filter(Boolean).join(' ');
  return '<input ' + attrs + '>';
}

function areaTexto(nome, valor, placeholder) {
  return '<textarea data-campo="' + esc(nome) + '"' + (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + '>' +
    esc(valor || '') + '</textarea>';
}

function seletor(nome, valor, opcoes, vazio) {
  const itens = opcoes.map((o) => {
    const v = typeof o === 'string' ? o : o.v;
    const t = typeof o === 'string' ? o : o.t;
    return '<option value="' + esc(v) + '"' + (String(v) === String(valor) ? ' selected' : '') + '>' + esc(t) + '</option>';
  }).join('');
  return '<select data-campo="' + esc(nome) + '">' +
    (vazio ? '<option value="">' + esc(vazio) + '</option>' : '') + itens + '</select>';
}

// Lê todos os [data-campo] de um pedaço da tela e devolve um objeto
// ({'solicitante.nome': 'x'} vira {solicitante:{nome:'x'}}).
function lerCampos(raiz) {
  const obj = {};
  raiz.querySelectorAll('[data-campo]').forEach((el) => {
    const caminho = el.dataset.campo.split('.');
    let alvo = obj;
    for (let i = 0; i < caminho.length - 1; i++) alvo = alvo[caminho[i]] || (alvo[caminho[i]] = {});
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.numero !== undefined && typeof v === 'string') v = numeroBR(v);
    alvo[caminho[caminho.length - 1]] = v;
  });
  return obj;
}

// Aceita "1.234,56", "1234.56" e também "1.200" (ponto de milhar sem centavos).
// Sem o terceiro caso, uma quantidade de 1.200 sacos virava 1,2 — foi assim que
// o recebimento chegou a gravar mil vezes menos do que chegou na obra.
function numeroBR(v) {
  if (typeof v === 'number') return v;
  // Tira "R$", "kg", "un" e qualquer outro enfeite: quem digita valor no
  // celular escreve "R$ 1.200,50" sem pensar, e isso virava ZERO calado.
  const s = String(v || '').trim().replace(/\s/g, '').replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  let limpo;
  if (s.includes(',')) limpo = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) limpo = s.replace(/\./g, ''); // 1.200 · 12.000 · 1.234.567
  else limpo = s;
  const n = parseFloat(limpo);
  return isFinite(n) ? n : 0;
}

/* ── WhatsApp ──────────────────────────────────────────────────────────────── */
function linkWhats(telefone, texto) {
  let d = String(telefone || '').replace(/\D/g, '');
  if (d && !d.startsWith('55')) d = '55' + d;
  return 'https://wa.me/' + d + '?text=' + encodeURIComponent(texto || '');
}

function baixarTexto(nome, conteudo, tipo = 'application/json') {
  const b = new Blob([conteudo], { type: tipo });
  salvarNoAparelho(b, nome);
}

/* ── Estado vazio ──────────────────────────────────────────────────────────── */
const vazio = (icone, titulo, texto) =>
  '<div class="vazio"><span class="icone">' + icone + '</span><b>' + esc(titulo) + '</b>' +
  (texto ? '<div>' + esc(texto) + '</div>' : '') + '</div>';
