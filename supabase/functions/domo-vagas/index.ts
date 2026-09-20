import { json, preflight } from '../_shared/cors.ts';
import { identificar } from '../_shared/acesso.ts';
import { db, lerCfgBruta } from '../_shared/dados.ts';
import './vagas-domain.js';
const V = (globalThis as any).DomoVagas;

Deno.serve(async(req:Request)=>{
  const pre=preflight(req);if(pre)return pre;
  if(req.method!=='POST')return json({error:'Método inválido'},405);
  if(!Deno.env.get('TOKEN')||req.headers.get('x-token')!==Deno.env.get('TOKEN'))return json({error:'Não autorizado'},401);
  try {
    const quem=await identificar(await lerCfgBruta(),req.headers.get('x-senha')||'');
    if(!quem)return json({error:'Entre novamente na Domo.',semSenha:true},403);
    if(!['direcao','escritorio'].includes(quem.perfil))return json({error:'Seu acesso não permite consultar vagas.'},403);
    const text=await req.text();if(text.length>1000000)return json({error:'Arquivo muito grande.'},413);
    const b=JSON.parse(text),acao=b.action;
    const {data:row,error}=await db.from('domo_vagas_estado').select('estado,revisao,atualizado_em').eq('obra','diamond').maybeSingle();
    if(error)throw Error('Não foi possível consultar o espelho.');
    if(!row)return json({error:'O espelho ainda não foi importado.'},404);
    if(acao==='carregar')return json({ok:true,...row});
    if(!['salvar','preverImportacao','importar'].includes(acao))return json({error:'Ação inválida'},400);
    const estado=structuredClone(row.estado);
    const por=quem.proprio?quem.nome:decodeURIComponent(req.headers.get('x-quem')||'Direção').slice(0,80);
    let novo=estado,detalhe:any;
    if(acao==='salvar'){
      const ajuste=V.validarAjuste(b.codigo,b.ajuste||{},estado);
      detalhe={vaga:b.codigo,antes:V.efetivas(estado).find((v:any)=>v.codigo===b.codigo),depois:ajuste,motivo:ajuste.motivo};
      novo.ajustes={...(estado.ajustes||{}),[b.codigo]:ajuste};
    }else{
      if(quem.perfil!=='direcao')return json({error:'Somente a direção pode importar uma planilha.'},403);
      const imp=V.importar({...b.fonte,lidoEm:new Date().toISOString()});
      novo={...imp,ajustes:estado.ajustes||{},historico:estado.historico||[],fonte:{...imp.fonte,tipo:'Planilha importada'}};
      const mudaram=imp.vagas.filter((v:any)=>v.assinatura!==estado.vagas.find((x:any)=>x.codigo===v.codigo)?.assinatura).map((v:any)=>v.codigo);
      if(acao==='preverImportacao')return json({ok:true,mudaram,alertas:V.efetivas(novo).filter((v:any)=>v.alertas.length).length,revisao:row.revisao});
      detalhe={motivo:'Importação de planilha conferida',vagasAlteradas:mudaram,fonteAnterior:estado.fonte,fonteNova:novo.fonte};
    }
    if(!Number.isSafeInteger(b.revisao)||b.revisao!==row.revisao)return json({error:'Outra pessoa atualizou o espelho. Atualize e confira antes de salvar.',conflito:true},409);
    novo.historico=[...(estado.historico||[]),{id:crypto.randomUUID(),em:new Date().toISOString(),por,acao,...detalhe}];
    const {data:revisao,error:e}=await db.rpc('domo_vagas_salvar',{p_revisao:b.revisao,p_estado:novo});
    if(e){if(e.message.includes('VAGAS_CONFLITO'))return json({error:'O espelho mudou durante a gravação. Atualize e confira novamente.',conflito:true},409);throw Error('Não foi possível salvar. Tente novamente.');}
    return json({ok:true,revisao,estado:novo,atualizado_em:new Date().toISOString()});
  }catch(e){return json({error:e instanceof Error?e.message:'Não foi possível concluir.'},400);}
});
