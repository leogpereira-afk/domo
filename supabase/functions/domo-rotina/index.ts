// ============================================================================
// Supabase Edge Function "rotina" — o que o cron do Netlify fazia todo dia.
//
// Chamada pelo pg_cron (@daily, 06:00 UTC ≈ 03:00 em Montes Claros), com um
// segredo próprio no header. Faz, em ordem:
//   1. cópia de segurança do dia (tabela backup, 60 dias de histórico)
//   2. apaga backups com mais de 60 dias
//   3. apaga log com mais de 120 dias
//   4. esvazia a lixeira do que foi apagado há mais de 90 dias
//   5. remove arquivo órfão (upload interrompido, registro apagado de vez)
//
// Backup automático sem depender de ninguém apertar botão.
// ============================================================================
import { json } from "../_shared/cors.ts";
import { NOMES_COLECOES } from "../_shared/colecoes.ts";
import { cfgSemSegredo } from "../_shared/acesso.ts";
import {
  db,
  agora,
  lerUm,
  lerTudo,
  lerCfgBruta,
  lerNumeracao,
  gravarBackup,
  apagarArquivo,
  apagarDeVez,
  registrarLog,
  lerColecaoBruta,
  lerApagados,
} from "../_shared/dados.ts";

const DIAS_BACKUP = 60;
const DIAS_LOG = 120;
const DIAS_LIXEIRA = 90;
const META = "_arqmeta";

const diasAtras = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

function arquivosDoRegistro(o: any): string[] {
  const ids: string[] = [];
  if (o.arquivoId) ids.push(o.arquivoId);
  for (const v of (o.versoes || [])) if (v && v.arquivoId) ids.push(v.arquivoId);
  for (const r of (o.recebimentos || [])) for (const f of (r.fotos || [])) if (f) ids.push(f);
  for (const d of (o.diario || [])) for (const f of (d.fotos || [])) if (f) ids.push(f);
  for (const d of (o.documentos || [])) if (d && d.arquivoId) ids.push(d.arquivoId);
  return ids;
}

Deno.serve(async (req) => {
  // Roda sozinha, sem ninguém logado: a entrada é um segredo de serviço,
  // conferido aqui dentro (verify_jwt = false, igual às outras).
  const segredo = Deno.env.get("ROTINA_TOKEN");
  const veio = req.headers.get("x-rotina-token") || new URL(req.url).searchParams.get("t");
  if (!segredo || veio !== segredo) return json({ error: "Não autorizado" }, 401);

  const hoje = agora().slice(0, 10);
  const resultado: Record<string, unknown> = { dia: hoje };

  // 1. Cópia do dia
  try {
    const registros = await lerTudo(null, NOMES_COLECOES);
    const cfg = await lerCfgBruta();
    // Nenhum hash de senha entra na cópia.
    const copia = cfgSemSegredo(cfg);
    // Sem a numeração, uma restauração recomeçaria em SC-0001 e repetiria
    // número de documento que já foi para fornecedor.
    const seq = await lerNumeracao();
    // Inventário dos arquivos: sem ele ninguém sabe quais plantas existiam.
    // Paginado: uma varredura sem .range() para em 1000 e o backup ficaria
    // incompleto sem avisar.
    const metas = await lerColecaoBruta(META, "registro");
    const arquivos = metas.map((l: any) => l.registro);

    await gravarBackup(hoje, { em: agora(), cfg: copia, registros, seq, arquivos });
    resultado.registros = registros.length;
    resultado.arquivos = arquivos.length;
  } catch (e) {
    resultado.erroBackup = (e as Error)?.message || String(e);
  }

  // 2. Backups com mais de 60 dias
  try {
    const limite = diasAtras(DIAS_BACKUP).slice(0, 10);
    const { data } = await db.from("domo_backup").delete().lt("dia", limite).select("dia");
    resultado.backupsApagados = (data || []).length;
  } catch (e) { resultado.erroLimpezaBackup = (e as Error)?.message || String(e); }

  // 3. Log antigo
  try {
    const { data } = await db.from("domo_log").delete().lt("em", diasAtras(DIAS_LOG)).select("id");
    resultado.logApagado = (data || []).length;
  } catch (e) { resultado.erroLimpezaLog = (e as Error)?.message || String(e); }

  // 4. Lixeira: some de vez com o que foi apagado há mais de 90 dias, junto
  //    com os arquivos que só aquele registro usava.
  try {
    const limite = diasAtras(DIAS_LIXEIRA);
    // Coleta TUDO antes de apagar: paginar por offset enquanto se apaga da
    // mesma tabela pularia linhas (o conjunto encolhe sob o cursor).
    const data = await lerApagados();
    let apagados = 0;
    for (const linha of data) {
      const o = linha.registro as any;
      if (!o.apagadoEm || o.apagadoEm >= limite) continue;
      for (const idArq of arquivosDoRegistro(o)) {
        const meta = await lerUm(META, idArq);
        const chaves: string[] = [];
        for (let i = 0; i < ((meta && meta.partes) || 1); i++) chaves.push(idArq + "/p" + i);
        await apagarArquivo(chaves);
        await apagarDeVez(META, idArq);
      }
      await apagarDeVez(linha.colecao, linha.id);
      apagados++;
    }
    resultado.lixeiraApagada = apagados;
  } catch (e) { resultado.erroLixeira = (e as Error)?.message || String(e); }

  // 5. Arquivos órfãos: metadados que nenhum registro usa mais (upload
  //    interrompido, registro apagado de vez). Sem isso uma planta de 60MB fica
  //    ocupando espaço para sempre.
  try {
    const registros = await lerTudo(null, NOMES_COLECOES);
    const usados = new Set<string>();
    for (const o of registros) for (const id of arquivosDoRegistro(o)) usados.add(id);

    const metas = await lerColecaoBruta(META, "id, registro");
    // Carência de 1 dia: arquivo recém-enviado pode estar esperando o registro
    // que ainda está na fila de um celular sem sinal.
    const ontem = diasAtras(1);
    let orfaos = 0;
    for (const l of metas) {
      const m = l.registro as any;
      if (usados.has(l.id)) continue;
      if (m && m.criadoEm && m.criadoEm > ontem) continue;
      const chaves: string[] = [];
      for (let i = 0; i < ((m && m.partes) || 1); i++) chaves.push(l.id + "/p" + i);
      await apagarArquivo(chaves);
      await apagarDeVez(META, l.id);
      orfaos++;
    }
    resultado.arquivosOrfaos = orfaos;
  } catch (e) { resultado.erroOrfaos = (e as Error)?.message || String(e); }

  // 6. Marca o batimento pra aparecer em Configurações
  try {
    await db.from("domo_meta").upsert({
      chave: "manutencao_status", valor: { em: agora(), ...resultado }, atualizado_em: agora(),
    });
  } catch { /* não é crítico */ }

  await registrarLog({ acao: "rotina diária", por: "sistema", ...resultado });
  console.log("[rotina]", JSON.stringify(resultado));
  return json(resultado);
});
