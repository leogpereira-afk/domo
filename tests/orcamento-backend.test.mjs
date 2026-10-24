import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {env} from './helpers/server-env.mjs';
import {PGlite} from '@electric-sql/pglite';
const O=createRequire(import.meta.url)('../orcamento-model.js');

const budget=(id='synthetic-budget')=>({id,obraId:'synthetic-work',origem:{totalCentavos:1000},grupos:[],servicos:[{item:'1.1',quantidade:1,custoUnitario:10,totalCentavos:1000}],revisoes:[],consolidacoes:[],validacoes:[],vinculos:[],anexos:[]});
const save=(e,r,role='dir')=>{const old=e.get('orc',r.id);return e.call('salvarLote',{protocoloEnvio:2,itens:[{colecao:'orc',registro:{...r,_baseExistente:!!old,_baseRevisao:old?._revisao||null,_baseAtualizadoEm:old?.atualizadoEm||null}}]},role);};
const source={id:'synthetic-source',obraId:'synthetic-work',situacao:'confirmada',itens:[{qtd:1,preco:10}]};
const link=(value=1000)=>({id:'synthetic-link',item:'1.1',col:'oc',registroId:source.id,etapa:'contratado',valorCentavos:value});

test('budget backend: concurrent budgets share one transactional source allowance',async()=>{
  const e=await env('domo-nucleo');e.seed('oc',source);e.concurrent('orc',2);
  const results=await Promise.all(['synthetic-a','synthetic-b'].map(id=>save(e,{...budget(id),vinculos:[link()]})));
  assert.equal(results.reduce((n,r)=>n+r.body.salvos.length,0),1);
  assert.equal(results.reduce((n,r)=>n+r.body.recusados.length,0),1);
  assert.match(results.find(r=>r.body.recusados.length).body.recusados[0].motivo,/rateio|origem/i);
});

test('budget backend: nonexistent and unfinished files cannot become budget attachments',async()=>{
  const e=await env('domo-nucleo'),b={...budget(),anexos:[{id:'synthetic-file',arquivoId:'synthetic-file'}]};
  assert.equal((await save(e,b)).body.recusados.length,1);
  e.seed('_arqmeta',{id:'synthetic-file',pronto:false,criadoPorId:'equipe'});
  assert.equal((await save(e,b)).body.recusados.length,1);
  e.seed('_arqmeta',{id:'synthetic-file',pronto:true,criadoPorId:'equipe'});
  assert.equal((await save(e,b)).body.salvos.length,1);
});

test('budget backend: server stamps revision actor and time instead of trusting submitted attribution',async()=>{
  const e=await env('domo-nucleo'),b=budget();await save(e,b);
  const r={id:'synthetic-revision',alteracoes:[{item:'1.1',quantidade:2}],aprovadoPor:'Falsified',aprovadoPorId:'other',aprovadoEm:'2000-01-01'};
  const result=await save(e,{...e.get('orc',b.id),revisoes:[r]});assert.equal(result.body.salvos.length,1);
  const stored=e.get('orc',b.id).revisoes[0];assert.equal(stored.aprovadoPorId,'equipe');assert.notEqual(stored.aprovadoPor,'Falsified');assert.notEqual(stored.aprovadoEm,r.aprovadoEm);
  const changed=structuredClone(e.get('orc',b.id));changed.revisoes[0].aprovadoPor='Changed';
  assert.equal((await save(e,changed)).body.recusados.length,1);
});

test('budget backend: validation history is appended by server and cannot be erased',async()=>{
  const e=await env('domo-nucleo'),b=budget();b.validacoes=[{id:'synthetic-validation',item:'1.1',titulo:'Synthetic check',status:'pendente',historico:[]}];
  assert.equal((await save(e,b,'office')).body.salvos.length,1);
  const initial=e.get('orc',b.id);assert.equal(initial.validacoes[0].historico.length,1);assert.equal(initial.validacoes[0].historico[0].porId,'u-office');
  const next=structuredClone(initial);next.validacoes[0].responsavel='Synthetic assignee';
  assert.equal((await save(e,next,'office')).body.salvos.length,1);
  const stored=e.get('orc',b.id);assert.equal(stored.validacoes[0].historico.length,2);
  stored.validacoes[0].historico=[];assert.equal((await save(e,stored,'office')).body.recusados.length,1);
});

test('budget backend: source reduction leaves unrelated validation editable and refuses new consumption',async()=>{
  const e=await env('domo-nucleo');e.seed('oc',source);
  const b={...budget(),vinculos:[link()],validacoes:[{id:'v',item:'1.1',status:'pendente',historico:[]}]};await save(e,b);
  e.seed('oc',{...source,itens:[{qtd:1,preco:5}]});
  const current=e.get('orc',b.id);current.validacoes[0].responsavel='Synthetic';
  assert.equal((await save(e,current,'office')).body.salvos.length,1);
  assert.equal(e.get('orc',b.id).validacoes[0].responsavel,'Synthetic');
  assert.equal((await save(e,{...budget('another-budget'),vinculos:[link(1)]})).body.recusados.length,1);
  const repaired=e.get('orc',b.id);repaired.vinculos[0].inativoEm='2026-10-24';
  assert.equal((await save(e,repaired)).body.salvos.length,1);
  assert.equal((await save(e,{...budget('another-budget'),vinculos:[link(1)]})).body.salvos.length,1);
});

test('budget backend: missing legacy attachment is flagged without blocking administrative repair',async()=>{
  const e=await env('domo-nucleo'),b={...budget(),anexos:[{arquivoId:'legacy-missing'}],validacoes:[{id:'v',status:'pendente',historico:[]}]};e.seed('orc',b);
  const edit=structuredClone(b);edit.validacoes[0].responsavel='Synthetic';
  assert.equal((await save(e,edit,'office')).body.salvos.length,1);
  assert.equal(e.get('orc',b.id).arquivosPendentesReparo[0].arquivoId,'legacy-missing');
  const another={...e.get('orc',b.id),anexos:[...b.anexos,{arquivoId:'new-missing'}]};
  assert.equal((await save(e,another,'office')).body.recusados.length,1);
});

test('budget backend: source changing after validation is refused atomically',async()=>{
  const e=await env('domo-nucleo');e.seed('oc',source);
  e.state.beforeBudgetCommit=async()=>e.seed('oc',{...source,itens:[{qtd:1,preco:1}]});
  const result=await save(e,{...budget(),vinculos:[link()]});
  assert.equal(result.body.salvos.length,0);assert.match(result.body.recusados[0].motivo,/Origem.*mudou/);assert.equal(e.get('orc',budget().id),undefined);
});

test('budget backend: consolidation permission, authenticated attribution, blockers and append-only decisions',async()=>{
  const e=await env('domo-nucleo'),b=budget();await save(e,b);
  const approval=base=>({...base,consolidacoes:[...base.consolidacoes,O.criarEvento(base,'1.1','consolidado',{id:'synthetic-approval',por:'Falsified',porId:'fake',em:'2000-01-01',responsavel:'Synthetic reviewer',evidencia:'Synthetic quantity sheet'})]});
  assert.equal((await save(e,approval(e.get('orc',b.id)),'office')).body.recusados.length,1);
  const blocked=e.get('orc',b.id);blocked.validacoes=[{id:'block',item:'1.1',status:'pendente',impeditiva:true,historico:[]}];await save(e,blocked);
  assert.equal((await save(e,approval(e.get('orc',b.id)))).body.recusados.length,1);
  const resolved=e.get('orc',b.id);Object.assign(resolved.validacoes[0],{status:'validado',responsavel:'Synthetic reviewer'});
  assert.equal((await save(e,resolved)).body.recusados.length,1);
  resolved.validacoes[0].evidencia='Synthetic document';assert.equal((await save(e,resolved)).body.salvos.length,1);
  const r=await save(e,approval(e.get('orc',b.id)));assert.equal(r.body.salvos.length,1);
  const stored=e.get('orc',b.id),event=stored.consolidacoes[0];assert.equal(event.porId,'equipe');assert.equal(event.aprovadoPorId,'equipe');assert.notEqual(event.em,'2000-01-01');
  const removed=structuredClone(stored);removed.consolidacoes=[];assert.equal((await save(e,removed)).body.recusados.length,1);
  const forged=structuredClone(stored);forged.consolidacoes[0].por='Other';assert.equal((await save(e,forged)).body.recusados.length,1);
});

test('budget backend: office cannot attach another owner private file or file claimed for cleanup',async()=>{
  const e=await env('domo-nucleo'),b={...budget(),anexos:[{arquivoId:'private-file'}]};
  e.seed('_arqmeta',{id:'private-file',pronto:true,criadoPorId:'u-office'});e.seed('pessoa',{id:'synthetic-person',asos:[{arquivoId:'private-file'}]});
  assert.equal((await save(e,b,'office')).body.recusados.length,1);
  e.seed('_arqmeta',{id:'cleanup-file',pronto:true,excluindoEm:'2026-10-24'});
  assert.equal((await save(e,{...b,anexos:[{arquivoId:'cleanup-file'}]})).body.recusados.length,1);
});

test('budget backend: restoring trashed budget uses current allowance and preserves history',async()=>{
  const e=await env('domo-nucleo');e.seed('oc',source);const b={...budget('restore-budget'),vinculos:[link()]};
  const approval=O.criarEvento(b,'1.1','consolidado',{id:'restore-approval',por:'Synthetic',em:'2026-10-24',responsavel:'Synthetic',evidencia:'Synthetic'});b.consolidacoes=[approval];await save(e,b);
  const confirmed=e.get('orc',b.id);assert.equal((await e.call('apagar',{colecao:'orc',id:b.id})).status,200);
  await save(e,{...budget('another-active'),vinculos:[link()]});
  const refused=await e.call('restaurarItem',{colecao:'orc',id:b.id});assert.notEqual(refused.status,200);assert.ok(e.get('orc',b.id).apagadoEm);
  await e.call('apagar',{colecao:'orc',id:'another-active'});
  const restored=await e.call('restaurarItem',{colecao:'orc',id:b.id});assert.equal(restored.status,200);assert.equal(e.get('orc',b.id).apagadoEm,null);
  assert.deepEqual(e.get('orc',b.id).consolidacoes,confirmed.consolidacoes);assert.equal(e.get('orc',b.id).restauracoes.at(-1).porId,'equipe');
  assert.equal((await e.call('restaurarItem',{colecao:'orc',id:b.id},'office')).status,403);
});

test('budget backend: backup preflight rejects excess before changing even an unrelated source record',async()=>{
  const e=await env('domo-nucleo');e.seed('oc',source);e.seed('forn',{id:'untouched',nome:'Before'});
  const records=[{_col:'forn',id:'untouched',nome:'After'}, {...source,_col:'oc'},
    {...budget('backup-a'),vinculos:[link()],_col:'orc'}, {...budget('backup-b'),vinculos:[link()],_col:'orc'}];
  const result=await e.call('restaurar',{registros:records});assert.notEqual(result.status,200);
  assert.equal(e.get('forn','untouched').nome,'Before');assert.equal(e.get('orc','backup-a'),undefined);assert.equal(e.get('orc','backup-b'),undefined);
});

test('budget backend: backup restores sources first, imports history with restoration audit, and refuses rewriting confirmed decisions',async()=>{
  const e=await env('domo-nucleo'),b={...budget('backup-valid'),vinculos:[link()]};
  b.consolidacoes=[O.criarEvento(b,'1.1','consolidado',{id:'backup-approval',por:'Historical author',em:'2026-01-01T00:00:00Z',responsavel:'Synthetic',evidencia:'Synthetic'})];
  const restored=await e.call('restaurar',{registros:[{...b,_col:'orc'},{...source,_col:'oc'}]});assert.equal(restored.status,200);
  const actual=e.get('orc',b.id);assert.deepEqual(actual.consolidacoes,b.consolidacoes);assert.equal(actual.restauracoes[0].origemHistorico,'backup');assert.deepEqual(actual.restauracoes[0].consolidacoesImportadas,['backup-approval']);
  const forged=structuredClone(b);forged.consolidacoes[0].por='Forged';
  const result=await e.call('restaurar',{registros:[{_col:'forn',id:'should-not-exist',nome:'Synthetic'},{...forged,_col:'orc'}]});
  assert.notEqual(result.status,200);assert.equal(e.get('forn','should-not-exist'),undefined);assert.deepEqual(e.get('orc',b.id).consolidacoes,b.consolidacoes);
  assert.equal((await e.call('restaurar',{registros:[{...b,_col:'orc'}]},'office')).status,403);
});

test('budget backend: benign legacy backup with unchanged excess does not block restoration metadata',async()=>{
  const e=await env('domo-nucleo');e.seed('oc',source);await save(e,{...budget('legacy-backup'),vinculos:[link()]});
  const before=e.get('orc','legacy-backup');e.seed('oc',{...source,itens:[{qtd:1,preco:5}]});
  assert.equal((await e.call('restaurar',{registros:[{...before,_col:'orc'}]})).status,200);
  assert.deepEqual(e.get('orc',before.id).vinculos,before.vinculos);assert.equal(e.get('orc',before.id).restauracoes.length,1);
});

test('budget backend: restoration winning trash cleanup preserves the budget and attachment bytes',async()=>{
  const e=await env('domo-nucleo'),b={...budget('restore-before-cleanup'),anexos:[{arquivoId:'restore-safe-file'}]};
  e.seed('_arqmeta',{id:'restore-safe-file',pronto:true,partes:1});e.parts.set('restore-safe-file/p0',new Uint8Array([1,2,3]));
  assert.equal((await save(e,b)).body.salvos.length,1);await e.call('apagar',{colecao:'orc',id:b.id});
  let restoration;e.state.beforeBudgetDeleteClaim=async()=>{restoration=await e.call('restaurarItem',{colecao:'orc',id:b.id});};
  const cleanup=await e.call('esvaziarLixeira');
  assert.equal(restoration.status,200);assert.equal(cleanup.status,200);assert.equal(cleanup.body.apagados,0);assert.equal(cleanup.body.arquivos,0);
  assert.equal(e.get('orc',b.id).apagadoEm,null);assert.ok(e.get('_arqmeta','restore-safe-file'));assert.equal(e.parts.has('restore-safe-file/p0'),true);
});

test('budget backend: cleanup winning restoration reserves budget before deleting any attachment bytes',async()=>{
  const e=await env('domo-nucleo'),b={...budget('cleanup-before-restore'),anexos:[{arquivoId:'claimed-file'}]};
  e.seed('_arqmeta',{id:'claimed-file',pronto:true,partes:1});e.parts.set('claimed-file/p0',new Uint8Array([1,2,3]));
  assert.equal((await save(e,b)).body.salvos.length,1);await e.call('apagar',{colecao:'orc',id:b.id});
  let restoration,claimedBeforeBytes=false;const remove=e.parts.delete.bind(e.parts);
  e.parts.delete=key=>{claimedBeforeBytes=!!e.get('orc',b.id)?.excluindoEm&&!!e.get('_arqmeta','claimed-file')?.excluindoEm;return remove(key);};
  e.state.beforeBudgetDeleteFinal=async()=>{restoration=await e.call('restaurarItem',{colecao:'orc',id:b.id});};
  const cleanup=await e.call('esvaziarLixeira');
  assert.notEqual(restoration.status,200);assert.equal(cleanup.status,200);assert.equal(cleanup.body.apagados,1);assert.equal(cleanup.body.arquivos,1);assert.equal(claimedBeforeBytes,true);
  assert.equal(e.get('orc',b.id),undefined);assert.equal(e.get('_arqmeta','claimed-file'),undefined);assert.equal(e.parts.has('claimed-file/p0'),false);
});

for(const restorationFirst of [true,false])test('budget backend: automatic trash cleanup arbitrates restoration '+(restorationFirst?'before':'after')+' claim',async()=>{
  const e=await env('domo-nucleo'),b={...budget('routine-budget'),anexos:[{arquivoId:'routine-file'}]};
  e.seed('_arqmeta',{id:'routine-file',pronto:true,partes:1});e.parts.set('routine-file/p0',new Uint8Array([1,2]));
  assert.equal((await save(e,b)).body.salvos.length,1);await e.call('apagar',{colecao:'orc',id:b.id});
  e.seed('orc',{...e.get('orc',b.id),apagadoEm:'2000-01-01'});
  const routine=await env('domo-rotina',{state:e.state});let restored;
  e.state[restorationFirst?'beforeBudgetDeleteClaim':'beforeBudgetDeleteFinal']=async()=>{restored=await e.call('restaurarItem',{colecao:'orc',id:b.id});};
  const result=await routine.call('run');assert.equal(result.status,200);assert.equal(result.body.erroLixeira,undefined);
  if(restorationFirst){
    assert.equal(restored.status,200);assert.equal(result.body.lixeiraApagada,0);assert.equal(result.body.arquivosOrfaos,0);
    assert.equal(e.get('orc',b.id).apagadoEm,null);assert.ok(e.get('_arqmeta','routine-file'));assert.equal(e.parts.has('routine-file/p0'),true);
  }else{
    assert.notEqual(restored.status,200);assert.equal(result.body.lixeiraApagada,1);assert.equal(e.get('orc',b.id),undefined);
    assert.equal(e.get('_arqmeta','routine-file'),undefined);assert.equal(e.parts.has('routine-file/p0'),false);
  }
});


test('budget backend: PDF after JSONB reload preserves validation history and rejects real rewrites',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  const jsonb=async r=>(await db.query('select $1::jsonb as registro',[JSON.stringify(r)])).rows[0].registro;
  const e=await env('domo-nucleo'),b=budget('jsonb-budget');
  b.origem={totalCentavos:1000,hash:'synthetic-hash',detalhes:{z:'last',a:'first'}};
  b.validacoes=[{id:'synthetic-validation',item:'1.1',titulo:'Synthetic check',status:'pendente',historico:[]}];
  const first=await save(e,b);assert.equal(first.body.salvos.length,1);
  const ack=first.body.salvos[0],remote=await jsonb(e.get('orc',b.id));e.seed('orc',remote);
  assert.notEqual(JSON.stringify(ack.validacoes[0].historico),JSON.stringify(remote.validacoes[0].historico));
  e.seed('_arqmeta',{id:'synthetic-pdf',pronto:true,criadoPorId:'equipe',vinculoPendente:{colecao:'orc',registroId:b.id}});
  const attached=await save(e,{...ack,anexos:[{arquivoId:'synthetic-pdf',mime:'application/pdf'}]});
  assert.equal(attached.body.salvos.length,1,attached.body.recusados[0]?.motivo);
  const confirmed=e.get('orc',b.id);assert.deepEqual(confirmed.validacoes,remote.validacoes);
  assert.equal(confirmed.anexos[0].arquivoId,'synthetic-pdf');
  for(const mutate of [
    r=>{r.validacoes[0].historico[0].por='Forged';},
    r=>{delete r.validacoes[0].historico[0].porId;},
    r=>{r.validacoes[0].historico[0].extra=null;},
    r=>{r.validacoes[0].historico[0].item=1.1;},
    r=>{r.origem.totalCentavos++;},
  ]){const changed=structuredClone(confirmed);mutate(changed);assert.equal((await save(e,changed)).body.recusados.length,1);}
  // Same contract applies to approved events and nested original data.
  const revised={...confirmed,revisoes:[{id:'synthetic-revision',alteracoes:[{item:'1.1',quantidade:2}],aprovadoPor:'Synthetic',aprovadoEm:'2026-01-01'}]};
  assert.equal((await save(e,revised)).body.salvos.length,1);
  const current=e.get('orc',b.id);current.consolidacoes=[O.criarEvento(current,'1.1','consolidado',{id:'synthetic-approval',por:'Synthetic',em:'2026-01-01',responsavel:'Synthetic',evidencia:'Synthetic sheet'})];
  assert.equal((await save(e,current)).body.salvos.length,1);
  const signed=e.get('orc',b.id),canonical=await jsonb(signed);e.seed('orc',canonical);
  assert.equal((await save(e,{...signed,nome:'Synthetic annotation'})).body.salvos.length,1);
  assert.deepEqual(e.get('orc',b.id).validacoes,canonical.validacoes);
  const forged=structuredClone(e.get('orc',b.id));forged.consolidacoes[0].aprovadoPorId='another';
  assert.equal((await save(e,forged)).body.recusados.length,1);
});
