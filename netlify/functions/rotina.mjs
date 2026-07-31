// Netlify Function agendada (@daily, ver netlify.toml) — endpoint /.netlify/functions/rotina
// Faz uma cópia de segurança diária de TODOS os registros num blob do dia
// (store "backup", chave AAAA-MM-DD), guarda 60 dias e limpa o log velho.
// Backup automático sem depender de ninguém apertar botão.

import { getStore } from '@netlify/blobs';
import { NOMES_COLECOES as COLS } from './lib/colecoes.mjs';

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

const DIAS_BACKUP = 60;
const DIAS_LOG = 120;
const DIAS_LIXEIRA = 90;

async function lerTudo() {
  const store = blobStore('domo');
  const r = await store.list().catch(() => null);
  const chaves = (r && r.blobs ? r.blobs : []).map((b) => b.key).filter((k) => COLS.includes(k.split('_')[0]));
  const saida = [];
  for (let i = 0; i < chaves.length; i += 24) {
    const parte = await Promise.all(chaves.slice(i, i + 24).map(async (k) => {
      const o = await store.get(k, { type: 'json' }).catch(() => null);
      if (o) o._col = k.split('_')[0];
      return o;
    }));
    for (const o of parte) if (o) saida.push(o);
  }
  return saida;
}

export const config = { schedule: '@daily' };

export default async () => {

  const hoje = new Date().toISOString().slice(0, 10);
  const resultado = { dia: hoje };

  // 1. Cópia do dia
  try {
    const registros = await lerTudo();
    const cfg = await blobStore('cfg').get('cfg', { type: 'json' }).catch(() => null);
    const copia = Object.assign({}, cfg || {});
    delete copia.senhaHash;

    // Numeração (ultimo_sc/oc/os) e inventário dos arquivos entram na cópia:
    // sem a numeração a restauração repetiria número de documento; sem o
    // inventário ninguém sabe quais plantas existiam.
    const seq = {};
    try {
      const s = blobStore('seq');
      const r = await s.list();
      for (const b of (r && r.blobs ? r.blobs : [])) {
        if (b.key.startsWith('ultimo_')) seq[b.key] = await s.get(b.key, { type: 'json' }).catch(() => null);
      }
    } catch { /* segue sem */ }

    const arquivos = [];
    try {
      const a = blobStore('arq');
      const r = await a.list();
      for (const b of (r && r.blobs ? r.blobs : [])) {
        if (b.key.endsWith('_meta')) arquivos.push(await a.get(b.key, { type: 'json' }).catch(() => null));
      }
    } catch { /* segue sem */ }

    await blobStore('backup').setJSON(hoje, {
      em: new Date().toISOString(), cfg: copia, registros, seq, arquivos: arquivos.filter(Boolean)
    });
    resultado.registros = registros.length;
    resultado.arquivos = arquivos.length;
  } catch (e) {
    resultado.erroBackup = (e && e.message) || String(e);
  }

  // 2. Backups com mais de 60 dias
  try {
    const limite = new Date(Date.now() - DIAS_BACKUP * 86400000).toISOString().slice(0, 10);
    const r = await blobStore('backup').list();
    let apagados = 0;
    for (const b of (r && r.blobs ? r.blobs : [])) {
      if (b.key < limite) { await blobStore('backup').delete(b.key).catch(() => {}); apagados++; }
    }
    resultado.backupsApagados = apagados;
  } catch (e) { resultado.erroLimpezaBackup = (e && e.message) || String(e); }

  // 3. Log antigo
  try {
    const limite = 'log_' + new Date(Date.now() - DIAS_LOG * 86400000).toISOString();
    const r = await blobStore('log').list();
    let apagados = 0;
    for (const b of (r && r.blobs ? r.blobs : [])) {
      if (b.key < limite) { await blobStore('log').delete(b.key).catch(() => {}); apagados++; }
    }
    resultado.logApagado = apagados;
  } catch (e) { resultado.erroLimpezaLog = (e && e.message) || String(e); }

  // 4. Lixeira: some de vez com o que foi apagado há mais de 90 dias
  try {
    const limite = new Date(Date.now() - DIAS_LIXEIRA * 86400000).toISOString();
    const store = blobStore('domo');
    const r = await store.list();
    let apagados = 0;
    for (const b of (r && r.blobs ? r.blobs : [])) {
      if (!COLS.includes(b.key.split('_')[0])) continue;
      const o = await store.get(b.key, { type: 'json' }).catch(() => null);
      if (o && o.apagadoEm && o.apagadoEm < limite) { await store.delete(b.key).catch(() => {}); apagados++; }
    }
    resultado.lixeiraApagada = apagados;
  } catch (e) { resultado.erroLixeira = (e && e.message) || String(e); }

  // 5. Arquivos órfãos: partes no store 'arq' que nenhum registro usa mais
  // (upload interrompido, registro apagado de vez). Sem isso uma planta de
  // 60MB fica ocupando espaço para sempre.
  try {
    const registros = await lerTudo();
    const usados = new Set();
    for (const o of registros) {
      if (o.arquivoId) usados.add(o.arquivoId);
      for (const v of (o.versoes || [])) if (v && v.arquivoId) usados.add(v.arquivoId);
      for (const r of (o.recebimentos || [])) for (const f of (r.fotos || [])) if (f) usados.add(f);
      for (const d of (o.diario || [])) for (const f of (d.fotos || [])) if (f) usados.add(f);
      for (const d of (o.documentos || [])) if (d && d.arquivoId) usados.add(d.arquivoId);
    }
    const arq = blobStore('arq');
    const lista = await arq.list();
    const ONTEM = new Date(Date.now() - 86400000).toISOString();
    let orfaos = 0;
    for (const b of (lista && lista.blobs ? lista.blobs : [])) {
      if (!b.key.endsWith('_meta')) continue;
      const id = b.key.slice(0, -5);
      if (usados.has(id)) continue;
      const meta = await arq.get(b.key, { type: 'json' }).catch(() => null);
      // Carência de 1 dia: arquivo recém-enviado pode estar esperando o
      // registro que ainda está na fila de um celular sem sinal.
      if (meta && meta.criadoEm && meta.criadoEm > ONTEM) continue;
      for (let i = 0; i < ((meta && meta.partes) || 1); i++) await arq.delete(id + '_p' + i).catch(() => {});
      await arq.delete(b.key).catch(() => {});
      orfaos++;
    }
    resultado.arquivosOrfaos = orfaos;
  } catch (e) { resultado.erroOrfaos = (e && e.message) || String(e); }

  // 6. Marca o batimento pra aparecer em Configurações
  try {
    await blobStore('cfg').setJSON('manutencao_status', Object.assign({ em: new Date().toISOString() }, resultado));
  } catch { /* não é crítico */ }

  console.log('[manutencao]', JSON.stringify(resultado));
  return new Response(JSON.stringify(resultado), { headers: { 'Content-Type': 'application/json' } });
};
