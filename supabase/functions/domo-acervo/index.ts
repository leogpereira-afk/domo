// ============================================================================
// Supabase Edge Function "acervo" — arquivos grandes (projetos, documentos,
// fotos de recebimento e do diário).
//
// MANTÉM o protocolo de envio em partes que o
// cliente já usa (iniciar → parte → finalizar → baixarParte): o limite de corpo
// de uma Edge Function é parecido com o do Netlify, e trocar o protocolo
// obrigaria a reescrever o upload do app — que funciona no 4G da obra e já foi
// testado. As partes viram objetos no bucket "arquivos" do Storage:
//
//   <id>/meta   → metadados (na tabela registros, coleção interna "_arqmeta")
//   <id>/p0, p1 → os pedaços
// ============================================================================
import { json, preflight } from "../_shared/cors.ts";
import { identificar, perfilDe, podeFazer, podeLerRegistro, COLECOES_SO_DIRECAO } from "../_shared/acesso.ts";
import { NOMES_COLECOES } from "../_shared/colecoes.ts";
import { arquivosDoRegistro } from "../_shared/arquivos.ts";
import {
  agora,
  idNovo,
  lerUm,
  gravarUm,
  lerCfgBruta,
  lerTudo,
  subirParte,
  baixarParte,
  apagarArquivo,
  apagarDeVez,
  lerColecaoBruta, atualizarRegistro,
} from "../_shared/dados.ts";

// Coleção interna: guarda o "meta" de cada arquivo (nome, tamanho, partes).
// Não aparece em COLECOES porque não é dado de obra — é encanamento.
const META = "_arqmeta";

// arquivosDoRegistro agora vem de _shared/arquivos.ts (cópia única).

// Coleções cujo ARQUIVO o pessoal da obra pode baixar: planta, documento da
// empresa, cadastro de fornecedor, e as fotos que ela mesma tira no recebimento
// (moram na 'oc') e no diário ('os'). Fica de fora 'prest' (CPF/ASO de
// terceiros) e 'cot' (não tem arquivo). 'comp' tem regra própria: só o dono.
const COLECAO_ARQ_OBRA = new Set(["proj", "doc", "forn", "oc", "os"]);

// A senha do painel abria QUALQUER arquivo por id — vira chave-mestra do acervo.
// Aqui a régua de LEITURA volta a valer por arquivo: acha o registro dono e
// aplica o mesmo filtro do snapshot. Direção e escritório leem tudo; a obra só o
// que lhe pertence, e nunca o anexo da conversa de outra pessoa.
async function podeBaixar(eu: any, arquivoId: string): Promise<boolean> {
  const perfil = perfilDe(eu);
  if (perfil === "direcao") return true;                    // direção: tudo
  const registros = await lerTudo(null, NOMES_COLECOES);
  const donos = registros.filter((o: any) => arquivosDoRegistro(o).includes(arquivoId));
  // Um arquivo compartilhado com RH/agenda privada mantém a regra mais restrita.
  if (donos.length) return donos.every((o: any) =>
    podeLerRegistro(eu, o) && (perfil !== "obra" || o._col === "comp" || COLECAO_ARQ_OBRA.has(o._col)));

  // Arquivo órfão (nenhum registro o referencia): só a direção. Um ASO/anexo que
  // sobre no bucket não pode virar porta dos fundos para o escritório — direção
  // já devolveu true lá em cima, então aqui é sempre não.
  return false;
}

function donoDoEnvio(eu: any, meta: any): boolean {
  // Uploads antigos sem id de autor só podem ser concluídos pela direção.
  return perfilDe(eu) === "direcao" || (meta.criadoPorId && meta.criadoPorId === eu.id);
}

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
        const tamanho = Number(body.tamanho), partes = Number(body.partes);
        if (!Number.isSafeInteger(tamanho) || tamanho < 1 || tamanho > 500 * 1024 * 1024 ||
            !Number.isSafeInteger(partes) || partes < 1 || partes > 1000 || partes > tamanho) {
          return json({ ok: false, error: "Tamanho ou quantidade de partes inválidos." }, 400);
        }
        let vinculoPendente;
        if (body.vinculoPendente) {
          const destino = body.vinculoPendente;
          if (destino.colecao !== 'orc' || typeof destino.registroId !== 'string' || !destino.registroId || destino.registroId.length > 300) return json({error:'Destino do anexo inválido.'},400);
          if (!['direcao','escritorio'].includes(perfilDe(eu))) return json({error:'Seu acesso não permite anexar a este orçamento.',semPermissao:true},403);
          const registro = await lerUm('orc',destino.registroId);
          if (!registro || registro.apagadoEm) return json({error:'O orçamento precisa estar sincronizado antes do envio do anexo.'},404);
          if (!podeLerRegistro(eu,{...registro,_col:'orc'})) return json({error:'Seu acesso não permite este orçamento.',semPermissao:true},403);
          vinculoPendente = {colecao:'orc',registroId:destino.registroId};
        }
        const id = idNovo() + Math.random().toString(36).slice(2, 6);
        const meta = {
          id,
          nome: String(body.nome || "arquivo").slice(0, 200),
          // O CLIENTE manda o tipo no campo 'mime' (store.js). O porte estava
          // lendo 'body.tipo' — que nunca chega — e gravava tudo como
          // octet-stream, então o PDF baixava sem abrir. `?? body.tipo` deixa
          // tolerante a qualquer chamador futuro.
          mime: String(body.mime ?? body.tipo ?? "application/octet-stream").slice(0, 100),
          tamanho: Number(body.tamanho) || 0,
          partes: Math.max(1, Number(body.partes) || 1),
          recebidas: 0,
          criadoEm: agora(),
          criadoPor: quem,
          criadoPorId: eu.id,
          pronto: false,
          ...(vinculoPendente ? {vinculoPendente} : {}),
        };
        await gravarUm(META, id, meta);
        return json({ ok: true, id, meta });
      }

      case "parte": {
        const { id, dados } = body;
        // O CLIENTE manda o índice do pedaço no campo 'i' (store.js). O porte
        // lia 'body.n' — que chega vazio — e Number(undefined) vira NaN: TODA
        // parte era gravada na mesma chave 'id/pNaN' (uma por cima da outra) e
        // nenhum upload concluía. Aceita os dois nomes, mas exige um número.
        const idx = Number(body.i ?? body.n);
        if (!Number.isInteger(idx) || idx < 0) return json({ ok: false, error: "Índice de parte inválido" }, 400);
        const meta = await lerUm(META, id);
        if (!meta) return json({ ok: false, error: "Arquivo não encontrado" }, 404);
        if (meta.excluindoEm) return json({error:'Arquivo em remoção. Reenvie o arquivo preservado.'},410);
        // Arquivo já FINALIZADO não aceita novo pedaço: sem isso, qualquer um
        // sobrescrevia a planta aprovada com lixo e ninguém via (o mesmo nome,
        // o mesmo "pronto", conteúdo corrompido).
        if (meta.pronto) return json({ ok: false, error: "Arquivo já finalizado" }, 409);
        // Só quem começou o upload manda os pedaços dele (a direção destrava
        // qualquer um). Impede escrever por cima do arquivo em andamento de outro.
        if (!donoDoEnvio(eu, meta)) {
          return json({ ok: false, error: "Este envio é de outra pessoa", semPermissao: true }, 403);
        }
        if (idx >= meta.partes) return json({ ok: false, error: "Parte fora do arquivo." }, 400);
        if (typeof dados !== "string") return json({ ok: false, error: "Parte vazia" }, 400);
        const bytes = b64ParaBytes(dados);
        if (!bytes.length || bytes.length > meta.tamanho || bytes.length > 2.5 * 1024 * 1024) return json({ ok: false, error: "Tamanho da parte inválido." }, 400);
        const existente = await baixarParte(id + "/p" + idx);
        if (existente) {
          if (existente.length !== bytes.length || existente.some((b: number, i: number) => b !== bytes[i])) {
            return json({ ok: false, error: "Esta parte já foi recebida com outro conteúdo. Reinicie o envio." }, 409);
          }
        } else await subirParte(id + "/p" + idx, bytes); // Storage não permite sobrescrever.
        const atualizado = await atualizarRegistro(META, id, (atual: any) => {
          if (!atual || atual.excluindoEm || !donoDoEnvio(eu, atual)) throw new Error("Envio não disponível.");
          return { ...atual, recebidas: Math.max(Number(atual.recebidas) || 0, idx + 1) };
        });
        return json({ ok: true, recebidas: atualizado.recebidas, partes: atualizado.partes });
      }

      case "finalizar": {
        const meta = await lerUm(META, body.id);
        if (!meta) return json({ ok: false, error: "Arquivo não encontrado" }, 404);
        if (meta.excluindoEm) return json({error:'Arquivo em remoção. Reenvie o arquivo preservado.'},410);
        if (!donoDoEnvio(eu, meta)) return json({ ok: false, error: "Este envio é de outra pessoa", semPermissao: true }, 403);
        if (meta.pronto) return json({ ok: true, meta });
        let tamanhoReal = 0;
        // Não confia só no contador: confere pedaço por pedaço no Storage, como
        // o backend antigo fazia. Um contador certo com uma parte que não subiu
        // deixaria o arquivo "pronto" e corrompido.
        for (let i = 0; i < (meta.partes || 1); i++) {
          const p = await baixarParte(body.id + "/p" + i);
          if (!p) return json({ ok: false, error: "Falta a parte " + i + " de " + meta.partes }, 400);
          tamanhoReal += p.byteLength;
        }
        if (tamanhoReal !== meta.tamanho) return json({ ok: false, error: "Arquivo incompleto: o tamanho recebido difere do original." }, 400);
        const pronto = await atualizarRegistro(META, body.id, (atual: any) => {
          if (!atual || atual.excluindoEm || !donoDoEnvio(eu, atual) || atual.tamanho !== meta.tamanho || atual.partes !== meta.partes) throw new Error("O envio mudou. Confira e tente novamente.");
          return { ...atual, pronto: true, concluidoEm: atual.concluidoEm || agora() };
        });
        return json({ ok: true, meta: pronto });
      }

      case "meta": {
        const meta = await lerUm(META, body.id);
        if (!meta) return json({ ok: false, error: "Arquivo não encontrado" }, 404);
        if (!await podeBaixar(eu, body.id)) {
          return json({ error: "Seu acesso não permite este arquivo.", semPermissao: true }, 403);
        }
        return json({ ok: true, meta });
      }

      // Confirmação/retomada do próprio upload, inclusive antes do vínculo.
      // Não concede download de arquivos órfãos a outro usuário.
      case "estadoEnvio": {
        const meta = await lerUm(META,body.id);
        if (!meta || meta.excluindoEm) return json({error:'Arquivo não encontrado'},404);
        if (!donoDoEnvio(eu,meta)) return json({error:'Este envio é de outra pessoa',semPermissao:true},403);
        return json({ok:true,meta});
      }

      case "baixarParte": {
        const idx = Number(body.i ?? body.n);
        if (!Number.isInteger(idx) || idx < 0) return json({ ok: false, error: "Índice de parte inválido" }, 400);
        const meta = await lerUm(META, body.id);
        if (!meta) return json({ ok: false, error: "Arquivo não encontrado" }, 404);
        // A régua de leitura por arquivo (fecha o furo da "senha = chave-mestra").
        if (!await podeBaixar(eu, body.id)) {
          return json({ error: "Seu acesso não permite este arquivo.", semPermissao: true }, 403);
        }
        const bytes = await baixarParte(body.id + "/p" + idx);
        if (!bytes) return json({ ok: false, error: "Parte não encontrada" }, 404);
        return json({ ok: true, dados: bytesParaB64(bytes), partes: meta.partes, meta });
      }

      case "apagar": {
        const meta = await lerUm(META, body.id);
        if (!meta) return json({ ok: true });
        if (!donoDoEnvio(eu, meta)) return json({ error: "Seu acesso não permite apagar este arquivo.", semPermissao: true }, 403);
        const registros = await lerTudo(null, NOMES_COLECOES);
        if (registros.some((r: any) => arquivosDoRegistro(r).includes(body.id))) {
          return json({ error: "Este arquivo ainda está vinculado a um registro. Preserve-o até a limpeza da lixeira." }, 409);
        }
        const chaves: string[] = [];
        for (let i = 0; i < (meta.partes || 1); i++) chaves.push(body.id + "/p" + i);
        await apagarArquivo(chaves);
        await apagarDeVez(META, body.id);
        return json({ ok: true });
      }

      case "uso": {
        // Conta pelo metadado, não pelo Storage: listar pasta por pasta seria
        // uma chamada por arquivo, e o tamanho já está guardado aqui. Paginado
        // para não parar em 1000 arquivos.
        const linhas = await lerColecaoBruta(META, "registro");
        let bytes = 0, arquivos = 0;
        for (const l of linhas) {
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
