/* Regras compartilhadas pelo navegador, servidor e testes. Sem dados pessoais. */
(function (root) {
  'use strict';
  const STATUS = {disponivel:'Disponível', reservada:'Reservada', vendida:'Vendida', conferir:'Conferir'};
  const PISOS = [{id:0,nome:'Térreo',de:1,ate:25}, {id:1,nome:'2º pavimento',de:26,ate:51}, {id:2,nome:'3º pavimento · Pilotis',de:52,ate:82}];
  // Posições relativas da planta entregue. O corredor separa as duas colunas.
  const LINHAS = [
    [[null,1],[null,2],[null,3],[null,5],[4,null],[6,7],[8,9],[10,11],[12,13],[14,15],[16,17],[18,19],[20,21],[22,23],[24,25]],
    [[26,27],[28,29],[null,30],[null,31],[null,32],[null,33],[null,34],[null,35],[null,36],[null,37],[null,38],[39,40],[41,42],[43,44],[45,46],[null,null],[47,null],[48,50],[49,51]],
    [[null,52],[53,54],[55,56],[57,58],[59,60],[null,null],[61,62],[63,64],[65,66],[67,68],[null,69],[null,70],[null,71],[null,72],[null,73],[null,74],[null,null],[75,76],[77,78],[79,80],[81,82]]
  ];
  const clean = v => String(v == null ? '' : v).trim().replace(/^[—–-]$/, '');
  const norm = v => clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const codigo = n => 'V'+String(n).padStart(2,'0');
  function numero(v) { const m=clean(v).match(/^V?\s*(\d{1,2})$/i); return m && +m[1]>=1 && +m[1]<=82 ? +m[1] : null; }
  const piso = n => n<=25?0:n<=51?1:2;
  function status(v) { const s=norm(v); return ['v','vendida','vinculada / vendida'].includes(s)?'vendida':['r','reservada'].includes(s)?'reservada':s==='disponivel'?'disponivel':'conferir'; }
  function data(v) {
    const s=clean(v); if(!s)return '';
    const m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); const iso=m?`${m[3]}-${m[2]}-${m[1]}`:s;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)||!Number.isFinite(Date.parse(iso+'T12:00:00Z'))||new Date(iso+'T12:00:00Z').toISOString().slice(0,10)!==iso)throw Error('Data inválida: '+s);
    return iso;
  }
  function parseCSV(text) {
    const rows=[];let row=[],v='',quoted=false;const s=String(text).replace(/^\uFEFF/,'');
    const sep=(s.split(/\r?\n/)[0].match(/;/g)||[]).length>(s.split(/\r?\n/)[0].match(/,/g)||[]).length?';':',';
    for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(quoted&&s[i+1]==='"'){v+='"';i++;}else quoted=!quoted;}else if(c===sep&&!quoted){row.push(v);v='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&s[i+1]==='\n')i++;row.push(v);rows.push(row);row=[];v='';}else v+=c;}
    if(quoted)throw Error('CSV incompleto: aspas não fechadas.'); if(v||row.length){row.push(v);rows.push(row);} return rows;
  }
  function tabela(rows,first) { const i=rows.findIndex(r=>r.some(c=>norm(c)===first)); if(i<0)throw Error('Cabeçalho não encontrado: '+first); const headers=rows[i].map(norm);return rows.slice(i+1).filter(r=>r.some(c=>clean(c))).map(r=>Object.fromEntries(headers.map((h,j)=>[h,clean(r[j])]))); }
  function importar(source) {
    const unidades=tabela(source.vinculos,'apartamento').filter(r=>/^apto\s*\d+$/i.test(r.apartamento));
    const gestao=tabela(source.gestao,'vaga').filter(r=>numero(r.vaga));
    if(unidades.length!==82)throw Error('A aba Vagas de Garagem deve conter os 82 apartamentos. Recebidos: '+unidades.length);
    if(gestao.length!==82||new Set(gestao.map(r=>numero(r.vaga))).size!==82)throw Error('A aba Gestão de Vagas deve conter V01 a V82, uma vez cada.');
    if(new Set(unidades.map(r=>r.apartamento)).size!==82)throw Error('Há apartamentos repetidos na planilha.');
    const vagas=gestao.map(g=>{
      const n=numero(g.vaga),vinculos=unidades.filter(u=>numero(u['vaga vinculada'])===n);
      const u=vinculos[0],sg=status(g.status),su=u?status(u['confirmacao (v/r)']||u.status):null;
      const alertas=[];
      if(vinculos.length>1)alertas.push('A mesma vaga está vinculada a mais de um apartamento.');
      if(su&&su!==sg)alertas.push(`Situação divergente: Vagas de Garagem = ${STATUS[su]}; Gestão de Vagas = ${STATUS[sg]}.`);
      if(sg==='conferir')alertas.push('Situação da planilha não reconhecida.');
      if(['reservada','vendida'].includes(sg)&&!u)alertas.push('Reserva ou venda sem apartamento vinculado na aba Vagas de Garagem.');
      if(u&&g.apartamento&&norm(g.apartamento)!==norm(u.apartamento))alertas.push('Apartamento diferente entre as duas abas.');
      if(u&&g['cliente / proprietario']&&norm(g['cliente / proprietario'])!==norm(u['cliente / proprietario']))alertas.push('Proprietário diferente entre as duas abas.');
      const pisoInformado=norm(g.pavimento);const pisoEsperado=piso(n);
      const avisos=[];if((pisoInformado.includes('terreo')?0:pisoInformado.startsWith('2')?1:pisoInformado.startsWith('3')?2:-1)!==pisoEsperado)avisos.push('Pavimento da planilha diverge da planta. O espelho segue o PDF enviado.');
      let reserva='',expiracao='';try{reserva=data(g['data da reserva']);expiracao=data(g['prazo de expiracao']);}catch(e){alertas.push(e.message);}
      if(reserva&&expiracao&&expiracao<reserva)alertas.push('Prazo da reserva anterior ao início.');
      const origem={gestao:g,vinculos,pisoPDF:PISOS[pisoEsperado].nome};
      return {numero:n,codigo:codigo(n),piso:pisoEsperado,apartamento:u?.apartamento||g.apartamento||'',cliente:u?.['cliente / proprietario']||g['cliente / proprietario']||'',area:u?.['tipologia / area']||'',situacao:alertas.length?'conferir':sg,contrato:u?.contratos||'',reserva,expiracao,observacoes:g.observacoes||'',alertas,avisos,origem,assinatura:JSON.stringify(origem)};
    }).sort((a,b)=>a.numero-b.numero);
    for(const u of unidades)if(u['vaga vinculada']&&!numero(u['vaga vinculada']))throw Error('Vaga inválida em '+u.apartamento);
    return {vagas,unidades,fonte:{spreadsheetId:source.spreadsheetId||'',lidoEm:source.lidoEm||new Date().toISOString(),tipo:'Google Sheets'},historico:[]};
  }
  function efetivas(state,hoje=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})) {
    return (state.vagas||[]).map(v=>{const m=state.ajustes?.[v.codigo];const mudou=m&&m.assinatura!==v.assinatura; const r=m?{...v,...m}: {...v};
      r.piso=piso(v.numero);r.codigo=v.codigo;r.numero=v.numero;r.origem=v.origem;r.manual=!!m;
      r.alertas=m&&!mudou?[]:[...(v.alertas||[])];if(mudou){r.situacao='conferir';r.alertas.push('A planilha mudou depois da conferência salva na Domo. Revise os dados.');}
      r.vencida=r.situacao==='reservada'&&!!r.expiracao&&r.expiracao<hoje;
      r.pendenteContrato=['vendida','reservada'].includes(r.situacao)&&norm(r.contrato)!=='finalizado';return r;
    });
  }
  function validarAjuste(cod,a,state) {
    const v=state.vagas.find(v=>v.codigo===cod);if(!v)throw Error('Vaga não encontrada.');
    if(!['disponivel','reservada','vendida'].includes(a.situacao))throw Error('Escolha uma situação válida.');
    const out={};for(const k of ['apartamento','cliente','contrato','observacoes','motivo']){out[k]=clean(a[k]);if(out[k].length>(k==='observacoes'?2000:300))throw Error('Texto muito longo: '+k);}
    if(!out.motivo)throw Error('Informe o motivo da alteração para o histórico.');
    if(a.situacao!=='disponivel'&&!out.cliente)throw Error('Informe o cliente da reserva ou venda.');
    if(a.situacao==='disponivel'&&(out.apartamento||out.cliente))throw Error('Uma vaga disponível não pode manter cliente ou apartamento vinculado.');
    if(out.apartamento&&!state.unidades.some(u=>norm(u.apartamento)===norm(out.apartamento)))throw Error('Selecione um apartamento existente.');
    if(out.apartamento&&efetivas(state).some(x=>x.codigo!==cod&&norm(x.apartamento)===norm(out.apartamento)))throw Error('Este apartamento já está vinculado a outra vaga. Confira antes de transferir.');
    out.reserva=data(a.reserva);out.expiracao=data(a.expiracao);
    if(a.situacao==='reservada'&&(!out.reserva||!out.expiracao))throw Error('Informe início e prazo da reserva.');
    if(out.reserva&&out.expiracao&&out.expiracao<out.reserva)throw Error('O prazo não pode ser anterior à reserva.');
    out.situacao=a.situacao;out.assinatura=v.assinatura;return out;
  }
  const api={STATUS,PISOS,LINHAS,codigo,piso,status,numero,data,parseCSV,importar,efetivas,validarAjuste};
  root.DomoVagas=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
