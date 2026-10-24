import test from 'node:test';
import assert from 'node:assert/strict';
import {env} from './helpers/server-env.mjs';
const base=()=>({id:'budget',obraId:'synthetic',origem:{totalCentavos:1000},servicos:[{item:'1.1',quantidade:1,custoUnitario:10,totalCentavos:1000}],revisoes:[],vinculos:[]});
const save=(e,r,role='dir')=>{const old=e.get('orc',r.id);return e.call('salvarLote',{protocoloEnvio:2,itens:[{colecao:'orc',registro:{...r,_baseExistente:!!old,_baseRevisao:old?._revisao||null,_baseAtualizadoEm:old?.atualizadoEm||null}}]},role);};
test('budget server denies field read/write, preserves original, office cannot approve',async()=>{
const e=await env('domo-nucleo');assert.equal((await save(e,base(),'field')).body.recusados.length,1);assert.equal((await save(e,base(),'office')).body.salvos.length,1);
const read=await e.call('snapshot',{},'field');assert.equal(JSON.stringify(read.body).includes('budget'),false);
const changed=base();changed.origem.totalCentavos=900;assert.equal((await save(e,changed)).body.recusados.length,1);
const rev=base();rev.revisoes=[{id:'r',aprovadoPor:'Direção',aprovadoEm:'2026-10-23',alteracoes:[{item:'1.1',quantidade:2}]}];assert.equal((await save(e,rev,'office')).body.recusados.length,1);assert.equal((await save(e,rev)).body.salvos.length,1);
rev.revisoes[0].alteracoes[0].quantidade=3;assert.equal((await save(e,rev)).body.recusados.length,1);
});
test('server rejects broken source and cumulative over-allocation',async()=>{const e=await env('domo-nucleo');e.seed('oc',{id:'source',total:5,pagamentos:[{valorCentavos:500}]});const b=base();b.vinculos=[{id:'v',item:'1.1',col:'oc',registroId:'source',etapa:'pago',valorCentavos:600}];assert.equal((await save(e,b)).body.recusados.length,1);b.vinculos[0].valorCentavos=0;assert.equal((await save(e,b)).body.salvos.length,1);});
test('same source hash cannot create a second budget in the same work',async()=>{const e=await env('domo-nucleo');const b=base();b.origem.hash='synthetic-sha';assert.equal((await save(e,b)).body.salvos.length,1);assert.equal((await save(e,{...b,id:'second'})).body.recusados.length,1);assert.equal((await save(e,{...b,id:'third',obraId:'other'})).body.salvos.length,1);});
test('server bounds actual OC totals and OS paid measurement cash',async()=>{const e=await env('domo-nucleo'),b=base();e.seed('oc',{id:'s',totalLiquido:10});b.vinculos=[{id:'v',item:'1.1',col:'oc',registroId:'s',etapa:'contratado',valorCentavos:1001}];assert.equal((await save(e,b)).body.recusados.length,1);e.seed('os',{id:'s',itens:[{qtd:1,preco:10}],medicoes:[{situacao:'paga',bruto:10,liquido:9.5,pagoEm:'2026-10-23'}]});b.vinculos[0]={...b.vinculos[0],col:'os',etapa:'pago',valorCentavos:950};assert.equal((await save(e,b)).body.salvos.length,1);b.vinculos[0].valorCentavos=951;assert.equal((await save(e,b)).body.recusados.length,1);});
