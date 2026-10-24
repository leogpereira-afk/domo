import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let db;
const root = new URL('../', import.meta.url);
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean);`);
  await db.exec(await readFile(new URL('supabase/migrations/0001_init.sql', root), 'utf8'));
  if (!process.env.DOMO_SQL_BASELINE) {
    await db.exec(await readFile(new URL('supabase/migrations/0004_gravacao_atomica.sql', root), 'utf8'));
  }
});
after(async () => { await db?.close(); });

async function cas(col, id, expected, record) {
  const r = await db.query('select public.domo_gravar_se_inalterado($1,$2,$3::jsonb,$4::jsonb) as saved',
    [col,id,expected === null ? null : JSON.stringify(expected),JSON.stringify(record)]);
  return r.rows[0].saved;
}
async function stored(col,id) {
  return (await db.query('select registro from domo_registros where colecao=$1 and id=$2',[col,id])).rows[0]?.registro;
}

test('SQL: criação repetida não substitui registro existente', async () => {
  assert.equal(await cas('oc','qa-sql-a',null,{id:'qa-sql-a',nf:'A'}),true);
  assert.equal(await cas('oc','qa-sql-a',null,{id:'qa-sql-a',nf:'B'}),false);
  assert.equal((await stored('oc','qa-sql-a')).nf,'A');
});
test('SQL: escrita com base antiga falha e releitura permite preservar ambas alterações', async () => {
  const initial={id:'qa-sql-b',recebimentos:[]};
  await cas('oc',initial.id,null,initial);
  const first={...initial,recebimentos:[{id:'r1',qtd:5}]};
  assert.equal(await cas('oc',initial.id,initial,first),true);
  assert.equal(await cas('oc',initial.id,initial,{...initial,recebimentos:[{id:'r2',qtd:5}]}),false);
  const fresh=await stored('oc',initial.id);
  assert.equal(await cas('oc',initial.id,fresh,{...fresh,recebimentos:[...fresh.recebimentos,{id:'r2',qtd:5}]}),true);
  assert.deepEqual((await stored('oc',initial.id)).recebimentos,[{id:'r1',qtd:5},{id:'r2',qtd:5}]);
});
test('SQL: comparação JSONB não depende da ordem das propriedades', async () => {
  const a={id:'qa-sql-c',nf:'A'};
  await cas('oc',a.id,null,a);
  assert.equal(await cas('oc',a.id,{nf:'A',id:a.id},{...a,nf:'B'}),true);
});
test('SQL: uma cotação não pode criar duas ordens vivas', async () => {
  const a={id:'qa-cot-a',cotacaoId:'qa-cot'};
  await cas('oc',a.id,null,a);
  await assert.rejects(()=>cas('oc','qa-cot-b',null,{id:'qa-cot-b',cotacaoId:'qa-cot'}),e=>e.code==='23505');
  assert.equal(await stored('oc','qa-cot-b'),undefined);
  await cas('oc',a.id,a,{...a,apagadoEm:'2026-01-01'});
  assert.equal(await cas('oc','qa-cot-b',null,{id:'qa-cot-b',cotacaoId:'qa-cot'}),true);
});
test('SQL: tentativas concorrentes de OCs da mesma cotação confirmam somente uma', async () => {
  const ids=['qa-concorrente-cot-a','qa-concorrente-cot-b'];
  const results=await Promise.allSettled(ids.map(id=>cas('oc',id,null,{id,cotacaoId:'qa-concorrente-cot'})));
  assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value===true).length,1);
  assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='23505').length,1);
  assert.equal((await db.query("select count(*)::integer as n from domo_registros where colecao='oc' and registro->>'cotacaoId'=$1",['qa-concorrente-cot'])).rows[0].n,1);
});
test('SQL: vínculo de ordem não pode pertencer a duas permutas e rollback preserva origem', async () => {
  const a={id:'qa-perm-a',ordens:[{col:'oc',id:'qa-vinculo'}]};
  await cas('permuta',a.id,null,a);
  await assert.rejects(()=>cas('permuta','qa-perm-b',null,{id:'qa-perm-b',ordens:[{col:'oc',id:'qa-vinculo'}]}),e=>e.code==='23505');
  assert.equal((await db.query('select permuta_id from domo_ordens_permutas where ordem_id=$1',['qa-vinculo'])).rows[0].permuta_id,a.id);
  assert.equal(await stored('permuta','qa-perm-b'),undefined);
  await cas('permuta',a.id,a,{...a,ordens:[{col:'oc',id:'qa-vinculo',apagadoEm:'2026-01-01'}]});
  assert.equal(await cas('permuta','qa-perm-b',null,{id:'qa-perm-b',ordens:[{col:'oc',id:'qa-vinculo'}]}),true);
});
test('SQL: tentativa de acrescentar vínculo ocupado preserva o documento e todos os vínculos anteriores', async () => {
  const a={id:'qa-rollback-perm-a',ordens:[{col:'oc',id:'qa-rollback-ordem-a'}]};
  const b={id:'qa-rollback-perm-b',ordens:[{col:'os',id:'qa-rollback-ordem-b'}]};
  await cas('permuta',a.id,null,a); await cas('permuta',b.id,null,b);
  await assert.rejects(()=>cas('permuta',b.id,b,{...b,ordens:[...b.ordens,...a.ordens]}),e=>e.code==='23505');
  assert.deepEqual(await stored('permuta',a.id),a); assert.deepEqual(await stored('permuta',b.id),b);
  const links=await db.query('select ordem_colecao,ordem_id,permuta_id from domo_ordens_permutas where permuta_id in ($1,$2) order by permuta_id',[a.id,b.id]);
  assert.deepEqual(links.rows,[
    {ordem_colecao:'oc',ordem_id:'qa-rollback-ordem-a',permuta_id:a.id},
    {ordem_colecao:'os',ordem_id:'qa-rollback-ordem-b',permuta_id:b.id}
  ]);
});
test('SQL: RPC não aceita identidade diferente da chave da linha', async () => {
  await assert.rejects(()=>cas('oc','qa-sql-wrong',null,{id:'outro'}),/Registro inválido/);
  assert.equal(await stored('oc','qa-sql-wrong'),undefined);
});
test('SQL: RPC é restrita ao serviço, inclusive sem grant herdado de PUBLIC', async () => {
  for(const role of ['anon','authenticated']) {
    assert.equal((await db.query("select has_function_privilege($1,'public.domo_gravar_se_inalterado(text,text,jsonb,jsonb)','EXECUTE') as ok",[role])).rows[0].ok,false);
    await db.exec(`set role ${role}`);
    try { await assert.rejects(()=>cas('oc','qa-denied',null,{id:'qa-denied'}),e=>e.code==='42501'); }
    finally { await db.exec('reset role'); }
  }
  assert.equal((await db.query("select has_function_privilege('service_role','public.domo_gravar_se_inalterado(text,text,jsonb,jsonb)','EXECUTE') as ok")).rows[0].ok,true);
});
