// Lista ÚNICA das coleções do sistema, compartilhada pelas Functions.
//
// Isso existe porque a lista já morou em três arquivos ao mesmo tempo e as
// coleções novas (cotação e cronograma) ficaram de fora do backup diário sem
// ninguém notar. Ao criar uma coleção nova, mexa AQUI e no COLECOES_APP do
// store.js — só nesses dois lugares.
//
// `pre` é o prefixo do número do documento (SC-0001). Vazio = sem numeração.
export const COLECOES = {
  sc:    { pre: 'SC', nome: 'Solicitação de compra' },
  cot:   { pre: 'CT', nome: 'Cotação' },
  crono: { pre: 'CR', nome: 'Cronograma' },
  oc:    { pre: 'OC', nome: 'Ordem de compra' },
  os:    { pre: 'OS', nome: 'Ordem de serviço' },
  forn:  { pre: '',   nome: 'Fornecedor' },
  prest: { pre: '',   nome: 'Prestador de serviço' },
  doc:   { pre: '',   nome: 'Documento' },
  proj:  { pre: '',   nome: 'Projeto' },
  comp:  { pre: '',   nome: 'Compromisso' },
  permuta: { pre: '', nome: 'Permuta' }
  // 'pessoa' (RH) é de PROPÓSITO só do Supabase: o backend Netlify legado (ainda
  // publicado até a virada) não conhece a coleção, então rejeita ler/gravar RH —
  // fecha o vazamento sem precisar portar o gate só-direção para cá.
};

export const NOMES_COLECOES = Object.keys(COLECOES);
