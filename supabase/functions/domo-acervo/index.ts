// ============================================================================
// Supabase Edge Function "acervo" — arquivos grandes (projetos, documentos,
// fotos de recebimento e do diário).
//
// Porte de netlify/functions/acervo.mjs. MANTÉM o protocolo em partes que o
// cliente já usa (iniciar → parte → finalizar → baixarParte): o limite de corpo
// de uma Edge Function é parecido com o do Netlify, e trocar o protocolo
// obrigaria a reescrever o upload do app — que funciona no 4G da obra e já foi
// testado. As partes viram objetos no bucket "arquivos" do Storage:
//
//   <id>/meta   → metadados (na tabela registros, coleção interna "_arqmeta")
//   <id>/p0, p1 → os pedaços
// ============================================================================
import { json, preflight } from "../_shared/cors.ts";
import { identificar, podeFazer } from "../_shared/acesso.ts";
import {
  db, agora, idNovo, lerUm, gravarUm, lerCfgBruta, subirParte, baixarParte,
  apagarArquivo, apagarDeVez,
} from "../_shared/dados.ts";

// Coleção interna: guarda o "meta" de cada arquivo (nome, tamanho, partes).
// Não aparece em COLECOES porque não é dado de obra — é encanamento.
const META = "_arqmeta";

const b64ParaBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesParaB64 = (b: Uint8Array) => {
  let s = "";
  // Em pedaços: passar 2,5MB de uma vez para String.fromCharCode estoura a pilha.
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const h = Object.fromEntries(req.headers);
  const TOKEN = Deno.env.get("TOKEN");
  if (!TOKEN || (h["x-token"] || body.token) !== TOKEN) return json({ error: "Não autorizado" }, 401);

  const cfg = await lerCfgBruta();
  const eu = await identificar(cfg, h["x-senha"] || body.senha || "");
  if (!eu) return json({ error: "Senha do painel inválida", semSenha: true }, 403);

  // 'apagar' e 'uso' mexem no acervo inteiro — a mesma régua do nucleo vale
  // aqui, senão o perfil obra ganharia pelo acervo o poder de apagar que o
  // nucleo nega.
  const ACAO_EQUIVALENTE: Record<string, string> = { apagar: "apagar", uso: "log" };
  const equivalente = ACAO_EQUIVALENTE[body.action];
  if (equivalente && !podeFazer(eu, equivalente)) {
    return json({ error: "Seu acesso não permite isso. Fale com a direção.", semPermissao: true }, 403);
  }

  // O nome do histórico vem do cadastro quando o acesso é próprio.
  const quem = (eu.proprio && eu.nome) ||
    String(h["x-quem"] ? decodeURIComponent(h["x-quem"]) : (body.por || "—")).slice(0, 60);

  try {
    switch (body.action) {

      // Abre um arquivo novo e devolve o id que as partes vão usar.
      case "iniciar": {
        const id = idNovo() + Math.random().toString(36).slice(2, 6);
        const meta = {
          id,
          nome: String(body.nome || "arquivo").slice(0, 200),
          mime: String(body.tipo || "application/octet-stream").slice(0, 100),
          tamanho: Number(body.tamanho) || 0,
          partes: Math.max(1, Number(body.partes) || 1),
          recebidas: 0,
          criadoEm: agora(),
          criadoPor: quem,
          pronto: false,
        };
        await gravarUm(META, id, meta);
        return json({ ok: true, id, meta });
      }

      case "parte": {
        const { id, n, dados } = body;
        const meta = await lerUm(META, id);
        if (!meta) return json({ ok: false, error: "Arquivo não encontrado" }, 404);
        if (typeof dados !== "string") return json({ ok: false, error: "Parte vazia" }, 400);
        await subirParte(id + "/p" + Number(n), b64ParaBytes(dados));
        meta.recebidas = Math.max(Number(meta.recebidas) || 0, Number(n) + 1);
        await gravarUm(META, id, meta);
        return json({ ok: true, recebidas: meta.recebidas, partes: meta.partes });
      }

      case "finalizar": {
        const meta = await lerUm(META, body.id);
        if (!meta) return json({ ok: false, error: "Arquivo não encontrado" }, 404);
        if (meta.recebidas < meta.partes) {
          return json({ ok: false, error: "Faltam partes (" + meta.recebidas + " de " + meta.partes + ")" }, 400);
        }
        meta.pronto = true;
        meta.concluidoEm = agora();
        await gravarUm(META, body.id, meta);
        return json({ ok: true, meta });
      }

      case "meta": {
        const meta = await lerUm(META, body.id);
        if (!meta) return json({ ok: false, error: "Arquivo não encontrado" }, 404);
        return json({ ok: true, meta });
      }

      case "baixarParte": {
        const meta = await lerUm(META, body.id);
        if (!meta) return json({ ok: false, error: "Arquivo não encontrado" }, 404);
        const bytes = await baixarParte(body.id + "/p" + Number(body.n));
        if (!bytes) return json({ ok: false, error: "Parte não encontrada" }, 404);
        return json({ ok: true, dados: bytesParaB64(bytes), partes: meta.partes, meta });
      }

      case "apagar": {
        const meta = await lerUm(META, body.id);
        if (!meta) return json({ ok: true });
        const chaves: string[] = [];
        for (let i = 0; i < (meta.partes || 1); i++) chaves.push(body.id + "/p" + i);
        await apagarArquivo(chaves);
        await apagarDeVez(META, body.id);
        return json({ ok: true });
      }

      case "uso": {
        // Conta pelo metadado, não pelo Storage: listar pasta por pasta seria
        // uma chamada por arquivo, e o tamanho já está guardado aqui.
        const { data } = await db.from("domo_registros").select("registro").eq("colecao", META);
        let bytes = 0, arquivos = 0;
        for (const l of (data || [])) {
          const m = l.registro as any;
          if (!m || !m.pronto) continue;
          bytes += Number(m.tamanho) || 0;
          arquivos++;
        }
        return json({ ok: true, arquivos, bytes });
      }

      default:
        return json({ error: "Ação desconhecida: " + body.action }, 400);
    }
  } catch (e) {
    console.error("[acervo] erro:", e);
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});
