import test from 'node:test';
import assert from 'node:assert/strict';
import {env} from './helpers/server-env.mjs';
const oc={id:'oc-qa',situacao:'emitida',total:100,itens:[{id:'i',qtd:10,preco:10}],recebimentos:[],historico:[]};
const save=(e,col,registro,role='dir')=>{const base=e.get(col,registro.id);return e.call('salvarLote',{protocoloEnvio:2,itens:[{colecao:col,registro:{_baseExistente:!!base,_baseRevisao:base?._revisao||null,_baseAtualizadoEm:base?.atualizadoEm||null,...registro}}]},role);};
const med=(id,numero,perc,ant=0)=>({id,numero,situacao:'rascunho',itens:[{itemId:'i',perc,percAnterior:ant,valorPeriodo:(perc-ant)*10}],bruto:(perc-ant)*10,retencaoPerc:5,retencao:(perc-ant)*.5,descontos:[],liquido:(perc-ant)*9.5});

test('Obra confirma recebimento e NF, mantendo preço protegido e resposta sem token',async()=>{
 const e=await env('domo-nucleo');e.seed('oc',{...oc,tokenPublico:'secret-link'});
 const r=await save(e,'oc',{id:oc.id,nf:'QA-ONLY',recebimentos:[{id:'r',itens:[{itemId:'i',qtd:10}]}]},'field');
 assert.equal(r.status,200);assert.equal(r.body.salvos.length,1);assert.equal(r.body.recusados.length,0);
 assert.equal(e.get('oc',oc.id).nf,'QA-ONLY');assert.equal(e.get('oc',oc.id).situacao,'entregue');assert.equal(e.get('oc',oc.id).total,100);
 assert.equal(r.body.salvos[0].total,undefined);assert.equal(r.body.salvos[0].tokenPublico,undefined);
});
test('Agenda: dono pode ler anexo e excluir compromisso; outro usuário não',async()=>{
 const e=await env('domo-acervo');e.seed('comp',{id:'private',dono:'u-office',anexos:[{id:'a',arquivoId:'file'}]});e.seed('_arqmeta',{id:'file',pronto:true,partes:1});e.parts.set('file/p0',new Uint8Array([1,2]));
 assert.equal((await e.call('baixarParte',{id:'file',i:0},'office')).status,200);assert.equal((await e.call('baixarParte',{id:'file',i:0},'field')).status,403);
 const n=await env('domo-nucleo',{state:e.state});assert.equal((await n.call('apagar',{colecao:'comp',id:'private'},'office')).status,200);assert.ok(n.get('comp','private').apagadoEm);
});
test('Upload: dono não finaliza arquivo truncado, mas conclui arquivo íntegro',async()=>{
 const e=await env('domo-acervo');const a=await e.call('iniciar',{nome:'synthetic.bin',tamanho:4,partes:2},'office');assert.equal(a.status,200);const id=a.body.id;
 assert.equal((await e.call('parte',{id,i:0,dados:'AQI='},'office')).status,200);
 assert.equal((await e.call('finalizar',{id},'office')).status,400);
 assert.equal((await e.call('parte',{id,i:1,dados:'Aw=='},'office')).status,200);
 assert.equal((await e.call('finalizar',{id},'office')).status,400);assert.equal(e.get('_arqmeta',id).pronto,false);
 const b=await e.call('iniciar',{nome:'synthetic-ok.bin',tamanho:4,partes:2},'office');const good=b.body.id;
 for(const [i,dados] of [[0,'AQI='],[1,'AwQ=']]) assert.equal((await e.call('parte',{id:good,i,dados},'office')).status,200);
 assert.equal((await e.call('finalizar',{id:good},'field')).status,403);
 assert.equal((await e.call('finalizar',{id:good},'office')).status,200);assert.equal(e.get('_arqmeta',good).pronto,true);
 assert.equal((await e.call('parte',{id:good,i:0,dados:'AQI='},'office')).status,409);
});
test('Partes: repetição idêntica é aceita; sobrescrita e índice fora da faixa são negados',async()=>{
 const e=await env('domo-acervo');const {body:{id}}=await e.call('iniciar',{nome:'qa',tamanho:2,partes:1},'office');
 assert.equal((await e.call('parte',{id,i:0,dados:'AQI='},'office')).status,200);
 assert.equal((await e.call('parte',{id,i:0,dados:'AQI='},'office')).status,200);
 assert.equal((await e.call('parte',{id,i:0,dados:'AwQ='},'office')).status,409);
 assert.equal((await e.call('parte',{id,i:1,dados:'AQI='},'office')).status,400);
 assert.deepEqual([...e.parts.get(id+'/p0')],[1,2]);
});
test('Arquivo vinculado não é apagado nem pela direção; órfão próprio pode ser removido',async()=>{
 const e=await env('domo-acervo');e.seed('_arqmeta',{id:'linked',partes:1,criadoPorId:'u-office'});e.seed('doc',{id:'d',arquivoId:'linked'});e.parts.set('linked/p0',new Uint8Array([1]));
 assert.equal((await e.call('apagar',{id:'linked'})).status,409);assert.ok(e.get('_arqmeta','linked'));
 e.seed('_arqmeta',{id:'orphan',partes:1,criadoPorId:'u-office'});e.parts.set('orphan/p0',new Uint8Array([1]));assert.equal((await e.call('apagar',{id:'orphan'},'office')).status,200);assert.equal(e.get('_arqmeta','orphan'),undefined);
});
test('Valores inválidos e item inexistente são recusados sem mudar a OC',async()=>{
 const e=await env('domo-nucleo');e.seed('oc',oc);
 for(const registro of [{id:oc.id,frete:-1},{id:oc.id,frete:'Infinity'},{id:oc.id,frete:'abc'},{id:oc.id,recebimentos:[{id:'x',itens:[{itemId:'unknown',qtd:1}]}]}]) {
  const r=await save(e,'oc',registro);assert.equal(r.body.salvos.length,0);assert.equal(r.body.recusados.length,1);
 }
 assert.equal(e.get('oc',oc.id).frete,undefined);assert.equal(e.get('oc',oc.id).recebimentos.length,0);
});
test('Medições simultâneas: uma confirmada, outra recusada; nunca duplo faturamento',async()=>{
 const e=await env('domo-nucleo');e.seed('os',{id:'os',situacao:'emitida',itens:[{id:'i',qtd:1,preco:1000}],medicoes:[]});e.concurrent('os',2);
 const r=await Promise.all(['a','b'].map(id=>save(e,'os',{id:'os',medicoes:[med(id,1,20)]})));
 assert.equal(r.flatMap(x=>x.body.salvos).length,1);assert.equal(r.flatMap(x=>x.body.recusados).length,1);assert.equal(e.get('os','os').medicoes.length,1);
});
test('Medição seguinte valida acumulado, totais e protege o que já foi pago',async()=>{
 const e=await env('domo-nucleo');const first={...med('m1',1,40),situacao:'paga'};e.seed('os',{id:'os',itens:[{id:'i',qtd:1,preco:1000}],medicoes:[first]});
 const stale=await save(e,'os',{id:'os',medicoes:[med('m2',2,50,20)]});assert.equal(stale.body.recusados.length,1);
 const missing=med('m2',2,50,40);delete missing.bruto;assert.equal((await save(e,'os',{id:'os',medicoes:[missing]})).body.recusados.length,1);
 assert.equal((await save(e,'os',{id:'os',medicoes:[{...first,liquido:0}]})).body.recusados.length,1);
 assert.equal((await save(e,'os',{id:'os',medicoes:[med('m2',2,50,40)]})).body.salvos.length,1);assert.equal(e.get('os','os').medicoes.length,2);
});
test('Cotação pública concorrente preserva as duas respostas e não revela concorrentes',async()=>{
 const e=await env('domo-nucleo');e.seed('cot',{id:'c',situacao:'aberta',itens:[{id:'i',qtd:1}],fornecedores:[{id:'a',nome:'A',token:'ta'},{id:'b',nome:'B',token:'tb'}]});e.concurrent('cot',2);
 const rs=await Promise.all(['a','b'].map((id,i)=>e.call('responderCotacao',{id:'c',t:'t'+id,precos:{i:10+i},frete:1},'')));
 assert.ok(rs.every(r=>r.status===200));assert.deepEqual(e.get('cot','c').fornecedores.map(f=>f.total),[11,12]);
});
test('Backup com falha interrompe toda limpeza',async()=>{
 const e=await env('domo-rotina');e.state.backupError=true;e.seed('doc',{id:'old',apagadoEm:'2020-01-01'});e.seed('_arqmeta',{id:'orphan',criadoEm:'2020-01-01',partes:1});e.parts.set('orphan/p0',new Uint8Array([1]));
 const r=await e.call('run');assert.equal(r.status,503);assert.equal(r.body.limpezaInterrompida,true);assert.ok(e.get('doc','old'));assert.ok(e.get('_arqmeta','orphan'));assert.equal(e.parts.has('orphan/p0'),true);
});
test('Restauração recompõe configuração e sequência sem apagar credenciais',async()=>{
 const e=await env('domo-nucleo');const hash=e.cfg.senhaHash;const users=structuredClone(e.cfg.usuarios);
 const r=await e.call('restaurar',{registros:[{_col:'sc',id:'r',numero:2}],cfg:{empresa:{nome:'Empresa sintética restaurada'},senhaHash:'bad',usuarios:[]},seq:{ultimo_sc:{n:78}}});
 assert.equal(r.status,200);assert.equal(e.cfg.empresa.nome,'Empresa sintética restaurada');assert.equal(e.state.seq.ultimo_sc.n,78);assert.equal(e.cfg.senhaHash,hash);assert.deepEqual(e.cfg.usuarios,users);assert.equal(r.body.arquivosRestaurados,false);
});
test('Base de revisão barra edição escalar antiga e permite união de recebimentos',async()=>{
 const e=await env('domo-nucleo');e.seed('oc',{...oc,_revisao:'r0',atualizadoEm:'2026-10-23T00:00:00.000Z'});
 const base={_baseExistente:true,_baseRevisao:'r0',_baseAtualizadoEm:'2026-10-23T00:00:00.000Z'};
 assert.equal((await save(e,'oc',{...base,id:oc.id,nf:'NF-NEW'})).body.salvos.length,1);
 const revision=e.get('oc',oc.id)._revisao;assert.notEqual(revision,'r0');
 assert.equal((await save(e,'oc',{...base,id:oc.id,nf:'NF-OLD'})).body.recusados.length,1);assert.equal(e.get('oc',oc.id).nf,'NF-NEW');
 const r=await save(e,'oc',{...base,id:oc.id,recebimentos:[{id:'a',itens:[{itemId:'i',qtd:3}]}]});assert.equal(r.body.salvos.length,1);assert.equal(e.get('oc',oc.id).nf,'NF-NEW');
});
test('Registro legado sem timestamp ganha revisão e protege próxima edição',async()=>{
 const e=await env('domo-nucleo');e.seed('doc',{id:'d',nome:'Original'});const base={_baseExistente:true,_baseRevisao:null,_baseAtualizadoEm:null};
 const r=await save(e,'doc',{...base,id:'d',nome:'Primeira'});assert.equal(r.body.salvos.length,1);assert.ok(r.body.confirmados[0]._revisao);
 assert.equal((await save(e,'doc',{...base,id:'d',nome:'Segunda'})).body.recusados.length,1);assert.equal(e.get('doc','d').nome,'Primeira');
});
test('Compromisso encaminhado confirma id sem devolver dados privados ao antigo dono',async()=>{
 const e=await env('domo-nucleo');e.seed('comp',{id:'c',dono:'u-office',titulo:'Synthetic'});
 const r=await save(e,'comp',{id:'c',dono:'u-field'},'office');assert.equal(r.body.salvos.length,0);assert.equal(r.body.recusados.length,0);assert.equal(r.body.confirmados.length,1);assert.equal(r.body.confirmados[0].id,'c');assert.equal(r.body.confirmados[0].titulo,undefined);assert.equal(e.get('comp','c').dono,'u-field');
});
test('Recebimento integral fecha solicitação ligada preservando CAS esperado',async()=>{
 const e=await env('domo-nucleo');e.seed('sc',{id:'s',situacao:'em compra',ocIds:[oc.id],historico:[]});e.seed('oc',{...oc,scIds:['s']});
 const r=await save(e,'oc',{id:oc.id,recebimentos:[{id:'r',itens:[{itemId:'i',qtd:10}]}]},'field');assert.equal(r.body.salvos.length,1);assert.equal(e.get('oc',oc.id).situacao,'entregue');assert.equal(e.get('sc','s').situacao,'atendida');
});
test('Cotação e medição usam arredondamento monetário por linha',async()=>{
 const e=await env('domo-nucleo');e.seed('cot',{id:'c',situacao:'aberta',itens:[{id:'a',qtd:1},{id:'b',qtd:1}],fornecedores:[{id:'f',token:'t'}]});
 const r=await e.call('responderCotacao',{id:'c',t:'t',precos:{a:1.005,b:1.005},frete:0},'');assert.equal(r.body.total,2.02);
 e.seed('os',{id:'s',itens:[{id:'a',qtd:1,preco:10.075}],medicoes:[]});
 const m={id:'m',numero:1,situacao:'rascunho',itens:[{itemId:'a',perc:100,percAnterior:0,valorPeriodo:10.08}],bruto:10.08,retencaoPerc:0,retencao:0,descontos:[],liquido:10.08};assert.equal((await save(e,'os',{id:'s',medicoes:[m]})).body.salvos.length,1);
});
test('Amortização considera inicial e lançamentos, mas recusa consumo além do disponível',async()=>{
 const e=await env('domo-nucleo');e.seed('os',{id:'os',itens:[{id:'i',qtd:1,preco:1000}],adiantamento:100,adiantamentos:[{id:'a',valor:50}],medicoes:[]});
 const mk=valor=>({...med('m',1,100),descontos:[{tipo:'adiantamento',valor}],liquido:950-valor});
 assert.equal((await save(e,'os',{id:'os',medicoes:[mk(151)]})).body.recusados.length,1);
 assert.equal((await save(e,'os',{id:'os',medicoes:[mk(150)]})).body.salvos.length,1);
});
test('Base antiga não reescreve entrada de lista já editada em outro aparelho',async()=>{
 const e=await env('domo-nucleo');e.seed('doc',{id:'d',_revisao:'new',anexos:[{id:'a',nome:'Atual',arquivoId:'f'}]});
 const r=await save(e,'doc',{id:'d',_baseRevisao:'old',anexos:[{id:'a',nome:'Antigo',arquivoId:'f'}]});assert.equal(r.body.recusados.length,1);assert.equal(e.get('doc','d').anexos[0].nome,'Atual');
});
test('Fotos acrescentadas ao mesmo recebimento por dois aparelhos permanecem vinculadas',async()=>{
 const e=await env('domo-nucleo');const r={id:'r',itens:[{itemId:'i',qtd:5}],fotos:[]};e.seed('oc',{...oc,_revisao:'r0',recebimentos:[r]});
 for(const foto of ['foto-a','foto-b']) {const out=await save(e,'oc',{id:oc.id,_baseRevisao:'r0',recebimentos:[{...r,fotos:[foto]}]},'field');assert.equal(out.body.salvos.length,1);}
 assert.deepEqual(e.get('oc',oc.id).recebimentos[0].fotos,['foto-a','foto-b']);
});
test('Cliente legado recebe erro HTTP preservável antes de qualquer gravação do lote',async()=>{
 const e=await env('domo-nucleo');e.seed('doc',{id:'d',nome:'Original',_revisao:'atual'});
 const itens=[{colecao:'doc',registro:{id:'d',nome:'Edição antiga'}},{colecao:'sc',registro:{id:'new',situacao:'nova'}}];
 for (const protocoloEnvio of [undefined,1,'2',3]) {
  const r=await e.call('salvarLote',{itens,...(protocoloEnvio===undefined?{}:{protocoloEnvio})});
  assert.equal(r.status,426);assert.equal(r.body.atualizacaoNecessaria,true);
  assert.equal(r.body.semPermissao,undefined);assert.equal(r.body.recusados,undefined);assert.equal(r.body.salvos,undefined);assert.equal(r.body.confirmados,undefined);
  assert.equal(e.get('doc','d').nome,'Original');assert.equal(e.get('sc','new'),undefined);
 }
});
test('OC valida IPI e ICMS percentuais reais, preservando valores monetários legados',async()=>{
 const e=await env('domo-nucleo');
 for(const [indice,campos] of [{ipiPerc:-5},{icmsPerc:'abc'},{ipiPerc:101},{icmsPerc:'Infinity'}].entries()) {
  const id='invalid-tax-'+indice;const r=await save(e,'oc',{id,itens:[{id:'i',qtd:1,preco:100}],...campos,total:100,totalLiquido:95});
  assert.equal(r.body.salvos.length,0);assert.equal(r.body.recusados.length,1);assert.equal(e.get('oc',id),undefined);
 }
 const r=await save(e,'oc',{id:'valid-tax',itens:[{id:'i',qtd:1,preco:1000}],ipiPerc:15,icmsPerc:20,ipi:150,icms:200,total:1000,totalLiquido:1350});
 assert.equal(r.body.salvos.length,1);assert.equal(e.get('oc','valid-tax').ipi,150);assert.equal(e.get('oc','valid-tax').icms,200);
});
