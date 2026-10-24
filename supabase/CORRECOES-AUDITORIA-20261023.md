# Correções de preservação, permissões e cálculos — v64

## Homologação e ordem de publicação

Publicação autorizada após homologação. A migração passou em PostgreSQL 17.6 isolado com duas conexões independentes, além da suíte de 105 testes. A cópia privada dos anexos foi restaurada e conferida por tamanho e SHA-256. Dados reais e links temporários ficam fora do repositório. Ordem de implantação:

1. Conferir/restaurar em homologação uma cópia de dados e uma cópia separada dos bytes do bucket `domo-arquivos`.
2. Aplicar `migrations/0004_gravacao_atomica.sql` em homologação, depois no projeto autorizado. A transação aborta se encontrar OCs vivas duplicadas para uma cotação ou uma ordem vinculada a duas permutas. Nesses casos, revisar os registros; nunca apagar automaticamente para fazer a migração passar.
3. Publicar as Functions `domo-nucleo`, `domo-acervo`, `domo-rotina` e `domo-drive` com os módulos compartilhados. A função CAS não tem fallback para upsert sem proteção. Conferir segredo de assinatura do Drive: `DRIVE_TICKET_SECRET`, ou uma chave secreta do servidor já configurada; o token público não é mais suficiente.
4. Publicar o frontend que envia `protocoloEnvio: 2`, base explícita e entende `confirmados` e recusas recuperáveis. O backend rejeita lotes sem esse protocolo com HTTP 426 antes de qualquer gravação, sem `semPermissao`, `recusados` ou `salvos`: o cliente antigo mantém sua fila diante desse erro HTTP. A pessoa deve atualizar o aplicativo sem limpar os dados do navegador; a versão nova migra as pendências para revisão. Assim, a janela servidor-antes-interface não devolve recusas 200 que a versão antiga descartaria.
5. Retestar em homologação com duas sessões independentes e, de forma controlada, na versão oficial: inclusão, edição concorrente, recebimento/fotos, medição, encaminhamento, recarga e sincronização. Nenhum desses passos foi executado em produção nesta tarefa.

## Protocolo e proteção

- `domo_gravar_se_inalterado` compara o JSONB esperado e grava atomicamente no Postgres. Cada conflito refaz leitura, autorização, união e cálculo. RPC restrita a `service_role`.
- A revisão `_revisao` é UUID do servidor. Cliente envia `_baseExistente`, `_baseRevisao` e `_baseAtualizadoEm`; estes campos não são persistidos. Base desatualizada não substitui campos escalares nem entradas já alteradas. Acréscimos compatíveis de listas/fotos são unidos.
- `salvarLote` exige `protocoloEnvio: 2`. Lotes legados recebem HTTP 426 antes de qualquer efeito, para preservar sua fila durante a atualização.
- `confirmados` contém somente coleção, id, revisão e horário; confirma também compromisso encaminhado que saiu da permissão de leitura do remetente. `salvos` aplica o mesmo filtro de leitura do snapshot.
- Índice único de cotação/OC e tabela de vínculos de permutas com chave única arbitram concorrência entre registros distintos no banco.
- Obra não emite OC, não recebe preços/documentos pessoais nem token do documento comercial. Agenda privada e RH têm proteção equivalente no download e na exclusão.
- Upload tem proprietário por id, partes imutáveis, validação de faixa/tamanho e soma final de bytes. Um arquivo vinculado não pode ser excluído diretamente. A lixeira preserva arquivos ainda usados por registros retidos.
- Validação financeira recusa negativos/não finitos, recebimento de item inexistente, medição obsoleta/inconsistente e amortização excessiva. Valores existentes de medições não são reescritos; cotação e medição seguem arredondamento por linha.
- Falha do backup interrompe a limpeza. Restauração recompõe configurações de negócio e máximos de sequência, preservando credenciais atuais.

## Testes e limites

Os testes `tests/server-regressions.mjs` e `tests/server-controls.mjs` executam os handlers reais, substituindo somente banco, Storage e relógio de serviço por IO local. `tests/helpers/server-env.mjs` também é usado na prévia. `fetch` é bloqueado. A camada RPC do mock simula compare-and-swap, mas não substitui o teste SQL real das constraints.

A suíte de controle falhou em 15 dos 17 cenários presentes na rodada RED contra a fonte original. Após correção e acréscimo das verificações de entradas de lista e fotos simultâneas, 21 controles e 13 regressões estão verdes. Os oito guardas originais também passaram. A raiz executa separadamente os testes da migração com motor PostgreSQL PGlite.

Limitações explícitas:

- Não foi feita alteração, exploração, migração ou verificação de escrita no banco real.
- Além do PGlite, a migração passou em PostgreSQL 17.6 isolado, com restauração privada dos registros atuais e comparação integral antes/depois. Duas conexões reais validaram CAS concorrente, unicidade de OC, unicidade de vínculo de permuta e rollback. Os sete controles passaram. Isso valida a migração em homologação local; não é uma publicação no banco oficial.
- O backup JSON da aplicação contém dados/metadados, não bytes. Para esta publicação foi feita e verificada uma cópia separada de todos os bytes do bucket em pasta privada. A aplicação não passa a executar backup físico automaticamente.
- Checagem de referências de arquivo ocorre na aplicação. Uma restauração/escrita administrativa simultânea ao expurgo físico requer coordenação; não executar essas operações concorrentes durante homologação/publicação.
- Dados antigos já inconsistentes não são recalculados nem apagados automaticamente.
