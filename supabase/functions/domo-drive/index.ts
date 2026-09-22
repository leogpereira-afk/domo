// ============================================================================
// domo-drive — a pasta do Google Drive da Domo, lida de dentro do sistema.
//
// POR QUE NO SERVIDOR, e não no navegador: o app da Domo é de EQUIPE (direção,
// escritório e obra têm senhas diferentes). O caminho fácil — o navegador pedir
// o crachá ao Google e falar direto com a API — entregaria a QUEM abrisse a tela
// um crachá que abre o Drive INTEIRO, não só a pasta da obra. Aqui a chave nunca
// sai daqui: o navegador pede "lista essa pasta" e recebe de volta só nomes e
// ids que já conferi estarem DENTRO da pasta raiz configurada.
//
// Escopo pedido ao Google: drive.readonly — navegar, ver e baixar. Nunca
// apagar, mover ou renomear. Nem Gmail, nem agenda.
//
// AÇÕES (POST, com x-token + x-senha, iguais às outras functions da Domo):
//   status        -> { conectado, conta, raiz, precisaAutorizar }
//   autorizarUrl  -> { url }            só direção
//   desconectar   -> { ok }             só direção
//   definirRaiz   -> { ok, raiz }       só direção (link ou id da pasta)
//   pasta         -> { itens, caminho } lista uma pasta (a raiz, se vier sem id)
//   arquivo       -> { dados, partes }  baixa um pedaço (base64), como o acervo
// GET (o navegador voltando do Google, sem cabeçalho nosso):
//   /domo-drive/callback?code=…&state=…
//
// ONDE FICA CADA COISA (coleção interna "_drive", fora do snapshot do app):
//   'refresh' = { token, escopo, conta, em }   o único segredo que sobrevive
//   'token'   = { token, exp }                 crachá de ~1 h, para não renovar à toa
//   'state'   = { valor, exp, por }            bilhete de uma ida só ao Google
//   'config'  = { raiz, nomeRaiz, em, por }    a pasta que o sistema enxerga
// ============================================================================
import { json, preflight } from "../_shared/cors.ts";
import { identificar, perfilDe } from "../_shared/acesso.ts";
import { agora, lerUm, gravarUm, lerCfgBruta, tokenCurto } from "../_shared/dados.ts";

const COL = "_drive";
const APP_URL = "https://leogpereira-afk.github.io/domo/";
const OAUTH_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const ESCOPO = "https://www.googleapis.com/auth/drive.readonly";
const FOLGA_SEG = 120;          // renova antes de vencer, p/ a tela não pegar crachá morto
const PARTE = 2 * 1024 * 1024;  // 2 MB por pedaço, como o acervo
const TETO_SUBIDA = 30;         // degraus máximos ao subir a árvore procurando a raiz

const txt = (v: unknown) => (v == null ? "" : String(v)).trim();

function credenciais(): { id: string; secret: string } {
  const id = txt(Deno.env.get("GOOGLE_CLIENT_ID"));
  const secret = txt(Deno.env.get("GOOGLE_CLIENT_SECRET"));
  if (!id || !secret) throw new Error("config");
  return { id, secret };
}
const urlCallback = () =>
  txt(Deno.env.get("SUPABASE_URL")).replace(/\/+$/, "") + "/functions/v1/domo-drive/callback";

const ler = (chave: string) => lerUm(COL, chave);
const gravar = (chave: string, valor: any) => gravarUm(COL, chave, { ...valor, id: chave });

/* O crachá de acesso vale ~1 h; guardado para não pedir um novo a cada tela.
   Vencido, renova com a chave de renovação — e se o Google recusar (acesso
   tirado no painel da conta), apaga tudo e pede autorização de novo, em vez de
   insistir com uma chave morta. */
async function tokenAcesso(): Promise<string | null> {
  const guardado = await ler("token");
  const exp = guardado ? Date.parse(txt(guardado.exp)) : NaN;
  if (guardado && txt(guardado.token) && Number.isFinite(exp) && exp > Date.now() + FOLGA_SEG * 1000) {
    return txt(guardado.token);
  }
  const refresh = await ler("refresh");
  const chave = refresh ? txt(refresh.token) : "";
  if (!chave) return null;
  const { id, secret } = credenciais();
  let resp: Response;
  try {
    resp = await fetch(OAUTH_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "refresh_token", refresh_token: chave }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch { throw new Error("rede"); }
  const dados = await resp.json().catch(() => ({} as any));
  if (!resp.ok) {
    if (resp.status === 400 || resp.status === 401) {
      await gravar("refresh", { token: "", em: agora(), motivo: "recusado pelo Google" });
      return null;
    }
    throw new Error("google " + resp.status);
  }
  const token = txt(dados.access_token);
  if (!token) throw new Error("token vazio");
  const seg = Number(dados.expires_in) || 3600;
  await gravar("token", { token, exp: new Date(Date.now() + seg * 1000).toISOString() });
  return token;
}

async function googleGet(token: string, url: string, cabecalhos: Record<string, string> = {}) {
  const r = await fetch(url, {
    headers: { authorization: "Bearer " + token, ...cabecalhos },
    signal: AbortSignal.timeout(25_000),
  });
  return r;
}

const CAMPOS = "id,name,mimeType,size,modifiedTime,iconLink,parents,shortcutDetails";
const ehPasta = (m: string) => m === "application/vnd.google-apps.folder";

async function meta(token: string, id: string): Promise<any | null> {
  const r = await googleGet(token, "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) +
    "?fields=" + encodeURIComponent(CAMPOS) + "&supportsAllDrives=true");
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("google " + r.status);
  return await r.json();
}

/* A TRAVA que faz esta tela ser da OBRA e não do Drive inteiro: um id só passa
   se for a pasta raiz ou descendente dela. Sem isto, qualquer id copiado de
   outro lugar do Drive abriria por aqui — a pasta configurada viraria enfeite.
   Sobe pelos `parents` até achar a raiz, com teto para não girar à toa. */
async function dentroDaRaiz(token: string, id: string, raiz: string): Promise<boolean> {
  if (!raiz) return false;
  let atual = id;
  for (let i = 0; i < TETO_SUBIDA; i++) {
    if (atual === raiz) return true;
    const m = await meta(token, atual);
    const pais: string[] = (m && m.parents) || [];
    if (!pais.length) return false;
    atual = pais[0];
  }
  return false;
}

async function config() {
  const c = (await ler("config")) || {};
  return { raiz: txt(c.raiz), nomeRaiz: txt(c.nomeRaiz), em: txt(c.em), por: txt(c.por) };
}

// Aceita o link inteiro da barra de endereços ou só o id — ninguém tem de
// saber o que é "id de pasta" para usar isto.
function idDePasta(entrada: string): string {
  const s = txt(entrada);
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : "";
}

async function contaGoogle(token: string): Promise<string> {
  try {
    const r = await googleGet(token, "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)");
    if (!r.ok) return "";
    const d = await r.json();
    return txt(d?.user?.emailAddress);
  } catch { return ""; }
}

const voltar = (motivo: string) =>
  Response.redirect(APP_URL + (motivo ? "?drive_erro=" + encodeURIComponent(motivo) : "") + "#/drive", 302);

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const url = new URL(req.url);

  // ── volta do Google: GET sem cabeçalho nosso, autenticado pelo `state` ──
  if (req.method === "GET" && url.pathname.endsWith("/callback")) {
    try {
      if (txt(url.searchParams.get("error"))) return voltar("negado");
      const code = txt(url.searchParams.get("code"));
      const state = txt(url.searchParams.get("state"));
      const guardado = await ler("state");
      const valido = guardado && txt(guardado.valor) && txt(guardado.valor) === state &&
        Date.parse(txt(guardado.exp)) > Date.now();
      // Bilhete de uma ida só: consome sempre, mesmo quando não confere, para
      // ninguém ficar tentando adivinhar.
      await gravar("state", { valor: "", exp: "", em: agora() });
      if (!code || !valido) return voltar("bilhete");

      const { id, secret } = credenciais();
      const r = await fetch(OAUTH_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: id, client_secret: secret, code,
          grant_type: "authorization_code", redirect_uri: urlCallback(),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok) return voltar("troca-" + r.status);
      const refresh = txt(d.refresh_token);
      // Sem chave de renovação a conexão morreria em 1 h — melhor dizer do que fingir.
      if (!refresh) return voltar("sem-renovacao");
      const token = txt(d.access_token);
      const conta = token ? await contaGoogle(token) : "";
      await gravar("refresh", { token: refresh, escopo: txt(d.scope), conta, em: agora(), por: txt(guardado.por) });
      if (token) {
        const seg = Number(d.expires_in) || 3600;
        await gravar("token", { token, exp: new Date(Date.now() + seg * 1000).toISOString() });
      }
      return voltar("");
    } catch (e) {
      return voltar((e as Error)?.message === "config" ? "config" : "erro");
    }
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const h = Object.fromEntries(req.headers);
  const TOKEN = Deno.env.get("TOKEN");
  if (!TOKEN || (h["x-token"] || body.token) !== TOKEN) return json({ error: "Não autorizado" }, 401);

  const cfg = await lerCfgBruta();
  const eu = await identificar(cfg, h["x-senha"] || body.senha || "");
  if (!eu) return json({ error: "Senha do painel inválida", semSenha: true }, 403);

  const perfil = perfilDe(eu);
  // A pasta da empresa no Drive tem contrato, proposta e coisa de escritório.
  // Quem é da obra não abre esta tela — a régua mora AQUI, não só no menu.
  if (perfil === "obra") {
    return json({ error: "Seu acesso não alcança a pasta do Drive. Fale com a direção.", semPermissao: true }, 403);
  }
  const soDirecao = () =>
    perfil === "direcao" ? null : json({ error: "Só a direção conecta ou troca a pasta do Drive.", semPermissao: true }, 403);
  const quem = (eu.proprio && eu.nome) ||
    String(h["x-quem"] ? decodeURIComponent(h["x-quem"]) : (body.por || "—")).slice(0, 60);

  try {
    const acao = txt(body.action);

    if (acao === "status") {
      const c = await config();
      const refresh = await ler("refresh");
      const conectado = !!(refresh && txt(refresh.token));
      return json({
        ok: true, conectado, conta: conectado ? txt(refresh.conta) : "",
        raiz: c.raiz, nomeRaiz: c.nomeRaiz, definidaEm: c.em, definidaPor: c.por,
        podeConectar: perfil === "direcao",
      });
    }

    if (acao === "autorizarUrl") {
      const nao = soDirecao(); if (nao) return nao;
      const { id } = credenciais();
      const valor = tokenCurto() + tokenCurto();
      await gravar("state", { valor, exp: new Date(Date.now() + 10 * 60 * 1000).toISOString(), por: quem, em: agora() });
      const u = new URL(OAUTH_AUTH);
      u.searchParams.set("client_id", id);
      u.searchParams.set("redirect_uri", urlCallback());
      u.searchParams.set("response_type", "code");
      u.searchParams.set("scope", ESCOPO);
      // offline + consent: é o que faz o Google devolver a chave de renovação
      u.searchParams.set("access_type", "offline");
      u.searchParams.set("prompt", "consent");
      u.searchParams.set("state", valor);
      return json({ ok: true, url: u.toString(), callback: urlCallback() });
    }

    if (acao === "desconectar") {
      const nao = soDirecao(); if (nao) return nao;
      await gravar("refresh", { token: "", em: agora(), motivo: "desligado por " + quem });
      await gravar("token", { token: "", exp: "" });
      return json({ ok: true });
    }

    if (acao === "definirRaiz") {
      const nao = soDirecao(); if (nao) return nao;
      const id = idDePasta(body.pasta);
      if (!id) return json({ error: "Cole o link da pasta do Drive (ou o id dela)." }, 400);
      const token = await tokenAcesso();
      if (!token) return json({ ok: true, precisaAutorizar: true });
      const m = await meta(token, id);
      if (!m) return json({ error: "Não achei essa pasta na conta conectada." }, 404);
      if (!ehPasta(txt(m.mimeType))) return json({ error: "Isso é um arquivo, não uma pasta." }, 400);
      await gravar("config", { raiz: id, nomeRaiz: txt(m.name), em: agora(), por: quem });
      return json({ ok: true, raiz: id, nomeRaiz: txt(m.name) });
    }

    if (acao === "pasta") {
      const token = await tokenAcesso();
      if (!token) return json({ ok: true, precisaAutorizar: true });
      const c = await config();
      if (!c.raiz) return json({ ok: true, semRaiz: true });
      const alvo = txt(body.id) || c.raiz;
      if (alvo !== c.raiz && !await dentroDaRaiz(token, alvo, c.raiz)) {
        return json({ error: "Essa pasta está fora da pasta da Domo.", semPermissao: true }, 403);
      }
      const q = encodeURIComponent("'" + alvo.replace(/'/g, "\\'") + "' in parents and trashed = false");
      const r = await googleGet(token, "https://www.googleapis.com/drive/v3/files?q=" + q +
        "&fields=" + encodeURIComponent("files(" + CAMPOS + ")") +
        "&orderBy=folder,name&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true");
      if (!r.ok) throw new Error("google " + r.status);
      const d = await r.json();
      const itens = (d.files || []).map((f: any) => ({
        id: txt(f.id), nome: txt(f.name), tipo: txt(f.mimeType),
        pasta: ehPasta(txt(f.mimeType)), tamanho: Number(f.size) || 0, em: txt(f.modifiedTime),
      }));
      // Caminho de volta até a raiz, para a tela ter migalhas sem adivinhar.
      const caminho: { id: string; nome: string }[] = [];
      let sobe = alvo;
      for (let i = 0; i < TETO_SUBIDA && sobe; i++) {
        const m = await meta(token, sobe);
        if (!m) break;
        caminho.unshift({ id: txt(m.id), nome: txt(m.name) });
        if (sobe === c.raiz) break;
        sobe = (m.parents || [])[0] || "";
      }
      return json({ ok: true, itens, caminho, raiz: c.raiz });
    }

    if (acao === "arquivo") {
      const token = await tokenAcesso();
      if (!token) return json({ ok: true, precisaAutorizar: true });
      const c = await config();
      const id = txt(body.id);
      if (!id) return json({ error: "Sem arquivo" }, 400);
      if (!await dentroDaRaiz(token, id, c.raiz)) {
        return json({ error: "Esse arquivo está fora da pasta da Domo.", semPermissao: true }, 403);
      }
      const m = await meta(token, id);
      if (!m) return json({ error: "Arquivo não encontrado" }, 404);
      const tipo = txt(m.mimeType);
      if (ehPasta(tipo)) return json({ error: "Isso é uma pasta." }, 400);

      // Documento nativo do Google não tem bytes para baixar: sai exportado.
      const EXPORTA: Record<string, { mime: string; ext: string }> = {
        "application/vnd.google-apps.document": { mime: "application/pdf", ext: ".pdf" },
        "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: ".pdf" },
        "application/vnd.google-apps.drawing": { mime: "application/pdf", ext: ".pdf" },
        "application/vnd.google-apps.spreadsheet": {
          mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: ".xlsx",
        },
      };
      const exp = EXPORTA[tipo];
      if (!exp && tipo.startsWith("application/vnd.google-apps.")) {
        return json({ error: "Este tipo do Google não pode ser baixado (" + tipo.split(".").pop() + ")." }, 400);
      }

      const i = Math.max(0, Number(body.i) || 0);
      const alvoUrl = exp
        ? "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) + "/export?mimeType=" + encodeURIComponent(exp.mime)
        : "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) + "?alt=media&supportsAllDrives=true";
      // Exportado não aceita Range: vem inteiro, e por isso tem teto.
      const cab = exp ? {} : { range: "bytes=" + i * PARTE + "-" + ((i + 1) * PARTE - 1) };
      const r = await googleGet(token, alvoUrl, cab);
      if (!r.ok && r.status !== 206) {
        if (r.status === 416) return json({ error: "Pedaço fora do arquivo" }, 400);
        throw new Error("google " + r.status);
      }
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (exp && bytes.length > 12 * 1024 * 1024) {
        return json({ error: "Este documento exportado ficou grande demais para abrir aqui. Abra no Drive." }, 413);
      }
      let s = "";
      for (let k = 0; k < bytes.length; k += 8192) s += String.fromCharCode(...bytes.subarray(k, k + 8192));
      const total = exp ? bytes.length : Number(m.size) || bytes.length;
      return json({
        ok: true, dados: btoa(s), i,
        partes: exp ? 1 : Math.max(1, Math.ceil(total / PARTE)),
        nome: txt(m.name) + (exp ? exp.ext : ""),
        mime: exp ? exp.mime : (tipo || "application/octet-stream"),
        tamanho: total,
      });
    }

    return json({ error: "Ação desconhecida: " + acao }, 400);
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    if (msg === "config") return json({ error: "Faltam as chaves do Google no servidor." }, 500);
    if (msg === "rede") return json({ error: "Não foi possível falar com o Google agora." }, 502);
    console.error("[drive] erro:", e);
    return json({ error: "Não deu para falar com o Drive (" + msg + ")." }, 500);
  }
});
