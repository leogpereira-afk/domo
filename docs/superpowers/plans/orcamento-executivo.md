# Plano de implementação — Orçamento Executivo

Spec: docs/superpowers/specs/orcamento-executivo.md
Goal: módulo completo e prévia local do orçamento sem publicação e sem dados privados no Git.
Architecture: coleção agregada `orc`, modelo puro compartilhado, UI em JS/CSS isolados, servidor atual com validação, importador local e seed privado.
Tech: JavaScript, TypeScript/Deno, Python/pypdf, harness Node existente.

## Restrições globais
Preservar R00 e fila offline v65, permissões no servidor, dados privados fora do repositório, nenhuma escrita produtiva, nenhuma publicação. Contratado/executado/pago não somam entre si. Totais de origem preservados inclusive arredondamento. Fonte e página acessíveis. Dados ausentes não são zero.

## Task 1 — Modelo e servidor
Criar orcamento-model.js e testes unitários com fixtures sintéticas. Registrar coleção orc no cliente/servidor e proteger original/revisões/permissões na validação do servidor. Implementar filtros, ABC, simulação e resumo. Rodar testes relevantes e scripts/test.mjs. Dono: agente de modelo.

## Task 2 — Interface compacta
Criar orcamento.js/orcamento.css e integrar rota, menu, assets e cache. Oito abas funcionais, filtros/detalhes completos, formulários de vínculo/validação/cenários, aprovação só direção, exportação e documentos. Usa API modelo da spec. Testar sintaxe e interações em navegador após seed. Dono: agente de interface.

## Task 3 — Importação e prévia
Extrair PDF em JSON privado com descrições completas, fonte e página. Reconciliar serviços/grupos/total e registrar precisão. Guardar texto completo para cobertura do book. Integrar seed por env ao preview-server, PDF privado protegido por sessão e sem inclusão em assets públicos. Dono: controlador.

## Task 4 — Revisão e verificação
Revisão independente dos três conjuntos; corrigir falhas. Suite completa, casos financeiros e permissões, persistência offline/recarga, visual em desktop e 375px, navegação de todas as abas e lançamento das validações/cenários. Abrir prévia local e informar cobertura e limitações. Sem publicação.

## Continuação — auditoria e consolidação por item

Implementar e verificar A01–A12: cálculos cumulativos e bases consistentes; rateios globais e limites por fonte; permutas/recebimento; anexos duráveis; conciliação de edições e recuperação; reparo de vínculos divergentes; rascunhos completos; eventos de consolidação; valores transcritos preservados em alterações sem efeito; responsividade intermediária. Revisão independente acrescenta proteção a campos vazios, filtros sem efeito invisível, origem ausente e intenção explícita de consolidar.

Entregar relatório local de verificação e prévia persistente separada, usando dados sintéticos para gravar/aprovar. Nenhum dado real do PDF é alterado nos ensaios. Sem commit, push, migração remota ou deploy.
