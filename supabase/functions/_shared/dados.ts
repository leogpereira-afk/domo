// Camada de dados — o que antes era Netlify Blobs, agora é Postgres.
//
// De propósito ela imita o formato do Blobs (ler um, gravar um, listar,
// apagar). Assim o miolo do sistema — numeração, união de campos, recálculo da
// situação da ordem, regras de acesso — foi PORTADO, não reescrito. Aquela
// lógica levou uma auditoria adversarial inteira para ficar de pé; reescrever
// do zero seria convidar os mesmos bugs de volta.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// Prefere a chave "secret" nova (sb_secret_…), guardada como segredo do
// projeto. A service_role legada continua como reserva para não haver janela de
// indisponibilidade — mas ela é um JWT assinado pela chave HS256, e é essa que
// vamos desligar. Depender só dela deixaria o sistema refém de uma chave que
// não dá para girar sem derrubar tudo.
const SERVICE_ROLE_KEY = Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Cliente de serviço: ignora RLS. É o único que toca nas tabelas — igual a
// "só a Netlify Function fala com o Blobs".
export const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const agora = () => new Date().toISOString();
export const idNovo = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const tokenCurto = () => {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/* ── registros ─────────────────────────────────────────────────────────────── */
export async function lerUm(colecao: string, id: string): Promise<any | null> {
  if (!id) return null;
  const { data } = await db.from("domo_registros").select("registro")
    .eq("colecao", colecao).eq("id", id).maybeSingle();
  return data ? data.registro : null;
}

export async function gravarUm(colecao: string, id: string, registro: any): Promise<void> {
  const { error } = await db.from("domo_registros").upsert({
    colecao, id, registro,
    atualizado_em: registro.atualizadoEm || agora(),
    apagado: !!registro.apagadoEm,
  });
  if (error) throw new Error("gravar " + colecao + ": " + error.message);
}

// Todos os registros (com a lixeira — o cliente é quem esconde o apagado).
export async function lerTudo(colecoes: string[] | null, todas: string[]): Promise<any[]> {
  const alvo = (colecoes && colecoes.length ? colecoes : todas).filter((c) => todas.includes(c));
  if (!alvo.length) return [];
  const saida: any[] = [];
  // Página de 1000 para não estourar o limite padrão do PostgREST num sistema
  // que vai crescer por anos.
  let de = 0;
  for (;;) {
    const { data, error } = await db.from("domo_registros").select("colecao, registro")
      .in("colecao", alvo).range(de, de + 999);
    if (error) throw new Error("lerTudo: " + error.message);
    for (const linha of (data || [])) saida.push({ ...linha.registro, _col: linha.colecao });
    if (!data || data.length < 1000) break;
    de += 1000;
  }
  return saida;
}

export async function apagarDeVez(colecao: string, id: string): Promise<void> {
  await db.from("domo_registros").delete().eq("colecao", colecao).eq("id", id);
}

/* ── cfg (linha única) ─────────────────────────────────────────────────────── */
export async function lerCfgBruta(): Promise<any> {
  const { data } = await db.from("domo_cfg").select("config").eq("id", true).maybeSingle();
  return (data && data.config) || {};
}

export async function gravarCfg(config: any): Promise<void> {
  const { error } = await db.from("domo_cfg").upsert({ id: true, config, atualizado_em: agora() });
  if (error) throw new Error("gravarCfg: " + error.message);
}

/* ── numeração ─────────────────────────────────────────────────────────────── */
// Atômico de verdade: um único INSERT ... ON CONFLICT DO UPDATE dentro de uma
// função do Postgres. Dois aparelhos criando documento ao mesmo tempo saem com
// números diferentes, sem laço de tentativa (o Blobs precisava de onlyIfNew).
export async function proximoNumero(colecao: string): Promise<number> {
  const { data, error } = await db.rpc("domo_proximo_numero", { p_colecao: colecao });
  if (error) throw new Error("numerar " + colecao + ": " + error.message);
  return Number(data);
}

export async function guardarIndiceNumero(colecao: string, numero: number, regId: string): Promise<void> {
  await db.from("domo_seq_idx").upsert({ colecao, numero, reg_id: regId });
}

export async function idPorNumero(colecao: string, numero: number): Promise<string | null> {
  const { data } = await db.from("domo_seq_idx").select("reg_id")
    .eq("colecao", colecao).eq("numero", numero).maybeSingle();
  return data ? data.reg_id : null;
}

export async function lerNumeracao(): Promise<Record<string, { n: number }>> {
  const { data } = await db.from("domo_seq").select("colecao, n");
  const saida: Record<string, { n: number }> = {};
  for (const l of (data || [])) saida["ultimo_" + l.colecao] = { n: l.n };
  return saida;
}

export async function definirNumeracao(colecao: string, n: number): Promise<void> {
  await db.from("domo_seq").upsert({ colecao, n });
}

/* ── log ───────────────────────────────────────────────────────────────────── */
export async function registrarLog(entrada: Record<string, unknown>): Promise<void> {
  try {
    await db.from("domo_log").insert({ entrada });
  } catch (e) {
    console.warn("[log] falhou:", (e as Error)?.message);
  }
}

export async function lerLog(limite = 200): Promise<any[]> {
  const { data } = await db.from("domo_log").select("em, entrada").order("em", { ascending: false }).limit(limite);
  return (data || []).map((l: any) => ({ em: l.em, ...l.entrada }));
}

/* ── backup ────────────────────────────────────────────────────────────────── */
export async function gravarBackup(dia: string, conteudo: unknown): Promise<void> {
  const { error } = await db.from("domo_backup").upsert({ dia, conteudo, em: agora() });
  if (error) throw new Error("backup: " + error.message);
}

/* ── arquivos (Storage) ────────────────────────────────────────────────────── */
export const BUCKET = "domo-arquivos";

export async function subirParte(chave: string, corpo: Uint8Array): Promise<void> {
  const { error } = await db.storage.from(BUCKET).upload(chave, corpo, {
    contentType: "application/octet-stream", upsert: true,
  });
  if (error) throw new Error("subir " + chave + ": " + error.message);
}

export async function baixarParte(chave: string): Promise<Uint8Array | null> {
  const { data, error } = await db.storage.from(BUCKET).download(chave);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function apagarArquivo(chaves: string[]): Promise<void> {
  if (chaves.length) await db.storage.from(BUCKET).remove(chaves);
}

export async function listarArquivos(prefixo = ""): Promise<{ name: string; size: number }[]> {
  const saida: { name: string; size: number }[] = [];
  let de = 0;
  for (;;) {
    const { data, error } = await db.storage.from(BUCKET).list(prefixo, { limit: 1000, offset: de });
    if (error || !data) break;
    for (const o of data) saida.push({ name: o.name, size: (o.metadata as any)?.size || 0 });
    if (data.length < 1000) break;
    de += 1000;
  }
  return saida;
}

/* ── meta (contador de versão) ─────────────────────────────────────────────── */
export async function marcarMudanca(colecoes: string | string[]): Promise<void> {
  const lista = (Array.isArray(colecoes) ? colecoes : [colecoes]).filter(Boolean);
  if (!lista.length) return;
  try {
    const { data } = await db.from("domo_meta").select("valor").eq("chave", "rev").maybeSingle();
    const atual = (data?.valor as any) ?? {};
    const porColecao = { ...(atual.porColecao ?? {}) };
    const t = Date.now();
    for (const c of lista) porColecao[c] = t;
    await db.from("domo_meta").upsert({ chave: "rev", valor: { rev: t, porColecao }, atualizado_em: agora() });
  } catch { /* best-effort: rev é só uma dica de cache */ }
}
