import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('importador',Path(__file__).parents[1]/'scripts/importar-orcamento-pdf.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class ImportTests(unittest.TestCase):
    def test_preserve_decimal_and_full_description(self):
        services,groups=m.parse_annex([(1,''' 01     GRUPO SINTÉTICO     R$ 15,01    100,0%
 01.01    TESTE    DOMO    Serviço sintético     M2    3,00    5,00    15,01    A validar
                                  segunda linha com descrição integral

Orçamento executivo · folha 1/1''')])
        self.assertEqual(services[0]['descricao'],'Serviço sintético segunda linha com descrição integral')
        self.assertEqual(services[0]['totalCentavos'],1501)
        self.assertEqual(groups[0]['totalCentavos'],1501)
        self.assertEqual(services[0]['custoUnitario'],5)
    def test_fail_on_unrecognized_row(self):
        with self.assertRaises(ValueError):m.parse_annex([(1,' 01.01 corrupto')])
    def test_reject_duplicates(self):
        page=' 01     GRUPO     R$ 15,00    100,0%\n 01.01    X    DOMO    Exemplo     UN    3,00    5,00    15,00'
        with self.assertRaises(ValueError):m.parse_annex([(1,page),(2,page)])
    def test_brazilian_precision(self):
        self.assertEqual(m.cents('1.234,56'),123456)

if __name__=='__main__':unittest.main()
