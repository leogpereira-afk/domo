// Prévia inteiramente local. Nenhuma leitura/escrita na conta real.
// Usa os handlers corrigidos com IO em memória e registros fictícios.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {env} from '../tests/helpers/server-env.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const port=Number(process.env.PORT || 5516);
const nuc=await env('domo-nucleo');
const acervo=await env('domo-acervo',{state:nuc.state});
const hash=s=>createHash('sha256').update(s).digest('hex');
const now=new Date().toISOString(), day=now.slice(0,10);
const budgetPath=process.env.DOMO_BUDGET_SEED;
const budgetPdf=process.env.DOMO_BUDGET_PDF;
const statePath=process.env.DOMO_PREVIEW_STATE;
for(const privatePath of [budgetPath,budgetPdf,statePath].filter(Boolean)){
 if(path.resolve(privatePath).startsWith(path.resolve(root)+path.sep))throw new Error('Dados privados da prévia devem ficar fora do repositório.');
}
const budget=budgetPath?JSON.parse(await fs.readFile(budgetPath,'utf8')):null;
Object.assign(nuc.cfg,{
  senhaHash:hash(hash('demo-direcao')),
  empresa:{nome:'Construtora de Demonstração',nomeCurto:'Domo · prévia local',endereco:'Endereço fictício para demonstração',cnpj:'',email:''},
  assinaturas:{diretor:{nome:'Responsável de demonstração',crea:'',cargo:'Direção'},engenheiro:{nome:'',crea:''}},
  obras:[{id:'obra-demo',nome:'Obra de demonstração',endereco:'Endereço fictício de referência para conferir leitura em telas pequenas',ativa:true}],
  usuarios:[['direcao','Direção de demonstração'],['escritorio','Escritório de demonstração'],['obra','Equipe de demonstração']].map(([perfil,nome])=>({id:'demo-'+perfil,nome,perfil,ativo:true,hash:hash(hash('demo-'+perfil))}))
});
function seed(col,reg){nuc.seed(col,{criadoEm:now,atualizadoEm:now,criadoPor:'Demonstração',historico:[],...reg});}
const parceiro={id:'forn-demo',nome:'Fornecedor de demonstração',categorias:'Material de construção',ativo:true};
seed('forn',parceiro);
seed('prest',{id:'prest-demo',nome:'Prestador de demonstração',especialidade:'Instalações',ativo:true,documentos:[],equipe:[]});
seed('sc',{id:'sc-demo',codigo:'SC-DEMO',obraId:'obra-demo',situacao:'nova',solicitante:'Equipe de demonstração',necessidade:day,setor:'Estrutura',itens:[{id:'material-demo',descricao:'Material para conferência de quantidade decimal',qtd:0.125,unid:'m³'}],observacoes:'Registro fictício para testar edição e sincronização.'});
seed('oc',{id:'oc-demo',codigo:'OC-DEMO',obraId:'obra-demo',situacao:'emitida',fornecedorId:parceiro.id,fornecedor:parceiro,dataEmissao:day,entregaPrevista:day,itens:[{id:'item-demo',descricao:'Material demonstrativo',qtd:12.5,preco:2.5,unid:'m'}],total:31.25,totalLiquido:31.25,frete:0,desconto:0,recebimentos:[],anexos:[],scIds:[]});
seed('os',{id:'os-demo',codigo:'OS-DEMO',obraId:'obra-demo',situacao:'andamento',empreiteiro:{id:'prest-demo',nome:'Prestador de demonstração'},dataInicio:day,itens:[{id:'serv-demo',descricao:'Serviço demonstrativo',qtd:10,preco:100,unid:'m²'}],retencaoPerc:5,adiantamento:100,adiantamentos:[{id:'adi-demo',valor:50,data:day}],medicoes:[],diario:[],anexos:[]});
seed('cot',{id:'cot-demo',codigo:'CT-DEMO',obraId:'obra-demo',situacao:'aberta',itens:[{id:'cot-item',descricao:'Material demonstrativo',qtd:10,unid:'un'}],fornecedores:[],scIds:[]});
seed('crono',{id:'crono-demo',codigo:'CR-DEMO',obraId:'obra-demo',nome:'Cronograma demonstrativo',etapas:[],responsaveis:[]});
seed('comp',{id:'comp-demo',titulo:'Conferir recebimento de demonstração',dono:'demo-direcao',tipo:'visita',data:day,hora:'10:00',feito:false,descricao:'Compromisso fictício para testar formulários e recarga.',anexos:[]});
seed('permuta',{id:'permuta-demo',nome:'Permuta de demonstração sem lançamentos',parceiro:'Parceiro demonstrativo',obraId:'obra-demo',ordens:[],lancamentos:[]});
seed('pessoa',{id:'pessoa-demo',nome:'Colaborador de demonstração',cargo:'Função demonstrativa',ativo:true,documentos:[],pagamentos:[],asos:[],ferias:[]});
seed('doc',{id:'doc-demo',nome:'Documento demonstrativo',tipo:'Outros',validadeEm:day,numero:'DEMO',obraId:'obra-demo'});
seed('doc',{id:'lixeira-demo',nome:'Documento fictício com nome extenso para verificar a tabela da lixeira no celular',tipo:'Outros',apagadoEm:now,apagadoPor:'Usuário de demonstração'});
seed('proj',{id:'proj-demo',nome:'Projeto demonstrativo sem arquivo real',disciplina:'Arquitetônico',obraId:'obra-demo',revisao:'R00',versoes:[]});
if(budget){
 nuc.cfg.obras.push({id:budget.obraId,nome:budget.nome,endereco:budget.origem.endereco||'',ativa:true});
 seed('orc',budget);
 if(statePath){
  try{
   const saved=JSON.parse(await fs.readFile(statePath,'utf8'));
   if(saved.hash!==budget.origem.hash)throw new Error('A cópia da prévia pertence a outro orçamento.');
   for(const row of saved.rows||[])seed(row.colecao,row.registro);
   for(const [key,bytes] of saved.parts||[])nuc.parts.set(key,Uint8Array.from(bytes));
  }catch(e){if(e.code!=='ENOENT')throw e;}
 }
}
let stateWrite=Promise.resolve();
async function preservePreview(){
 if(!statePath||!budget)return;
 const payload=JSON.stringify({hash:budget.origem.hash,rows:[...nuc.rows.values()],parts:[...nuc.parts].map(([k,v])=>[k,[...v]])});
 stateWrite=stateWrite.then(async()=>{await fs.writeFile(statePath+'.tmp',payload,{mode:0o600});await fs.rename(statePath+'.tmp',statePath);});
 await stateWrite;
}
function budgetAccess(req){return ['demo-direcao','demo-escritorio'].some(password=>req.headers['x-senha']===hash(password));}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
// Lista explícita: config.js nunca é lido do disco. Segredos, fontes de
// servidor, diretório Git e arquivos fora do pacote público são inacessíveis.
const publicFiles=new Set(['tests/offline-browser.html','index.html','styles.css','store.js','ui.js','pdf.js','compras.js','acervo.js','cotacao.js','cronograma.js','qualificacao.js','compromissos.js','servicos.js','rh.js','permutas.js','drive.js','app.js','orcamento.js','orcamento-model.js','orcamento.css','libs/jspdf.umd.min.js','manifest.webmanifest','logo-domo-branco.png','logo-domo.png','logo-domo-azul.png']);
const server=http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,`http://127.0.0.1:${port}`);
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'none'; frame-src 'none'");
  if(u.pathname==='/config.js'){
   res.setHeader('Content-Type',mime['.js']);
   res.end("const TOKEN='synthetic-token';const SUPABASE_URL=location.origin;const API=SUPABASE_URL+'/functions/v1/domo-nucleo';const API_ARQ=SUPABASE_URL+'/functions/v1/domo-acervo';const VERSAO='prévia local';");return;
  }
  if(u.pathname==='/preview-budget-source'){
   if(req.method!=='POST'||!budget||!budgetPdf){res.writeHead(404).end();return;}
   if(!budgetAccess(req)){res.writeHead(403).end('Sem acesso');return;}
   res.setHeader('Content-Type','application/pdf');res.end(await fs.readFile(budgetPdf));return;
  }
  if(u.pathname.startsWith('/functions/v1/')){
   if(req.method!=='POST'){res.writeHead(405).end();return;}
   const body=[];for await(const c of req)body.push(c);
   if(u.pathname.endsWith('domo-drive')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({conectado:false,configurado:false,semRaiz:true,previa:true}));return;}
   const handler=u.pathname.endsWith('domo-acervo')?acervo.handler:u.pathname.endsWith('domo-nucleo')?nuc.handler:null;
   if(!handler){res.writeHead(404).end();return;}
   const response=await handler(new Request(u,{method:'POST',headers:req.headers,body:Buffer.concat(body)}));
   await preservePreview();
   res.statusCode=response.status;res.setHeader('Content-Type','application/json');res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(u.pathname==='/preview-state.json'){if(budget&&!budgetAccess(req)){res.writeHead(403).end();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify([...nuc.rows.values()]));return;}
  let pathname=decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname);
  if(pathname.includes('..')||(!publicFiles.has(pathname.slice(1))&&!/^\/icons\/[a-zA-Z0-9_-]+\.png$/.test(pathname))){res.writeHead(404).end();return;}
  let data=await fs.readFile(path.join(root,pathname));
  if(pathname==='/app.js') data=Buffer.from(data.toString().replace("if ('serviceWorker' in navigator)", 'if (false)'));
  if(pathname==='/index.html') data=Buffer.from(data.toString().replace('<body>',`<body style="padding-bottom:42px"><aside style="position:fixed;z-index:150;bottom:0;left:0;right:0;padding:6px 12px;background:#12395f;color:white;font:12px system-ui;text-align:center">PRÉVIA LOCAL · ${budget?'Orçamento do PDF · Demais cadastros fictícios':'Dados fictícios'} · Não publicada · Senha: demo-direcao</aside>`));
  res.setHeader('Content-Type',mime[path.extname(pathname)]||'application/octet-stream');res.end(data);
 }catch(e){res.writeHead(e.code==='ENOENT'?404:500,{'Content-Type':'text/plain'}).end(e.code==='ENOENT'?'Não encontrado':'Erro na prévia local');console.error(e.message);}
});
server.listen(port,'127.0.0.1',()=>console.log(`Prévia local: http://127.0.0.1:${port}/ · senha demo-direcao · dados sintéticos em memória`));
