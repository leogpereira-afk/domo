#!/usr/bin/env node
// ============================================================================
// Migra os dados da Domo do Netlify para o Supabase.
//
// A FONTE é o backup JSON exportado pelo próprio app (regra de ouro 1) — não o
// site ao vivo. O Blobs tem leitura eventual e listagem lenta (~1min); o backup
// é o retrato consistente, e é ele que serve de gabarito para conferir a
// contagem no fim.
//
// Uso:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service_role> \
//   node scripts/migrar-para-supabase.mjs backup-migracao/backup-domo-AAAA-MM-DD.json
//
// Só usa a service_role key para escrever direto nas tabelas (ela ignora RLS).
// NUNCA comitar essa chave: ela entra por variável de ambiente e sai da memória
// quando o processo acaba.
// ============================================================================

import { readFileSync } from 'node:fs';

const URL_SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const arquivo = process.argv[2];

if (!URL_SB || !KEY) {
  console.error('Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  process.exit(1);
}
if (!arquivo) {
  console.error('Uso: node scripts/migrar-para-supabase.mjs <backup.json>');
  process.exit(1);
}

const COLECOES = ['sc', 'cot', 'crono', 'oc', 'os', 'forn', 'prest', 'doc', 'proj'];

async function rest(caminho, opts = {}) {
  const r = await fetch(URL_SB + '/rest/v1/' + caminho, {
    ...opts,
    headers: {
      apikey: KEY,
      authorization: 'Bearer ' + KEY,
      'content-type': 'application/json',
      prefer: opts.prefer || 'return=minimal',
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error(caminho + ' → ' + r.status + ' ' + (await r.text()).slice(0, 300));
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

const backup = JSON.parse(readFileSync(arquivo, 'utf8'));
const registros = backup.registros || [];

console.log('Backup:', arquivo);
console.log('Gerado em:', backup.em);

// ── 1. Contagem de origem (o gabarito) ──────────────────────────────────────
const porColecao = {};
for (const r of registros) porColecao[r._col] = (porColecao[r._col] || 0) + 1;
console.log('\nORIGEM (backup):');
for (const c of COLECOES) console.log('  ' + c.padEnd(6), porColecao[c] || 0);
console.log('  total ', registros.length);

// ── 2. Registros ────────────────────────────────────────────────────────────
console.log('\nSubindo registros...');
const linhas = registros
  .filter((r) => COLECOES.includes(r._col) && r.id)
  .map((r) => {
    const copia = { ...r };
    delete copia._col;
    return {
      colecao: r._col,
      id: r.id,
      registro: copia,
      atualizado_em: r.atualizadoEm || r.criadoEm || new Date().toISOString(),
      apagado: !!r.apagadoEm,
    };
  });

// Em lotes de 100: um INSERT gigante estoura o limite de corpo do PostgREST.
for (let i = 0; i < linhas.length; i += 100) {
  const lote = linhas.slice(i, i + 100);
  await rest('domo_registros?on_conflict=colecao,id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: JSON.stringify(lote),
  });
  process.stdout.write('  ' + Math.min(i + 100, linhas.length) + '/' + linhas.length + '\r');
}
console.log('  ' + linhas.length + '/' + linhas.length + ' registros enviados');

// ── 3. Configuração ─────────────────────────────────────────────────────────
// ATENÇÃO: o backup sai SEM os hashes de senha (o servidor os remove de toda
// resposta, por segurança). Então:
//   • a senha da equipe volta pela variável PAINEL_SENHA do Supabase;
//   • cada acesso individual precisa de senha nova, dada pela direção na tela
//     "Acessos da equipe" → Nova senha. O cadastro (nome, cargo, perfil) migra.
console.log('\nSubindo configuração...');
const cfg = { ...(backup.cfg || {}) };
const usuarios = (cfg.usuarios || []).map((u) => {
  const x = { ...u };
  delete x.hash;                 // não existe no backup; explicitando a ausência
  x.precisaSenhaNova = true;     // a tela avisa a direção
  return x;
});
cfg.usuarios = usuarios;
await rest('domo_cfg?on_conflict=id', {
  method: 'POST',
  prefer: 'resolution=merge-duplicates,return=minimal',
  body: JSON.stringify([{ id: true, config: cfg, atualizado_em: new Date().toISOString() }]),
});
console.log('  configuração migrada · ' + usuarios.length + ' acesso(s) sem senha (precisam ser redefinidas)');

// ── 4. Numeração ────────────────────────────────────────────────────────────
// Sem isto o próximo documento sairia com um número que já foi para fornecedor.
console.log('\nSubindo numeração...');
const seq = backup.seq || {};
const linhasSeq = Object.entries(seq)
  .filter(([k, v]) => k.startsWith('ultimo_') && v && typeof v.n === 'number')
  .map(([k, v]) => ({ colecao: k.replace('ultimo_', ''), n: v.n }));
if (linhasSeq.length) {
  await rest('domo_seq?on_conflict=colecao', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: JSON.stringify(linhasSeq),
  });
}
for (const l of linhasSeq) console.log('  ' + l.colecao.padEnd(6), 'próximo será', l.n + 1);

// Índice número → id, para o link público achar o documento pelo código.
// SÓ as coleções que têm numeração de documento (SC-0001, OC-0002...).
// Um documento da empresa também tem um campo "numero" — mas é o número da
// CND ("2026/0431"), não da sequência: entrava aqui e quebrava a tabela.
const NUMERADAS = ['sc', 'cot', 'crono', 'oc', 'os'];
const idx = registros
  .filter((r) => NUMERADAS.includes(r._col) && Number.isInteger(Number(r.numero)))
  .map((r) => ({ colecao: r._col, numero: Number(r.numero), reg_id: r.id }));
if (idx.length) {
  await rest('domo_seq_idx?on_conflict=colecao,numero', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: JSON.stringify(idx),
  });
}

// ── 5. PORTÃO: contagem de destino tem que bater com a de origem ────────────
console.log('\nCONFERINDO no Supabase...');
let erro = false;
for (const c of COLECOES) {
  const r = await fetch(URL_SB + '/rest/v1/domo_registros?select=id&colecao=eq.' + c, {
    headers: { apikey: KEY, authorization: 'Bearer ' + KEY, prefer: 'count=exact', range: '0-0' },
  });
  const total = Number((r.headers.get('content-range') || '').split('/')[1] || 0);
  const esperado = porColecao[c] || 0;
  const bate = total === esperado;
  if (!bate) erro = true;
  console.log('  ' + c.padEnd(6), String(total).padStart(4), '/', String(esperado).padStart(4), bate ? '✅' : '❌ NÃO BATE');
}

console.log('\n' + (erro
  ? '❌ Alguma coleção não bateu. NÃO siga para a virada — investigue antes.'
  : '✅ Todas as coleções bateram. Backup e Supabase têm a mesma contagem.'));
process.exit(erro ? 1 : 0);
