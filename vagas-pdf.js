/* Um documento gerado da mesma base da tela. Nunca reutiliza as marcações antigas do PDF. */
function DomoVagasPDF(base,opts={}){
  const V=globalThis.DomoVagas,vs=V.efetivas(base.estado),{jsPDF}=globalThis.jspdf;
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  const cores={disponivel:[28,111,82],reservada:[149,102,11],vendida:[34,80,153],conferir:[175,61,52]};
  const fundos={disponivel:[236,249,242],reservada:[255,246,218],vendida:[233,240,253],conferir:[255,236,233]};
  const d=s=>s?new Date(s.length===10?s+'T12:00:00':s).toLocaleDateString('pt-BR'):'—';
  const titulo=(t,sub)=>{doc.setFillColor(0,46,111);doc.rect(0,0,297,28,'F');doc.setFont('helvetica','bold');doc.setTextColor(255);doc.setFontSize(17);doc.text('DOMO  /  DIAMOND',12,12);doc.setFontSize(11);doc.text(t,12,21);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.text(sub,285,20,{align:'right'});};
  const rodape=()=>{doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(90);doc.text('Base Domo · revisão '+base.revisao+' · emissão '+new Date().toLocaleString('pt-BR'),12,202);doc.text('Planilha importada: '+d(base.estado.fonte.lidoEm),285,202,{align:'right'});};
  const fit=(text,width)=>{let s=String(text||'—');while(s.length>1&&doc.getTextWidth(s)>width)s=s.slice(0,-2)+'…';return s;};
  V.PISOS.forEach((p,pi)=>{
    if(pi)doc.addPage();const vv=vs.filter(v=>v.piso===p.id);
    titulo(p.nome+' · '+V.codigo(p.de)+' a '+V.codigo(p.ate),'ESPELHO DE VAGAS');
    doc.setFontSize(8);doc.setTextColor(60);doc.text('Posição conforme a planta enviada · esquema sem escala',12,36);
    const rows=V.LINHAS[p.id],step=151/rows.length,h=step-1.3;
    doc.setFillColor(243,246,250);doc.roundedRect(12,42,84,151,2,2,'F');
    rows.forEach((row,y)=>row.forEach((n,col)=>{if(!n)return;const v=vs.find(x=>x.numero===n),x=15+col*44,yy=43+y*step;doc.setFillColor(...fundos[v.situacao]);doc.setDrawColor(...cores[v.situacao]);doc.roundedRect(x,yy,34,h,1,1,'FD');doc.setTextColor(...cores[v.situacao]);doc.setFont('helvetica','bold');doc.setFontSize(Math.min(9,h*1.8));doc.text(v.codigo,x+2,yy+h*.44);doc.setFont('helvetica','normal');doc.setFontSize(Math.min(7,h*1.2));doc.text(fit(v.apartamento||V.STATUS[v.situacao],30),x+2,yy+h*.83);}));
    doc.setFontSize(7);doc.setTextColor(135);doc.text('CIRCULAÇÃO',55,132,{angle:90});
    const sx=105,sy=48,stepT=4.45;
    doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(40);
    doc.text('VAGA',sx,42);doc.text('APTO',sx+15,42);doc.text('CLIENTE / PROPRIETÁRIO',sx+34,42);doc.text('SITUAÇÃO',sx+122,42);doc.text('CONTRATO',sx+148,42);
    vv.forEach((v,i)=>{const y=sy+i*stepT;if(i%2===0){doc.setFillColor(246,248,251);doc.rect(sx-2,y-3.3,183,stepT,'F');}doc.setTextColor(40);doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.text(v.codigo,sx,y);doc.setFont('helvetica','normal');doc.text((v.apartamento||'—').replace('Apto ',''),sx+15,y);doc.text(fit(v.cliente,84),sx+34,y);doc.setTextColor(...cores[v.situacao]);doc.text(V.STATUS[v.situacao],sx+122,y);doc.setTextColor(65);doc.text(fit(v.contrato,32),sx+148,y);});
    const counts=Object.entries(V.STATUS).map(([k,t])=>t+': '+vv.filter(v=>v.situacao===k).length).join('     ');doc.setFontSize(8);doc.setTextColor(30);doc.text(counts,105,191);
    rodape();
  });
  const avisos=vs.filter(v=>v.alertas.length||v.avisos.length||v.vencida||v.observacoes||v.reserva||v.expiracao);
  let y=220;
  for(const v of avisos){
    const textos=[...(v.alertas||[]),...(v.avisos||[]),...(v.reserva||v.expiracao?['Reserva: '+d(v.reserva)+' · Prazo: '+d(v.expiracao)+(v.vencida?' · VENCIDA':'')]:[]),...(v.observacoes?['Observações: '+v.observacoes]:[])];
    doc.setFontSize(9);const linhas=doc.splitTextToSize(textos.join('\n'),267);
    for(let j=0;j<linhas.length;j++){
      if(y>185){doc.addPage();titulo('Conferências, reservas e observações','RELATÓRIO COMPLEMENTAR');rodape();y=41;}
      if(j===0||y===41){doc.setTextColor(0,46,111);doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text(v.codigo+' · '+(v.apartamento||'Sem apartamento')+' · '+V.STATUS[v.situacao],12,y);y+=6;}
      doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(50);doc.text(linhas[j],12,y);y+=4.5;
    }y+=7;
  }
  doc.setProperties({title:'Diamond — Espelho de vagas',subject:'Situação das 82 vagas e conferências',author:'Domo Construtora'});
  if(opts.retornar)return doc;
  doc.save('Diamond-vagas-'+new Date().toISOString().slice(0,10)+'.pdf');return doc;
}
