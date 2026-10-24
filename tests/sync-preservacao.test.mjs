import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import {env} from './helpers/server-env.mjs';
const root = new URL('../', import.meta.url);
const source=fs.readFileSync(new URL('store.js',root),'utf8');
const app=fs.readFileSync(new URL('app.js',root),'utf8');
function storage({data=new Map(), fail=()=>false}={}) {
 return {data,get length(){return data.size},key(i){return [...data.keys()][i]??null},getItem(k){return data.get(k)??null},setItem(k,v){if(fail(k,String(v),data))throw new DOMException('Quota exceeded','QuotaExceededError');data.set(k,String(v))},removeItem(k){data.delete(k)}};
}
function make({ls=storage(),online=false,api=async()=>{throw new Error('NETWORK_UNAVAILABLE')},files=[],indexedDB}={}) {
 const warnings=[],events=[],toasts=[],timers=[],uploads=[],listeners={};
 const c={console:{warn:(...x)=>warnings.push(x.join(' '))}, navigator:{onLine:online},localStorage:ls,indexedDB,structuredClone,
  document:{hidden:false,addEventListener(){},dispatchEvent:e=>events.push({type:e.type,detail:e.detail})},
  window:{addEventListener:(name,cb)=>listeners[name]=cb}, CustomEvent:class{constructor(type,opts={}){this.type=type;this.detail=opts.detail}},
  setInterval(){},setTimeout(fn,ms){timers.push({fn,ms});return 1},clearTimeout(){},
  toast:(...x)=>toasts.push(x),API:'https://example.invalid/api',TOKEN:'synthetic',API_ARQ:'https://example.invalid/arq',
  File,Blob,AbortController,TextEncoder,btoa,atob,crypto:globalThis.crypto,location:{hash:''},render(){},__api:api,__files:files,__uploads:uploads};
 vm.createContext(c);vm.runInContext(source,c,{filename:'store.js'});
 vm.runInContext(fs.readFileSync(new URL('orcamento-model.js',root),'utf8'),c);
 vm.runInContext(`globalThis.__uploadOriginal=enviarArquivo;globalThis.__comFilaOriginal=comFila;
 api=(...args)=>__api(...args);
 comFila=async(modo,fn)=>{const st={getAll:()=>({result:__files.map(x=>({...x}))}),delete:id=>{const i=__files.findIndex(x=>x.id===id);if(i>=0)__files.splice(i,1);return {result:undefined}},put:item=>{const i=__files.findIndex(x=>x.id===item.id);if(i>=0)__files[i]={...item};else __files.push({...item});return {result:item.id}}};const r=fn(st);return r?.result};
 enviarArquivo=async file=>{__uploads.push({name:file.name,who:S.quem});return {id:'uploaded-synthetic'}};
 globalThis.test={S,K,salvar,lerCache,gravarFila,gravarCache,subirFila,puxar,subirArquivosPendentes,fotosAindaNoAparelho,anexarFoto};`,c);
 const fn=app.slice(app.indexOf('async function sincronizarAgora()'),app.indexOf('// Sair = trocar'));
 const logout=app.slice(app.indexOf('function limparAparelho()'),app.indexOf('function cabecalho('));
 vm.runInContext(fn+'\n'+logout+'\nglobalThis.test.sincronizarAgora=sincronizarAgora;globalThis.test.limparAparelho=limparAparelho;',c);
 c.test.S.quem='QA Auditor';c.test.S.perfil='direcao';c.test.S.senhaHash='synthetic';c.test.S.usuarioId='qa-user';
 return {...c.test,c,warnings,events,toasts,timers,uploads,ls,files,listeners};
}
function record(id,extra={}){return {id,nome:'QA-'+id,nota:'informacao sintetica completa',...extra};}
function loginReload(ctx){ctx.ls.setItem(ctx.K.senha,'synthetic');ctx.ls.setItem(ctx.K.usuario,'qa-user');ctx.ls.setItem(ctx.K.quem,'QA Auditor');const r=make({ls:ctx.ls});r.lerCache();return r;}
function remoteApi(server=new Map()){return async(action,b)=>{if(action==='salvarLote'){const salvos=b.itens.map(x=>({...x.registro,_col:x.colecao}));salvos.forEach(x=>server.set(x.id,x));return{salvos};}return{registros:[...server.values()]};};}
function photo(extra={}){return {id:'PHOTO',blob:new Blob(['synthetic']),nome:'qa.jpg',mime:'image/jpeg',colecao:'oc',registroId:'OC',subLista:'recebimentos',subId:'RCPT',campo:'fotos',...extra};}
function own(ctx,item){return {...item,dono:vm.runInContext('typeof donoFila === "function" ? donoFila() : "qa-owner"',ctx.c)};}

test('quota failure rejects save before caller closes or updates the record',()=>{const ctx=make({ls:storage({fail:k=>k==='domo_cache_v1'||k.startsWith('domo_fila')})});let closed=false;assert.throws(()=>{ctx.salvar('forn',record('FULL'),{semSubir:true});closed=true;},/memória|guardar|salv/i);assert.equal(closed,false);assert.equal(ctx.S.reg.forn.length,0);assert.equal(loginReload(ctx).S.fila.length,0);});
test('independent offline tabs keep both durable operations',()=>{const ls=storage(),a=make({ls}),b=make({ls});a.salvar('forn',record('A'),{semSubir:true});b.salvar('forn',record('B'),{semSubir:true});const r=loginReload(a);assert.deepEqual(Array.from(r.S.fila,x=>x.registro.id).sort(),['A','B']);});
test('interleaved single-key writes cannot replace a whole shared queue',()=>{const ls=storage(),a=make({ls}),b=make({ls});let interleave=true;const original=ls.setItem.bind(ls);ls.setItem=(k,v)=>{if(k.startsWith('domo_fila')&&interleave){interleave=false;b.salvar('forn',record('B'),{semSubir:true});}original(k,v);};a.salvar('forn',record('A'),{semSubir:true});assert.deepEqual(Array.from(loginReload(a).S.fila,x=>x.registro.id).sort(),['A','B']);});
test('simultaneous edits of same record remain recoverable instead of silently overwriting',async()=>{const ls=storage(),a=make({ls}),b=make({ls});a.salvar('forn',record('SAME',{nota:'first'}),{semSubir:true});b.salvar('forn',record('SAME',{nota:'second'}),{semSubir:true});const r=loginReload(a);assert.equal(r.S.fila.length,2);r.c.navigator.onLine=true;let sends=0;r.c.__api=async()=>{sends++;return{salvos:[]}};await r.subirFila();assert.equal(sends,0);assert.equal(r.S.fila.length,2);});
test('same-tab repeated edit replaces only its observed predecessor',()=>{const ctx=make();ctx.salvar('forn',record('SAME',{nota:'first'}),{semSubir:true});ctx.salvar('forn',{...ctx.S.reg.forn[0],nota:'second'},{semSubir:true});const r=loginReload(ctx);assert.equal(r.S.fila.length,1);assert.equal(r.S.fila[0].registro.nota,'second');});
test('legacy queue migration is idempotent and preserves full records',()=>{const ls=storage({data:new Map([['domo_fila_v1',JSON.stringify([{colecao:'forn',registro:record('OLD')},{colecao:'forn',registro:record('SEQ'),seq:20}])],['domo_senha','synthetic'],['domo_usuario','qa-user']])}),a=make({ls});a.lerCache();a.lerCache();const r=loginReload(a);assert.equal(r.S.fila.length,2);assert.equal(r.S.fila.find(x=>x.registro.id==='OLD').registro.nota,'informacao sintetica completa');});
test('network failure keeps pending data across reload',async()=>{const a=make({online:true});a.salvar('forn',record('NET'),{semSubir:true});await a.subirFila();assert.equal(loginReload(a).S.fila[0].registro.id,'NET');});
test('acknowledgement of in-flight old edit does not delete new edit',async()=>{let finish;const ctx=make({online:true,api:async(action,b)=>new Promise(resolve=>finish=()=>resolve({salvos:b.itens.map(x=>({...x.registro,_col:x.colecao}))}))});ctx.salvar('forn',record('EDIT',{nota:'old'}),{semSubir:true});const sending=ctx.subirFila();await Promise.resolve();ctx.salvar('forn',record('EDIT',{nota:'new'}),{semSubir:true});finish();await sending;assert.equal(loginReload(ctx).S.fila[0].registro.nota,'new');});
test('partial/unconfirmed response never clears the unacknowledged record',async()=>{const a=make({online:true,api:async()=>({salvos:[]})});a.salvar('forn',record('MISSING'),{semSubir:true});await a.subirFila();assert.equal(loginReload(a).S.fila.length,1);});
test('refused record survives old timestamp, new snapshot and reload',async()=>{const a=make({online:true,api:async(action,b)=>action==='salvarLote'?{recusados:b.itens.map(x=>({colecao:x.colecao,id:x.registro.id,motivo:'synthetic denial'})),salvos:[]}:{registros:[]}});a.salvar('forn',record('DENIED'),{semSubir:true});await a.subirFila();a.S.reg.forn[0].atualizadoEm='2000-01-01T00:00:00Z';await a.puxar();const r=loginReload(a);assert.equal(r.S.fila.length,1);assert.equal(r.S.reg.forn[0]._recusado,'synthetic denial');});
test('manual sync does not claim success after failed download',async()=>{const a=make({online:true});await a.sincronizarAgora();assert.equal(a.toasts.at(-1)[1],'ruim');assert(!a.toasts.at(-1)[0].includes('Tudo em dia'));});
test('cache unavailability preserves the local journal even after server confirmation',async()=>{const a=make({ls:storage({fail:k=>k==='domo_cache_v1'}),online:true,api:remoteApi()});a.salvar('forn',record('CACHE'),{semSubir:true});assert.equal(await a.subirFila(),false);assert.equal(a.S.fila.length,1);assert.match(a.S.erroCache,/offline|aparelho/i);assert.equal(loginReload(a).S.reg.forn[0].id,'CACHE');});
test('missing parent keeps photo queued and prevents orphan upload',async()=>{const a=make({online:true});a.files.push(own(a,photo()));await a.subirArquivosPendentes();assert.equal(a.uploads.length,0);assert.equal(a.files.length,1);});
test('missing child keeps photo queued and prevents orphan upload',async()=>{const a=make({online:true});a.S.reg.oc=[{id:'OC',recebimentos:[]}];a.files.push(own(a,photo()));await a.subirArquivosPendentes();assert.equal(a.uploads.length,0);assert.equal(a.files.length,1);});
test('cold reload loads parent before uploading and durably confirms attachment link',async()=>{const parent={id:'OC',_col:'oc',recebimentos:[{id:'RCPT',fotos:[],fotosPendentes:1}]},server=new Map([['OC',parent]]),a=make({online:true,api:remoteApi(server)});a.files.push(own(a,photo()));await a.puxar();assert.equal(a.uploads.length,1);assert.equal(a.files.length,0);assert.deepEqual(Array.from(server.get('OC').recebimentos[0].fotos),['uploaded-synthetic']);});
test('failed link save retains uploaded id without duplicate upload on retry',async()=>{let fail=true;const a=make({online:true,api:async(action,b)=>{if(fail)throw Error('NETWORK');return remoteApi()(action,b);}});a.S.reg.oc=[{id:'OC',recebimentos:[{id:'RCPT',fotos:[],fotosPendentes:1}]}];a.files.push(own(a,photo()));await a.subirArquivosPendentes();assert.equal(a.files.length,1);assert.equal(a.files[0].arquivoId,'uploaded-synthetic');fail=false;await a.subirArquivosPendentes();assert.equal(a.uploads.length,1);assert.equal(a.files.length,0);});
test('logout preserves owned drafts but another user cannot upload or see them',async()=>{const a=make({online:true});a.salvar('forn',record('PRIVATE'),{semSubir:true});a.files.push(own(a,photo()));a.limparAparelho();a.S.senhaHash='other';a.S.usuarioId='other-user';a.S.quem='Other';await a.subirArquivosPendentes();assert.equal(a.uploads.length,0);assert.equal(a.files.length,1);const r=loginReload(a);assert.equal(r.S.fila.length,1);assert.equal(r.S.fila[0].registro.id,'PRIVATE');});
test('unowned legacy photo remains quarantined for explicit recovery',async()=>{const a=make({online:true,files:[photo()]});a.S.reg.oc=[{id:'OC',recebimentos:[{id:'RCPT',fotos:[]}]}];await a.subirArquivosPendentes();assert.equal(a.uploads.length,0);assert.equal(a.files.length,1);});
test('legacy source remains available and acknowledged items are not re-imported',async()=>{const ls=storage({data:new Map([['domo_fila_v1',JSON.stringify([{colecao:'forn',registro:record('OLD')}])],['domo_senha','synthetic'],['domo_usuario','qa-user']])}),a=make({ls,online:true,api:remoteApi()});a.lerCache();await a.subirFila();assert(ls.getItem('domo_fila_v1'));const r=loginReload(a);assert.equal(r.S.fila.length,0);});
test('old rejection after a replacement must not resurrect discarded predecessor',async()=>{let finish;const a=make({online:true,api:async(action,b)=>new Promise(resolve=>finish=()=>resolve({salvos:[],recusados:b.itens.map(x=>({colecao:x.colecao,id:x.registro.id,motivo:'old rejection'}))}))});a.salvar('forn',record('EDIT',{nota:'old'}),{semSubir:true});const request=a.subirFila();await Promise.resolve();a.salvar('forn',{...a.S.reg.forn[0],nota:'new'},{semSubir:true});finish();await request;assert.equal(a.S.fila.length,1);assert.equal(a.S.fila[0].registro.nota,'new');a.c.__api=remoteApi();await a.subirFila();assert.equal(loginReload(a).S.fila.length,0);});
test('snapshot received after logout never restores prior private data',async()=>{let finish;const a=make({online:true,api:async()=>new Promise(resolve=>finish=()=>resolve({registros:[{...record('PRIVATE'),_col:'forn'}]}))});const request=a.puxar();await Promise.resolve();await Promise.resolve();a.limparAparelho();finish();await request;assert.equal(a.S.reg.forn.length,0);assert.equal(a.S.senhaHash,'');});
test('stale unauthorized response cannot sign out another session',async()=>{let fail;const a=make({online:true,api:async()=>new Promise((_,reject)=>fail=()=>reject(Object.assign(Error('revoked'),{semSenha:true})))});a.salvar('forn',record('PRIVATE'),{semSubir:true});const request=a.subirFila();await Promise.resolve();a.S.usuarioId='different-user';a.S.senhaHash='new-secret';fail();await request;assert(!a.events.some(e=>e.type==='domo:semsenha'));assert.equal(a.S.erroSync,'');});
test('choosing a conflicting version keeps both previous versions available for recovery',async()=>{const ls=storage(),a=make({ls}),b=make({ls});a.salvar('forn',record('SAME',{nota:'first'}),{semSubir:true});b.salvar('forn',record('SAME',{nota:'second'}),{semSubir:true});const r=loginReload(a);r.c.__choose=r.S.fila.find(f=>f.registro.nota==='first').op;vm.runInContext('resolverPendenciaLocal(__choose)',r.c);assert.equal(r.S.fila.length,1);assert.equal(r.S.fila[0].registro.nota,'first');const backups=vm.runInContext('versoesLocaisPreservadas()',r.c);assert.deepEqual(Array.from(backups,x=>x.registro.nota).sort(),['first','second']);});
test('new records declare absence and repeated offline edits keep the original server base',()=>{const a=make();a.salvar('forn',record('NEW'),{semSubir:true});assert.equal(a.S.fila[0].registro._baseAtualizadoEm,null);const serverRecord=record('EXISTING',{atualizadoEm:'2026-01-01T10:00:00.000Z'});a.S.reg.forn.push(serverRecord);a.salvar('forn',{...serverRecord,nota:'offline1'},{semSubir:true});a.salvar('forn',{...a.S.reg.forn.find(x=>x.id==='EXISTING'),nota:'offline2'},{semSubir:true});assert.equal(a.S.fila.find(x=>x.registro.id==='EXISTING').registro._baseAtualizadoEm,'2026-01-01T10:00:00.000Z');});
test('stale editor submits the base it opened, not the newer snapshot behind it',()=>{const a=make(),old=record('EDIT',{atualizadoEm:'2026-01-01T10:00:00.000Z'});a.S.reg.forn=[{...old,atualizadoEm:'2026-01-02T10:00:00.000Z',nota:'new server'}];a.salvar('forn',{...old,nota:'stale editor'},{semSubir:true});assert.equal(a.S.fila[0].registro._baseAtualizadoEm,old.atualizadoEm);});
test('legacy pending entry without server base remains unknown instead of pretending its local timestamp was confirmed',()=>{const a=make(),old=record('OLD',{atualizadoEm:'2026-01-01T10:00:00.000Z',_pendente:true});a.S.reg.forn=[old];a.salvar('forn',{...old,nota:'edited legacy'},{semSubir:true});assert.equal(Object.hasOwn(a.S.fila[0].registro,'_baseAtualizadoEm'),false);});
test('server revision and explicit existing flag distinguish old records from new ones',()=>{const a=make();a.S.reg.forn=[record('OLD')];a.salvar('forn',{...a.S.reg.forn[0],nota:'changed'},{semSubir:true});assert.equal(a.S.fila[0].registro._baseExistente,true);assert.equal(a.S.fila[0].registro._baseRevisao,null);a.S.reg.forn.push(record('REV',{atualizadoEm:'2026-01-01T00:00:00Z',_revisao:'server-rev'}));a.salvar('forn',{...a.S.reg.forn.find(x=>x.id==='REV'),nota:'changed'},{semSubir:true});assert.equal(a.S.fila.find(x=>x.registro.id==='REV').registro._baseRevisao,'server-rev');});
test('ACK for an in-flight predecessor advances the base of its pending descendant only',async()=>{let finish;const a=make({online:true,api:async(action,b)=>new Promise(resolve=>finish=()=>resolve({salvos:b.itens.map(x=>({...x.registro,_col:x.colecao,atualizadoEm:'server-new-time',_revisao:'server-new-rev'}))}))});a.S.reg.forn=[record('EDIT',{atualizadoEm:'server-old-time',_revisao:'server-old-rev'})];a.salvar('forn',{...a.S.reg.forn[0],nota:'first'},{semSubir:true});const request=a.subirFila();await Promise.resolve();a.salvar('forn',{...a.S.reg.forn[0],nota:'second'},{semSubir:true});a.salvar('forn',{...a.S.reg.forn[0],nota:'third'},{semSubir:true});finish();await request;assert.equal(a.S.fila.length,1);assert.equal(a.S.fila[0].registro._baseRevisao,'server-new-rev');assert.equal(a.S.fila[0].registro.nota,'third');});
test('confirmation without readable record removes the operation and stale private view',async()=>{const a=make({online:true,api:async(action,b)=>({salvos:[],confirmados:b.itens.map(x=>({colecao:x.colecao,id:x.registro.id,atualizadoEm:'server'}))})});a.salvar('comp',record('FORWARDED'),{semSubir:true});await a.subirFila();assert.equal(a.S.fila.length,0);assert.equal(a.S.reg.comp.length,0);});
test('switching session during file persistence must prevent upload with another identity',async()=>{const a=make({online:true});let release;const previous=a.c.comFila;let first=true;a.c.comFila=async(...args)=>{if(first){first=false;await new Promise(resolve=>release=resolve);}return previous(...args)};const request=a.anexarFoto({file:new File(['synthetic'],'qa.jpg'),colecao:'oc',registroId:'OC',subLista:'recebimentos',subId:'RCPT'});await Promise.resolve();a.S.usuarioId='other';a.S.senhaHash='other-secret';release();await request;assert.equal(a.uploads.length,0);assert.equal(a.files.length,1);});
test('explicit reviewed resolution uses the displayed server revision while retaining prior copies',()=>{const a=make();a.S.reg.forn=[record('EDIT',{atualizadoEm:'old-time',_revisao:'old-rev'})];a.salvar('forn',{...a.S.reg.forn[0],nota:'reviewed'},{semSubir:true});a.c.__op=a.S.fila[0].op;vm.runInContext("resolverPendenciaLocal(__op, {id:'EDIT',atualizadoEm:'reviewed-time',_revisao:'reviewed-rev'})",a.c);assert.equal(a.S.fila[0].registro._baseRevisao,'reviewed-rev');assert.equal(a.S.fila[0].registro._baseAtualizadoEm,'reviewed-time');assert.equal(vm.runInContext('versoesLocaisPreservadas().length',a.c),2);});
test('real multipart uploader captures the identity and stops before sending chunks after a session switch',async()=>{const a=make({online:true});const actions=[];a.c.__api=async(action,b,opts)=>{actions.push({action,identity:opts.sessao.senhaHash});if(action==='iniciar'){a.S.usuarioId='another';a.S.senhaHash='another-secret';return{id:'upload'};}return{};};const uploading=a.c.__uploadOriginal(new File(['synthetic'],'qa.jpg'));await assert.rejects(uploading,/sessão mudou/);assert.deepEqual(actions,[{action:'iniciar',identity:'synthetic'}]);});
test('reviewed resolution preserves the exact server snapshot as well as every local version',()=>{const a=make();a.S.reg.forn=[record('EDIT',{atualizadoEm:'old-time',_revisao:'old-rev'})];a.salvar('forn',{...a.S.reg.forn[0],nota:'local choice'},{semSubir:true});a.c.__op=a.S.fila[0].op;a.c.__server={...record('EDIT'),nota:'server version to retain',atualizadoEm:'current-time',_revisao:'current-rev'};vm.runInContext('resolverPendenciaLocal(__op,__server)',a.c);const copies=vm.runInContext('versoesLocaisPreservadas()',a.c);assert.equal(copies.length,2);assert.equal(copies.find(x=>x.origem==='servidor').registro.nota,'server version to retain');assert.equal(copies.find(x=>x.origem==='servidor').registro._revisao,'current-rev');});
test('new client declares durable-refusal protocol on each batch request',async()=>{let body;const a=make({online:true,api:async(action,b)=>{body=b;return remoteApi()(action,b)}});a.salvar('forn',record('PROTOCOL'),{semSubir:true});await a.subirFila();assert.equal(body.protocoloEnvio,2);});
test('a storage event behind an old editor cannot cause it to delete the other tab pending version',()=>{const ls=storage(),a=make({ls}),b=make({ls});const original=record('EDIT',{atualizadoEm:'server-time',_revisao:'server-rev'});a.S.reg.forn=[{...original}];b.S.reg.forn=[{...original}];b.salvar('forn',{...original,nota:'other tab'},{semSubir:true});a.listeners.storage({key:'domo_fila_v2:'+b.S.fila[0].op});a.salvar('forn',{...original,nota:'stale editor'},{semSubir:true});assert.equal(loginReload(a).S.fila.length,2);});

function remembered(ls){ls.setItem('domo_senha','synthetic');ls.setItem('domo_usuario','qa-user');return ls;}
test('full offline snapshot survives localStorage quota and a cold offline reload',async()=>{
 const db=new IDBFactory(),ls=remembered(storage({fail:k=>k==='domo_cache_v1'})),a=make({ls,indexedDB:db});
 a.S.reg.forn=[record('LARGE',{nota:'á'.repeat(6*1024*1024),campos:{valor:12.34,lista:[1,2,3]}})];
 assert.equal(await a.gravarCache(),true);
 const b=make({ls,indexedDB:db});await b.lerCache();
 assert.equal(b.S.reg.forn[0].nota,a.S.reg.forn[0].nota);assert.deepEqual(JSON.parse(JSON.stringify(b.S.reg.forn[0].campos)),{valor:12.34,lista:[1,2,3]});assert.equal(b.S.erroCache,'');
});
test('legacy snapshot migrates intact before freeing its localStorage space',async()=>{
 const db=new IDBFactory(),ls=remembered(storage()),a=make({ls,indexedDB:db});
 const old=JSON.stringify({dono:'usuario:qa-user',reg:{forn:[record('LEGACY')]},cfg:{obras:[]},em:123});ls.setItem(a.K.cache,old);ls.setItem('other-app','preserve');
 await a.lerCache();assert.equal(ls.getItem(a.K.cache),null);assert.equal(ls.getItem('other-app'),'preserve');
 const b=make({ls,indexedDB:db});await b.lerCache();assert.equal(b.S.reg.forn[0].id,'LEGACY');
});
test('unavailable storage never deletes the legacy copy when a new operation fails',async()=>{
 const ls=remembered(storage({fail:k=>k.startsWith('domo_fila')})),a=make({ls});ls.setItem(a.K.cache,'original preserved');
 assert.throws(()=>a.salvar('forn',record('FAIL'),{semSubir:true}));assert.equal(ls.getItem(a.K.cache),'original preserved');
});
test('offline cache plus pending journal reload and synchronize complete records',async()=>{
 const db=new IDBFactory(),ls=remembered(storage({fail:k=>k==='domo_cache_v1'})),a=make({ls,indexedDB:db});
 a.S.reg.forn=[record('EXISTING')];await a.gravarCache();a.salvar('forn',record('PENDING',{valor:19.75,anexos:['synthetic-file']}),{semSubir:true});await a.gravarCache();
 const server=new Map(),b=make({ls,indexedDB:db,online:true,api:remoteApi(server)});await b.lerCache();assert.equal(b.S.reg.forn.length,2);assert.equal(b.S.fila.length,1);await b.subirFila();await b.gravarCache();
 const c=make({ls,indexedDB:db});await c.lerCache();assert.equal(c.S.fila.length,0);assert.equal(c.S.reg.forn.length,2);assert.equal(server.get('PENDING').valor,19.75);assert.equal(c.S.reg.forn.find(x=>x.id==='PENDING').anexos[0],'synthetic-file');assert.equal(c.S.erroCache,'');
});
test('offline snapshots are isolated by account',async()=>{
 const db=new IDBFactory(),ls=remembered(storage()),a=make({ls,indexedDB:db});a.S.reg.forn=[record('PRIVATE')];await a.gravarCache();ls.setItem('domo_usuario','other');
 const b=make({ls,indexedDB:db});await b.lerCache();assert.equal(b.S.reg.forn.length,0);
});
test('failed IndexedDB transaction preserves previous copy and reports incomplete cache',async()=>{
 const db=new IDBFactory(),ls=remembered(storage()),a=make({ls,indexedDB:db});a.S.reg.forn=[record('BEFORE')];await a.gravarCache();
 a.c.bancoCache=async()=>{throw new Error('disk full')};a.S.reg.forn.push(record('AFTER'));assert.equal(await a.gravarCache(),false);assert.match(a.S.erroCache,/offline/);
 const b=make({ls,indexedDB:db});await b.lerCache();assert.equal(b.S.reg.forn[0].id,'BEFORE');
});
test('delayed cache read cannot reveal previous account after session switch',async()=>{
 const db=new IDBFactory(),ls=remembered(storage()),a=make({ls,indexedDB:db});a.S.reg.forn=[record('PRIVATE')];await a.gravarCache();
 const b=make({ls,indexedDB:db});const read=b.lerCache();b.S.usuarioId='other';b.S.reg.forn=[];await read;assert.equal(b.S.reg.forn.length,0);
});
test('migration failure keeps original bytes and other applications untouched',async()=>{
 const ls=remembered(storage()),a=make({ls,indexedDB:new IDBFactory()});const original=JSON.stringify({dono:'usuario:qa-user',reg:{forn:[record('OLD')]},em:1});ls.setItem(a.K.cache,original);ls.setItem('foreign','untouched');a.c.bancoCache=async()=>{throw Error('blocked')};await a.lerCache();assert.equal(ls.getItem(a.K.cache),original);assert.equal(ls.getItem('foreign'),'untouched');assert.equal(a.S.reg.forn[0].id,'OLD');
});
test('ACK never removes the last local journal before IndexedDB commits its replacement',async()=>{
 const db=new IDBFactory(),ls=remembered(storage()),server=new Map(),a=make({ls,indexedDB:db,online:true,api:remoteApi(server)});
 a.salvar('forn',record('ACK-SAFE'),{semSubir:true});await a.gravarCache();a.c.bancoCache=async()=>{throw Error('disk full')};
 assert.equal(await a.subirFila(),false);assert.equal(server.has('ACK-SAFE'),true);assert.equal(a.S.fila.length,1);assert(ls.getItem('domo_fila_v2:'+a.S.fila[0].op));
});
test('activating Domo preserves cached copies belonging to other applications',async()=>{
 const events={},removed=[];let done;const sw=fs.readFileSync(new URL('sw.js',root),'utf8');
 const current=sw.match(/const CACHE = '([^']+)'/)[1];
 vm.runInNewContext(sw,{self:{addEventListener:(name,fn)=>events[name]=fn,clients:{claim:async()=>{}}},caches:{keys:async()=>['domo-shell-v64',current,'central-offline-v1'],delete:async k=>removed.push(k)}});
 events.activate({waitUntil:p=>done=p});await done;assert.deepEqual(removed,['domo-shell-v64']);
});

test('budget aggregate preserves original services, validations and scenarios through offline reload and sync',async()=>{
 const db=new IDBFactory(),ls=remembered(storage()),a=make({ls,indexedDB:db});
 const original={id:'BUDGET-SYNTHETIC',obraId:'synthetic',origem:{hash:'synthetic-sha',totalCentavos:2700},
  servicos:Array.from({length:150},(_,i)=>({item:'test-'+i,descricao:'Descrição sintética integral '.repeat(60),quantidade:0.125,custoUnitario:1.337,totalCentavos:18})),
  paginas:[{pagina:1,texto:'Fonte sintética '.repeat(1000)}],validacoes:[{id:'v',status:'pendente',responsavel:'',historico:[]}],cenarios:[],revisoes:[],vinculos:[],anexos:[]};
 a.S.reg.orc=[structuredClone(original)];await a.gravarCache();
 const edited={...structuredClone(original),validacoes:[{id:'v',status:'em-analise',responsavel:'QA',prazo:'2026-11-10',observacao:'Conferência sintética completa',historico:[{acao:'Edição QA'}]}],cenarios:[{id:'s',nome:'Cenário sintético',alteracoes:[{item:'test-0',quantidade:0.25,custoUnitario:1.337}]}]};
 await a.salvar('orc',edited,{semSubir:true});await a.gravarCache();
 const server=new Map(),b=make({ls,indexedDB:db,online:true,api:remoteApi(server)});await b.lerCache();
 assert.equal(b.S.fila.length,1);assert.equal(b.S.reg.orc[0].servicos.length,150);
 await b.subirFila();await b.gravarCache();
 const c=make({ls,indexedDB:db});await c.lerCache();
 assert.equal(c.S.fila.length,0);assert.equal(c.S.erroCache,'');
 for(const field of ['origem','servicos','paginas','validacoes','cenarios','revisoes','vinculos','anexos']){
  assert.deepEqual(JSON.parse(JSON.stringify(c.S.reg.orc[0][field])),edited[field]);
  assert.deepEqual(JSON.parse(JSON.stringify(server.get(original.id)[field])),edited[field]);
 }
});

test('budget drafts persist repeated form fields and isolate accounts',async()=>{
 const ls=remembered(storage()),db=new IDBFactory(),a=make({ls,indexedDB:db});
 const payload={campos:[{name:'item',value:'1'},{name:'quantidade',value:'2'},{name:'item',value:'2'},{name:'quantidade',value:'3'}],meta:{rowCount:2}};
 a.c.__payload=payload;await vm.runInContext("gravarRascunhoOrcamento('budget/scenario',__payload)",a.c);
 const b=make({ls,indexedDB:db});await b.lerCache();
 assert.deepEqual(JSON.parse(JSON.stringify(await vm.runInContext("lerRascunhoOrcamento('budget/scenario')",b.c))),payload);
 assert.equal((await vm.runInContext('listarRascunhosOrcamento()',b.c)).length,1);
 b.S.usuarioId='other';assert.equal(await vm.runInContext("lerRascunhoOrcamento('budget/scenario')",b.c),null);
 b.S.usuarioId='qa-user';await vm.runInContext("removerRascunhoOrcamento('budget/scenario')",b.c);
 assert.equal(await vm.runInContext("lerRascunhoOrcamento('budget/scenario')",a.c),null);
});
test('budget three-way merge preserves separate item edits and flags the same field',()=>{
 const a=make(),base={id:'B',validacoes:[{id:'v1',responsavel:''},{id:'v2',responsavel:''}],cenarios:[]},local=structuredClone(base),remote=structuredClone(base);
 local.validacoes[0].responsavel='A';remote.validacoes[1].responsavel='B';
 Object.assign(a.c,{__base:base,__local:local,__remote:remote});
 let m=vm.runInContext('consolidarEdicaoOrcamento(__base,__local,__remote)',a.c);
 assert.equal(m.conflitos.length,0);assert.deepEqual(Array.from(m.registro.validacoes,x=>x.responsavel),['A','B']);
 remote.validacoes[0].responsavel='C';m=vm.runInContext('consolidarEdicaoOrcamento(__base,__local,__remote)',a.c);
 assert.equal(m.conflitos.length,1);assert.match(m.conflitos[0].caminho,/v1.*responsavel/);
 a.c.__choice={[m.conflitos[0].caminho]:'remoto'};m=vm.runInContext('consolidarEdicaoOrcamento(__base,__local,__remote,__choice)',a.c);
 assert.equal(m.conflitos.length,0);assert.equal(m.registro.validacoes[0].responsavel,'C');
});
test('budget consolidation joins distinct items but requires review of the same item',()=>{
 const a=make();Object.assign(a.c,{__base:{id:'B',consolidacoes:[]},__local:{id:'B',consolidacoes:[{id:'a',item:'1',estado:'consolidado'}]},__remote:{id:'B',consolidacoes:[{id:'b',item:'2',estado:'consolidado'}]}});
 let m=vm.runInContext('consolidarEdicaoOrcamento(__base,__local,__remote)',a.c);assert.equal(m.conflitos.length,0);assert.equal(m.registro.consolidacoes.length,2);
 a.c.__remote.consolidacoes[0].item='1';m=vm.runInContext('consolidarEdicaoOrcamento(__base,__local,__remote)',a.c);assert.equal(m.conflitos.length,1);
});
test('budget pending chain retains original base and resolution merges independent remote changes',()=>{
 const a=make(),base={id:'B',atualizadoEm:'old',_revisao:'r0',validacoes:[{id:'v1',responsavel:''},{id:'v2',responsavel:''}]};
 a.S.reg.orc=[base];a.salvar('orc',{...structuredClone(base),validacoes:[{id:'v1',responsavel:'A'},{id:'v2',responsavel:''}]},{semSubir:true,baseRegistro:base});
 const first=a.S.reg.orc[0];a.salvar('orc',{...first,nome:'Updated'},{semSubir:true,baseRegistro:first});
 assert.equal(a.S.fila[0].baseRegistro._revisao,'r0');
 a.c.__op=a.S.fila[0].op;a.c.__remote={...structuredClone(base),_revisao:'r1',validacoes:[{id:'v1',responsavel:''},{id:'v2',responsavel:'B'}]};
 vm.runInContext('resolverPendenciaLocal(__op,__remote)',a.c);
 assert.deepEqual(Array.from(a.S.reg.orc[0].validacoes,x=>x.responsavel),['A','B']);
});
test('durable budget attachment survives offline reload and preserves Blob until link ACK',async()=>{
 const files=[],a=make({files});a.S.reg.orc=[{id:'B',anexos:[]}];a.c.__file=new File(['synthetic'],'qa.pdf',{type:'application/pdf'});
 const queued=await vm.runInContext("anexarArquivoDuravel({file:__file,colecao:'orc',registroId:'B'})",a.c);
 assert.equal(queued.pendente,true);assert.equal(files.length,1);assert.equal(a.uploads.length,0);assert.equal(await files[0].blob.text(),'synthetic');
 const b=make({files,ls:a.ls,online:true,api:async()=>{throw Error('NETWORK')}});b.S.reg.orc=[{id:'B',anexos:[]}];await b.subirArquivosPendentes();
 assert.equal(files.length,1);assert.equal(files[0].arquivoId,'uploaded-synthetic');assert.equal(b.S.fila.length,1);
 b.c.__api=remoteApi();await b.subirArquivosPendentes();assert.equal(files.length,0);assert.equal(b.uploads.length,1);assert.equal(b.S.reg.orc[0].anexos[0].arquivoId,'uploaded-synthetic');
});
test('real budget upload uses durable IndexedDB Blob, survives daily cleanup and confirms link after reload',async()=>{
 const acervo=await env('domo-acervo'),nucleo=await env('domo-nucleo',{state:acervo.state});
 const budget={id:'B',obraId:'synthetic',origem:{totalCentavos:100},servicos:[{item:'1',quantidade:1,custoUnitario:1,totalCentavos:100}],validacoes:[],cenarios:[],revisoes:[],vinculos:[],anexos:[]};
 const first=await nucleo.call('salvarLote',{protocoloEnvio:2,itens:[{colecao:'orc',registro:budget}]},'office');assert.equal(first.body.salvos.length,1);
 let linkOffline=true;
 const api=async(action,body,opts={})=>{
   if(action==='salvarLote'&&linkOffline&&body.itens.some(i=>i.registro.anexos?.length))throw Error('NETWORK after upload');
   const e=opts.url?.endsWith('/arq')?acervo:nucleo,r=await e.call(action,body,'office');
   if(r.status>=400)throw Object.assign(Error(r.body.error),{status:r.status});return r.body;
 };
 let full=false;const ls=remembered(storage({fail:()=>full}));full=true;
 const db=new IDBFactory(),a=make({ls,indexedDB:db,online:true,api});a.S.reg.orc=first.body.salvos;
 vm.runInContext('comFila=__comFilaOriginal;enviarArquivo=__uploadOriginal',a.c);a.c.__file=new File(['synthetic document'],'qa.pdf',{type:'application/pdf'});
 const r=await vm.runInContext("anexarArquivoDuravel({file:__file,colecao:'orc',registroId:'B'})",a.c);
 assert.equal(r.pendente,true);assert.ok(r.arquivoId);let files=await vm.runInContext('filaArqListar()',a.c);assert.equal(files.length,1);assert.equal(await files[0].blob.text(),'synthetic document');
 const meta=acervo.get('_arqmeta',r.arquivoId);assert.equal(meta.vinculoPendente.registroId,'B');acervo.seed('_arqmeta',{...meta,criadoEm:'2000-01-01'});
 const routine=await env('domo-rotina',{state:acervo.state});assert.equal((await routine.call('run')).body.arquivosOrfaos,0);
 const b=make({ls,indexedDB:db,online:true,api});vm.runInContext('comFila=__comFilaOriginal;enviarArquivo=__uploadOriginal',b.c);await b.lerCache();
 linkOffline=false;await b.subirArquivosPendentes();files=await vm.runInContext('filaArqListar()',b.c);assert.equal(files.length,0);
 assert.equal(nucleo.get('orc','B').anexos[0].arquivoId,r.arquivoId);assert.equal(acervo.parts.size,1);
 const download=await acervo.call('baixarParte',{id:r.arquivoId,i:0},'office');assert.equal(download.status,200);assert.equal(Buffer.from(download.body.dados,'base64').toString(),'synthetic document');
});
test('real uploader resumes the same initialized upload and stops after finalization changes session',async()=>{
 const a=make({online:true});const actions=[];let resume='';
 a.c.__api=async(action,body)=>{actions.push(action);if(action==='iniciar')return{id:'same-upload',meta:{id:'same-upload'}};if(action==='estadoEnvio')return{meta:{id:'same-upload',pronto:false}};if(action==='parte')throw Object.assign(Error('transient'),{status:400});return{meta:{id:'same-upload'}};};
 await assert.rejects(a.c.__uploadOriginal(new File(['synthetic'],'qa.pdf'),null,null,{onIniciado:id=>{resume=id;}}));assert.equal(resume,'same-upload');
 a.c.__api=async(action)=>{actions.push(action);if(action==='estadoEnvio')return{meta:{id:'same-upload',pronto:false}};if(action==='finalizar'){a.S.usuarioId='other';return{meta:{id:'same-upload'}};}return{};};
 await assert.rejects(a.c.__uploadOriginal(new File(['synthetic'],'qa.pdf'),null,null,{uploadId:resume}),/sessão mudou/);
 assert.equal(actions.filter(x=>x==='iniciar').length,1);
});
test('separate budget drafts from two tabs never overwrite each other',async()=>{
 const ls=remembered(storage()),db=new IDBFactory(),a=make({ls,indexedDB:db}),b=make({ls,indexedDB:db});
 await Promise.all([vm.runInContext("gravarRascunhoOrcamento('B/validation',{value:'one'})",a.c),vm.runInContext("gravarRascunhoOrcamento('B/scenario',{value:'two'})",b.c)]);
 assert.deepEqual(Array.from(await vm.runInContext('listarRascunhosOrcamento()',a.c),x=>x.chave).sort(),['B/scenario','B/validation']);
});
test('budget consolidation preserves the complete interleaved approved prefix',()=>{
 const a=make(),base={id:'B',consolidacoes:[{id:'a1',item:'A'},{id:'b1',item:'B'},{id:'a2',item:'A'}]};
 Object.assign(a.c,{__base:base,__local:{...base,consolidacoes:[...base.consolidacoes,{id:'c1',item:'C'}]},__remote:{...base,consolidacoes:[...base.consolidacoes,{id:'d1',item:'D'}]}});
 const r=vm.runInContext('consolidarEdicaoOrcamento(__base,__local,__remote)',a.c);
 assert.equal(r.conflitos.length,0);assert.deepEqual(Array.from(r.registro.consolidacoes,x=>x.id),['a1','b1','a2','d1','c1']);
});
test('budget successor in flight adopts server-stamped event prefix and keeps its new event',async()=>{
 let finish;const a=make({online:true,api:async(action,body)=>new Promise(resolve=>{finish=()=>resolve({salvos:body.itens.map(x=>({...x.registro,_col:x.colecao,_revisao:'r1',atualizadoEm:'server',consolidacoes:x.registro.consolidacoes.map(c=>({...c,em:'server-time',por:'Server Actor'}))}))});})});
 const base={id:'B',_revisao:'r0',atualizadoEm:'old',consolidacoes:[]};a.S.reg.orc=[base];
 a.salvar('orc',{...base,consolidacoes:[{id:'c1',item:'A',em:'client-time',por:'Local'}]},{semSubir:true,baseRegistro:base});
 const sending=a.subirFila();await Promise.resolve();
 const first=a.S.reg.orc[0];a.salvar('orc',{...first,consolidacoes:[...first.consolidacoes,{id:'c2',item:'B',em:'client-2',por:'Local'}]},{semSubir:true,baseRegistro:first});
 finish();await sending;
 assert.equal(a.S.fila.length,1);assert.equal(a.S.fila[0].registro._baseRevisao,'r1');
 assert.equal(a.S.fila[0].registro.consolidacoes[0].em,'server-time');assert.equal(a.S.fila[0].registro.consolidacoes[0].por,'Server Actor');assert.equal(a.S.fila[0].registro.consolidacoes[1].id,'c2');
 assert.equal(a.S.fila[0].baseRegistro.consolidacoes[0].em,'server-time');
});
test('approved budget ACK remains canonical across cache quota, reload and retry without resending approval',async()=>{
 const nucleus=await env('domo-nucleo');
 const original={id:'ACK-B',obraId:'synthetic',origem:{totalCentavos:100},servicos:[{item:'1',quantidade:1,custoUnitario:1,totalCentavos:100}],validacoes:[],cenarios:[],revisoes:[],consolidacoes:[],vinculos:[],anexos:[]};
 const initial=await nucleus.call('salvarLote',{protocoloEnvio:2,itens:[{colecao:'orc',registro:original}]});assert.equal(initial.body.salvos.length,1);
 let cacheFull=true,sends=0;
 const ls=remembered(storage({fail:k=>cacheFull&&k==='domo_cache_v1'}));
 const api=async(action,body)=>{if(action==='salvarLote')sends++;const r=await nucleus.call(action,body);if(r.status>=400)throw Error(r.body.error);return r.body;};
 const a=make({ls,online:true,api});a.S.reg.orc=initial.body.salvos;
 vm.runInContext(fs.readFileSync(new URL('orcamento-model.js',root),'utf8'),a.c);
 const base=a.S.reg.orc[0];a.c.__base=base;
 const event=vm.runInContext("Orcamento.criarEvento(__base,'1','consolidado',{id:'approval',por:'Client actor',em:'2000-01-01',responsavel:'QA',evidencia:'Synthetic sheet'})",a.c);
 a.salvar('orc',{...base,consolidacoes:[event]},{semSubir:true,baseRegistro:base});
 assert.equal(await a.subirFila(),false);assert.equal(sends,1);
 const canonical=nucleus.get('orc',base.id).consolidacoes[0];assert.notEqual(canonical.em,'2000-01-01');
 assert.equal(a.S.fila[0].confirmado,true);assert.equal(a.S.fila[0].registro.consolidacoes[0].em,canonical.em);
 const b=make({ls,online:true,api});await b.lerCache();assert.equal(b.S.reg.orc[0].consolidacoes[0].em,canonical.em);
 cacheFull=false;b.c.navigator.onLine=false;assert.equal(await b.subirFila(),true);assert.equal(sends,1);assert.equal(b.S.fila.length,0);
 assert.equal(b.S.reg.orc[0].consolidacoes.length,1);assert.equal(nucleus.get('orc',base.id).consolidacoes.length,1);
});

test('large first budget import survives full localStorage through durable IndexedDB journal and offline reload',async()=>{
 let full=false;const ls=remembered(storage({fail:()=>full})),db=new IDBFactory();ls.setItem('other-application','preserve exact bytes');full=true;
 const a=make({ls,indexedDB:db}),original=record('B-LARGE',{servicos:Array.from({length:146},(_,i)=>({item:String(i),descricao:'Synthetic source '.repeat(100)})),paginas:[{pagina:1,texto:'Synthetic complete page '.repeat(10000)}],anexos:[]});
 const saved=await a.salvar('orc',original,{semSubir:true});assert.equal(saved.id,original.id);assert.equal(a.S.fila.length,1);
 const b=make({ls,indexedDB:db});await b.lerCache();assert.equal(b.S.fila.length,1);assert.equal(b.S.reg.orc[0].paginas[0].texto,original.paginas[0].texto);assert.equal(b.S.reg.orc[0].servicos.length,146);
 const server=new Map();b.c.navigator.onLine=true;b.c.__api=remoteApi(server);assert.equal(await b.subirFila(),true);
 const c=make({ls,indexedDB:db});await c.lerCache();assert.equal(c.S.fila.length,0);assert.equal(c.S.reg.orc[0].paginas[0].texto,original.paginas[0].texto);assert.equal(ls.getItem('other-application'),'preserve exact bytes');
});

test('IndexedDB budget journal refuses unavailable durability before publishing edited local state',async()=>{
 const a=make({indexedDB:new IDBFactory()});a.c.indexedDB={open(){throw Error('disk unavailable')}};
 await assert.rejects(async()=>a.salvar('orc',record('B-FAIL'),{semSubir:true}),/guardar|armazen|disk|diário/i);assert.equal(a.S.reg.orc.length,0);assert.equal(a.S.fila.length,0);
});

test('IndexedDB budget operations from two tabs remain separate under localStorage quota',async()=>{
 let full=false;const ls=remembered(storage({fail:()=>full})),db=new IDBFactory();full=true;
 const a=make({ls,indexedDB:db}),b=make({ls,indexedDB:db});
 await Promise.all([a.salvar('orc',record('B',{nota:'first tab'}),{semSubir:true}),b.salvar('orc',record('B',{nota:'second tab'}),{semSubir:true})]);
 const c=make({ls,indexedDB:db,online:true});await c.lerCache();assert.equal(c.S.fila.length,2);let sent=0;c.c.__api=async()=>{sent++;return{salvos:[]}};await c.subirFila();assert.equal(sent,0);
 c.S.usuarioId='another-account';await c.subirFila();assert.equal(c.S.fila.length,0);
 const d=make({ls,indexedDB:db});await d.lerCache();assert.equal(d.S.fila.length,2);
});

test('canonical budget ACK uses IndexedDB journal when both localStorage and offline cache writes fail',async()=>{
 let full=false;const ls=remembered(storage({fail:()=>full})),db=new IDBFactory();full=true;let sends=0;
 const a=make({ls,indexedDB:db,online:true,api:async(action,body)=>{sends++;return{salvos:body.itens.map(x=>({...x.registro,_col:'orc',_revisao:'server-revision',consolidacoes:x.registro.consolidacoes.map(e=>({...e,em:'server-time',por:'Server actor'}))}))}}});
 await a.salvar('orc',{id:'ACK-IDB',consolidacoes:[{id:'approval',item:'1',em:'client-time'}]},{semSubir:true});await a.gravarCache();a.c.bancoCache=async()=>{throw Error('offline cache failed')};
 assert.equal(await a.subirFila(),false);assert.equal(a.S.fila[0].confirmado,true);assert.equal(a.S.fila[0].registro.consolidacoes[0].em,'server-time');
 const b=make({ls,indexedDB:db});await b.lerCache();assert.equal(b.S.reg.orc[0].consolidacoes[0].em,'server-time');assert.equal(await b.subirFila(),true);assert.equal(b.S.fila.length,0);assert.equal(sends,1);
});

test('budget save during account change commits only to its captured owner and never updates the next account',async()=>{
 const ls=remembered(storage()),db=new IDBFactory(),a=make({ls,indexedDB:db});
 const tx=a.c.transacaoDiarioOrc;a.c.transacaoDiarioOrc=async(dono,alterar)=>{const r=await tx(dono,alterar);if(alterar){a.S.usuarioId='other';a.S.reg.orc=[];}return r;};
 await assert.rejects(a.salvar('orc',record('PRIVATE-B'),{semSubir:true}),/acesso anterior/);
 await a.subirFila();assert.equal(a.S.fila.length,0);assert.equal(a.S.reg.orc.length,0);
 const b=make({ls,indexedDB:db});await b.lerCache();assert.equal(b.S.reg.orc[0].id,'PRIVATE-B');assert.equal(b.S.fila.length,1);
});

test('budget recovery cannot copy archived private versions into a newly switched account',async()=>{
 let full=false;const ls=remembered(storage({fail:()=>full})),db=new IDBFactory();full=true;
 const a=make({ls,indexedDB:db}),base={id:'PRIVATE-RECOVERY',_revisao:'r0',atualizadoEm:'old',nome:'before'};a.S.reg.orc=[base];
 await a.salvar('orc',{...base,nome:'local'},{semSubir:true,baseRegistro:base});
 a.c.__op=a.S.fila[0].op;a.c.__remote={...base,_revisao:'r1',nota:'remote addition'};
 const tx=a.c.transacaoDiarioOrc;a.c.transacaoDiarioOrc=async(dono,alterar)=>{const r=await tx(dono,alterar);if(alterar){a.S.usuarioId='other';a.S.reg.orc=[];}return r;};
 await assert.rejects(vm.runInContext('resolverPendenciaLocal(__op,__remote)',a.c),/sessão mudou/);
 await a.subirFila();assert.equal(a.S.fila.length,0);assert.equal(a.S.reg.orc.length,0);
 const b=make({ls,indexedDB:db});await b.lerCache();assert.equal(b.S.fila.length,1);assert.equal(b.S.reg.orc[0].nome,'local');
 assert.equal(vm.runInContext('versoesLocaisPreservadas().length',b.c),2);
});

test('budget legacy localStorage journal migrates once and a stale acknowledged copy is never resent',async()=>{
 let full=false;const ls=remembered(storage({fail:()=>full})),old=make({ls});old.salvar('orc',record('MIGRATE-B'),{semSubir:true});
 const key='domo_fila_v2:'+old.S.fila[0].op,text=ls.getItem(key);ls.setItem('foreign-app','untouched');full=true;
 const db=new IDBFactory(),a=make({ls,indexedDB:db,online:true,api:remoteApi()});await a.lerCache();assert.equal(a.S.fila.length,1);assert.equal(ls.getItem(key),null);
 assert.equal(await a.subirFila(),true);full=false;ls.setItem(key,text);full=true;
 const b=make({ls,indexedDB:db});await b.lerCache();assert.equal(b.S.fila.length,0);assert.equal(b.S.reg.orc[0].id,'MIGRATE-B');assert.equal(ls.getItem('foreign-app'),'untouched');
});

test('IndexedDB budget successor queued during request adopts canonical approval and late editor uses ACK receipt',async()=>{
 let full=false;const ls=remembered(storage({fail:()=>full})),db=new IDBFactory();full=true;
 let finish,started;const began=new Promise(r=>started=r);
 const a=make({ls,indexedDB:db,online:true,api:async(action,body)=>new Promise(resolve=>{finish=()=>resolve({salvos:body.itens.map(x=>({...x.registro,_col:'orc',_revisao:'server-rev',atualizadoEm:'server',consolidacoes:x.registro.consolidacoes.map(e=>({...e,em:'server-time',por:'Server actor'}))}))});started();})});
 const base={id:'B-IDB',_revisao:'r0',atualizadoEm:'old',consolidacoes:[]};a.S.reg.orc=[base];
 const first=await a.salvar('orc',{...base,consolidacoes:[{id:'c1',item:'A',em:'client-time'}]},{semSubir:true,baseRegistro:base});
 const sending=a.subirFila();await began;
 await a.salvar('orc',{...first,consolidacoes:[...first.consolidacoes,{id:'c2',item:'B',em:'client-2'}]},{semSubir:true,baseRegistro:first});
 finish();await sending;assert.equal(a.S.fila.length,1);assert.equal(a.S.fila[0].registro.consolidacoes[0].em,'server-time');assert.equal(a.S.fila[0].registro.consolidacoes[1].id,'c2');assert.equal(a.S.fila[0].registro._baseRevisao,'server-rev');
 // An editor still holding the first client snapshot can save after its ACK.
 const other=make({ls,indexedDB:db});await other.lerCache();
 await other.salvar('orc',{...first,observacao:'late independent change'},{semSubir:true,baseRegistro:first});
 const late=other.S.fila.find(f=>f.registro.observacao);assert.equal(late.registro.consolidacoes[0].em,'server-time');assert.equal(late.registro._baseRevisao,'server-rev');
});

test('temporary budget journal failure never prevents sending unrelated localStorage records',async()=>{
 let sends=0;const a=make({indexedDB:new IDBFactory(),online:true,api:async(action,body)=>{sends++;return remoteApi()(action,body)}});
 a.salvar('forn',record('GENERIC'),{semSubir:true});await a.gravarCache();a.c.indexedDB={open(){throw Error('temporarily unavailable')}};
 await a.subirFila();assert.equal(sends,1);assert.equal(a.S.fila[0].confirmado,true);
});

test('recovered budget journal read clears only its own temporary error and resumes queued data',async()=>{
 const ls=remembered(storage()),db=new IDBFactory(),a=make({ls,indexedDB:db});await a.salvar('orc',record('RESUME'),{semSubir:true});
 const b=make({ls,indexedDB:{open(){throw Error('unavailable')}},online:true,api:remoteApi()});await b.lerCache();assert.match(b.S.erroFila,/diário/);
 b.c.indexedDB=db;assert.equal(await b.subirFila(),true);assert.equal(b.S.erroFila,'');
 b.S.erroFila='Fila antiga ilegível';await b.c.carregarDiarioOrcamento();assert.equal(b.S.erroFila,'Fila antiga ilegível');
});

test('failed IndexedDB ACK commit is reconciled after restart without replaying a signed budget approval',async()=>{
 const nucleus=await env('domo-nucleo'),db=new IDBFactory();let full=false;const ls=remembered(storage({fail:()=>full}));full=true;
 const original={id:'ACK-TRANSACTION',obraId:'synthetic',origem:{totalCentavos:100},servicos:[{item:'1',quantidade:1,custoUnitario:1,totalCentavos:100}],validacoes:[],cenarios:[],revisoes:[],consolidacoes:[],vinculos:[],anexos:[]};
 const initial=await nucleus.call('salvarLote',{protocoloEnvio:2,itens:[{colecao:'orc',registro:original}]});let writes=0;
 const api=async(action,body)=>{if(action==='salvarLote')writes++;return(await nucleus.call(action,body)).body;};
 const a=make({ls,indexedDB:db,online:true,api});a.S.reg.orc=initial.body.salvos;vm.runInContext(fs.readFileSync(new URL('orcamento-model.js',root),'utf8'),a.c);
 const base=a.S.reg.orc[0];a.c.__base=base;const event=vm.runInContext("Orcamento.criarEvento(__base,'1','consolidado',{id:'approval',por:'Client actor',em:'2000-01-01',responsavel:'QA',evidencia:'Synthetic sheet'})",a.c);
 await a.salvar('orc',{...base,consolidacoes:[event]},{semSubir:true,baseRegistro:base});await a.gravarCache();
 a.c.confirmarOperacaoOrc=async()=>{throw Error('ACK disk failure')};assert.equal(await a.subirFila(),false);assert.equal(writes,1);
 const b=make({ls,indexedDB:db,online:true,api});await b.lerCache();assert.equal(await b.subirFila(),true);assert.equal(writes,1);assert.equal(b.S.fila.length,0);
 assert.equal(b.S.reg.orc[0].consolidacoes[0].em,nucleus.get('orc',base.id).consolidacoes[0].em);assert.notEqual(b.S.reg.orc[0].consolidacoes[0].em,'2000-01-01');
});

test('uncertain budget upload retries only after authenticated snapshot proves its original base unchanged',async()=>{
 const nucleus=await env('domo-nucleo'),db=new IDBFactory(),ls=remembered(storage());
 const budget={id:'RETRY-UNCHANGED',obraId:'synthetic',origem:{totalCentavos:100},servicos:[{item:'1',quantidade:1,custoUnitario:1,totalCentavos:100}],validacoes:[],cenarios:[],revisoes:[],consolidacoes:[],vinculos:[],anexos:[]};
 let fail=true,writes=0,reads=0;const api=async(action,body)=>{if(action==='salvarLote'){writes++;if(fail)throw Error('network before server');}if(action==='snapshot')reads++;return(await nucleus.call(action,body)).body;};
 const a=make({ls,indexedDB:db,online:true,api});await a.salvar('orc',budget,{semSubir:true});assert.equal(await a.subirFila(),false);assert.equal(writes,1);
 fail=false;const b=make({ls,indexedDB:db,online:true,api});await b.lerCache();assert.equal(await b.subirFila(),true);assert.equal(reads,1);assert.equal(writes,2);assert.equal(b.S.fila.length,0);assert.equal(nucleus.get('orc',budget.id)._operacaoEnvio, b.S.reg.orc[0]._operacaoEnvio);
});

test('uncertain budget ACK with another remote operation preserves both versions for review without resending',async()=>{
 const nucleus=await env('domo-nucleo'),db=new IDBFactory(),ls=remembered(storage());
 const budget={id:'ACK-OTHER',obraId:'synthetic',origem:{totalCentavos:100},servicos:[{item:'1',quantidade:1,custoUnitario:1,totalCentavos:100}],validacoes:[],cenarios:[],revisoes:[],consolidacoes:[],vinculos:[],anexos:[]};
 let writes=0;const api=async(action,body)=>{if(action==='salvarLote')writes++;return(await nucleus.call(action,body)).body;};
 const a=make({ls,indexedDB:db,online:true,api});await a.salvar('orc',budget,{semSubir:true});a.c.confirmarOperacaoOrc=async()=>{throw Error('ACK disk failure')};assert.equal(await a.subirFila(),false);
 const remote=nucleus.get('orc',budget.id),other={...remote,_baseExistente:true,_baseRevisao:remote._revisao,_baseAtualizadoEm:remote.atualizadoEm,_operacaoEnvio:'other-operation',observacao:'remote independent change'};
 assert.equal((await nucleus.call('salvarLote',{protocoloEnvio:2,itens:[{colecao:'orc',registro:other}]})).body.recusados.length,0);
 const b=make({ls,indexedDB:db,online:true,api});await b.lerCache();assert.equal(await b.subirFila(),false);assert.equal(writes,1);assert.equal(b.S.fila.length,1);assert.match(b.S.fila[0].recusado,/versão do servidor mudou/i);assert.equal(vm.runInContext('versoesLocaisPreservadas().length',b.c),2);assert.equal(nucleus.get('orc',budget.id).observacao,'remote independent change');
});

test('aborted budget IndexedDB transaction preserves predecessor and never reports the replacement saved',async()=>{
 const db=new IDBFactory(),ls=remembered(storage()),a=make({ls,indexedDB:db});const first=await a.salvar('orc',record('ABORT',{nota:'original'}),{semSubir:true});
 const tx=a.c.transacaoDiarioOrc;a.c.transacaoDiarioOrc=(dono,alterar)=>tx(dono,alterar?(mapa,put,del)=>{alterar(mapa,put,del);throw Error('abort after put');}:null);
 await assert.rejects(a.salvar('orc',{...first,nota:'replacement'},{semSubir:true}),/abort after put/);assert.equal(a.S.reg.orc[0].nota,'original');
 const b=make({ls,indexedDB:db});await b.lerCache();assert.equal(b.S.fila.length,1);assert.equal(b.S.reg.orc[0].nota,'original');
});


test('budget merge ignores JSONB key order without dropping signed history or hiding real changes',()=>{
 const a=make(),reverse=x=>Array.isArray(x)?x.map(reverse):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).reverse().map(k=>[k,reverse(x[k])])):x;
 const base={id:'budget',nome:'Synthetic',consolidacoes:[{id:'approved',item:'1',por:'Synthetic',em:'2026-01-01',quantidade:1,totalCentavos:1000}],anexos:[]};
 a.c.__base=base;a.c.__local={...reverse(base),anexos:[{arquivoId:'synthetic-pdf'}]};a.c.__remote={...base,nome:'Changed independently'};
 const merged=vm.runInContext('consolidarEdicaoOrcamento(__base,__local,__remote)',a.c);
 assert.equal(merged.conflitos.length,0);assert.equal(merged.registro.nome,'Changed independently');assert.equal(merged.registro.anexos[0].arquivoId,'synthetic-pdf');
 assert.deepEqual(JSON.parse(JSON.stringify(merged.registro.consolidacoes)),base.consolidacoes);
 a.c.__local.consolidacoes[0].por='Forged';
 const conflict=vm.runInContext('consolidarEdicaoOrcamento(__base,__local,__remote)',a.c);
 assert.equal(conflict.conflitos[0].caminho,'consolidacoes.1');
 assert.deepEqual(JSON.parse(JSON.stringify(conflict.registro.consolidacoes)),base.consolidacoes);
});
