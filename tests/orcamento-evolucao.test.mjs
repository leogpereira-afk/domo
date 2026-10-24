import {createRequire} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const O=createRequire(import.meta.url)('../orcamento-model.js');
const base=()=>({id:'budget',obraId:'obra',origem:{totalCentavos:3001},grupos:[{codigo:'1',totalCentavos:3000}],servicos:[{item:'1.1',grupo:'1',quantidade:1,custoUnitario:10,totalCentavos:1000},{item:'1.2',grupo:'1',quantidade:1,custoUnitario:20,totalCentavos:2000}],revisoes:[],cenarios:[],consolidacoes:[],validacoes:[],vinculos:[]});
const revision=(id,item,quantidade)=>({id,alteracoes:[{item,quantidade}],aprovadoPor:'QA',aprovadoEm:'2026-10-24T10:00:00Z'});
const link=(extra={})=>({id:'v',item:'1.1',col:'oc',registroId:'source',etapa:'contratado',valorCentavos:1000,...extra});
const source=()=>({id:'source',obraId:'obra',situacao:'emitida',itens:[{id:'i',qtd:1,preco:10}],totalLiquido:10});
const event=(b,item,estado='consolidado',extra={})=>O.criarEvento(b,item,estado,{id:'e'+(b.consolidacoes.length+1),em:'2026-10-24T10:00:00Z',por:'QA',responsavel:'Conferente QA',evidencia:'Memória conferida na fonte sintética',...extra});

test('successive revisions preserve previous changed items and simulations use current values',()=>{
 const b=base();b.revisoes=[revision('r1','1.1',2),revision('r2','1.2',2)];
 assert.deepEqual(O.itens(b,'r2').map(x=>x.totalCentavos),[2000,4000]);
 assert.equal(O.simular(b,[{item:'1.2',quantidade:3}]).totalCentavos,8000);
 assert.equal(O.resumo(b).totalAtualCentavos,6000);
 assert.equal(O.resumo(b).diferencaCentavos,-1);
});
test('no-op selection or identical values never recalculate source and new empty scenario is refused',()=>{
 const b=base();b.servicos[0].totalCentavos=1001;
 assert.equal(O.simular(b,[{item:'1.1'}]).itens[0].totalCentavos,1001);
 assert.equal(O.simular(b,[{item:'1.1',quantidade:1,custoUnitario:10}]).itens[0].totalCentavos,1001);
 const changed=structuredClone(b);changed.cenarios=[{id:'c',alteracoes:[{item:'1.1'}]}];
 assert.ok(O.validar(changed,b,'direcao').some(x=>/alteração efetiva/i.test(x)));
});
test('a real permuta is bounded by live accepted orders plus deliveries, excluding cash payments',()=>{
 const b=base(),reg={oc:[source()],permuta:[{id:'p',ordens:[{id:'source',col:'oc',valor:99}],lancamentos:[{id:'l',tipo:'entrega',valor:5},{id:'cash',tipo:'pagamento',valor:100},{id:'deleted',tipo:'entrega',valor:20,apagadoEm:'2026-10-24'}]}]};
 b.vinculos=[link({col:'permuta',registroId:'p',etapa:'permuta',valorCentavos:1501})];
 assert.ok(O.validar(b,null,'direcao',reg).some(x=>/excedem/.test(x)));
 b.vinculos[0].valorCentavos=1500;assert.deepEqual(O.validar(b,null,'direcao',reg),[]);
 reg.oc[0].situacao='cancelada';assert.ok(O.validar(b,null,'direcao',reg).length);
});
test('OC receipts support received value but never imply physical execution or cash payment',()=>{
 const b=base(),oc=source();oc.itens[0].qtd=2;oc.totalLiquido=20;oc.frete=5;oc.recebimentos=[{id:'r',itens:[{itemId:'i',qtd:1}],nf:'QA'}];
 b.vinculos=[link({etapa:'recebido'})];assert.deepEqual(O.validar(b,null,'direcao',{oc:[oc]}),[]);
 assert.equal(O.resumo(b,{oc:[oc]}).recebidoCentavos,1000);
 b.vinculos[0].valorCentavos=1001;assert.ok(O.validar(b,null,'direcao',{oc:[oc]}).length);
 b.vinculos[0]=link({etapa:'executado'});assert.ok(O.validar(b,null,'direcao',{oc:[oc]}).length);
 b.vinculos[0]=link({etapa:'pago'});assert.ok(O.validar(b,null,'direcao',{oc:[oc]}).length);
});
test('new contracted allocation rejects draft and cancelled sources without deleting historical totals',()=>{
 for(const situacao of ['rascunho','cancelada']){
  const b=base(),reg={oc:[{...source(),situacao}]};b.vinculos=[link()];
  assert.ok(O.validar(b,null,'direcao',reg).length);
  const r=O.resumo(b,reg);assert.equal(r.contratadoCentavos,1000);assert.equal(r.contratadoConfirmadoCentavos,0);assert.equal(r.divergencias.length,1);
 }
});
test('source drift stays visible while unrelated edits and soft unlink remain possible',()=>{
 const old=base();old.vinculos=[link()];const reg={oc:[{...source(),itens:[{id:'i',qtd:1,preco:5}],totalLiquido:5}]};
 const changed=structuredClone(old);changed.nome='Novo nome';assert.deepEqual(O.validar(changed,old,'escritorio',reg),[]);
 const r=O.resumo(changed,reg);assert.equal(r.contratadoCentavos,1000);assert.equal(r.contratadoConfirmadoCentavos,0);assert.equal(r.contratadoDivergenteCentavos,1000);assert.equal(r.divergencias[0].limiteCentavos,500);
 changed.vinculos[0].valorCentavos=600;assert.ok(O.validar(changed,old,'direcao',reg).length);
 changed.vinculos[0].valorCentavos=500;assert.deepEqual(O.validar(changed,old,'direcao',reg),[]);
 changed.vinculos[0].apagadoEm='2026-10-24';assert.deepEqual(O.validar(changed,old,'direcao',reg),[]);
 assert.equal(O.resumo(changed,reg).contratadoCentavos,null);
});
test('cumulative bounds include unchanged rows when another row is edited',()=>{
 const old=base();old.vinculos=[link({valorCentavos:400}),link({id:'v2',item:'1.2',valorCentavos:400})];
 const changed=structuredClone(old);changed.vinculos[1].valorCentavos=700;
 assert.ok(O.validar(changed,old,'direcao',{oc:[source()]}).some(x=>/excedem/.test(x)));
});
test('an unchanged original item can be expressly approved without artificial price changes',()=>{
 const b=base();b.servicos[0].totalCentavos=1001;const next=structuredClone(b);next.consolidacoes.push(event(b,'1.1'));
 assert.equal(next.consolidacoes[0].totalCentavos,1001);assert.deepEqual(O.validar(next,b,'direcao'),[]);
 assert.ok(O.validar(next,b,'escritorio').some(x=>/direção/.test(x)));
 const r=O.resumo(next);assert.equal(r.totalAtualCentavos,3001);assert.equal(r.consolidadoCentavos,1001);assert.equal(r.aConsolidarCentavos,2000);assert.equal(r.itensConsolidados,1);assert.equal(r.estadoConsolidacao,'em-consolidacao');
 assert.equal(O.itens(next,'consolidado').length,1);
});
test('approving item B preserves A, and opening a new proposal preserves the approved value',()=>{
 const b=base();b.consolidacoes.push(event(b,'1.1','consolidado',{quantidade:2}));b.consolidacoes.push(event(b,'1.2','consolidado',{quantidade:2}));
 assert.equal(O.resumo(b).totalAtualCentavos,6000);assert.equal(O.resumo(b).estadoConsolidacao,'consolidado');
 const before=structuredClone(b);b.consolidacoes.push(event(b,'1.1','aguardando-aprovacao',{quantidade:3}));
 assert.deepEqual(O.validar(b,before,'escritorio'),[]);assert.equal(O.resumo(b).totalAtualCentavos,6000);assert.equal(O.situacaoItem(b,'1.1').proposta.quantidade,3);assert.equal(O.situacaoItem(b,'1.1').revisaoEmAndamento,true);
 assert.equal(O.resumo(b).estadoConsolidacao,'em-consolidacao');
});
test('approval requires responsible evidence and no applicable blocking issue, without blocking unrelated item',()=>{
 const b=base();b.validacoes=[{id:'p',item:'1.1',status:'pendente',impeditiva:true,titulo:'Memória da quantidade'}];
 const next=structuredClone(b);next.consolidacoes=[event(b,'1.1')];assert.ok(O.validar(next,b,'direcao').some(x=>/Memória/.test(x)));
 next.consolidacoes=[event(b,'1.2')];assert.deepEqual(O.validar(next,b,'direcao'),[]);
 next.consolidacoes[0].evidencia='';assert.ok(O.validar(next,b,'direcao').some(x=>/evidência/i.test(x)));
 b.validacoes[0].item=undefined;next.validacoes=structuredClone(b.validacoes);next.consolidacoes=[event(b,'1.2')];assert.ok(O.validar(next,b,'direcao').length);
});
test('stale approval and rewrite of prior events are rejected',()=>{
 const b=base(),stale=event(b,'1.1','consolidado',{quantidade:3});b.consolidacoes.push(event(b,'1.1','consolidado',{quantidade:2}));
 const next=structuredClone(b);next.consolidacoes.push({...stale,id:'stale'});assert.ok(O.validar(next,b,'direcao').some(x=>/base|desatualizada/i.test(x)));
 const rewrite=structuredClone(b);rewrite.consolidacoes[0].quantidade=9;assert.ok(O.validar(rewrite,b,'direcao').some(x=>/imutável|imutáveis|preservad/i.test(x)));
 const removed=structuredClone(b);removed.consolidacoes=[];assert.ok(O.validar(removed,b,'direcao').length);
});
test('a submitted proposal cannot be silently changed in its approval',()=>{
 const b=base();b.consolidacoes.push(event(b,'1.1','aguardando-aprovacao',{quantidade:2}));
 const changed=structuredClone(b);changed.consolidacoes.push(event(b,'1.1','consolidado',{quantidade:3}));assert.ok(O.validar(changed,b,'direcao').some(x=>/proposta/i.test(x)));
 changed.consolidacoes[1]=event(b,'1.1','consolidado',{quantidade:2});assert.deepEqual(O.validar(changed,b,'direcao'),[]);
});
test('zero open issues does not imply consolidation and legacy revisions do not invent per-item decisions',()=>{
 const b=base();b.revisoes=[revision('r1','1.1',2)];const r=O.resumo(b);
 assert.equal(r.pendencias,0);assert.equal(r.itensConsolidados,0);assert.equal(r.estadoConsolidacao,'executivo');assert.equal(r.totalAtualCentavos,4000);assert.equal(r.aConsolidarCentavos,4000);
});
test('validation history cannot be removed and resolving a new issue requires evidence',()=>{
 const b=base();b.validacoes=[{id:'p',status:'pendente',historico:[{em:'2026-10-23',por:'QA',status:'pendente'}]}];
 const n=structuredClone(b);n.validacoes[0].historico=[];assert.ok(O.validar(n,b,'escritorio').some(x=>/histórico/i.test(x)));
 n.validacoes=structuredClone(b.validacoes);n.validacoes[0].status='validado';assert.ok(O.validar(n,b,'escritorio').some(x=>/evidência|responsável/i.test(x)));
 n.validacoes[0].responsavel='QA';n.validacoes[0].evidencia='Conferido';assert.deepEqual(O.validar(n,b,'escritorio'),[]);
 n.validacoes=[];assert.ok(O.validar(n,b,'escritorio').length);
});
test('server author stamps do not stale a subsequent offline item decision',()=>{
 const b=base();b.consolidacoes.push(event(b,'1.1','consolidado',{quantidade:2}));
 const offline=event(b,'1.1','revisao-solicitada',{motivo:'Rever quantitativo'});
 const stamped=structuredClone(b);Object.assign(stamped.consolidacoes[0],{em:'2026-10-25',por:'Autora autenticada',porId:'user',aprovadoEm:'2026-10-25',aprovadoPor:'Autora autenticada'});
 const next=structuredClone(stamped);next.consolidacoes.push(offline);
 assert.deepEqual(O.validar(next,stamped,'escritorio'),[]);
});
test('scenario approval cannot silently rebase a proposal after another item was consolidated',()=>{
 const b=base();b.cenarios=[{id:'c',nome:'Proposta',baseVersao:O.versao(b),alteracoes:[{item:'1.2',quantidade:2}]}];
 b.consolidacoes.push(event(b,'1.1','consolidado',{quantidade:2}));
 const n=structuredClone(b);n.consolidacoes.push(event(b,'1.2','consolidado',{quantidade:2,cenarioId:'c'}));
 assert.ok(O.validar(n,b,'direcao').some(x=>/cenário.*base|base.*cenário/i.test(x)));
});
test('one scenario can consolidate multiple items against its single reviewed base',()=>{
 const b=base();b.cenarios=[{id:'c',nome:'Proposta',baseVersao:O.versao(b),alteracoes:[{item:'1.1',quantidade:2},{item:'1.2',quantidade:2}]}];
 const n=structuredClone(b);n.consolidacoes.push(event(n,'1.1','consolidado',{quantidade:2,cenarioId:'c'}));n.consolidacoes.push(event(n,'1.2','consolidado',{quantidade:2,cenarioId:'c'}));
 assert.deepEqual(O.validar(n,b,'direcao'),[]);assert.equal(O.resumo(n).totalAtualCentavos,6000);
 const forged=structuredClone(b);forged.consolidacoes.push(event(b,'1.1','consolidado',{quantidade:3,cenarioId:'c'}));
 assert.ok(O.validar(forged,b,'direcao').some(x=>/cenário/i.test(x)));
});
test('a removed financial source remains quantified and blocks approval until its link is repaired',()=>{
 const b=base();b.vinculos=[link()];const reg={oc:[{...source(),apagadoEm:'2026-10-24'}]};
 assert.equal(O.resumo(b,reg).contratadoCentavos,1000);assert.equal(O.resumo(b,reg).contratadoConfirmadoCentavos,0);
 assert.equal(O.diagnosticarVinculos(b,reg)[0].estado,'sem-origem');
 const n=structuredClone(b);n.consolidacoes.push(event(b,'1.1'));assert.ok(O.validar(n,b,'direcao',reg).length);
});
test('visible active budgets expose shared over-allocation while archived alternatives do not consume balance',()=>{
 const a=base(),b=base();a.vinculos=[link()];b.id='other';b.vinculos=[link()];
 const reg={oc:[source()],orc:[a,b]};
 assert.equal(O.diagnosticarVinculos(a,reg)[0].estado,'divergente');
 assert.equal(O.diagnosticarVinculos(a,reg)[0].alocadoOutrosCentavos,1000);
 assert.equal(O.resumo(a,reg).contratadoConfirmadoCentavos,0);
 b.inativoEm='2026-10-24';assert.equal(O.diagnosticarVinculos(a,reg)[0].estado,'confirmado');
});
