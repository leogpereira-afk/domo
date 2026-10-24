import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=process.env.DOMO_TEST_ROOT || fileURLToPath(new URL('../../',import.meta.url));
const copy=x=>x===undefined?undefined:structuredClone(x);
const hash=x=>createHash('sha256').update(x).digest('hex');
export async function env(target, options={}){
 const state=options.state || {rows:new Map(),parts:new Map(),logs:[],cfg:null,seq:{},backup:null};
 const {rows,parts,logs}=state;
 let counter=0, handler, barrier=null;
 const cfg=state.cfg || (state.cfg={senhaHash:hash('dir'),usuarios:[{id:'u-office',nome:'Office QA',perfil:'escritorio',hash:hash('office')},{id:'u-field',nome:'Field QA',perfil:'obra',hash:hash('field')}],obras:[],empresa:{nome:'Synthetic QA'}});
 const key=(c,id)=>c+':'+id;
 const seed=(col,reg)=>rows.set(key(col,reg.id),{colecao:col,id:reg.id,registro:copy(reg),apagado:!!reg.apagadoEm});
 const rateios=reg=>{
   const groups=new Map();if(!reg||reg.apagadoEm||reg.inativoEm)return groups;
   for(const v of reg.vinculos||[]){if(v.apagadoEm||v.inativoEm||!['contratado','recebido','executado','pago','permuta'].includes(v.etapa))continue;
     const k=[v.col,v.registroId,v.etapa].join('|'),g=groups.get(k)||{col:v.col,id:v.registroId,etapa:v.etapa,valor:0,itens:[]};
     g.valor+=v.valorCentavos;g.itens.push({id:v.id,item:v.item,valorCentavos:v.valorCentavos});groups.set(k,g);
   }
   for(const g of groups.values())g.itens.sort((a,b)=>a.id.localeCompare(b.id));return groups;
 };
 function query(table){let filters=[],range=null;const q={select:()=>q,eq:(k,v)=>(filters.push(r=>r[k]===v),q),neq:(k,v)=>(filters.push(r=>r[k]!==v),q),in:(k,v)=>(filters.push(r=>v.includes(r[k])),q),order:()=>q,range:(a,b)=>(range=[a,b],q),lt:()=>q,upsert:async()=>({data:null,error:null}),delete:()=>q,insert:async()=>({data:null,error:null}),maybeSingle:async()=>({data:null,error:null}),then:(ok,bad)=>{let data=table==='domo_registros'?[...rows.values()].filter(r=>filters.every(f=>f(r))):[];if(range)data=data.slice(range[0],range[1]+1);return Promise.resolve({data:copy(data),error:null}).then(ok,bad)}};return q;}
 const sandbox={console,structuredClone,crypto:webcrypto,Request,Response,Headers,URL,Uint8Array,TextEncoder,TextDecoder,atob,btoa,Date,Map,Set,JSON,Number,Object,Array,String,Math,isFinite,parseFloat,parseInt,decodeURIComponent,
 Deno:{env:{get:k=>k==='TOKEN'?'synthetic-token':k==='ROTINA_TOKEN'?'synthetic-routine':undefined},serve:f=>{handler=f;}},
 db:{from:query,rpc:async(name,args)=>{
   if(name==='domo_reservar_exclusao_orcamento'||name==='domo_remover_orcamento'){
     const hookName=name==='domo_reservar_exclusao_orcamento'?'beforeBudgetDeleteClaim':'beforeBudgetDeleteFinal';
     if(state[hookName]){const hook=state[hookName];state[hookName]=null;await hook(args);}
     const current=rows.get(key('orc',args.p_id))?.registro;
     const matches=current?.apagadoEm&&JSON.stringify(current)===JSON.stringify(args.p_esperado);
     if(name==='domo_remover_orcamento'){
       if(!matches||!current.excluindoEm)return{data:false,error:null};rows.delete(key('orc',args.p_id));return{data:true,error:null};
     }
     if(!matches)return{data:null,error:null};
     const reserved={...current,excluindoEm:current.excluindoEm||new Date().toISOString(),_revisao:webcrypto.randomUUID()};seed('orc',reserved);return{data:copy(reserved),error:null};
   }
   if(name==='domo_gravar_orcamento'){
     args={...args,p_colecao:'orc'};
     if(barrier&&barrier.col==='orc'){const b=barrier;await new Promise(resolve=>{b.waiters.push(resolve);if(b.waiters.length===b.n){barrier=null;b.waiters.forEach(r=>r());}});}
     if(state.beforeBudgetCommit){const hook=state.beforeBudgetCommit;state.beforeBudgetCommit=null;await hook(args);}
     const current=rows.get(key('orc',args.p_id))?.registro??null;
     if(JSON.stringify(current)!==JSON.stringify(args.p_esperado))return {data:false,error:null};
     const refuse=message=>({data:null,error:{message}});
     if(current?.excluindoEm)return refuse('Orçamento reservado para limpeza definitiva.');
     for(const f of args.p_fontes||[])if(JSON.stringify(rows.get(key(f.col,f.id))?.registro??null)!==JSON.stringify(f.registro))return refuse('Origem do rateio mudou durante a gravação.');
     const before=rateios(current),after=rateios(args.p_registro);
     for(const [k,g] of after){if(JSON.stringify(before.get(k)?.itens)===JSON.stringify(g.itens))continue;
       const limit=(args.p_limites||[]).find(l=>[l.col,l.id,l.etapa].join('|')===k)?.limiteCentavos;
       if(!Number.isSafeInteger(limit)||limit<0)return refuse('Rateio sem limite ou evidência válida na origem.');
       let used=0;for(const row of rows.values())if(row.colecao==='orc'&&row.id!==args.p_id)used+=rateios(row.registro).get(k)?.valor||0;
       if(used+g.valor>limit)return refuse('Rateios entre orçamentos excedem o valor da origem.');
     }
     for(const id of args.p_arquivos||[]){const m=rows.get(key('_arqmeta',id))?.registro;if(!m||m.apagadoEm||m.excluindoEm||m.pronto!==true)return refuse('Arquivo inexistente ou envio não concluído.');
       if(m.vinculoPendente&&(m.vinculoPendente.colecao!=='orc'||m.vinculoPendente.registroId!==args.p_id))return refuse('Arquivo reservado para outro registro.');
     }
     seed('orc',args.p_registro);
     for(const id of args.p_arquivos||[]){const m=rows.get(key('_arqmeta',id))?.registro;seed('_arqmeta',{...m,vinculadoEm:m.vinculadoEm||new Date().toISOString(),_revisao:webcrypto.randomUUID(),vinculoPendente:m.vinculoPendente||{colecao:'orc',registroId:args.p_id}});}
     return {data:true,error:null};
   }
   if(name!=='domo_gravar_se_inalterado')throw Error('RPC desconhecida: '+name);
   if(barrier&&args.p_colecao===barrier.col){const b=barrier;await new Promise(resolve=>{b.waiters.push(resolve);if(b.waiters.length===b.n){barrier=null;b.waiters.forEach(r=>r());}});}
   const current=rows.get(key(args.p_colecao,args.p_id))?.registro??null;
   if(JSON.stringify(current)!==JSON.stringify(args.p_esperado))return {data:false,error:null};
   seed(args.p_colecao,args.p_registro);return {data:true,error:null};
 }},agora:()=>new Date().toISOString(),idNovo:()=>`id-${++counter}`,tokenCurto:()=>`tok-${++counter}`,
 lerUm:async(c,id)=>copy(rows.get(key(c,id))?.registro??null),gravarUm:async(c,id,reg)=>{if(barrier&&c===barrier.col){const b=barrier;await new Promise(resolve=>{b.waiters.push(resolve);if(b.waiters.length===b.n){barrier=null;b.waiters.forEach(r=>r());}});}seed(c,reg);},
 lerTudo:async(cols,all)=>copy([...rows.values()].filter(r=>(cols?.length?cols:all).includes(r.colecao)).map(r=>({...r.registro,_col:r.colecao}))),
 apagarDeVez:async(c,id)=>rows.delete(key(c,id)),lerCfgBruta:async()=>copy(cfg),gravarCfg:async next=>{Object.keys(cfg).forEach(k=>delete cfg[k]);Object.assign(cfg,copy(next));},proximoNumero:async()=>++counter,guardarIndiceNumero:async()=>{},lerNumeracao:async()=>copy(state.seq),definirNumeracao:async(c,n)=>{state.seq["ultimo_"+c]={n};},registrarLog:async e=>logs.push(e),lerLog:async()=>[],gravarBackup:async(d,c)=>{if(state.backupError)throw Error("synthetic backup failure");state.backup=copy(c);},marcarMudanca:async()=>{},
 subirParte:async(k,b)=>parts.set(k,copy(b)),baixarParte:async k=>copy(parts.get(k)??null),apagarArquivo:async ks=>ks.forEach(k=>parts.delete(k)),lerColecaoBruta:async c=>copy([...rows.values()].filter(r=>r.colecao===c)),lerApagados:async()=>copy([...rows.values()].filter(r=>r.apagado)),
 fetch:async()=>{throw Error('NO NETWORK ALLOWED');}};
 const ctx=vm.createContext(sandbox);
 vm.runInContext(fs.readFileSync((options.root||root)+"orcamento-model.js","utf8"),ctx);
 // Business retry helper is the production source; only database IO is replaced.
 const ds=fs.readFileSync((options.root||root)+'supabase/functions/_shared/dados.ts','utf8');
 const helpers=ds.slice(ds.indexOf('export async function gravarSeInalterado'),ds.indexOf('// Todos os registros (')).replace(/^export\s+/gm,'');
 if(helpers)vm.runInContext(stripTypeScriptTypes(helpers),ctx,{filename:'dados-CAS.ts'});
 for(const f of ['_shared/cors.ts','_shared/acesso.ts','_shared/colecoes.ts','_shared/arquivos.ts','_shared/validacao.ts','_shared/orcamento.ts',target+'/index.ts']){
 if(!fs.existsSync((options.root||root)+'supabase/functions/'+f)&&f==='_shared/validacao.ts')continue;
 let src=fs.readFileSync((options.root || root)+'supabase/functions/'+f,'utf8').replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*/gm,'').replace(/^import\s+['"][^'"]+['"];\s*/gm,'').replace(/^export\s+/gm,'');
 if(target==='domo-nucleo'&&f==='_shared/colecoes.ts')src=src.replace(/^const NOMES_COLECOES.*$/m,'');
 vm.runInContext(stripTypeScriptTypes(src),ctx,{filename:f});
 }
 return {state,handler,rows,parts,logs,cfg,seed,get:(c,id)=>copy(rows.get(key(c,id))?.registro),concurrent:(col,n)=>{barrier={col,n,waiters:[]};},call:async(action,body={},role='dir')=>{const r=await handler(new Request('http://local.invalid/function',{method:'POST',headers:{'content-type':'application/json','x-token':'synthetic-token','x-senha':role,'x-rotina-token':'synthetic-routine'},body:JSON.stringify({action,...body})}));return {status:r.status,body:await r.json()};}};
}
