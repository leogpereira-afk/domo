/* Private, complete dashboard report. Values come from the same model as the screen. */
(function(root) {
  'use strict';
  const arr=x=>Array.isArray(x)?x:[];
  const number=x=>x==null?'Não informado':Number(x).toLocaleString('pt-BR',{maximumFractionDigits:6});
  const money=x=>x==null?'Não informado':(x/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const percent=x=>x==null?'Não aplicável':Number(x).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
  const value=x=>x==null||x===''?'Não informado':String(x);
  const states={executivo:'Executivo','em-conferencia':'Em conferência','aguardando-aprovacao':'Aguardando aprovação',consolidado:'Consolidado','revisao-solicitada':'Revisão solicitada'};
  const stages=[['contratado','Contratado'],['recebido','Recebido - material'],['executado','Executado'],['pago','Pago - caixa'],['permuta','Permuta - valor econômico']];
  // Helvetica handles Portuguese; normalize punctuation that its WinAnsi encoding cannot render.
  const printable=x=>String(x??'').replace(/[\u00a0\u202f]/g,' ').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\u2192/g,' -> ');

  async function exportarDashboardOrcamento(o,reg={}) {
    if(!o?.origem||!root.Orcamento)throw Error('Orçamento indisponível para exportar.');
    if(!root.jspdf?.jsPDF)throw Error('Biblioteca de PDF indisponível. Recarregue a página.');
    const model=root.Orcamento,summary=model.resumo(o,reg),original=model.itens(o,'original'),current=model.itens(o,'vigente');
    const originals=new Map(original.map(x=>[x.item,x])),created=new Date(),navy=[20,43,73],gray=[83,101,119];
    const doc=new root.jspdf.jsPDF({unit:'mm',format:'a4',compress:true});
    const logo=typeof carregarLogo==='function'?await carregarLogo():null;
    const margin=12,width=186,bottom=277;let y=29;
    const style=(size=9,bold=false,color=[30,44,60])=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);};
    function header(){
      if(logo){try{doc.addImage(logo,'PNG',margin,8,29,9.3);}catch{ /* The report remains readable without the optional logo. */ }}
      style(10,true,navy);doc.text('DOMO | Orçamento Executivo',logo?46:margin,14);
      style(7,false,gray);doc.text('Dashboard - '+created.toLocaleDateString('pt-BR'),198,21,{align:'right'});
      doc.setDrawColor(184,149,84);doc.line(margin,24,198,24);
    }
    function page(){doc.addPage();header();y=31;}
    function reserve(height){if(y+height>bottom)page();}
    function text(content,{size=9,bold=false,color=[30,44,60],gap=2,indent=0}={}){
      style(size,bold,color);const height=size*.352778*1.35;
      const lines=doc.splitTextToSize(printable(content),width-indent);
      for(const line of lines){reserve(height);style(size,bold,color);doc.text(line,margin+indent,y);y+=height;}
      y+=gap;
    }
    function section(title){
      reserve(18);doc.setFillColor(237,242,247);doc.rect(margin,y-4,width,8,'F');
      style(10,true,navy);doc.text(title,margin+2,y+1);y+=10;
    }
    function metric(label,amount){
      reserve(9);style(9,false);doc.text(label,margin,y);style(12,true,navy);doc.text(printable(money(amount)),198,y,{align:'right'});y+=9;
    }
    const field=(label,content,options={})=>text(label+': '+value(content),options);
    const total=xs=>xs.reduce((sum,x)=>sum+x.totalCentavos,0);
    const pending=arr(o.validacoes).filter(v=>model.vinculoAtivo(v)&&v.status!=='validado');
    const financial=summary.diagnosticos;
    header();
    text(o.nome||'Orçamento Executivo',{size:15,bold:true,gap:4});
    field('Obra / identificação',o.obra||o.obraNome||o.obraId,{size:8});
    field('Revisão e base da fonte',[o.origem.revisao,o.origem.base].filter(Boolean).join(' / '),{size:8});
    field('Gerado em',created.toLocaleString('pt-BR'),{size:8});
    text(o._recusado?'Cópia local com alteração recusada pelo servidor. Confira a sincronização.':o._pendente?'Cópia local com alterações aguardando confirmação do servidor.':'Relatório dos dados disponíveis neste aparelho no momento da geração.',{size:8,color:gray});
    section('Panorama financeiro');
    metric('Executivo original - total declarado R00',summary.totalOriginalCentavos);
    metric('Vigente - soma dos itens',summary.totalAtualCentavos);
    metric('Consolidado - últimas aprovações por item',summary.consolidadoCentavos);
    metric('Ainda a consolidar',summary.aConsolidarCentavos);
    text(summary.servicos?summary.itensConsolidados+' de '+summary.servicos+' itens aprovados | '+percent(summary.percentualItensConsolidados)+' dos itens | '+(summary.percentualConsolidado==null?'Percentual do valor não aplicável':percent(summary.percentualConsolidado)+' do valor vigente')+'.':'Sem itens para avaliar a consolidação.',{size:8});
    text(Object.entries(states).map(([key,label])=>label+': '+current.filter(x=>x.statusConsolidacao===key).length).join(' | '),{size:8});
    const reopened=current.filter(x=>x.revisaoEmAndamento).length;
    if(reopened)text(reopened+' item(ns) em revisão. O vigente mantém a última aprovação até uma nova decisão.',{size:8});
    text('Vigente combina referências executivas e últimas aprovações. Consolidar não registra contratação, execução ou pagamento.',{size:8,color:gray});
    section('Contratação e realizado');
    for(const [key,label] of stages){
      const ds=financial.filter(d=>d.etapa===key&&Number.isSafeInteger(d.valorCentavos)),issues=ds.filter(d=>d.estado!=='confirmado');
      reserve(17);metric(label,summary[key+'Centavos']);
      text(ds.length?'Confirmado: '+money(summary[key+'ConfirmadoCentavos'])+' | A conferir: '+money(summary[key+'DivergenteCentavos'])+' | '+ds.length+' vínculo(s), '+new Set(ds.map(d=>d.item)).size+' de '+summary.servicos+' itens, '+issues.length+' divergente(s).':'Sem valor vinculado nesta etapa. Ausência de lançamento não comprova custo zero.',{size:7.5,color:gray});
    }
    text('Os estágios são sobrepostos e não são somados. Material recebido não comprova execução. Permuta é valor econômico separado de saída de caixa. A cobertura financeira depende dos rateios vinculados.',{size:8,color:gray});
    text('Pendências abertas: '+pending.length+' | Fontes financeiras a conferir: '+summary.divergencias.length+'.',{size:9,bold:true});

    section('Reconciliação e referência');
    field('Soma dos itens originais',money(summary.totalItensOriginalCentavos));
    field('Diferença entre itens e total declarado',money(summary.diferencaCentavos));
    field('Ajustes aprovados sobre a soma original',money(summary.desvioAprovadoCentavos));
    field('Área / horizonte',[o.origem.area==null?'Área não informada':number(o.origem.area)+' m²',o.origem.meses==null?'Horizonte não informado':number(o.origem.meses)+' meses'].join(' / '));
    text('Diferenças de transcrição e arredondamento são preservadas; não são distribuídas artificialmente.',{size:8,color:gray});
    field('Arquivo da fonte',o.origem.arquivo);
    field('Emissão da fonte',o.origem.emissao);
    field('SHA-256 da fonte',o.origem.hash,{size:8});
    field('Páginas de texto preservadas',arr(o.paginas).length);
    field('PDF original',o.origem.pdfArquivoId?'Vinculado ao acervo privado':o.origem.pdfLocal?'Disponível somente nesta prévia':arr(o.anexos).some(a=>a.mime==='application/pdf')?'Há anexo PDF; confira se corresponde ao original':'Não vinculado');
    field('Insumos disponíveis / declarados',arr(o.insumos).length+' / '+value(o.origem.insumosDeclarados));
    field('Composições declaradas',o.origem.composicoesDeclaradas);
    text('Composições analíticas completas não disponíveis para análise. Cobertura documental não comprova avanço físico nem fechamento financeiro. O PDF original é um arquivo separado deste relatório.',{size:8,color:gray});
    if(arr(o.arquivosPendentesReparo).length)text('Arquivos a reparar: '+o.arquivosPendentesReparo.map(a=>value(a.arquivoId)+' - '+value(a.motivo)).join('; '));

    section('Todos os grupos - comparação das bases');
    const groupCodes=[...new Set([...arr(o.grupos).map(g=>g.codigo),...current.map(x=>x.grupo)])];
    if(!groupCodes.length)text('Grupos não informados.');
    for(const code of groupCodes){
      const group=arr(o.grupos).find(g=>g.codigo===code),before=original.filter(x=>x.grupo===code),now=current.filter(x=>x.grupo===code),approved=now.filter(x=>x.consolidado);
      reserve(20);text(value(code)+' - '+(group?.nome||'Grupo sem cadastro na fonte'),{bold:true});
      text('R00 (itens): '+money(total(before))+' | Vigente: '+money(total(now))+' | Consolidado: '+money(total(approved))+' | A consolidar: '+money(total(now)-total(approved)),{size:8});
      text('Total do grupo declarado na fonte: '+money(group?.totalCentavos)+' | '+approved.length+' de '+now.length+' itens aprovados.',{size:8,color:gray});
    }

    section('Evolução de todos os itens');
    if(!current.length)text('Nenhum serviço informado.');
    for(const item of current){
      const before=originals.get(item.item),state=model.situacaoItem(o,item.item);
      reserve(23);text(item.item+' - '+value(item.descricao),{bold:true});
      text('Original: '+money(before.totalCentavos)+' | Vigente: '+money(item.totalCentavos)+' | '+(state.consolidado?'Última aprovação: '+money(state.aprovacao.totalCentavos):'Ainda sem aprovação por item'),{size:8});
      text('Quantidade vigente: '+number(item.quantidade)+' '+value(item.unidade)+' | Custo unitário vigente: R$ '+number(item.custoUnitario)+' | Estado: '+value(states[state.estado]||state.estado),{size:8});
      text('Fonte: '+value(item.fonte)+' | Composição: '+value(item.codigo)+' | Página: '+value(item.pagina),{size:7.5,color:gray});
      const blocks=model.bloqueios(o,item.item,reg);if(blocks.length)text('Impedimentos: '+blocks.join('; '),{size:8});
      for(const event of state.historico){
        text(value(states[event.estado]||event.estado)+' | '+value(event.em)+' | '+value(event.aprovadoPor||event.por)+' | '+money(event.totalCentavos),{size:8,bold:true,indent:3});
        field('Responsável',event.responsavel,{size:8,indent:3});
        if(event.evidencia)field('Evidência',event.evidencia,{size:8,indent:3});
        if(event.motivo)field('Motivo',event.motivo,{size:8,indent:3});
      }
    }

    section('Pendências completas e histórico de conferência');
    if(!arr(o.validacoes).length)text('Nenhuma pendência documentada. Isso não significa que os itens foram consolidados.');
    for(const v of arr(o.validacoes)){
      reserve(20);text(value(v.titulo),{bold:true});
      text('Abrangência: '+(v.item?'Item '+v.item:arr(v.itens).length?'Itens '+v.itens.join(', '):v.grupo?'Grupo '+v.grupo:'Geral')+' | Situação: '+value(v.status)+(model.vinculoAtivo(v)?'':' (inativa)')+' | Impeditiva: '+(v.impeditiva||v.bloqueante||v.severidade==='impeditiva'?'Sim':'Não'),{size:8});
      text('Responsável: '+value(v.responsavel)+' | Prazo: '+value(v.prazo),{size:8});
      if(v.observacao)field('Observação',v.observacao,{size:8});
      if(v.evidencia)field('Evidência',v.evidencia,{size:8});
      for(const h of arr(v.historico)){
        text('Histórico: '+value(h.em)+' | '+value(h.por)+' | '+value(h.status),{size:8,bold:true,indent:3});
        for(const [key,label] of [['titulo','Título'],['responsavel','Responsável'],['prazo','Prazo'],['observacao','Observação'],['evidencia','Evidência'],['motivo','Motivo']])if(h[key])field(label,h[key],{size:8,indent:3});
      }
    }

    section('Fontes dos valores - vínculos completos');
    if(!arr(o.vinculos).length)text('Nenhuma origem vinculada. Contratado, recebido, executado, pago e permuta permanecem não informados.');
    for(const v of arr(o.vinculos)){
      const d=financial.find(x=>x.id===v.id),source=arr(reg[v.col]).find(x=>x.id===v.registroId);
      reserve(20);text(value(v.item)+' | '+value(v.etapa)+' | '+money(v.valorCentavos),{bold:true});
      text('Origem: '+value(v.col)+' / '+value(v.registroId)+' / '+value(source?.codigo||source?.nome||source?.titulo),{size:8});
      text('Data: '+value(v.data)+' | '+(model.vinculoAtivo(v)?value(d?.estado):'Inativo - não consome saldo'),{size:8});
      if(d?.motivos?.length)field('Conferência',d.motivos.join('; '),{size:8});
      if(v.observacao)field('Observação',v.observacao,{size:8});
      if(v.motivoInativacao)field('Motivo da inativação',v.motivoInativacao,{size:8});
    }
    const pages=doc.internal.getNumberOfPages();
    for(let n=1;n<=pages;n++){
      doc.setPage(n);style(7,false,gray);doc.text('DOMO - relatório privado | Dados na data de geração',margin,288);
      doc.text('Página '+n+' de '+pages,198,288,{align:'right'});
    }
    doc.setProperties({title:'Dashboard - '+(o.nome||'Orçamento Executivo'),subject:'Orçamento, consolidação, fontes e pendências',creator:'DOMO'});
    const name='dashboard-orcamento-'+String(o.nome||o.id||'executivo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,70)+'.pdf';
    doc.save(name);
    return doc;
  }
  root.exportarDashboardOrcamento=exportarDashboardOrcamento;
})(typeof window==='undefined'?globalThis:window);
