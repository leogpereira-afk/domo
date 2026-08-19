// Todos os ids de arquivo que UM registro usa. ÚNICO lugar de verdade.
//
// Antes esta função morava COPIADA em três Edge Functions (nucleo, acervo,
// rotina) e elas divergiram: os anexos da conversa de compromisso e o PDF do
// ASO (coleção 'pessoa') entraram só na cópia do acervo. Resultado — o
// "Esvaziar lixeira" e o varredor de órfãos usavam a lista incompleta, então o
// arquivo de saúde ou ficava para sempre no bucket, ou era apagado de um
// colaborador ATIVO ~1 dia depois. Uma cópia só mata a classe inteira.
export function arquivosDoRegistro(o: any): string[] {
  const ids: string[] = [];
  if (o.arquivoId) ids.push(o.arquivoId);
  for (const v of (o.versoes || [])) if (v && v.arquivoId) ids.push(v.arquivoId);
  for (const r of (o.recebimentos || [])) for (const f of (r.fotos || [])) if (f) ids.push(f);
  for (const d of (o.diario || [])) for (const f of (d.fotos || [])) if (f) ids.push(f);
  for (const d of (o.documentos || [])) if (d && d.arquivoId) ids.push(d.arquivoId);
  for (const a of (o.anexos || [])) if (a && a.arquivoId) ids.push(a.arquivoId);
  for (const a of (o.asos || [])) if (a && a.arquivoId) ids.push(a.arquivoId);
  // A nota que sustenta um lançamento de permuta.
  for (const l of (o.lancamentos || [])) if (l && l.anexo && l.anexo.arquivoId) ids.push(l.anexo.arquivoId);
  return Array.from(new Set(ids));
}
