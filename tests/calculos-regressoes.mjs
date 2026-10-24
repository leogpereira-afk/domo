import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { jsPDF } = createRequire(import.meta.url)(ROOT + '/libs/jspdf.umd.min.js');
function harness() {
  const records = {}, notices = [], saved = [], pdfs = [];
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, Blob, Date, Math,
    document: { addEventListener() {}, querySelectorAll() { return []; }, getElementById() { return null; } },
    window: { jspdf: { jsPDF } }, location: { origin: 'http://offline.test', pathname: '/' },
    S: { cfg: { unidades: ['un', 'm³'] }, quem: 'Teste sintético' },
    lista: col => Object.values(records[col] || {}), achar: (col,id) => records[col]?.[id] || null,
    salvar: (col,reg) => { (records[col] ||= {})[reg.id] = reg; saved.push(reg); },
    fetch: () => { throw Error('Rede proibida no teste'); },
    notice: msg => notices.push(msg),
    captureDoc: () => {
      const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true }), texts = [];
      const raw = doc.text.bind(doc);
      doc.text = (text,x,y,opts) => { texts.push({ text: Array.isArray(text) ? text.join('\n') : text, x, y, lines: Array.isArray(text) ? text.length : 1, page: doc.internal.getNumberOfPages(), font: doc.getFontSize() }); return raw(text,x,y,opts); };
      doc.save = name => {
        pdfs.push({ texts, pages: doc.internal.getNumberOfPages() });
        if (process.env.DOMO_PDF_EVIDENCE_DIR) {
          fs.mkdirSync(process.env.DOMO_PDF_EVIDENCE_DIR,{recursive:true});
          fs.writeFileSync(path.join(process.env.DOMO_PDF_EVIDENCE_DIR,name),Buffer.from(doc.output('arraybuffer')));
        }
      };
      return doc;
    }
  });
  for (const file of ['ui.js','compras.js','servicos.js','permutas.js','cotacao.js','pdf.js']) vm.runInContext(fs.readFileSync(ROOT+'/'+file,'utf8'),ctx,{filename:file});
  const run = code => vm.runInContext(code,ctx);
  run('toast=notice; render=()=>{}; fecharEste=()=>{}; historiar=(o,t)=>[...(o.historico||[]),{o_que:t}]; carregarLogo=async()=>null; novoDoc=()=>captureDoc();');
  return { ctx, run, records, notices, saved, pdfs };
}
const plain = obj => JSON.parse(JSON.stringify(obj));

test('editor preserva decimais de três casas e entrada de milhar', () => {
  const {ctx,run} = harness();
  for (const [value,expected] of [['1.200',1200],['1.234,56',1234.56],['1234.56',1234.56],['0,125',0.125]]) assert.equal(run(`numeroBR(${JSON.stringify(value)})`),expected);
  ctx.html = run(`linhaItem({id:'i',descricao:'Sintético',qtd:0.125,preco:1.234},true)`);
  const values = Object.fromEntries([...ctx.html.matchAll(/data-i="([^"]+)"[^>]*value="([^"]*)"/g)].map(x => [x[1],x[2]]));
  ctx.raiz = { querySelectorAll: () => [{ dataset: { id:'i' }, querySelector: s => ({ value: values[s.match(/data-i=(\w+)/)[1]] || '' }) }] };
  assert.deepEqual(plain(run('(()=>{const i=lerItens(raiz,true)[0]; return {qtd:i.qtd,preco:i.preco}})()')), {qtd:0.125,preco:1.234});
  assert.match(run(`entrada('valor',1.234,{inputmode:'decimal'})`), /value="1,234"/);
});
test('editor preserva números pequenos que JavaScript escreve em notação científica', () => {
  const {run} = harness();
  for (const n of [1e-7, 1e-9, 1.25e-7]) assert.equal(run(`numeroBR(numeroParaEntrada(${n}))`),n);
});

test('tabela da OC mostra quantidade e preço unitário completos, com total em centavos', () => {
  const h = harness();
  h.records.oc = { preciso: {id:'preciso',obra:'Obra sintética',situacao:'rascunho',itens:[{id:'i',descricao:'Material sintético',unid:'m',qtd:0.125,preco:1.234}]} };
  h.ctx.el = { innerHTML:'', querySelectorAll:()=>[] };
  h.ctx.document.getElementById=()=>({addEventListener(){}});
  h.run('cabecalho=()=>{}; telaOC(el,"preciso")');
  assert.match(h.ctx.el.innerHTML,/>0,125 m<\/td>/);
  assert.match(h.ctx.el.innerHTML,/>R\$\s1,234<\/td>/);
  assert.match(h.ctx.el.innerHTML,/>R\$\s0,15<\/td>/);
});

for (const type of ['OC','OS']) test(`PDF ${type} conserva precisão de quantidade e preço unitário`, async () => {
  const h = harness();
  h.ctx.order={id:'preciso',codigo:'TESTE-PRECISAO',obra:'Sintética',fornecedor:{nome:'Sintético'},empreiteiro:{nome:'Sintético'},itens:[{id:'i',descricao:'Material sintético',unid:'m',qtd:0.125,preco:1.234}]};
  await h.run(`pdf${type}(order,{})`);
  const texts=h.pdfs[0].texts.map(t=>t.text);
  assert.ok(texts.includes('0,125'));
  assert.ok(texts.some(t=>/^R\$\s1,234$/.test(t)));
  assert.ok(texts.some(t=>/^R\$\s0,15$/.test(t)));
});

test('campos compartilhados e itens têm associação entre rótulo e controle', () => {
  const {run} = harness();
  for (const html of [run(`campo('Valor',entrada('valor',0))`),run(`campo('Obs',areaTexto('obs',''))`),run(`campo('Tipo',seletor('tipo','a',['a']))`),run(`linhaItem({},true)`)]) {
    const ids = [...html.matchAll(/<(?:input|textarea|select)\b[^>]*\bid="([^"]+)"/g)].map(x=>x[1]);
    const count = [...html.matchAll(/<(?:input|textarea|select)\b/g)].length;
    assert.equal(ids.length,count);
    for (const id of ids) assert.ok(html.includes(`for="${id}"`));
  }
});

test('adiantamento inicial é somado aos adicionais, inclusive quando iguais', () => {
  const {run} = harness();
  assert.equal(run(`totaisOS({adiantamento:10000,adiantamentos:[{valor:5000}]}).adiantamento`),15000);
  assert.equal(run(`totaisOS({adiantamento:10000,adiantamentos:[{valor:10000}]}).adiantamento`),20000);
  assert.equal(run(`totaisOS({adiantamento:10000,adiantamentos:[{valor:5000,apagadoEm:'2026-01-01'}]}).adiantamento`),10000);
  assert.equal(run(`totaisOS({adiantamento:10000,adiantamentos:[{valor:5000}],medicoes:[{situacao:'paga',descontos:[{tipo:'adiantamento',valor:4000}]}]}).adiantamentoSaldo`),11000);
});
test('adiantamento explicitamente migrado não é somado duas vezes', () => {
  const {run} = harness();
  assert.equal(run(`totaisOS({adiantamento:10000,adiantamentoInicialId:'a',adiantamentos:[{id:'a',origem:'inicial',valor:10000},{id:'b',valor:5000}]}).adiantamento`),15000);
});

function medicaoHarness() {
  const h = harness();
  h.ctx.oldOS={id:'os',situacao:'andamento',retencaoPerc:0,itens:[{id:'i',descricao:'Etapa sintética',qtd:1,preco:1000}],medicoes:[{id:'m1',numero:1,situacao:'paga',itens:[{itemId:'i',perc:20}],bruto:200,liquido:200}]};
  h.records.os={os:structuredClone(h.ctx.oldOS)};
  h.records.os.os.medicoes.push({id:'m2',numero:2,situacao:'paga',itens:[{itemId:'i',perc:40}],bruto:200,liquido:200});
  const inp={value:'50'}, form={querySelectorAll:()=>[]};
  h.ctx.modal={style:{display:''},querySelector:s=>s==='#fMed'?form:s.startsWith('[data-perc=')?inp:null,querySelectorAll:()=>[]};
  h.ctx.document.querySelectorAll=s=>s==='.fundo-modal'?[h.ctx.modal]:[];
  return h;
}
test('medição pede reconferência, recalcula avanço contra última OS e usa número atual', () => {
  const h=medicaoHarness(); h.run('salvarMedicao(modal,oldOS,2,0)');
  assert.equal(h.saved.length,0); assert.match(h.notices.at(-1),/Recalculamos/);
  h.run('salvarMedicao(modal,oldOS,2,0)');
  assert.equal(h.saved.at(-1)?.medicoes.at(-1).bruto,100);
  assert.deepEqual(plain(h.records.os.os.medicoes.map(m=>m.numero)),[1,2,3]);
  assert.equal(h.saved.at(-1).medicoes.at(-1).itens[0].percAnterior,40);
});
test('medição preserva formulário e rejeita contrato alterado enquanto modal aberto', () => {
  const h=medicaoHarness(); h.records.os.os.itens[0].preco=2000; h.run('salvarMedicao(modal,oldOS,2,0)');
  assert.equal(h.saved.length,0); assert.match(h.notices.at(-1),/contrato.*mudou/i);
});
test('medição rejeita OS encerrada ou excluída enquanto modal aberto', () => {
  for (const change of [{situacao:'cancelada'},{apagadoEm:'2026-01-01'}]) {
    const h=medicaoHarness(); Object.assign(h.records.os.os,change); h.run('salvarMedicao(modal,oldOS,2,0)'); assert.equal(h.saved.length,0);
  }
});
test('medição solicita nova conferência se outra alteração chega depois da primeira conferência', () => {
  const h=medicaoHarness(); h.run('salvarMedicao(modal,oldOS,2,0)');
  h.records.os.os.medicoes.push({id:'m3',numero:3,situacao:'paga',itens:[{itemId:'i',perc:45}],bruto:50,liquido:50});
  h.run('salvarMedicao(modal,oldOS,2,0)'); assert.equal(h.saved.length,0);
  h.run('salvarMedicao(modal,oldOS,2,0)'); assert.equal(h.saved.at(-1).medicoes.at(-1).bruto,50);
  assert.equal(h.saved.at(-1).medicoes.at(-1).numero,4);
});
test('permuta sem movimento é distinta de saldo zerado após movimentos', () => {
  const {run}=harness();
  assert.equal(run(`fraseDoSaldo(resumoDaPermuta({}).saldo,resumoDaPermuta({})).txt`),'sem lançamentos');
  assert.equal(run(`fraseDoSaldo(0,{linhas:[{}],lancamentos:[]}).txt`),'saldo zerado');
});
test('total de cotação sinaliza frete negativo inválido', () => {
  const {run}=harness();
  assert.equal(run(`erroValoresCotacao({precos:{a:100},frete:-150})`),'O frete não pode ser negativo.');
  assert.equal(run(`erroValoresCotacao({precos:{a:100},frete:0})`),'');
});
test('formulário público recusa frete negativo antes da API e preserva campos no reenvio', async () => {
  const h=harness(), calls=[], els={};
  const elem=(id,value='')=>els[id]||=( {value,innerHTML:'',textContent:'',disabled:false,focus(){},addEventListener(e,fn){this[e]=fn;} });
  for (const id of ['rFrete','rTotal','rEnviar','rErro','rPrazo','rCond','rVal','rObs','rContato']) elem(id);
  elem('rFrete').value='-150'; elem('rPrazo').value='5 dias'; elem('rObs').value='Observação sintética integral';
  const preco=elem('preco','100'), cel=elem('total');
  h.ctx.document.getElementById=id=>els[id];
  h.ctx.document.querySelector=s=>s.startsWith('[data-preco=')?preco:cel;
  h.ctx.document.querySelectorAll=s=>s==='[data-preco]'?[preco]:[];
  h.ctx.api=async (action,data)=>{calls.push({action,data}); return action==='verCotacao'?{cotacao:{id:'c',itens:[{id:'i',qtd:1,descricao:'Sintético'}]},minhaResposta:{precos:{}},empresa:{nome:'Sintético'}}:{total:100};};
  h.run('molduraPublica=()=>{};');
  await h.run(`telaCotarPublico(['c','token-sintetico'])`);
  await els.rEnviar.click();
  assert.equal(calls.filter(c=>c.action==='responderCotacao').length,0);
  assert.match(els.rErro.innerHTML,/frete não pode ser negativo/); assert.equal(els.rFrete.value,'-150');
  els.rFrete.value='0'; await els.rEnviar.click();
  const body=calls.find(c=>c.action==='responderCotacao')?.data;
  assert.equal(body.frete,0); assert.equal(body.prazoEntrega,'5 dias'); assert.equal(body.obs,'Observação sintética integral');
});
test('arredondamento monetário é consistente entre OC, OS, cotação e permuta', () => {
  const {run}=harness();
  assert.equal(run('cent(1.005)'),1.01); assert.equal(run('cent(-1.005)'),-1.01);
  assert.equal(run(`totaisOC({itens:[{qtd:1,preco:1.005}]}).totalLiquido`),1.01);
  assert.equal(run(`totaisOS({itens:[{qtd:1,preco:1.005}]}).contrato`),1.01);
  assert.equal(run(`totalCotacao({itens:[{id:'a',qtd:1}]},{precos:{a:1.005}})`),1.01);
  assert.equal(run(`totaisOC({itens:[{qtd:2,preco:100},{qtd:3,preco:10}],ipiPerc:10,icmsPerc:5,frete:20,seguro:5,desconto:10}).totalLiquido`),279.5);
});

for (const type of ['OC','OS','Medicao']) test(`PDF ${type} preserva todas as observações e evita corte de página`, async () => {
  const h=harness();
  h.ctx.notes=Array.from({length:120},(_,i)=>`Nota sintética ${String(i+1).padStart(3,'0')}: informação integral do documento.`).join('\n');
  h.ctx.order={id:'os',codigo:'TESTE-'+type,situacao:'rascunho',fornecedor:{nome:'Sintético'},empreiteiro:{nome:'Sintético'},itens:[{id:'i',descricao:'Sintético',qtd:1,preco:1000}],medicoes:[]};
  await h.run(type==='Medicao'?`pdfMedicao(order,{numero:1,situacao:'rascunho',itens:[],bruto:200,liquido:200,obs:notes},{})`:`pdf${type}({...order,observacoes:notes},{})`);
  const pdf=h.pdfs[0], chunks=pdf.texts.filter(t=>t.text.includes('Nota sintética'));
  assert.ok(pdf.pages>=3); assert.equal(chunks.map(x=>x.text).join('\n').match(/Nota sintética/g)?.length,120);
  assert.ok(chunks.every(t=>t.y+(t.lines-1)*t.font*.352778*1.15<=272));
});
