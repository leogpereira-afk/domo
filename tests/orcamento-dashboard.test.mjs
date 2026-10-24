import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup() {
  const c={structuredClone,window:{},TELAS:{},S:{reg:{}},esc:x=>String(x),setTimeout,clearTimeout};
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(new URL('../orcamento-model.js',import.meta.url),'utf8'),c);
  const source=fs.readFileSync(new URL('../orcamento.js',import.meta.url),'utf8').replace('window.renderizarOrcamento=renderizarOrcamento;',
    'window.testDashboard={geral,priorityQueue,nextActions,st,dashboardBudgetView,filtered};window.renderizarOrcamento=renderizarOrcamento;');
  vm.runInContext(source,c);
  const o={id:'synthetic',obraId:'synthetic-work',origem:{totalCentavos:3100,insumosDeclarados:20,composicoesDeclaradas:8},
    grupos:[{codigo:'01',nome:'Grupo A'},{codigo:'02',nome:'Grupo B'}],
    servicos:[{item:'01.01',descricao:'Serviço A',quantidade:1,custoUnitario:10,totalCentavos:1000,pagina:2},
      {item:'02.01',descricao:'Serviço B',quantidade:1,custoUnitario:20,totalCentavos:2000,pagina:3}],
    consolidacoes:[],validacoes:[],revisoes:[],vinculos:[],insumos:[{codigo:'a'}],paginas:[{pagina:1,texto:'Synthetic'}],anexos:[]};
  return {c,o,...c.window.testDashboard};
}
const cell=(html,id)=>html.match(new RegExp('<(?:a|article)[^>]*data-dashboard="'+id+'"[^>]*>([\\s\\S]*?)</(?:a|article)>'))?.[1]||'';

test('dashboard compares declared R00, vigente and partial consolidation even when charts show the original',()=>{
  const {c,o,geral,st}=setup();
  o.consolidacoes.push(c.Orcamento.criarEvento(o,'01.01','consolidado',{id:'approval',quantidade:2,responsavel:'QA',evidencia:'Synthetic'}));
  st.base='original';
  const html=geral(o);
  assert.match(cell(html,'original'),/31,00/);
  assert.match(cell(html,'vigente'),/40,00/);
  assert.match(cell(html,'consolidado'),/20,00/);
  assert.match(cell(html,'executivo'),/20,00/);
  assert.match(html,/1 de 2 itens/);
  assert.match(html,/Diferença da fonte:[\s\S]*?-R[^<]*1,00/);
});

test('dashboard separates historical finance, confirmed sources, explicit zero and missing information',()=>{
  const {c,o,geral}=setup();
  c.S.reg.oc=[{id:'oc-ok',totalCentavos:1000}];
  c.S.reg.os=[{id:'os-zero',pagamentos:[{valor:0}]}];
  o.vinculos=[{id:'one',item:'01.01',col:'oc',registroId:'oc-ok',etapa:'contratado',valorCentavos:700},
    {id:'missing',item:'02.01',col:'oc',registroId:'oc-missing',etapa:'contratado',valorCentavos:200},
    {id:'zero',item:'01.01',col:'os',registroId:'os-zero',etapa:'pago',valorCentavos:0}];
  const html=geral(o),contract=cell(html,'contratado');
  assert.match(contract,/9,00/);assert.match(contract,/Confirmado[\s\S]*?7,00/);assert.match(contract,/2,00[\s\S]*?conferir/);
  assert.match(cell(html,'pago'),/0,00/);assert.doesNotMatch(cell(html,'pago'),/Não informado/);
  assert.match(cell(html,'executado'),/Não informado/);
  assert.match(html,/#\/compras\/oc-ok/);assert.match(html,/#\/compras\/oc-missing/);
  assert.match(html,/não são somados/);
});

test('dashboard exposes document coverage and routes without implying analytic compositions are available',()=>{
  const {o,geral}=setup(),html=geral(o);
  assert.match(html,/1 página/);assert.match(html,/1 de 20 insumos/);
  assert.match(html,/Composições analíticas[\s\S]*?não disponíveis/);
  assert.match(html,/PDF não vinculado/);
  for(const route of ['documentos','cronograma','cenarios','abc','contratacao','validacoes'])assert.match(html,new RegExp('#/orcamento/'+route));
});

test('action queue retains non-blocking pending work on approved items and respects group/deleted scope',()=>{
  const {c,o,priorityQueue,nextActions}=setup();
  for(const s of o.servicos)o.consolidacoes.push(c.Orcamento.criarEvento(o,s.item,'consolidado',{id:'approval-'+s.item,responsavel:'QA',evidencia:'Synthetic'}));
  o.validacoes=[{id:'group',grupo:'01',titulo:'Documento por grupo',status:'pendente',impeditiva:false,prazo:'2000-01-01'},
    {id:'inactive',item:'02.01',titulo:'Inativa',status:'pendente',prazo:'2000-01-01',inativoEm:'2001-01-01'}];
  const queue=priorityQueue(o);
  assert.equal(queue.length,1);assert.equal(queue[0].item,'01.01');assert.equal(queue[0].late,1);
  const html=nextActions(o);
  assert.match(html,/data-act="validation" data-id="group"/);
  assert.doesNotMatch(html,/Todos os itens estão consolidados/);
});

test('dashboard state links open the exact current subset despite prior table filters',()=>{
  const {c,o,geral,st,dashboardBudgetView,filtered}=setup();c.location={hash:''};
  o.consolidacoes.push(c.Orcamento.criarEvento(o,'01.01','consolidado',{id:'approval',quantidade:2,responsavel:'QA',evidencia:'Synthetic'}));
  o.consolidacoes.push(c.Orcamento.criarEvento(o,'01.01','revisao-solicitada',{id:'review',motivo:'Rever referência',quantidade:9}));
  Object.assign(st,{base:'original',busca:'no match',grupo:'02',status:'other',classe:'Z',page:20});
  dashboardBudgetView('vigente','revisao-solicitada');
  assert.equal(c.location.hash,'#/orcamento/orcamento');assert.equal(st.page,1);
  const xs=filtered(o);assert.equal(xs.length,1);assert.equal(xs[0].item,'01.01');assert.equal(xs[0].totalCentavos,2000);
  assert.match(geral(o),/1 item\(ns\) em revisão/);
  dashboardBudgetView('original');assert.equal(filtered(o).reduce((s,x)=>s+x.totalCentavos,0),3000);
});

test('empty budget does not claim completed consolidation or financial zero',()=>{
  const {o,geral}=setup();o.servicos=[];
  const html=geral(o);
  assert.match(html,/Sem itens para calcular progresso/);
  assert.match(html,/Nenhum serviço informado/);
  assert.doesNotMatch(html,/Todos os itens estão consolidados/);
  assert.match(cell(html,'contratado'),/Não informado/);
});
