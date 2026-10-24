# Orçamento Executivo — especificação aprovada

## Objetivo
Criar Execução → Orçamento Executivo no Domo, compacto, responsivo e interativo, com todos os dados disponíveis no PDF fornecido pelo dono. Entregar somente prévia local; publicação exige aprovação posterior.

## Contrato dos dados
Nova coleção `orc` (direção e escritório; obra não acessa dados financeiros). Um registro contém `id`, `obraId`, `nome`, `origem`, `grupos`, `servicos`, `cronograma`, `insumos`, `areas`, `indicadores`, `memorial`, `premissas`, `metodologia`, `paginas`, `validacoes`, `cenarios`, `revisoes`, `vinculos`, `anexos` e metadados usuais do store.

- origem: arquivo, hash SHA256, revisao, emissao ISO, base, bdi, area, apartamentos, vagas, lajes, meses, totalCentavos, composicoesDeclaradas, insumosDeclarados.
- grupos: codigo, nome, totalCentavos, pagina.
- servicos: item (código hierárquico), codigo (composição), fonte, descricao completa, unidade, quantidade, custoUnitario, totalCentavos transcrito, status literal ou vazio, pagina.
- cronograma: mensalMil (valores arredondados do gráfico), trimestralCentavos, etapas (grupo/inicio/fim quando verificável), marcos, nota.
- insumos: codigo, descricao, tipo, totalCentavos, percentual, pagina; apenas os disponíveis no documento.
- paginas: pagina e texto completo, para preservar todo conteúdo do PDF.
- validacoes: id, item opcional, titulo, status (`pendente`, `em-analise`, `validado`), responsavel, prazo ISO, observacao, historico.
- cenarios: id, nome, alteracoes [{item,quantidade,custoUnitario}], nota, criadoEm.
- revisoes: id, nome, cenarioId, alteracoes (snapshot), aprovadoPor, aprovadoEm. Aprovação somente direção; histórico não pode ser reescrito.
- vinculos: id, item, col (`sc`, `cot`, `oc`, `os`, `forn`, `permuta`, `doc`), registroId, etapa (`contratado`, `executado`, `pago`, `permuta`, `referencia`), valorCentavos quando aplicável, data, observacao. Valores são rateios explícitos para etapa, com documento fonte e impedimento de duplicação, não inferidos por status genérico.

Origem, grupos, serviços, cronograma e conteúdo documental são imutáveis após criação. Cenários não substituem o original. Divergências por arredondamento são mostradas, nunca corrigidas artificialmente. Lançamentos reais só contam com origem vinculada; ausência é “não informado”. Contratado/executado/pago são estágios sobrepostos e nunca somados entre si. Permuta é valor econômico separado de saída de caixa.

## API do modelo compartilhado
Global `Orcamento` exportado também para Node: `itens(orc,revisaoId='original')`, `abc(itens)` (classe e participacao/acumulado), `filtrar(itens,{busca,grupo,status,classe})`, `simular(orc,alteracoes)` → {itens,totalCentavos,deltaCentavos}, `resumo(orc,reg)` → {totalOriginalCentavos,totalAtualCentavos,contratadoCentavos,executadoCentavos,pagoCentavos,permutaCentavos,pendencias,servicos,grupos,diferencaCentavos}, `validar(orc,anterior,perfil,reg)` → mensagens de erro. Reg é mapa de coleções do store. Totais reais nulos quando não informados. Atual usa última revisão aprovada, original sempre preservado. Valores financeiros em centavos; quantidade/preço com precisão decimal.

## Telas
Abas Visão geral, Orçamento, Cronograma e caixa, Contratação e execução, Curva ABC, Validações, Cenários e revisões, Documentos. Cards clicáveis abrem recorte. Tabela pesquisável com agrupamento, filtros e descrição integral nos detalhes. Formulários de vínculo, validação e cenário salvam pela mesma fila offline existente. Exportações CSV/JSON e impressão usam o mesmo modelo dos indicadores. Documentos permitem consultar texto completo e PDF, anexar futuros arquivos e explicitar cobertura parcial de composições/insumos.

## Segurança e entrega
Dados reais do PDF e o PDF ficam fora do repositório público. Importação local opt-in por variável de ambiente na prévia. Importador produz JSON privado com hash/páginas, reconcilia valores e não inventa dados ausentes. Seed no servidor simulado; nenhum acesso à conta produtiva. Não alterar cálculo/sincronização existente. Testar modelo, permissão e imutabilidade no servidor, importação, regressões e navegação desktop/celular. Sem commit/push/deploy nesta entrega.

## Evolução aprovada — consolidação progressiva por item

Esta seção atualiza o contrato inicial após a auditoria. O pedido autoriza corrigir cálculos, preservação, permissões e salvamentos, com prévia local antes de publicar.

- R00 continua imutável. `vigente` combina referências executivas com a última aprovação de cada item; `consolidado` contém os itens com aprovação registrada. Revisões anteriores são cumulativas.
- `consolidacoes` guarda eventos imutáveis com item, estado, base do item, quantidade, custo unitário, total em centavos, responsável, evidência e motivo. Estados: executivo (ausência de evento), em conferência, aguardando aprovação, consolidado e revisão solicitada. A autoria/data confirmadas pertencem ao servidor autenticado. Somente direção consolida.
- Reabrir um item mantém a última aprovação até a próxima decisão. Os indicadores explicam revisões em andamento. Pendências impeditivas impedem aprovação e exigem evidência para resolver.
- Cenários usam a base vigente; mudança de base exige nova conferência. Aprovação de cenário gera eventos por item. Aprovar orçamento não registra pagamento ou execução.
- Vínculos distinguem referência, contratado, recebido (material), executado, pago e permuta. Rateios são conferidos com a origem e com os demais orçamentos ativos. Vínculos divergentes permanecem visíveis, com ações de correção ou inativação com motivo.
- Rascunhos por formulário preservam múltiplas linhas e sobrevivem à recarga. Edições independentes são conciliadas por campo/item; conflitos exigem escolha, sem sobrescrever silenciosamente.
- Anexos têm cópia durável e reserva até a confirmação do vínculo. O diário de sincronização só é retirado após confirmar a cópia offline.
- A gravação financeira usa `domo_gravar_orcamento` com controle de concorrência. A migração 0005 precisa de homologação antes de uma futura publicação; esta entrega não aplica migrações remotas.
- Restauração preserva históricos e identifica separadamente o ato de importar o backup. A restauração do backup completo continua sem atomicidade global; a gravação de cada orçamento é transacional e há pré-validação das fontes e saldos antes de iniciar.
