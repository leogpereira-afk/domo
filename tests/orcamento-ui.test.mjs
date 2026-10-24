import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {env} from './helpers/server-env.mjs';

const budget = () => ({
  origem:{hash:'synthetic-hash',totalCentavos:3000}, grupos:[],
  servicos:[
    {item:'02.01',descricao:'Synthetic B',quantidade:1,custoUnitario:20,totalCentavos:2000},
    {item:'01.02',descricao:'Synthetic A',quantidade:1,custoUnitario:10,totalCentavos:1000},
  ],revisoes:[],vinculos:[],anexos:[],
});
function ui() {
  const context={structuredClone,crypto:{randomUUID:()=>"synthetic-event"},window:{},TELAS:{},S:{
    cfg:{obras:[{id:'one',nome:'Synthetic One',ativa:true},{id:'two',nome:'Synthetic Two'},
      {id:'inactive',ativa:false}]},reg:{orc:[]}},
    esc:x=>String(x),perfilAtual:()=> 'escritorio',
    lista:col=>context.S.reg[col]||[],setTimeout,clearTimeout};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../orcamento-model.js',import.meta.url),'utf8'),context);
  let source=fs.readFileSync(new URL('../orcamento.js',import.meta.url),'utf8');
  // Expose lexical helpers only inside this VM; production has no test API.
  source=source.replace('window.renderizarOrcamento=renderizarOrcamento;',
    'window.testUI={activeWorks,prepareImport,attachmentMeta,pdfAttachmentId,filtered,bindFilters,st,priorityQueue,geral,save,statusSave,itemForm,linkForm,scenarioSnapshot,scenarios,modal,importFile};window.setTestModal=f=>{modal=f;};window.renderizarOrcamento=renderizarOrcamento;');
  vm.runInContext(source,context);
  return {context,api:context.window.testUI};
}

test('UI import selects configured active works, imports empty list and a second work, refuses duplicate/invalid work',()=>{
  const {context,api}=ui();
  assert.deepEqual(Array.from(api.activeWorks(),x=>x.id),['one','two']);
  const raw=budget();raw.origem.pdfLocal=true;raw.criadoPor='synthetic-preview';
  const first=api.prepareImport(raw,'one');
  assert.equal(first.origem.pdfLocal,undefined);
  assert.equal(first.criadoPor,undefined);
  assert.equal(raw.origem.pdfLocal,true);
  assert.equal(first.id,'orc-one-synthetic-hash');
  assert.equal(raw.obraId,undefined);
  context.S.reg.orc.push(first);
  assert.throws(()=>api.prepareImport(raw,'one'),/já importado/);
  const second=api.prepareImport(raw,'two');
  assert.equal(second.id,'orc-two-synthetic-hash');
  assert.throws(()=>api.prepareImport(raw,''),/obra ativa/);
  assert.throws(()=>api.prepareImport(raw,'inactive'),/obra ativa/);
});

test('UI attachment metadata owns an actual office upload after budget save/reload; field download is refused',async()=>{
  const {api}=ui(),e=await env('domo-acervo');
  const start=await e.call('iniciar',{nome:'synthetic.pdf',mime:'application/pdf',tamanho:2,partes:1},'office');
  assert.equal(start.status,200);
  const id=start.body.id;
  assert.equal((await e.call('parte',{id,i:0,dados:'AQI='},'office')).status,200);
  const finish=await e.call('finalizar',{id},'office');
  assert.equal(finish.status,200);
  const record=api.prepareImport(budget(),'one');
  record.anexos=[api.attachmentMeta(finish.body.meta||{id}, {name:'synthetic.pdf'})];
  assert.equal(record.anexos[0].arquivoId,id);
  const nucleus=await env('domo-nucleo',{state:e.state});
  const saved=await nucleus.call('salvarLote',{protocoloEnvio:2,itens:[{colecao:'orc',registro:record}]},'office');
  assert.equal(saved.body.salvos.length,1);
  const reloaded=nucleus.get('orc',record.id);
  assert.equal(reloaded.anexos[0].arquivoId,id);
  const download=await e.call('baixarParte',{id,i:0},'office');
  assert.equal(download.status,200);
  assert.equal(download.body.dados,'AQI=');
  assert.equal((await e.call('baixarParte',{id,i:0},'field')).status,403);
  assert.equal(api.pdfAttachmentId({...record,anexos:[{arquivoId:id,mime:'application/pdf'}]}),id);
  assert.equal(api.pdfAttachmentId({...record,anexos:[{id,mime:'application/pdf'}]}),id);
});

test('UI EAP defaults to natural item order while ABC and cost sort retain descending amounts',()=>{
  const {api}=ui(),o=budget();
  assert.deepEqual(Array.from(api.filtered(o),x=>x.item),['01.02','02.01']);
  assert.deepEqual(Array.from(api.filtered(o,true),x=>x.item),['02.01','01.02']);
  api.st.sort='custo';
  assert.deepEqual(Array.from(api.filtered(o),x=>x.item),['02.01','01.02']);
});

test('UI live text filter debounces and restores focus/caret after render',async()=>{
  const {context,api}=ui();let renders=0,focused=false,range;
  const input={dataset:{filter:'busca'},value:'Synthetic',selectionStart:4,tagName:'INPUT'};
  context.render=()=>{renders++;};
  context.document={querySelector:()=>({focus:()=>{focused=true;},setSelectionRange:(...x)=>{range=x;}})};
  api.bindFilters({querySelectorAll:()=>[input]});
  input.oninput();input.oninput();
  await new Promise(resolve=>setTimeout(resolve,240));
  assert.equal(renders,1);assert.equal(api.st.busca,'Synthetic');
  assert.equal(focused,true);assert.deepEqual(range,[4,4]);
});


test('UI bases use original, vigente and consolidated across table and overview without mixing values',()=>{
 const {context,api}=ui(),o={...budget(),id:'qa-budget',obraId:'one',validacoes:[]};
 o.consolidacoes=[context.Orcamento.criarEvento(o,'01.02','consolidado',{id:'event-one',em:'2026-10-24T12:00:00Z',por:'QA',responsavel:'QA',evidencia:'Fonte sintética conferida',quantidade:2,custoUnitario:10})];
 api.st.base='vigente';assert.equal(api.filtered(o).reduce((s,x)=>s+x.totalCentavos,0),4000);
 assert.match(api.geral(o),/4[0],00/);
 api.st.base='original';assert.equal(api.filtered(o).reduce((s,x)=>s+x.totalCentavos,0),3000);
 api.st.base='consolidado';assert.equal(api.filtered(o).reduce((s,x)=>s+x.totalCentavos,0),2000);assert.equal(api.filtered(o).length,1);
 assert.equal(o.servicos[1].totalCentavos,1000);
});

test('UI queue prioritizes an explicit blocker before greater cost and does not equate empty validations to approved',()=>{
 const {context,api}=ui(),o={...budget(),id:'qa-budget',obraId:'one',validacoes:[{id:'v',item:'01.02',titulo:'Conferir fonte',impeditiva:true,status:'pendente'}]};
 const queue=api.priorityQueue(o);assert.equal(queue.length,2);assert.equal(queue[0].item,'01.02');assert.ok(queue[0].blocks.length);assert.equal(queue[1].state.consolidado,false);
});

test('UI retains open edit on conflict and saves independent changes against the current record',async()=>{
 const {context,api}=ui(),o={...budget(),id:'qa-budget',obraId:'one',validacoes:[]};
 let writes=0,base;context.achar=()=>o;context.toast=()=>{};context.salvarOrcamento=async(next,opts)=>{writes++;base=opts.baseRegistro;return next;};
 context.consolidarEdicaoOrcamento=()=>({registro:o,conflitos:[{caminho:'nome',local:'A',remoto:'B'}]});
 await assert.rejects(()=>api.save(o,{...o,nome:'A'}),/mesmo campo/);assert.equal(writes,0);
 context.consolidarEdicaoOrcamento=(base,local)=>({registro:local,conflitos:[]});
 await api.save(o,{...o,nome:'A'});assert.equal(writes,1);assert.equal(base,o);
});

// Execute the production modal/submit handler; this tiny DOM double only supplies its controls.
function modalDOM(context){
 const input={name:'nome',value:'Nome completo ainda no formulário',type:'text',focus(){}},submitButton={disabled:false},closeButton={},error={textContent:''},status={textContent:'',after(){}},conflicts={innerHTML:''};
 const form={elements:[input],inert:false,querySelector(selector){return ({'.ob-draft-state':status,'.ob-error':error,'.ob-conflicts':conflicts,'button[type=submit]':submitButton})[selector]||input;},
   querySelectorAll(selector){return selector==='button[type=submit]'?[submitButton]:selector==='input,select,textarea,button[type=submit]'?[input,submitButton]:[];}};
 const state={closed:false,renders:0,toasts:[],removed:0,writes:0};
 const layer={querySelector:selector=>selector==='form'?form:closeButton,addEventListener(){},remove(){state.closed=true;}};
 context.document={createElement:()=>layer,body:{append(){}},activeElement:input};
 context.FormData=class extends Map{constructor(f){super(f.elements.map(x=>[x.name,x.value]));}};
 context.render=()=>{state.renders++;};context.toast=(...args)=>state.toasts.push(args);
 context.lerRascunhoOrcamento=async()=>null;
 context.gravarRascunhoOrcamento=async()=>{state.writes++;};
 context.removerRascunhoOrcamento=async()=>{state.removed++;};
 return {form,input,submitButton,closeButton,error,state};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('production budget modal waits for durable commit before discarding draft, closing or reporting success',async()=>{
 const {context,api}=ui(),o={...budget(),id:'qa-budget',obraId:'one',validacoes:[]},d=modalDOM(context);
 let finish,started=false;
 context.achar=()=>o;context.salvarOrcamento=next=>{started=true;return new Promise(resolve=>{finish=()=>resolve(next);});};
 api.modal('Editar orçamento','',f=>api.save(o,{...o,nome:f.get('nome')}),null,null,{draft:{chave:'qa-draft'}});
 await tick();
 const running=d.form.onsubmit({preventDefault(){}});await tick();
 assert.equal(started,true);assert.equal(d.form.inert,true);assert.equal(d.submitButton.disabled,true);
 assert.equal(d.state.closed,false);assert.equal(d.state.removed,0);assert.equal(d.state.toasts.length,0);assert.equal(d.state.renders,0);
 await d.closeButton.onclick();assert.equal(d.state.closed,false);
 finish();await running;
 assert.equal(d.state.closed,true);assert.equal(d.state.removed,1);assert.equal(d.state.toasts.length,1);assert.equal(d.state.renders,1);
});

test('production budget modal keeps all fields and draft after durable storage rejection',async()=>{
 const {context,api}=ui(),o={...budget(),id:'qa-budget',obraId:'one',validacoes:[]},d=modalDOM(context);
 let reject;context.achar=()=>o;context.salvarOrcamento=()=>new Promise((resolve,no)=>{reject=no;});
 api.modal('Editar orçamento','',f=>api.save(o,{...o,nome:f.get('nome')}),null,null,{draft:{chave:'qa-draft'}});
 await tick();const running=d.form.onsubmit({preventDefault(){}});await tick();
 reject(Error('Não foi possível preservar o diário: disco sem espaço'));await running;
 assert.equal(d.state.closed,false);assert.equal(d.state.removed,0);assert.equal(d.state.renders,0);assert.equal(d.state.toasts.length,0);
 assert.equal(d.input.value,'Nome completo ainda no formulário');assert.match(d.error.textContent,/disco sem espaço/);
 assert.equal(d.form.inert,false);assert.equal(d.submitButton.disabled,false);assert.ok(d.state.writes>0);
});

test('private import awaits durable save before selecting the imported budget',async()=>{
 const {context,api}=ui();let callback,finish;
 context.window.setTestModal((title,html,submit)=>{callback=submit;return {};});
 context.salvarOrcamento=()=>new Promise(resolve=>{finish=resolve;});
 await api.importFile({text:async()=>JSON.stringify(budget())});
 const saving=callback(new Map([['obraId','one']]));await tick();
 assert.equal(api.st.id,'');finish();await saving;assert.equal(api.st.id,'orc-one-synthetic-hash');
});


test('UI empty quantity or price cannot zero an approved item, and reopening requires an explicit consolidation choice',()=>{
 const {context,api}=ui(),o={...budget(),id:'qa-budget',obraId:'one',validacoes:[],consolidacoes:[]};
 context.perfilAtual=()=> 'direcao';
 o.consolidacoes.push(context.Orcamento.criarEvento(o,'01.02','consolidado',{id:'old',em:'2026-10-24',por:'QA',responsavel:'QA',evidencia:'Fonte sintética conferida'}));
 let form;context.window.setTestModal((...args)=>{form=args;return {};});api.itemForm(o,'01.02');
 assert.match(form[1],/<option value="em-conferencia" selected>/);
 assert.doesNotMatch(form[1],/<option value="consolidado" selected>/);
 assert.match(form[1],/name="quantidade"[^>]+required/);
 for(const field of ['quantidade','custoUnitario']){
   const values=new Map(Object.entries({estado:'consolidado',responsavel:'QA',evidencia:'Fonte conferida',motivo:'',quantidade:'1',custoUnitario:'10',[field]:''}));
   assert.throws(()=>form[2](values),/campo vazio não é zero/);
 }
 assert.equal(context.Orcamento.itens(o,'vigente').find(x=>x.item==='01.02').totalCentavos,1000);
});

test('UI validation responsible filter does not silently filter the item table',()=>{
 const {api}=ui();api.st.responsavel='Equipe sintética';assert.equal(api.filtered(budget()).length,2);
});

test('UI missing linked source remains visibly selected instead of silently choosing another source',()=>{
 const {context,api}=ui(),o={...budget(),id:'qa-budget',obraId:'one',vinculos:[{id:'old-link',col:'oc',registroId:'missing',item:'01.02',etapa:'contratado',valorCentavos:1000}]};
 context.S.reg.oc=[{id:'other',obraId:'one',codigo:'OC-sintética'}];
 const form={elements:{col:{value:'oc'},registroId:{innerHTML:''}},persistDraft:()=>Promise.resolve()};
 context.window.setTestModal(()=>form);api.linkForm(o,'old-link');
 assert.match(form.elements.registroId.innerHTML,/<option value="missing" selected>Origem anterior indisponível/);
 assert.match(form.elements.registroId.innerHTML,/<option value=""\s*>Selecione/);
 assert.doesNotMatch(form.elements.registroId.innerHTML,/<option value="other" selected>/);
});


test('UI scenarios preserve creation totals separately from later vigente simulations',()=>{
 const {context,api}=ui(),o={...budget(),id:'qa-budget',obraId:'one',validacoes:[],consolidacoes:[]},changes=[{item:'01.02',quantidade:3}];
 const snap=api.scenarioSnapshot(o,changes);
 assert.equal(snap.baseTotalCentavos,3000);assert.equal(snap.totalCentavos,5000);assert.equal(snap.deltaAtualCentavos,2000);
 o.cenarios=[{id:'scenario-qa',nome:'Scenario',alteracoes:changes,baseVersao:context.Orcamento.versao(o),simulacaoCriada:snap}];
 o.consolidacoes.push(context.Orcamento.criarEvento(o,'01.02','consolidado',{id:'approved',em:'2026-10-24',por:'QA',responsavel:'QA',evidencia:'Fonte conferida',quantidade:3,custoUnitario:10}));
 const html=api.scenarios(o);assert.match(html,/Na criação/);assert.match(html,/diferença R[^<]*20,00/);assert.match(html,/Hoje/);assert.match(html,/vigente mudou/);assert.equal(snap.deltaAtualCentavos,2000);
 delete o.cenarios[0].simulacaoCriada;assert.match(api.scenarios(o),/Valores da criação não registrados/);
});
