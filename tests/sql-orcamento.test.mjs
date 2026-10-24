import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
let db;
const root=new URL('../',import.meta.url);
before(async()=>{
  db=new PGlite();await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean);');
  for(const name of ['0001_init.sql','0004_gravacao_atomica.sql','0005_orcamento_rateios.sql'])await db.exec(await readFile(new URL('supabase/migrations/'+name,root),'utf8'));
});
after(async()=>{await db?.close();});
async function put(col,r){await db.query('insert into domo_registros(colecao,id,registro) values($1,$2,$3) on conflict(colecao,id) do update set registro=excluded.registro',[col,r.id,JSON.stringify(r)]);return r;}
async function get(col,id){return (await db.query('select registro from domo_registros where colecao=$1 and id=$2',[col,id])).rows[0]?.registro;}
const budget=(id,source,amount=1000)=>({id,obraId:'synthetic-work',vinculos:[{id:'synthetic-link',item:'1.1',col:'oc',registroId:source.id,etapa:'contratado',valorCentavos:amount}]});
async function save(r,source,expected=null,extra={}){
  const refs=extra.fontes||[{col:'oc',id:source.id,registro:source}],limits=extra.limites||[{col:'oc',id:source.id,etapa:'contratado',limiteCentavos:1000}];
  return (await db.query('select domo_gravar_orcamento($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb) as ok',[
    r.id,expected?JSON.stringify(expected):null,JSON.stringify(r),JSON.stringify(refs),JSON.stringify(limits),JSON.stringify(extra.arquivos||[])
  ])).rows[0].ok;
}
test('SQL budget: competing budgets cannot allocate the same source twice',async()=>{
  const source=await put('oc',{id:'sql-shared',totalCentavos:1000});
  const rs=await Promise.allSettled(['sql-budget-a','sql-budget-b'].map(id=>save(budget(id,source),source)));
  assert.equal(rs.filter(r=>r.status==='fulfilled'&&r.value).length,1);
  assert.equal(rs.filter(r=>r.status==='rejected'&&/excedem/.test(r.reason.message)).length,1);
  const rows=(await db.query('select * from domo_orcamento_rateios where origem_id=$1',[source.id])).rows;
  assert.equal(rows.length,1);assert.equal(Number(rows[0].valor_centavos),1000);
});
test('SQL budget: different stages overlap; a removed allocation releases its own stage only',async()=>{
  const source=await put('oc',{id:'sql-stages',totalCentavos:1000}),a=budget('sql-stage-a',source),b=budget('sql-stage-b',source);
  assert.equal(await save(a,source),true);b.vinculos[0].etapa='pago';
  assert.equal(await save(b,source,null,{limites:[{col:'oc',id:source.id,etapa:'pago',limiteCentavos:1000}]}),true);
  const removed={...a,vinculos:[{...a.vinculos[0],inativoEm:'2026-10-24'}]};assert.equal(await save(removed,source,a),true);
  assert.equal(await save(budget('sql-stage-c',source),source),true);
  assert.equal((await db.query('select count(*)::int as n from domo_orcamento_rateios where origem_id=$1',[source.id])).rows[0].n,2);
});
test('SQL budget: unchanged legacy excess allows independent editing; new allocation and stale source are refused',async()=>{
  const source=await put('oc',{id:'sql-reduced',totalCentavos:1000}),a=budget('sql-reduced-a',source);await save(a,source);
  const reduced=await put('oc',{...source,totalCentavos:500}),limits=[{col:'oc',id:source.id,etapa:'contratado',limiteCentavos:500}];
  const edit={...a,responsavel:'Synthetic'};assert.equal(await save(edit,reduced,a,{limites:limits}),true);
  await assert.rejects(()=>save(budget('sql-reduced-b',source,1),reduced,null,{limites:limits}),/excedem/);
  await assert.rejects(()=>save({...edit,responsavel:'Other'},source,edit),/Origem.*mudou/);
  assert.equal((await get('orc',a.id)).responsavel,'Synthetic');
});
test('SQL budget: rollback preserves previous allocations when an edited group exceeds combined ceiling',async()=>{
  const source=await put('oc',{id:'sql-rollback',totalCentavos:1000}),a=budget('sql-roll-a',source,600),b=budget('sql-roll-b',source,400);await save(a,source);await save(b,source);
  const edit=budget(b.id,source,401);await assert.rejects(()=>save(edit,source,b),/excedem/);
  assert.deepEqual(await get('orc',b.id),b);
  assert.equal(Number((await db.query('select sum(valor_centavos) as n from domo_orcamento_rateios where origem_id=$1',[source.id])).rows[0].n),1000);
});
test('SQL budget: archived budget releases allocation and reactivation is checked',async()=>{
  const source=await put('oc',{id:'sql-archive',totalCentavos:1000}),a=budget('sql-archive-a',source);await save(a,source);
  const inactive={...a,inativoEm:'2026-10-24'};assert.equal(await save(inactive,source,a),true);
  await save(budget('sql-archive-b',source),source);await assert.rejects(()=>save(a,source,inactive),/excedem/);
  assert.deepEqual(await get('orc',a.id),inactive);
});
test('SQL budget: source dependency snapshot prevents accepting an outdated permutation allowance',async()=>{
  const source=await put('oc',{id:'sql-perm-order',totalCentavos:1000}),perm=await put('permuta',{id:'sql-perm',ordens:[{col:'oc',id:source.id}]}),b=budget('sql-perm-budget',perm);b.vinculos[0].col='permuta';b.vinculos[0].etapa='permuta';
  await put('oc',{...source,totalCentavos:500});
  await assert.rejects(()=>save(b,perm,null,{fontes:[{col:'permuta',id:perm.id,registro:perm},{col:'oc',id:source.id,registro:source}],limites:[{col:'permuta',id:perm.id,etapa:'permuta',limiteCentavos:1000}]}),/Origem.*mudou/);
  assert.equal(await get('orc',b.id),undefined);
});
test('SQL budget: file readiness and reservation are verified atomically with budget save',async()=>{
  const source=await put('oc',{id:'sql-file-source',totalCentavos:1000}),b=budget('sql-file-budget',source);b.anexos=[{arquivoId:'sql-file'}];
  await assert.rejects(()=>save(b,source,null,{arquivos:['sql-file']}),/Arquivo inexistente/);
  assert.equal(await get('orc',b.id),undefined);
  await put('_arqmeta',{id:'sql-file',pronto:false});await assert.rejects(()=>save(b,source,null,{arquivos:['sql-file']}),/envio não concluído/);
  await put('_arqmeta',{id:'sql-file',pronto:true,excluindoEm:'2026-10-24'});await assert.rejects(()=>save(b,source,null,{arquivos:['sql-file']}),/envio não concluído/);
  await put('_arqmeta',{id:'sql-file',pronto:true,vinculoPendente:{colecao:'orc',registroId:'other'}});await assert.rejects(()=>save(b,source,null,{arquivos:['sql-file']}),/outro registro/);
  await put('_arqmeta',{id:'sql-file',pronto:true,vinculoPendente:{colecao:'orc',registroId:b.id}});
  assert.equal(await save(b,source,null,{arquivos:['sql-file']}),true);
  const meta=await get('_arqmeta','sql-file');assert.ok(meta.vinculadoEm);assert.equal(meta.vinculoPendente.registroId,b.id);
});
test('SQL budget: old RPC cannot bypass aggregate checks and stale expected document cannot overwrite',async()=>{
  const source=await put('oc',{id:'sql-bypass',totalCentavos:1000}),b=budget('sql-bypass-budget',source);
  await assert.rejects(()=>db.query("select domo_gravar_se_inalterado('orc',$1,null,$2::jsonb)",[b.id,JSON.stringify(b)]),/transacional/);
  assert.equal(await save(b,source),true);assert.equal(await save({...b,nome:'stale'},source,null),false);
  assert.deepEqual(await get('orc',b.id),b);
});
test('SQL budget: new RPC and ledger are inaccessible to anon and authenticated',async()=>{
  for(const role of ['anon','authenticated']){
    assert.equal((await db.query("select has_function_privilege($1,'public.domo_gravar_orcamento(text,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE') as ok",[role])).rows[0].ok,false);
    assert.equal((await db.query("select has_table_privilege($1,'public.domo_orcamento_rateios','INSERT') as ok",[role])).rows[0].ok,false);
  }
});

test('SQL budget: generic soft deletion removes consumption without allowing active bypass',async()=>{
  const source=await put('oc',{id:'sql-trash',totalCentavos:1000}),b=budget('sql-trash-budget',source);await save(b,source);
  const deleted={...b,apagadoEm:'2026-10-24'};
  const response=await db.query("select domo_gravar_se_inalterado('orc',$1,$2::jsonb,$3::jsonb) as ok",[b.id,JSON.stringify(b),JSON.stringify(deleted)]);
  assert.equal(response.rows[0].ok,true);assert.equal((await db.query('select count(*)::int as n from domo_orcamento_rateios where orcamento_id=$1',[b.id])).rows[0].n,0);
  assert.equal(await save(budget('sql-trash-reuse',source),source),true);
});

test('SQL budget: restoring before cleanup invalidates its stale claim and conditional deletion',async()=>{
  const source=await put('oc',{id:'sql-restore-first-source',totalCentavos:1000}),b=budget('sql-restore-first',source);await save(b,source);
  const deleted={...b,apagadoEm:'2026-10-24'};assert.equal(await save(deleted,source,b),true);assert.equal(await save(b,source,deleted),true);
  const claim=await db.query('select domo_reservar_exclusao_orcamento($1,$2::jsonb) as reservado',[b.id,JSON.stringify(deleted)]);
  assert.equal(claim.rows[0].reservado,null);
  assert.equal((await db.query('select domo_remover_orcamento($1,$2::jsonb) as removido',[b.id,JSON.stringify(deleted)])).rows[0].removido,false);
  assert.deepEqual(await get('orc',b.id),b);
});

test('SQL budget: cleanup claim blocks restoration and only the exact claimed version can be removed',async()=>{
  const source=await put('oc',{id:'sql-cleanup-first-source',totalCentavos:1000}),b=budget('sql-cleanup-first',source);await save(b,source);
  const deleted={...b,apagadoEm:'2026-10-24'};assert.equal(await save(deleted,source,b),true);
  const claim=(await db.query('select domo_reservar_exclusao_orcamento($1,$2::jsonb) as reservado',[b.id,JSON.stringify(deleted)])).rows[0].reservado;
  assert.ok(claim.excluindoEm);assert.ok(claim._revisao);await assert.rejects(()=>save(b,source,claim),/reservado.*limpeza/);
  assert.equal((await db.query('select domo_remover_orcamento($1,$2::jsonb) as removido',[b.id,JSON.stringify(deleted)])).rows[0].removido,false);
  assert.deepEqual(await get('orc',b.id),claim);
  assert.equal((await db.query('select domo_remover_orcamento($1,$2::jsonb) as removido',[b.id,JSON.stringify(claim)])).rows[0].removido,true);
  assert.equal(await get('orc',b.id),undefined);
  for(const role of ['anon','authenticated'])for(const fn of ['domo_reservar_exclusao_orcamento','domo_remover_orcamento']){
    assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') as ok',[role,'public.'+fn+'(text,jsonb)'])).rows[0].ok,false);
  }
});
