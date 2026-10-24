"""Extrai o anexo sintético de um book DOMO para um JSON privado.

Uso: python scripts/importar-orcamento-pdf.py entrada.pdf /caminho/privado/base.json
Não altera o PDF, não envia dados e recusa saída dentro do repositório.
Requer pypdf. Os valores transcritos não são recalculados pelo preço arredondado.
"""
import argparse
import hashlib
import json
import re
from decimal import Decimal
from pathlib import Path

NUM = r"[\d.]+,\d+"
ROW = re.compile(r"^\s*(\d{2}\.\d{2}(?:\.\d{2})?)\s+(\S+)\s+(SINAPI|DOMO)\s+(.+?)\s{2,}(\S+)\s+("+NUM+r")\s+("+NUM+r")\s+("+NUM+r")(?:\s+(A validar|Verba|Cotação))?\s*$")
GROUP = re.compile(r"^\s*(\d{2})\s{2,}(.+?)\s{2,}R\$\s*("+NUM+r")\s+[\d,]+%\s*$")

def number(text):
    return Decimal(text.replace('.', '').replace(',', '.'))

def cents(text):
    return int(number(text) * 100)

def parse_annex(pages):
    services, groups = [], []
    current = None
    for page, text in pages:
        current = None
        for line in text.splitlines():
            m = ROW.match(line)
            if m:
                item, code, source, description, unit, qty, price, total, status = m.groups()
                current = dict(item=item,codigo=code,fonte=source,descricao=description.strip(),
                    unidade=unit,quantidade=float(number(qty)),custoUnitario=float(number(price)),
                    totalCentavos=cents(total),status=status or '',pagina=page)
                services.append(current)
                continue
            g = GROUP.match(line)
            if g:
                groups.append(dict(codigo=g[1],nome=g[2].strip(),totalCentavos=cents(g[3]),pagina=page))
                current = None
                continue
            if re.match(r'^\s*\d{2}\.\d{2}',line):
                raise ValueError(f'Linha de serviço não reconhecida na página {page}: {line.strip()}')
            if not line.strip():
                continue
            # Descrições continuam na coluna textual. Rodapé/cabeçalho nunca entra.
            if current and len(line)-len(line.lstrip()) >= 20 and not any(x in line for x in ('CUSTO DIRETO TOTAL','R$','Total (R$)')):
                current['descricao'] += ' ' + line.strip()
            elif not line.startswith(' ' * 20):
                current = None
    if len({s['item'] for s in services}) != len(services):
        raise ValueError('Itens duplicados no anexo')
    if len({g['codigo'] for g in groups}) != len(groups):
        raise ValueError('Grupos duplicados no anexo')
    known = {g['codigo'] for g in groups}
    if any(s['item'].split('.')[0] not in known for s in services):
        raise ValueError('Serviço sem grupo reconhecido')
    if not services or not groups:
        raise ValueError('Anexo sintético não identificado')
    return services, groups

def extract(source):
    from pypdf import PdfReader
    reader = PdfReader(source)
    pages = [(i+1,p.extract_text(extraction_mode='layout')) for i,p in enumerate(reader.pages)]
    annex = [(i,t) for i,t in pages if 'Anexo — orçamento sintético' in t or 'Anexo - orçamento sintético' in t]
    services, groups = parse_annex(annex)
    full = '\n'.join(t for _,t in pages)
    total = re.search(r'CUSTO DIRETO TOTAL\s*[—-]\s*BDI\s*[\d,]+%\s+R\$\s*('+NUM+')',full)
    if not total:
        raise ValueError('Total original não encontrado')
    declared = re.search(r'(\d+) serviços',full)
    if declared and len(services) != int(declared[1]):
        raise ValueError('Quantidade extraída difere da declarada')
    digest = hashlib.sha256(Path(source).read_bytes()).hexdigest()
    groupdiff = {g['codigo']:sum(s['totalCentavos'] for s in services if s['item'].startswith(g['codigo']+'.'))-g['totalCentavos'] for g in groups}
    return dict(id='orc-'+digest[:16],nome=Path(source).stem,origem=dict(arquivo=Path(source).name,hash=digest,totalCentavos=cents(total[1])),
        grupos=groups,servicos=services,paginas=[dict(pagina=i,texto=t) for i,t in pages],
        cronograma={},insumos=[],areas=[],indicadores=[],memorial=[],premissas=[],metodologia=[],
        validacoes=[],cenarios=[],revisoes=[],vinculos=[],anexos=[],
        conferencia=dict(servicos=len(services),grupos=len(groups),diferencaServicosCentavos=sum(s['totalCentavos'] for s in services)-cents(total[1]),
          diferencaGruposCentavos=sum(g['totalCentavos'] for g in groups)-cents(total[1]),diferencasPorGrupoCentavos=groupdiff))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf',type=Path)
    parser.add_argument('saida',type=Path)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    dest = args.saida.resolve()
    if dest == repo or repo in dest.parents:
        parser.error('Dados do orçamento devem ficar fora do repositório público')
    if dest.exists():
        parser.error('A saída já existe; escolha outro nome para preservar a versão anterior')
    result = extract(args.pdf)
    dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(json.dumps(result,ensure_ascii=False,indent=2))
    dest.chmod(0o600)
    print(json.dumps(result['conferencia'],ensure_ascii=False))
