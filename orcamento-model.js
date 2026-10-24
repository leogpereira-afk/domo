/* Pure budget calculations shared by the browser, Node and the server. */
(function(root) {
  'use strict';
  const lista=x=>Array.isArray(x)?x:[], igual=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
  const texto=x=>typeof x==='string'&&!!x.trim(), dinheiro=x=>Number.isSafeInteger(x)&&x>=0;
  const decimal=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0, soma=xs=>xs.reduce((s,x)=>s+x.totalCentavos,0);
  const vinculoAtivo=v=>!!v&&!v.apagadoEm&&!v.inativoEm;
  const etapas=['contratado','recebido','executado','pago','permuta','referencia'];
  const colecoes=['sc','cot','oc','os','forn','permuta','doc'];
  const estados=['em-conferencia','aguardando-aprovacao','consolidado','revisao-solicitada'];
  const chaveFonte=v=>[v.col,v.registroId,v.etapa].join('|');
  const fonte=(v,reg)=>lista(reg?.[v.col]).find(r=>r.id===v.registroId&&vinculoAtivo(r));
  function produtoCentavos(q,p) {
    if(![q,p].every(n=>decimal(n)&&n<=Number.MAX_SAFE_INTEGER))throw Error('Quantidade/preço fora dos limites.');
    const fracao=n=>{const [mant,exp='0']=String(n).toLowerCase().split('e');const casas=(mant.split('.')[1]||'').length-Number(exp);return [BigInt(mant.replace('.',''))*(casas<0?10n**BigInt(-casas):1n),10n**BigInt(Math.max(0,casas))];};
    const [a,b]=fracao(q),[c,d]=fracao(p),n=a*c*100n,den=b*d;
    return Number((n*2n+den)/(den*2n));
  }
  // Match the existing OC/OS rounding contract, including half-cent boundaries.
  const brlCentavos=valor=>{const n=Number(valor);if(!Number.isFinite(n))return 0;const [base,exp='0']=Math.abs(n).toString().split('e');return Math.sign(n)*Math.round(Number(base+'e'+(Number(exp)+2)));};
  const alterado=(s,a)=>(a.quantidade!==undefined&&a.quantidade!==s.quantidade)||(a.custoUnitario!==undefined&&a.custoUnitario!==s.custoUnitario);
  function aplicar(xs,as) {
    const mapa=new Map(lista(as).map(a=>[a.item,a]));
    return xs.map(s=>{const a=mapa.get(s.item);if(!a||!alterado(s,a))return {...s};const quantidade=a.quantidade??s.quantidade,custoUnitario=a.custoUnitario??s.custoUnitario;return {...s,quantidade,custoUnitario,totalCentavos:produtoCentavos(quantidade,custoUnitario)};});
  }
  function situacaoItem(orc,item) {
    const historico=lista(orc.consolidacoes).filter(e=>e.item===item),ultimo=historico.at(-1);
    const aprovacao=historico.filter(e=>e.estado==='consolidado').at(-1)||null;
    return {estado:ultimo?.estado||'executivo',consolidado:!!aprovacao,aprovacao,
      proposta:ultimo&&ultimo.estado!=='consolidado'?ultimo:null,responsavel:ultimo?.responsavel||'',evidencia:ultimo?.evidencia||'',
      revisaoEmAndamento:!!aprovacao&&ultimo?.estado!=='consolidado',historico};
  }
  function itens(orc,revisaoId='original') {
    let xs=lista(orc.servicos).map(s=>({...s,grupo:s.grupo||String(s.item).split('.')[0]}));
    if(revisaoId!=='original'){
      const rs=lista(orc.revisoes),vigente=['vigente','consolidado'].includes(revisaoId);
      const fim=vigente?rs.length-1:rs.findIndex(r=>r.id===revisaoId);
      for(let i=0;i<=fim;i++)xs=aplicar(xs,rs[i].alteracoes);
      if(vigente){
        // Pending proposals never replace approved amounts.
        const aprovados=new Map(lista(orc.consolidacoes).filter(e=>e.estado==='consolidado').map(e=>[e.item,e]));
        xs=xs.map(s=>{const a=aprovados.get(s.item);return a?{...s,quantidade:a.quantidade,custoUnitario:a.custoUnitario,totalCentavos:a.totalCentavos}:s;});
      }
    }
    xs=xs.map(s=>{const e=situacaoItem(orc,s.item);return {...s,statusConsolidacao:e.estado,consolidado:e.consolidado,revisaoEmAndamento:e.revisaoEmAndamento,responsavel:e.responsavel};});
    return revisaoId==='consolidado'?xs.filter(s=>s.consolidado):xs;
  }
  const versao=orc=>JSON.stringify([lista(orc.revisoes).map(r=>r.id),lista(orc.consolidacoes).filter(e=>e.estado==='consolidado').map(e=>e.id)]);
  function baseItem(orc,item) {
    const s=itens(orc,'vigente').find(s=>s.item===item);if(!s)throw Error('Item inexistente.');
    const r=lista(orc.revisoes).filter(r=>lista(r.alteracoes).some(a=>a.item===item)).at(-1);
    return JSON.stringify([item,s.quantidade,s.custoUnitario,s.totalCentavos,r?.id||null,situacaoItem(orc,item).aprovacao?.id||null]);
  }
  function criarEvento(orc,item,estado,dados={}) {
    const atual=itens(orc,'vigente').find(s=>s.item===item);if(!atual)throw Error('Item inexistente.');
    const p=aplicar([atual],[{item,quantidade:dados.quantidade,custoUnitario:dados.custoUnitario}])[0];
    return {...dados,item,estado,baseItem:baseItem(orc,item),quantidade:p.quantidade,custoUnitario:p.custoUnitario,totalCentavos:p.totalCentavos};
  }
  function abc(xs) {
    const total=soma(xs);let acumulado=0;
    return xs.map(x=>({...x})).sort((a,b)=>b.totalCentavos-a.totalCentavos||String(a.item).localeCompare(String(b.item),'en')).map(x=>{
      const participacao=total?x.totalCentavos/total*100:0;acumulado+=participacao;
      return {...x,classe:acumulado<=80?'A':acumulado<=95?'B':'C',participacao,acumulado};
    });
  }
  function filtrar(xs,{busca='',grupo='',status='',classe='',estado='',responsavel=''}={}) {
    const normal=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    return abc(xs).filter(x=>(!busca||normal([x.item,x.codigo,x.descricao].join(' ')).includes(normal(busca)))&&(!grupo||(x.grupo||String(x.item).split('.')[0])===grupo)&&(!status||x.status===status)&&(!classe||x.classe===classe)&&(!estado||x.statusConsolidacao===estado)&&(!responsavel||normal(x.responsavel).includes(normal(responsavel))));
  }
  function simular(orc,alteracoes,base='vigente') {
    const anteriores=itens(orc,base),resultado=aplicar(anteriores,alteracoes),totalCentavos=soma(resultado);
    return {itens:resultado,totalCentavos,baseVersao:versao(orc),deltaCentavos:totalCentavos-orc.origem.totalCentavos,
      deltaOriginalCentavos:totalCentavos-soma(itens(orc)),deltaAtualCentavos:totalCentavos-soma(anteriores)};
  }
  const valorFonte=x=>x?.totalCentavos??x?.valorCentavos??(decimal(x?.total)?brlCentavos(x.total):null);
  function contratoFonte(col,f) {
    if(!f||!vinculoAtivo(f))return null;
    // Missing status is supported only for numeric legacy records; explicit draft/cancellation is not a commitment.
    if(f.situacao&&!(col==='oc'?['emitida','enviada','confirmada','transito','parcial','entregue']:['emitida','andamento','concluida']).includes(f.situacao))return null;
    if(Array.isArray(f.itens)){
      if(f.itens.some(i=>!decimal(Number(i.qtd))||!decimal(Number(i.preco))))return null;
      const total=f.itens.reduce((s,i)=>s+brlCentavos(Number(i.qtd)*Number(i.preco)),0);
      if(col==='os')return total;
      return total+brlCentavos(total/100*(Number(f.ipiPerc)||0)/100)+brlCentavos(total/100*(Number(f.icmsPerc)||0)/100)+brlCentavos(f.frete)+brlCentavos(f.seguro)-Math.abs(brlCentavos(f.desconto));
    }
    if(col==='oc'&&decimal(f.totalLiquido))return brlCentavos(f.totalLiquido);
    return valorFonte(f);
  }
  function limitePermuta(f,reg) {
    if(!Array.isArray(f.ordens)&&!Array.isArray(f.lancamentos))return valorFonte(f);
    let total=0;
    for(const o of lista(f.ordens).filter(vinculoAtivo)){
      if(!['oc','os'].includes(o.col))return null;
      const valor=contratoFonte(o.col,fonte({col:o.col,registroId:o.id},reg));
      if(!dinheiro(valor))return null;total+=valor;
    }
    for(const l of lista(f.lancamentos).filter(vinculoAtivo)){
      if(l.tipo==='pagamento')continue;if(!decimal(Number(l.valor)))return null;total+=brlCentavos(l.valor);
    }
    return dinheiro(total)?total:null;
  }
  function limiteRecebido(f) {
    const rs=lista(f.recebimentos).filter(r=>vinculoAtivo(r)&&!['cancelada','cancelado','rascunho'].includes(r.situacao));
    if(!rs.length||!Array.isArray(f.itens))return null;
    const qs=new Map();
    for(const r of rs)for(const i of lista(r.itens)){
      if(!f.itens.some(s=>s.id===i.itemId)||!decimal(Number(i.qtd)))return null;
      qs.set(i.itemId,(qs.get(i.itemId)||0)+Number(i.qtd));
    }
    let total=0;
    for(const i of f.itens){
      if(!decimal(Number(i.qtd))||!decimal(Number(i.preco)))return null;
      // Goods only: no inferred distribution of taxes/freight and no execution inferred.
      total+=brlCentavos(Math.min(Number(i.qtd),qs.get(i.id)||0)*Number(i.preco));
    }
    return dinheiro(total)?total:null;
  }
  function limiteFonte(v,f,reg={}) {
    if(!f||!vinculoAtivo(f))return null;
    if(v.etapa==='contratado'&&['oc','os'].includes(v.col))return contratoFonte(v.col,f);
    if(v.etapa==='recebido'&&v.col==='oc')return limiteRecebido(f);
    if(v.etapa==='permuta'&&v.col==='permuta')return limitePermuta(f,reg);
    if(!['executado','pago'].includes(v.etapa))return null;
    if(v.col==='doc'&&f.etapa===v.etapa)return valorFonte(f);
    if(v.col==='os'){
      const ms=lista(f.medicoes).filter(m=>vinculoAtivo(m)&&m.situacao!=='cancelada');
      if(v.etapa==='executado'){const confirmadas=ms.filter(m=>['emitida','aprovada','paga'].includes(m.situacao));return confirmadas.length?confirmadas.reduce((s,m)=>s+brlCentavos(m.bruto),0):null;}
      const pagas=ms.filter(m=>m.situacao==='paga'),as=lista(f.adiantamentos),vivos=as.filter(vinculoAtivo);
      const migrado=as.some(a=>a&&(a.origem==='inicial'||(f.adiantamentoInicialId&&a.id===f.adiantamentoInicialId)));
      const inicial=migrado?0:brlCentavos(f.adiantamento),liberada=brlCentavos(f.retencaoLiberada?.valor);
      if(!pagas.length&&!vivos.length&&!inicial&&!f.retencaoLiberada)return null;
      return pagas.reduce((s,m)=>s+brlCentavos(m.liquido),0)+vivos.reduce((s,a)=>s+brlCentavos(a.valor),0)+inicial+liberada;
    }
    if(v.col==='oc'){
      const es=lista(f[v.etapa==='executado'?'medicoes':'pagamentos']).filter(x=>vinculoAtivo(x)&&!['rascunho','cancelada','cancelado'].includes(x.situacao));
      const vs=es.map(x=>valorFonte(x)??(decimal(x.valor)?brlCentavos(x.valor):decimal(x.bruto)?brlCentavos(x.bruto):decimal(x.liquido)?brlCentavos(x.liquido):null));
      return vs.length&&vs.every(dinheiro)?vs.reduce((a,b)=>a+b,0):null;
    }
    return null;
  }
  function diagnosticarVinculos(orc,reg={}) {
    const ativos=lista(orc.vinculos).filter(vinculoAtivo),totais=new Map(),outros=new Map();
    for(const v of ativos)if(v.etapa!=='referencia'&&dinheiro(v.valorCentavos))totais.set(chaveFonte(v),(totais.get(chaveFonte(v))||0)+v.valorCentavos);
    // Read-time reconciliation also diagnoses pre-existing duplicates. The server
    // separately enforces the same balance atomically; a browser cache is not a lock.
    if(vinculoAtivo(orc))for(const b of lista(reg.orc).filter(b=>b.id!==orc.id&&vinculoAtivo(b)))for(const v of lista(b.vinculos).filter(vinculoAtivo)){
      if(v.etapa!=='referencia'&&dinheiro(v.valorCentavos))outros.set(chaveFonte(v),(outros.get(chaveFonte(v))||0)+v.valorCentavos);
    }
    return ativos.map(v=>{
      const f=fonte(v,reg),limiteCentavos=limiteFonte(v,f,reg),motivos=[];let estado='confirmado';
      if(!f){estado='sem-origem';motivos.push('Origem inexistente, removida ou ainda não sincronizada.');}
      if(!lista(orc.servicos).some(s=>s.item===v.item))motivos.push('Item de orçamento inexistente.');
      if(f?.obraId&&f.obraId!==orc.obraId)motivos.push('Origem pertence a outra obra.');
      if(!colecoes.includes(v.col)||!etapas.includes(v.etapa))motivos.push('Coleção ou etapa inválida.');
      if(v.etapa!=='referencia'){
        if(!dinheiro(v.valorCentavos))motivos.push('Rateio deve informar centavos válidos.');
        if(f&&!dinheiro(limiteCentavos)){estado='sem-evidencia';motivos.push('Etapa sem origem/evidência compatível.');}
        if(dinheiro(limiteCentavos)&&(totais.get(chaveFonte(v))||0)+(outros.get(chaveFonte(v))||0)>limiteCentavos)motivos.push('Rateios excedem valor da origem.');
      }else if(v.valorCentavos!=null&&!dinheiro(v.valorCentavos))motivos.push('Valor de referência inválido.');
      if(motivos.length&&estado==='confirmado')estado='divergente';
      return {...v,limiteCentavos,alocadoCentavos:totais.get(chaveFonte(v))??null,alocadoOutrosCentavos:outros.get(chaveFonte(v))||0,estado,motivos};
    });
  }
  function aplicavel(v,s) {
    if(v.item)return v.item===s.item;if(lista(v.itens).length)return v.itens.includes(s.item);
    if(v.grupo)return v.grupo===(s.grupo||String(s.item).split('.')[0]);return true;
  }
  function bloqueios(orc,item,reg={}) {
    const s=lista(orc.servicos).find(s=>s.item===item);if(!s)return ['Item inexistente.'];
    const motivos=lista(orc.validacoes).filter(v=>vinculoAtivo(v)&&v.status!=='validado'&&(v.impeditiva===true||v.bloqueante===true||v.severidade==='impeditiva')&&aplicavel(v,s)).map(v=>'Pendência impeditiva: '+(v.titulo||v.id||'sem título'));
    for(const d of diagnosticarVinculos(orc,reg).filter(d=>d.item===item&&d.estado!=='confirmado'))motivos.push(...d.motivos);
    return [...new Set(motivos)];
  }
  function resumo(orc,reg={}) {
    const orig=itens(orc),atual=itens(orc,'vigente'),cs=atual.filter(s=>s.consolidado);
    const totalAtualCentavos=soma(atual),consolidadoCentavos=soma(cs),diagnosticos=diagnosticarVinculos(orc,reg),financeiro={};
    const total=(etapa,estado)=>{const vs=diagnosticos.filter(v=>v.etapa===etapa&&dinheiro(v.valorCentavos));if(!vs.length)return null;return vs.filter(v=>!estado||(estado==='confirmado'?v.estado===estado:v.estado!=='confirmado')).reduce((s,v)=>s+v.valorCentavos,0);};
    for(const etapa of etapas.filter(e=>e!=='referencia')){
      financeiro[etapa+'Centavos']=total(etapa);financeiro[etapa+'ConfirmadoCentavos']=total(etapa,'confirmado');financeiro[etapa+'DivergenteCentavos']=total(etapa,'divergente');
    }
    const tudo=atual.length>0&&cs.length===atual.length,aberto=atual.some(s=>s.revisaoEmAndamento||bloqueios(orc,s.item,reg).length);
    return {...financeiro,totalOriginalCentavos:orc.origem.totalCentavos,totalItensOriginalCentavos:soma(orig),totalAtualCentavos,
      consolidadoCentavos,aConsolidarCentavos:totalAtualCentavos-consolidadoCentavos,itensConsolidados:cs.length,itensAConsolidar:atual.length-cs.length,
      percentualConsolidado:totalAtualCentavos?consolidadoCentavos/totalAtualCentavos*100:null,percentualItensConsolidados:atual.length?cs.length/atual.length*100:null,
      estadoConsolidacao:tudo&&!aberto?'consolidado':cs.length?'em-consolidacao':'executivo',desvioAprovadoCentavos:totalAtualCentavos-soma(orig),
      diferencaCentavos:soma(orig)-orc.origem.totalCentavos,pendencias:lista(orc.validacoes).filter(v=>vinculoAtivo(v)&&v.status!=='validado').length,
      servicos:orig.length,grupos:lista(orc.grupos).length,divergencias:diagnosticos.filter(d=>d.estado!=='confirmado'),diagnosticos};
  }
  const prefixoPreservado=(as,ns)=>ns.length>=as.length&&as.every((r,i)=>igual(r,ns[i]));
  function validar(orc,anterior,perfil,reg={}) {
    const erros=[];if(!orc||typeof orc!=='object')return ['Orçamento inválido.'];
    if(!['direcao','escritorio'].includes(perfil))erros.push('Obra não acessa orçamento.');
    for(const campo of ['origem','grupos','servicos','cronograma','insumos','areas','indicadores','memorial','premissas','metodologia','paginas'])if(anterior&&!igual(orc[campo],anterior[campo]))erros.push('Original imutável: '+campo);
    if(!orc.id||!orc.obraId||!dinheiro(orc.origem?.totalCentavos))erros.push('Identificação/origem inválida.');
    const ids=new Set();
    for(const s of lista(orc.servicos)){if(!s.item||ids.has(s.item))erros.push('Item duplicado ou ausente.');ids.add(s.item);if(!dinheiro(s.totalCentavos)||!decimal(s.quantidade)||!decimal(s.custoUnitario))erros.push('Valores inválidos: '+s.item);}
    for(const g of lista(orc.grupos))if(!dinheiro(g.totalCentavos))erros.push('Total de grupo inválido.');
    function conferirAlteracoes(as,base,exigirMudanca){
      const vistos=new Set();let efetiva=false;
      for(const a of lista(as)){
        if(!ids.has(a.item)||vistos.has(a.item))erros.push('Alteração de item inexistente ou duplicada.');vistos.add(a.item);
        if((a.quantidade!==undefined&&!decimal(a.quantidade))||(a.custoUnitario!==undefined&&!decimal(a.custoUnitario)))erros.push('Valor de cenário inválido.');
        const s=base.find(s=>s.item===a.item);if(s&&alterado(s,a))efetiva=true;
      }
      try{if(!dinheiro(soma(aplicar(base,as))))erros.push('Total de cenário inválido.');}catch{erros.push('Total de cenário inválido.');}
      if(exigirMudanca&&!efetiva)erros.push('Cenário deve informar ao menos uma alteração efetiva.');
    }
    let vigente;try{vigente=itens(orc,'vigente');}catch{erros.push('Total de cenário inválido.');vigente=itens(orc);}
    if(!dinheiro(soma(vigente)))erros.push('Total vigente inválido.');
    for(const c of lista(orc.cenarios)){
      const antes=lista(anterior?.cenarios).find(x=>x.id===c.id);
      conferirAlteracoes(c.alteracoes,vigente,!igual(c,antes));
      if(!igual(c,antes)&&c.baseVersao!=null&&c.baseVersao!==versao(orc))erros.push('Cenário com base desatualizada. Confira a versão vigente.');
    }
    const antigas=lista(anterior?.revisoes),novas=lista(orc.revisoes);
    if(!prefixoPreservado(antigas,novas))erros.push('Revisões aprovadas são imutáveis.');
    if(novas.length>antigas.length&&perfil!=='direcao')erros.push('Somente direção aprova revisão.');
    if(novas.length>antigas.length&&lista(anterior?.consolidacoes).length)erros.push('Aprove a nova revisão por item, preservando a consolidação vigente.');
    const revisoesIds=new Set();let baseRevisao=itens(orc);
    for(let i=0;i<novas.length;i++){
      const r=novas[i];if(!r.id||['original','vigente','consolidado'].includes(r.id)||revisoesIds.has(r.id)||!r.aprovadoPor||!r.aprovadoEm||!Number.isFinite(Date.parse(r.aprovadoEm)))erros.push('Revisão inválida.');
      revisoesIds.add(r.id);conferirAlteracoes(r.alteracoes,baseRevisao,i>=antigas.length);
      try{baseRevisao=aplicar(baseRevisao,r.alteracoes);}catch{/* already reported */}
    }
    const antigasV=lista(anterior?.validacoes),vs=lista(orc.validacoes),vids=new Set();
    for(const v of antigasV)if(!vs.some(n=>n.id===v.id))erros.push('Validações anteriores devem ser preservadas; use inativação.');
    for(const v of vs){
      const velha=antigasV.find(x=>x.id===v.id);
      if(!v.id||vids.has(v.id))erros.push('Validação sem identificação ou duplicada.');vids.add(v.id);
      if(!['pendente','em-analise','validado'].includes(v.status)||(v.item&&!ids.has(v.item))||lista(v.itens).some(id=>!ids.has(id)))erros.push('Validação inválida.');
      if(velha&&!prefixoPreservado(lista(velha.historico),lista(v.historico)))erros.push('O histórico da validação deve ser preservado.');
      if(!igual(v,velha)&&v.status==='validado'&&(!texto(v.responsavel)||!texto(v.evidencia)))erros.push('Resolver validação exige responsável e evidência.');
    }
    const antigosE=lista(anterior?.consolidacoes),es=lista(orc.consolidacoes),eids=new Set();
    if(!prefixoPreservado(antigosE,es))erros.push('Eventos de consolidação são imutáveis e devem ser preservados.');
    for(let i=0;i<es.length;i++){
      const e=es[i];if(!e.id||eids.has(e.id)||!ids.has(e.item)||!estados.includes(e.estado))erros.push('Evento de consolidação inválido.');eids.add(e.id);
      if(i<antigosE.length)continue;
      if(!texto(e.por)||!e.em||!Number.isFinite(Date.parse(e.em)))erros.push('Evento exige autor e data válidos.');
      const previo={...orc,consolidacoes:es.slice(0,i)};if(!ids.has(e.item))continue;const estado=situacaoItem(previo,e.item);
      if(e.baseItem!==baseItem(previo,e.item))erros.push('A base do item mudou; a decisão está desatualizada. Confira o vigente.');
      if(!decimal(e.quantidade)||!decimal(e.custoUnitario)||!dinheiro(e.totalCentavos))erros.push('Valores da consolidação inválidos.');
      try{if(criarEvento(previo,e.item,e.estado,e).totalCentavos!==e.totalCentavos)erros.push('Total da consolidação diverge dos valores conferidos.');}catch{erros.push('Valores da consolidação inválidos.');}
      if(['aguardando-aprovacao','consolidado'].includes(e.estado)&&(!texto(e.responsavel)||!texto(e.evidencia)))erros.push('Conferência exige responsável e evidência.');
      if(e.estado==='revisao-solicitada'&&(!estado.consolidado||!texto(e.motivo)))erros.push('Solicitar revisão exige aprovação anterior e motivo.');
      if(e.estado==='consolidado'){
        if(perfil!=='direcao')erros.push('Somente direção consolida item.');
        erros.push(...bloqueios(previo,e.item,reg));
        if(estado.estado==='aguardando-aprovacao'&&!['quantidade','custoUnitario','totalCentavos'].every(k=>e[k]===estado.proposta[k]))erros.push('A aprovação deve corresponder à proposta submetida. Reabra a conferência para alterar valores.');
        if(e.cenarioId){
          const c=lista(orc.cenarios).find(c=>c.id===e.cenarioId);
          const inicio=es.findIndex((x,j)=>j>=antigosE.length&&x.cenarioId===e.cenarioId);
          const baseCenario={...orc,consolidacoes:es.slice(0,inicio)};
          if(!c||!lista(c.alteracoes).some(a=>a.item===e.item))erros.push('Item não pertence ao cenário informado.');
          else{
            if(c.baseVersao!=null&&c.baseVersao!==versao(baseCenario))erros.push('Cenário com base desatualizada. Confira novamente antes de aprovar.');
            try{const proposto=simular(baseCenario,c.alteracoes).itens.find(s=>s.item===e.item);if(!['quantidade','custoUnitario','totalCentavos'].every(k=>e[k]===proposto[k]))erros.push('A aprovação diverge dos valores do cenário conferido.');}catch{erros.push('Cenário inválido para aprovação.');}
          }
        }
      }
    }
    const vistos=new Set(),vinculoIds=new Set(),velhos=lista(anterior?.vinculos),gruposAlterados=new Set();
    for(const v of lista(orc.vinculos)){
      if(!v.id||vinculoIds.has(v.id))erros.push('Rateio duplicado.');vinculoIds.add(v.id);
      if(!igual(v,velhos.find(a=>a.id===v.id))&&vinculoAtivo(v))gruposAlterados.add(chaveFonte(v));
      if(!vinculoAtivo(v))continue;const k=[chaveFonte(v),v.item].join('|');if(vistos.has(k))erros.push('Rateio duplicado.');vistos.add(k);
    }
    // A stale untouched allocation must not prevent an unrelated repair. Changed
    // groups remain strict, including unchanged rows that consume the same source.
    for(const d of diagnosticarVinculos(orc,reg))if(gruposAlterados.has(chaveFonte(d)))erros.push(...d.motivos);
    return [...new Set(erros)];
  }
  const api={itens,abc,filtrar,simular,resumo,validar,situacaoItem,criarEvento,baseItem,versao,bloqueios,limiteFonte,diagnosticarVinculos,vinculoAtivo,produtoCentavos};
  root.Orcamento=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
