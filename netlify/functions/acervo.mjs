// Netlify Function — endpoint /.netlify/functions/acervo
// Guarda arquivos grandes (projetos, documentos, fotos de recebimento) no
// Netlify Blobs em PARTES.
//
// Por que em partes: uma Function do Netlify só aceita ~6MB por requisição
// (ida e volta). Uma planta em PDF passa disso fácil. Então o navegador fatia
// o arquivo em pedaços de 2,5MB, manda um por vez, e na hora de baixar remonta
// tudo de volta no navegador. Do lado do usuário parece um upload/download só.
//
// Chaves no store "arq":  <id>_meta  (JSON)   e   <id>_p0, <id>_p1, ...

import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

// Mesma porta do nucleo.mjs. Quando os acessos individuais foram criados, só
// metade do sistema aprendeu a reconhecê-los: esta Function continuou olhando
// só para a senha da equipe, e quem tinha acesso próprio não conseguia subir
// nem baixar arquivo nenhum — foto de nota, planta, CND de prestador.
import { identificar, podeFazer, perfilDe } from './lib/acesso.mjs';

// Leitura FORTE (consistency: 'strong'). Sem isso, o Blobs devolve leitura
// eventual: um registro recém-gravado volta como inexistente por mais de 5s
// (medido no ar em 28/07/2026 — quem pedia material não conseguia consultar o
// próprio pedido logo depois). Só funciona em Function v2 (ESM, export default);
// na runtime antiga (exports.handler + connectLambda) a leitura forte dá erro.
function blobStore(name) {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token, consistency: 'strong' });
  return getStore({ name, consistency: 'strong' });
}

const agora = () => new Date().toISOString();

function resp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function lerCfg() {
  try { return await blobStore('cfg').get('cfg', { type: 'json' }); } catch { return null; }
}

export default async (req) => {
  if (req.method !== 'POST') return resp({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return resp({ error: 'JSON inválido' }, 400); }

  const h = Object.fromEntries(req.headers);
  const token = h['x-token'] || body.token;
  if (!process.env.TOKEN || token !== process.env.TOKEN) return resp({ error: 'Não autorizado' }, 401);

  const senhaCliente = h['x-senha'] || body.senha || '';
  const cfg = await lerCfg();
  const eu = identificar(cfg, senhaCliente);
  if (!eu) return resp({ error: 'Senha do painel inválida', semSenha: true }, 403);

  // 'apagar' e 'uso' mexem no acervo inteiro — a mesma régua do nucleo.mjs
  // vale aqui, senão o perfil obra ganharia pelo acervo o poder de apagar que
  // o nucleo nega.
  const ACAO_ARQUIVO = { apagar: 'apagar', uso: 'log' };
  const acaoEquivalente = ACAO_ARQUIVO[body.action];
  if (acaoEquivalente && !podeFazer(eu, acaoEquivalente)) {
    return resp({ error: 'Seu acesso não permite isso. Fale com a direção.', semPermissao: true }, 403);
  }

  const store = blobStore('arq');
  // O nome do histórico vem do cadastro quando o acesso é próprio.
  const quem = (eu.proprio && eu.nome) ||
    String(h['x-quem'] ? decodeURIComponent(h['x-quem']) : (body.por || '—')).slice(0, 60);

  try {
    switch (body.action) {

      // Abre um arquivo novo e devolve o id que as partes vão usar.
      case 'iniciar': {
        const id = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
        const meta = {
          id,
          nome: String(body.nome || 'arquivo').slice(0, 200),
          mime: String(body.mime || 'application/octet-stream').slice(0, 120),
          tamanho: Number(body.tamanho) || 0,
          partes: Number(body.partes) || 1,
          recebidas: 0,
          completo: false,
          criadoEm: agora(),
          criadoPor: quem
        };
        await store.setJSON(id + '_meta', meta);
        return resp({ ok: true, id, meta });
      }

      // Recebe um pedaço (base64). Grava como binário.
      case 'parte': {
        const { id, i, dados } = body;
        if (!id || typeof i !== 'number' || typeof dados !== 'string') return resp({ error: 'Parte inválida' }, 400);
        const meta = await store.get(id + '_meta', { type: 'json' }).catch(() => null);
        if (!meta) return resp({ error: 'Arquivo não iniciado' }, 404);
        const buf = Buffer.from(dados, 'base64');
        await store.set(id + '_p' + i, buf);
        meta.recebidas = Math.max(meta.recebidas || 0, i + 1);
        await store.setJSON(id + '_meta', meta);
        return resp({ ok: true, parte: i, bytes: buf.length });
      }

      // Fecha o arquivo (marca completo).
      case 'finalizar': {
        const meta = await store.get(body.id + '_meta', { type: 'json' }).catch(() => null);
        if (!meta) return resp({ error: 'Arquivo não encontrado' }, 404);
        // Confere parte por parte: arquivo incompleto marcado como pronto vira
        // documento salvo sem conteúdo, e ninguém descobre até precisar dele.
        for (let i = 0; i < (meta.partes || 1); i++) {
          const existe = await store.getMetadata(body.id + '_p' + i).catch(() => null);
          if (!existe) return resp({ error: 'Faltou a parte ' + (i + 1) + ' de ' + meta.partes, faltou: i }, 409);
        }
        meta.completo = true;
        meta.finalizadoEm = agora();
        await store.setJSON(body.id + '_meta', meta);
        return resp({ ok: true, meta });
      }

      case 'meta': {
        const meta = await store.get(body.id + '_meta', { type: 'json' }).catch(() => null);
        if (!meta) return resp({ error: 'Arquivo não encontrado' }, 404);
        return resp({ ok: true, meta });
      }

      // Devolve um pedaço em base64 — o navegador junta tudo e salva.
      case 'baixarParte': {
        const { id, i } = body;
        const buf = await store.get(id + '_p' + i, { type: 'arrayBuffer' }).catch(() => null);
        if (!buf) return resp({ error: 'Parte não encontrada' }, 404);
        return resp({ ok: true, i, dados: Buffer.from(buf).toString('base64') });
      }

      case 'apagar': {
        const meta = await store.get(body.id + '_meta', { type: 'json' }).catch(() => null);
        const partes = meta ? (meta.partes || 1) : 1;
        for (let i = 0; i < partes; i++) await store.delete(body.id + '_p' + i).catch(() => {});
        await store.delete(body.id + '_meta').catch(() => {});
        return resp({ ok: true });
      }

      // Quanto está ocupado no armazenamento (aparece em Configurações).
      case 'uso': {
        let bytes = 0, arquivos = 0;
        const r = await store.list().catch(() => null);
        for (const b of (r && r.blobs ? r.blobs : [])) {
          if (b.key.endsWith('_meta')) arquivos++;
          bytes += b.size || 0;
        }
        return resp({ ok: true, arquivos, bytes });
      }

      default:
        return resp({ error: 'Ação desconhecida' }, 400);
    }
  } catch (e) {
    console.error('[arquivos] erro:', e);
    return resp({ error: (e && e.message) || String(e) }, 500);
  }
};
