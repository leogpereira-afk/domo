// Quem é quem, e o que cada um pode fazer. ÚNICO lugar onde isso é decidido.
//
// Porte fiel de netlify/functions/lib/acesso.mjs. A regra já morou em dois
// lugares uma vez (o acervo não conhecia os acessos individuais e desligava os
// arquivos para quem tinha senha própria); aqui as três functions importam
// daqui.

// ── Hash ────────────────────────────────────────────────────────────────────
// O cliente manda sha256(senha); guardamos sha256(sha256(senha)). Assim um
// vazamento do banco não entrega direto o que abre a porta.
export async function sha256(txt: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(txt)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Quem {
  id: string;
  nome: string;
  cargo: string;
  perfil: "direcao" | "escritorio" | "obra";
  proprio: boolean;
}

export const PERFIS: Record<string, {
  txt: string; tudo?: boolean; escreve?: string[]; le?: string[]; semPreco?: string[];
}> = {
  direcao: { txt: "Direção", tudo: true },
  escritorio: { txt: "Escritório / compras", tudo: false },
  obra: {
    txt: "Obra / almoxarifado",
    tudo: false,
    escreve: ["sc", "oc", "crono"],
    // 'prest' fica de fora: a pasta do prestador tem CPF, ASO e ficha de
    // terceiros, e quem é da obra não abre essa tela.
    le: ["sc", "oc", "os", "crono", "forn", "doc", "proj"],
    semPreco: ["oc", "os", "cot"],
  },
};

export const ACOES_DIRECAO = ["salvarCfg", "trocarSenha", "esvaziarLixeira", "reiniciarNumeracao",
  "restaurar", "restaurarItem", "salvarUsuario", "apagarUsuario", "log", "backup"];

export const ACOES_NEGADAS_OBRA = ["apagar"];

export async function hashGuardado(cfg: any): Promise<string | null> {
  if (cfg && cfg.senhaHash) return cfg.senhaHash;
  const env = Deno.env.get("PAINEL_SENHA");
  if (!env) return null;
  return await sha256(await sha256(env));
}

// A senha da equipe continua valendo como Direção — ninguém fica trancado do
// lado de fora ao ligar os acessos individuais.
export async function identificar(cfg: any, senhaCliente: string): Promise<Quem | null> {
  if (!senhaCliente) return null;
  const h = await sha256(senhaCliente);
  const u = ((cfg && cfg.usuarios) || []).find((x: any) => x && x.ativo !== false && x.hash && x.hash === h);
  if (u) {
    return {
      id: u.id, nome: u.nome, cargo: u.cargo || "",
      perfil: PERFIS[u.perfil] ? u.perfil : "obra", proprio: true,
    };
  }
  const mestre = await hashGuardado(cfg);
  if (mestre && h === mestre) return { id: "equipe", nome: "", cargo: "", perfil: "direcao", proprio: false };
  return null;
}

// Tira todo hash antes de qualquer resposta sair do servidor.
export function cfgSemSegredo(cfg: any) {
  const c = { ...(cfg || {}) };
  delete c.senhaHash;
  c.usuarios = ((cfg && cfg.usuarios) || []).map((u: any) => {
    const x = { ...u };
    delete x.hash;
    return x;
  });
  return c;
}

export const perfilDe = (quem: Quem | null) => (quem && PERFIS[quem.perfil]) ? quem.perfil : "obra";

/* ── O que a obra pode mexer em cada coleção ────────────────────────────────
   Esconder a tela no menu não protege nada: a porta é o servidor. */
const CAMPOS_OBRA: Record<string, string[]> = {
  oc: ["recebimentos", "historico", "situacao", "atualizadoEm", "atualizadoPor"],
  crono: ["etapas", "responsaveis", "historico", "atualizadoEm", "atualizadoPor"],
};

const igual = (a: unknown, b: unknown) =>
  JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

// Devolve '' quando pode, ou o motivo da recusa.
export function motivoRecusa(quem: Quem | null, colecao: string, registro: any, atual: any): string {
  const perfil = perfilDe(quem);
  if (perfil !== "obra") return "";

  const escreve = PERFIS.obra.escreve!;
  if (!escreve.includes(colecao)) return "quem é da obra não grava " + colecao;

  if (colecao === "sc") {
    if (atual && atual.situacao !== "nova") return "a solicitação já saiu da obra";
    if (registro.situacao && registro.situacao !== "nova") return "quem é da obra não aprova a própria solicitação";
    return "";
  }

  if (!atual) return "";

  const permitidos = CAMPOS_OBRA[colecao] || [];
  for (const k of Object.keys(registro)) {
    if (permitidos.includes(k) || k === "id") continue;
    if (!igual(registro[k], atual[k])) return 'quem é da obra não altera "' + k + '" em ' + colecao;
  }
  return "";
}

export function podeFazer(quem: Quem | null, action: string): boolean {
  if (!quem) return false;
  const perfil = perfilDe(quem);
  if (perfil === "direcao") return true;
  if (ACOES_DIRECAO.includes(action)) return false;
  if (perfil === "obra" && ACOES_NEGADAS_OBRA.includes(action)) return false;
  return true;
}

/* ── Leitura: o celular da obra não leva preço para casa ───────────────────── */
const CAMPOS_VALOR = ["preco", "total", "totalLiquido", "totalBruto", "desconto", "frete",
  "valor", "liquido", "bruto", "retencao", "adiantamento", "condicaoPagamento", "banco"];

function semValores(o: any): any {
  if (Array.isArray(o)) return o.map(semValores);
  if (!o || typeof o !== "object") return o;
  const saida: any = {};
  for (const [k, v] of Object.entries(o)) {
    if (CAMPOS_VALOR.includes(k)) continue;
    saida[k] = semValores(v);
  }
  return saida;
}

export function filtrarLeitura(quem: Quem | null, registros: any[]): any[] {
  const p = PERFIS[perfilDe(quem)];
  if (!p || p.tudo || !p.le) return registros;
  return registros
    .filter((r) => p.le!.includes(r._col))
    .map((r) => {
      if (!(p.semPreco || []).includes(r._col)) return r;
      const limpo = semValores(r);
      delete limpo.medicoes;
      delete limpo.aditivos;
      return limpo;
    });
}
