import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const {jsPDF}=createRequire(import.meta.url)('../libs/jspdf.umd.min.js');
function harness(){
  const documents=[];
  function capture(options){
    const doc=new jsPDF(options),calls=[],raw=doc.text.bind(doc);
    doc.text=(text,x,y,opts)=>{calls.push({text:String(text),x,y,font:doc.getFontSize(),page:doc.internal.getCurrentPageInfo().pageNumber});return raw(text,x,y,opts);};
    doc.save=name=>{
      const bytes=Buffer.from(doc.output('arraybuffer'));
      documents.push({name,bytes,calls,pages:doc.internal.getNumberOfPages()});
      if(process.env.DOMO_PDF_EVIDENCE_DIR){fs.mkdirSync(process.env.DOMO_PDF_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.DOMO_PDF_EVIDENCE_DIR,name),bytes);}
    };
    return doc;
  }
  const c={jspdf:{jsPDF:capture},carregarLogo:async()=>null};c.window=c;vm.createContext(c);
  for(const name of ['orcamento-model.js','orcamento-pdf.js'])vm.runInContext(fs.readFileSync(new URL('../'+name,import.meta.url),'utf8'),c,{filename:name});
  return {c,documents};
}
function fixture(){
  const groups=Array.from({length:15},(_,i)=>({codigo:String(i+1).padStart(2,'0'),nome:'Grupo sintético '+String(i+1).padStart(2,'0'),totalCentavos:1000}));
  return {id:'synthetic-budget',obraId:'synthetic-work',nome:'QA dashboard completo',origem:{arquivo:'fonte-sintetica.pdf',revisao:'R00',base:'Referência sintética',totalCentavos:15000,hash:'0123456789abcdef'.repeat(4),insumosDeclarados:500,composicoesDeclaradas:200},
    grupos:groups,servicos:groups.map(g=>({item:g.codigo+'.01',descricao:'Serviço sintético do grupo '+g.codigo,quantidade:1,custoUnitario:10,totalCentavos:1000,unidade:'m²',pagina:Number(g.codigo)})),
    paginas:Array.from({length:26},(_,i)=>({pagina:i+1,texto:'Texto sintético'})),insumos:[{codigo:'one'}],consolidacoes:[],revisoes:[],vinculos:[],validacoes:Array.from({length:7},(_,i)=>({id:'issue-'+i,titulo:'Pendência completa '+(i+1),item:'01.01',status:'pendente',responsavel:'Responsável QA',observacao:'Observação integral '+(i+1)}))};
}

test('real jsPDF dashboard includes every group, issue, stage, source hash and original/vigente/partial totals',async()=>{
  const {c,documents}=harness(),o=fixture();
  o.consolidacoes.push(c.Orcamento.criarEvento(o,'01.01','consolidado',{id:'approval',em:'2026-10-24T12:00:00Z',por:'Direção QA',responsavel:'Conferência QA',evidencia:'Fonte QA conferida',quantidade:2}));
  o.vinculos=[{id:'valid',item:'01.01',col:'oc',registroId:'source-ok',etapa:'contratado',valorCentavos:1000},
    {id:'missing',item:'02.01',col:'oc',registroId:'source-missing',etapa:'contratado',valorCentavos:2000},
    {id:'paid-zero',item:'01.01',col:'os',registroId:'zero',etapa:'pago',valorCentavos:0}];
  const reg={oc:[{id:'source-ok',codigo:'OC-SYNTHETIC',totalCentavos:1000}],os:[{id:'zero',pagamentos:[{valor:0}]}]},before=JSON.stringify({o,reg});
  const doc=await c.exportarDashboardOrcamento(o,reg),out=documents[0],text=out.calls.map(x=>x.text).join('\n');
  assert.equal(JSON.stringify({o,reg}),before);assert.equal(doc.internal.getNumberOfPages(),out.pages);
  assert.equal(out.bytes.subarray(0,5).toString(),'%PDF-');assert.ok(out.bytes.length>2000);assert.ok(out.pages>1);
  for(let n=1;n<=15;n++)assert.ok(text.includes('Grupo sintético '+String(n).padStart(2,'0')));
  for(let n=1;n<=7;n++){assert.ok(text.includes('Pendência completa '+n));assert.ok(text.includes('Observação integral '+n));}
  for(const label of ['Executivo original','Vigente - soma','Consolidado - últimas','Ainda a consolidar','Recebido - material','Executado','Pago - caixa','Permuta - valor econômico'])assert.ok(text.includes(label));
  assert.match(text,/R\$ 150,00/);assert.match(text,/R\$ 160,00/);assert.match(text,/R\$ 20,00/);assert.match(text,/R\$ 140,00/);
  assert.match(text,/Confirmado: R\$ 10,00 \| A conferir: R\$ 20,00/);
  assert.match(text,/Pago - caixa\nR\$ 0,00/);assert.match(text,/Executado\nNão informado/);
  assert.ok(text.includes(o.origem.hash));assert.match(text,/Páginas de texto preservadas: 26/);
  assert.match(text,/Composições analíticas completas não disponíveis/);assert.match(text,/OC-SYNTHETIC/);assert.match(text,/source-missing/);
  assert.ok(out.calls.every(x=>x.y>=8&&x.y<=288));
});

test('single long description, evidence and history flow across pages without truncation or footer overlap',async()=>{
  const {c,documents}=harness(),o=fixture();
  o.nome='QA paginação longa';
  const long='Trecho extenso de conferência com quantidade, origem e observação integral. '.repeat(180);
  o.servicos[0].descricao=long+'ITEM-FIM-UNICO';
  o.validacoes[0].observacao=long+'PENDENCIA-FIM-UNICO';
  o.validacoes[0].historico=[{em:'2026-10-24',por:'QA',status:'em-analise',evidencia:long+'HISTORICO-FIM-UNICO'}];
  o.consolidacoes.push(c.Orcamento.criarEvento(o,'01.01','em-conferencia',{id:'event',em:'2026-10-24',por:'QA',responsavel:'QA',evidencia:long+'EVIDENCIA-FIM-UNICO'}));
  await c.exportarDashboardOrcamento(o,{});
  const out=documents[0],text=out.calls.map(x=>x.text).join('\n');
  assert.ok(out.pages>6);
  for(const token of ['ITEM-FIM-UNICO','PENDENCIA-FIM-UNICO','HISTORICO-FIM-UNICO','EVIDENCIA-FIM-UNICO'])assert.ok(text.includes(token),token);
  const body=out.calls.filter(x=>x.y>24&&x.y<288).map(x=>x.text).join(' ').replace(/\s+/g,' ');
  assert.equal((body.match(/Trecho extenso de conferência/g)||[]).length,720);
  assert.ok(out.calls.filter(x=>x.y<288).every(x=>x.y<=277));
  for(let n=1;n<=out.pages;n++)assert.ok(out.calls.some(x=>x.page===n&&x.text==='Página '+n+' de '+out.pages));
});

test('empty dashboard distinguishes missing financial records from a declared zero and flags local pending data',async()=>{
  const {c,documents}=harness(),o=fixture();o.nome='QA sem movimentos';o._pendente=true;o.servicos=[];o.grupos=[];o.validacoes=[];o.origem.totalCentavos=0;
  await c.exportarDashboardOrcamento(o,{});
  const text=documents[0].calls.map(x=>x.text).join('\n');
  assert.match(text,/Cópia local com alterações aguardando confirmação/);
  assert.match(text,/Executivo original - total declarado R00\nR\$ 0,00/);
  assert.match(text,/Contratado\nNão informado/);assert.match(text,/Grupos não informados/);
  assert.match(text,/Nenhum serviço informado/);assert.match(text,/Nenhuma pendência documentada/);
  assert.doesNotMatch(text,/100%/);
});
