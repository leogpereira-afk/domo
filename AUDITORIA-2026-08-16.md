# Auditoria do sistema Domo — 16/08/2026

8 frentes de análise adversarial + verificação. **114 suspeitas levantadas**, das quais
**6 foram verificadas a fundo** antes de a cota de uso acabar; mais 3 verifiquei à mão.

## Já corrigido e no ar
- Histórico não entrega mais valores para o perfil obra (mascara R$ no texto livre) — servidor
- Segunda ordem de compra da mesma cotação é recusada; ocId virou grudento — servidor
- "Reabrir" nos compromissos concluídos (o clique disparava 2x) — cliente v46
- hojeISO usava UTC: lembrete criado à noite nascia com data de amanhã — cliente v46

## Verificado, ainda em aberto (precisa de decisão)
- Login sem limite de tentativas: dá para testar senha em massa (exige contador de tentativas)
- Formulário público de solicitação sem limite: dá para inundar com pedidos falsos
- sugerirEtapa/relatarEntrega crescem o cronograma sem teto

## Refutado pela checagem em produção
- "cron nunca rodou / token de exemplo" — FALSO: roda 6:00 todo dia, entrega HTTP 200, backup de hoje gravado

---

## Suspeitas levantadas e NÃO verificadas (113)
> Levantadas por análise de código; **não confirmadas**. Tratar como pista, não como fato.

### [ALTO] Histórico de OC/OS vaza todos os valores financeiros para o perfil 'obra' (que é cego a preço por design)
- **onde:** `supabase/functions/_shared/acesso.ts`:163
- **o quê:** filtrarLeitura() aplica semValores() nas coleções semPreco ['oc','os','cot'] e ainda apaga medicoes/aditivos, justamente para o perfil 'obra' nunca levar preço para casa. Mas semValores() só remove CHAVES conhecidas (CAMPOS_VALOR: preco/total/frete/…); ele NÃO sanitiza o conteúdo de string. E o histórico é gravado com o valor embutido em texto no campo o_que (store.js:188, campo 'o_que' — que não 
- **quando quebra:** Almoxarife (perfil 'obra') sincroniza e abre uma Ordem de Serviço de um empreiteiro. Os campos de valor aparecem em branco (semValores os removeu), mas a aba Histórico mostra 'Contrato alterado: R$200.000,00 → R$230.000,00', 'Medição 03 paga: R$45.000,00', 'Retenção de garantia liberada: R$11.500,00', 'Adiantamento de R$20.000,00'. O almoxarife agora conhece o valor do contrato e toda a folha de p

### [ALTO] Endpoint de login 'entrar' sem rate limit nem bloqueio: força-bruta online da senha-mestra e das senhas de usuário
- **onde:** `supabase/functions/domo-nucleo/index.ts`:377
- **o quê:** Toda a segurança do sistema repousa na SENHA ('quem protege os dados de verdade é a SENHA' — nucleo/index.ts:8). O outro barreira, o TOKEN, está hardcoded no bundle (config.js:11) num repositório PÚBLICO, logo é conhecido. A ação 'entrar' é PÚBLICA (só exige o TOKEN) e é um oráculo perfeito: retorna 200 quando a senha bate e 403 'Senha incorreta' quando não (linhas 383-384/393), sem QUALQUER throt
- **quando quebra:** Um curioso pega o TOKEN do bundle público e dispara um script contra POST /functions/v1/domo-nucleo com {action:'entrar', senha:<palpite>} a milhares de tentativas por minuto, sem nenhuma restrição do servidor. Ao acertar a senha-mestra (ou a de qualquer usuário) recebe 200 e daí em diante lê o snapshot inteiro (preços, contratos, RH com CPF/salário) e pode apagar registros. Não há lockout após N 

### [ALTO] Cancelar OC com recebimento é revertido em silêncio para 'parcial' pelo servidor
- **onde:** `supabase/functions/domo-nucleo/index.ts`:146
- **o quê:** Em gravar(), quando a OC tem recebimentos e a situação guardada não é 'cancelada'/'rascunho', o recálculo sobrescreve QUALQUER situação vinda do cliente que não seja 'entregue': `else if (novo.situacao !== "entregue") novo.situacao = "parcial"` (index.ts:145-146; idêntico no legado netlify/functions/nucleo.mjs:243-244). O botão 'Cancelar ordem' é oferecido justamente para OC 'parcial' (compras.js:
- **quando quebra:** Fornecedor entrega 40 de 120 sacos (OC vira 'parcial') e avisa que o resto não vem; o escritório clica 'Cancelar ordem' e escreve o motivo. Localmente aparece 'Cancelada', mas o servidor regrava 'parcial'; no próximo sync a OC volta como 'Recebida em parte', continua somando no total 'em aberto' (compras.js:478-479) e na tela de Recebimento para sempre — repetir o cancelamento nunca pega. Pior: o 

### [ALTO] SC fecha como 'atendida' com itens que nunca foram comprados (fechamento por status de OC, não por cobertura de item)
- **onde:** `supabase/functions/domo-nucleo/index.ts`:165
- **o quê:** O fechamento da SC (servidor index.ts:157-179 e cliente recalcularSC compras.js:447) só confere se TODAS as OCs em sc.ocIds estão 'entregue' — nunca se os ITENS da SC estão cobertos por alguma OC. Dois caminhos criam OC que cobre só parte dos itens: (a) escolherFornecedor exclui da OC os itens sem preço (cotacao.js:559-562) — e o diálogo de confirmação mente, dizendo que 'a ordem vai sair com esse
- **quando quebra:** SC-0007 pede vergalhão, arame e prego. Na cotação o fornecedor dá preço só em vergalhão e arame; o comprador confirma a escolha parcial — a OC nasce com 2 itens. Quando essa OC é recebida por completo, o servidor marca a SC 'atendida' (não há outra OC pendente). O prego nunca entrou em ordem nenhuma e some de todos os radares: 'Puxar de solicitações' só lista SC em 'nova/aprovada/em_cotacao/em_com

### [ALTO] Backend legado (o que a equipe usa hoje) aceita 'comp' sem nenhum gate: agenda de todos vaza e é editável por qualquer perfil
- **onde:** `/Users/leonardopereira/Projetos/domo/netlify/functions/nucleo.mjs`:421
- **o quê:** prepararComp (carimbo de dono, snapshot por dono, historico append-only, limpeza de donoNome/encaminhadoPor) existe SÓ no porte Supabase (commit 4ffd191 alterou supabase/functions/domo-nucleo/index.ts, mas netlify/functions/nucleo.mjs nunca foi atualizado — git log mostra só o commit inicial). O legado, porém, foi deliberadamente habilitado para 'comp': netlify/functions/lib/colecoes.mjs:19 regist
- **quando quebra:** Enquanto a virada não acontece, um usuário do perfil obra logado em domo-construtora.netlify.app chama 'snapshot' e recebe os compromissos de toda a equipe (inclusive da direção); um escritório chama 'salvarLote' com o id de um compromisso do diretor e reescreve o texto de um comentário antigo assinando como quiser — o mesmo pedido que o backend Supabase recusaria.

### [ALTO] Adiantamento lançado no editor some da conta assim que o 1º lançamento novo é feito
- **onde:** `/Users/leonardopereira/Projetos/domo/servicos.js`:64
- **o quê:** totaisOS calcula `const adiantamento = somaLancados || Number(os.adiantamento) || 0`. O campo antigo `os.adiantamento` (que o editor ainda grava — linhas 298 e 352) só vale enquanto NÃO existe nenhum item em `os.adiantamentos`; no momento em que a direção usa o botão '💵 Adiantamento' (lancarAdiantamento, linha 1039), o valor do editor é descartado da soma — o próprio comentário (linhas 59-61) prom
- **quando quebra:** OS emitida com 'Adiantamento (R$)' = 10.000 no editor. Medição 01 amortiza 4.000 (saldo mostrado: 6.000). A direção entrega mais 5.000 pelo botão 'Adiantamento'. A partir daí totaisOS considera adiantamento = 5.000: 'Já pago' cai 10.000, o saldo a amortizar vira 1.000 (deveria ser 11.000) e a validação de salvarMedicao bloqueia qualquer amortização acima de 1.000 — os 10.000 originais nunca mais s

### [ALTO] Medição PAGA pode regredir para cancelada (ou aprovada→rascunho) por escrita de aparelho desatualizado — servidor não guarda o estado da medição
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-nucleo/index.ts`:99
- **o quê:** unirPorId funde cada medição por id com `{...anterior, ...it}`: o item que CHEGA sempre sobrescreve campo a campo o guardado, sem comparar recência nem respeitar máquina de estados (o servidor protege a situação da OC e o historico do comp, mas nenhuma transição de medição). A trava do cliente (`if (m.situacao === 'paga')`, servicos.js:958) confere só a cópia local. O mesmo mecanismo faz QUALQUER 
- **quando quebra:** 10h: escritório marca a Medição 02 como paga no PC (pagoEm gravado). O engenheiro está sem sinal desde 9h e, na tela dele, a 02 aparece 'aprovada'; ele a cancela (a trava local permite). Quando o sinal volta, a fila sobe e o servidor grava `{...paga, ...cancelada}` → situacao final 'cancelada'. O dinheiro já pago sai de 'Já pago' e do 'Retido' (totaisOS só soma situacao==='paga'), o aviso 'Confira

### [ALTO] Apontamento do diário e avaliação gravam a OS a partir do retrato do render — aditivo/etapas e situação são desfeitos
- **onde:** `/Users/leonardopereira/Projetos/domo/servicos.js`:1159
- **o quê:** novoApontamento salva `Object.assign({}, o, { diario: ... })` e avaliarPrestador salva `Object.assign({}, o, { avaliacao: aval })` (linha 1236) usando o `o` capturado no render — sem reler `achar('os', o.id)` como todos os outros handlers fazem (padrão das linhas 844, 917, 981, 1001, 1034, 1068, com comentário explicando que 'itens não é campo de união'). Com modal aberto o app adia o redesenho (a
- **quando quebra:** O encarregado abre 'Apontamento do dia' e passa 10 minutos subindo fotos no 4G. Nesse meio tempo o escritório lança um aditivo (etapa nova em `os.itens`) e o sync o traz para o aparelho. Ao salvar o apontamento, o registro sobe com os `itens` antigos: o servidor troca `itens` (não é CAMPOS_UNIAO) e a etapa do aditivo some do contrato — fica só a linha do histórico 'Aditivo de R$ X' apontando para 

### [ALTO] Sublistas substituídas pelo link público ressuscitam ao unir com cópia velha do painel (remessas e precos)
- **onde:** `supabase/functions/domo-nucleo/index.ts`:746
- **o quê:** Os endpoints públicos SUBSTITUEM sublistas: responderPrazo troca e.remessas inteiro (index.ts:746; nucleo.mjs:739) e responderCotacao troca f.precos inteiro (index.ts:666; nucleo.mjs:661). Já o caminho do painel (salvarLote→gravar) faz UNIÃO sem lápide: SUBLISTAS_UNIAO ['remessas','entregas','itens_recebidos'] e SUBOBJETOS_UNIAO ['precos'] (index.ts:88-89; nucleo.mjs:199-200) juntam item a item em
- **quando quebra:** O concreteiro manda programação de 2 caminhões (ids rmA,rmB). O painel do engenheiro sincroniza e guarda essa cópia. O concreteiro clica 'Alterar programação' e manda 3 caminhões com outras datas (servidor substitui por rmC,rmD,rmE). O engenheiro, com a cópia velha (fila offline ou até 90s sem pull), edita qualquer coisa do cronograma → gravar une [rmC,rmD,rmE] com [rmA,rmB] → a etapa passa a exib

### [ALTO] Backend Netlify (o que a equipe usa hoje) não chama reporProtegidos nem carimba recebidoEm — correções só existem no Supabase
- **onde:** `netlify/functions/nucleo.mjs`:450
- **o quê:** O salvarLote legado chama motivoRecusa direto no registro cru (nucleo.mjs:449-455) e o import (linhas 17-20) nem traz reporProtegidos — a função foi adicionada em lib/acesso.mjs:124 (commit 1cdaed0) mas nucleo.mjs está intocado desde o commit inicial (git confirma). Também falta no gravar legado o carimbo de recebidoEm ao virar 'entregue' (bloco existe só em index.ts:156). Como o app v43 recebe 40
- **quando quebra:** Usuário de perfil obra no app do Netlify: ele lê a OC mascarada por semValores (itens sem 'preco'). Ao registrar um recebimento, o registro enviado tem itens ≠ do guardado → motivoRecusa devolve 'quem é da obra não altera "itens" em oc' e o recebimento — a prova de que o material chegou — é recusado. No cronograma: o escritório renomeia o cronograma ou o encerra; o almoxarife com cópia velha concl

### [ALTO] Cotação decidida não tem trava no servidor — dois aparelhos geram duas ordens de compra (compra dupla)
- **onde:** `/Users/leonardopereira/Projetos/domo/cotacao.js`:514
- **o quê:** A única proteção contra decidir a mesma cotação duas vezes é no CLIENTE (cotacao.js:514: `if (atual.ocId || atual.situacao === 'atendida')`), consultando o cache local. O servidor (gravar() em supabase/functions/domo-nucleo/index.ts:116-215) aceita qualquer gravação de 'cot' sem verificar se ela já foi decidida, e aceita qualquer OC nova — numera e dá tokenPublico. Agrava: sc.ocIds e cot.ocId NÃO 
- **quando quebra:** Escritório decide a cotação CT-0007 no desktop às 10h (OC-0031 criada). O celular da direção está offline desde as 9h com a cotação ainda 'aberta' no cache; às 11h a direção clica Escolher no celular — o guard local passa (cache não tem ocId), cria OC-0032 e enfileira. Ao reconectar, o servidor grava as duas: OC-0031 e OC-0032 vivas, dois PDFs no WhatsApp, material comprado duas vezes; e sc.ocIds 

### [ALTO] Adiantamento antigo (os.adiantamento) é SUBSTITUÍDO, não somado, pelo primeiro lançamento novo
- **onde:** `servicos.js`:64
- **o quê:** totaisOS calcula `const adiantamento = somaLancados || Number(os.adiantamento) || 0` — o campo legado do editor só vale quando a lista `adiantamentos` está VAZIA. O comentário logo acima (linhas 59-61) promete que o número antigo 'continua valendo como o primeiro deles', mas nada migra os.adiantamento para dentro da lista: lancarAdiantamento (linha 1039) só faz append do lançamento novo. No primei
- **quando quebra:** Contrato criado no editor com Adiantamento = R$ 20.000 (campo da linha 298, gravado na linha 352). A obra amortiza R$ 8.000 em medições. Depois a direção lança um segundo adiantamento de R$ 5.000 pelo botão '💵 Adiantamento'. A partir daí: adiantamento total vira R$ 5.000 (não R$ 25.000), 'Já pago' cai R$ 20.000 na tela, e adiantamentoSaldo = max(0, 5000−8000) = 0 — os R$ 12.000 restantes do primei

### [ALTO] Apontamento do diário grava o retrato velho da OS e apaga aditivo/estado gravado por outro aparelho
- **onde:** `servicos.js`:1159
- **o quê:** novoApontamento captura `o` na abertura do modal e o handler de salvar faz `Object.assign({}, o, { diario: [...] })` SEM reler via achar('os', o.id) — exatamente a classe de bug que salvarMedicao (linhas 841-845), lancarAdiantamento (1034) e lancarAditivo (1068) já corrigem com o comentário 'itens não é campo de união'. O modal do diário fica aberto por minutos (upload de fotos no 4G), o puxar() r
- **quando quebra:** O engenheiro abre 'Apontamento do dia' na obra e passa 5 minutos subindo fotos. Nesse meio tempo o escritório lança um aditivo de R$ 15.000 (etapa nova em `itens`) e ele sincroniza para o aparelho do engenheiro. Ao salvar o apontamento, o registro sobe com o `itens` antigo (sem o aditivo) e o servidor grava por cima (spread da linha 120 do nucleo): a etapa do aditivo é apagada do contrato no servi

### [ALTO] Cron do Supabase agendado com token placeholder — rotina diária (backup/faxina) nunca autentica
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/migrations/0002_cron.sql`:21
- **o quê:** 0002_cron.sql foi commitado com a URL REAL do projeto (reoghclxripktzpdwhiy) mas com o header 'x-rotina-token' valendo o placeholder literal 'SEU_ROTINA_TOKEN' (linha 21). O comentário do arquivo diz que 'o script de virada faz isso sozinho', mas esse script NÃO EXISTE — /Users/leonardopereira/Projetos/domo/scripts/ contém apenas migrar-para-supabase.mjs, que não toca no cron. O arquivo meio-edita
- **quando quebra:** Todo dia às 06:00 UTC o pg_cron dispara, domo-rotina responde 401 ('Não autorizado', index.ts:49), o job marca 'succeeded' e ninguém vê nada. Meses depois alguém apaga um registro errado ou o banco corrompe: o backup mais recente em domo_backup é inexistente (ou parou no dia da virada), e a lixeira/órfãos nunca foram limpos.

### [ALTO] Script de re-migração (a virada pendente) descarta 'comp' em silêncio, sobrescreve cfg e pode REGREDIR a numeração — com o portão de conferência verde
- **onde:** `/Users/leonardopereira/Projetos/domo/scripts/migrar-para-supabase.mjs`:35
- **o quê:** A virada Netlify→Supabase ainda vai acontecer (a equipe segue no Netlify desde 31/07) e a única ferramenta é scripts/migrar-para-supabase.mjs. Três defeitos: (1) linha 35 tem uma TERCEIRA cópia da lista de coleções — ['sc','cot','crono','oc','os','forn','prest','doc','proj'] — sem 'comp', que o backend Netlify legado ACEITA (netlify/functions/lib/colecoes.mjs inclui comp) e a equipe pode ter alime
- **quando quebra:** Dia da virada: roda-se o script com o backup fresco do Netlify. Os compromissos/lembretes que a equipe criou no Netlify desde 31/07 somem sem erro (script imprime tudo verde); as senhas configuradas no Supabase são apagadas e ninguém entra; e a próxima SC sai como SC-0014 quando uma SC-0014 já existe — dois documentos com o mesmo código na mão de fornecedores.

### [ALTO] Acervo (arquivos) não tem caminho de migração nem cópia de segurança dos bytes em lugar nenhum
- **onde:** `/Users/leonardopereira/Projetos/domo/scripts/migrar-para-supabase.mjs`:66
- **o quê:** Nenhum script copia os blobs do store 'arq' do Netlify para o Storage domo-arquivos + coleção _arqmeta do Supabase — migrar-para-supabase.mjs só migra registros/cfg/seq. O backup do app (nucleo index.ts:918, ação 'backup') e o backup diário da rotina (index.ts:66-69) carregam apenas o INVENTÁRIO (metas), nunca os bytes. Em 31/07 havia 0 arquivos referenciados (verifiquei no backup-migracao), mas a
- **quando quebra:** Virada feita com o script atual: o almoxarife abre um recebimento de agosto e clica na foto — 'Arquivo não encontrado'. A foto (a prova de que o material chegou) existia só no Blobs do Netlify, que no padrão das migrações anteriores é APAGADO depois da virada. Alternativa sem virada: o projeto Supabase é perdido/recriado — todo o acervo some e nenhum backup contém os bytes.

### [ALTO] Pontualidade do prestador usa atualizadoEm porque concluidaEm nunca é gravado — nota despenca a cada toque posterior na OS
- **onde:** `/Users/leonardopereira/Projetos/domo/qualificacao.js`:207
- **o quê:** qualificacao.js:205-211 calcula a pontualidade do prestador com `o.concluidaEm || o.atualizadoEm`, mas NENHUM código grava `concluidaEm` em ordem de serviço: avancarOS (servicos.js:650-652) faz `Object.assign({}, o, { situacao: destino })` sem carimbo de data (grep no repo inteiro: concluidaEm só existe em etapas de cronograma). Logo a conta usa SEMPRE `atualizadoEm` — que muda em qualquer gravaçã
- **quando quebra:** OS com dataTerminoPrevista 01/06 é concluída em 01/06 (no prazo). Em agosto a direção paga a última medição (pagarMedicao → salvar('os') → atualizadoEm = 15/08). desempenhoPrestador calcula atraso = 15/08 − 01/06 = +75 dias → pontualidade 0% (peso 4 de 9) → a nota do prestador cai de A para C/D e a lista de prestadores (servicos.js:1278) passa a mostrar selo 'Evitar' para quem entregou em dia.

### [ALTO] Remessas substituídas pelo fornecedor ressuscitam e se duplicam quando qualquer aparelho da equipe regrava o cronograma
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-nucleo/index.ts`:746
- **o quê:** responderPrazo SUBSTITUI a programação (`...(remessas.length ? { remessas } : {})`, domo-nucleo/index.ts:746 e nucleo.mjs:739) e gera ids NOVOS a cada envio, porque o cliente nunca manda id (cronograma.js:707-711). Já a gravação autenticada via salvarLote → gravar() UNE `remessas` por id como SUBLISTA_UNIAO (index.ts:88,100-102). São semânticas contraditórias para a mesma lista: qualquer aparelho 
- **quando quebra:** Concreteiro envia programação de 2 caminhões (dias 5 e 8). O tablet do engenheiro sincroniza. O concreteiro usa 'Alterar programação' e troca para dias 12 e 15 (ids novos; servidor substitui). O engenheiro, com o cache de antes, conclui outra etapa do mesmo cronograma → gravar() une etapas e sub-une remessas → a etapa fica com 4 remessas (5, 8, 12 e 15). A obra programa bomba e equipe para os dias

### [ALTO] Lista 'Concluídos' liga os handlers em DOBRO: 'Reabrir' nunca funciona e 'Editar/Encaminhar' abrem dois modais empilhados
- **onde:** `/Users/leonardopereira/Projetos/domo/compromissos.js`:214
- **o quê:** ligarLinhasComp(el) na linha 207 já liga TODOS os [data-feito]/[data-editcomp]/[data-passar] da tela — inclusive os que estão dentro de #feitosComp (display:none não filtra querySelectorAll). Ao clicar em 'Mostrar concluídos', a linha 214 chama ligarLinhasComp(cx) de novo sobre os MESMOS elementos: cada botão fica com 2 listeners (e mais um a cada abrir/fechar sem re-render). No quadradinho de rea
- **quando quebra:** Qualquer pessoa abre Compromissos → 'Mostrar concluídos' → clica no ✓ de um item concluído para reabri-lo. O item NÃO reabre (nunca — a dupla ligação existe em toda abertura), o histórico da conversa ganha 'Reabriu'+'Marcou como feito' em sequência, e o sync grava esse lixo. Clicar em ✎ (Editar) ou ↪ (Encaminhar) na mesma lista abre DOIS modais idênticos empilhados: ao salvar o de cima, o de baixo

### [ALTO] Escrita concorrente no servidor perde resposta de fornecedor (read-modify-write sem tranca)
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-nucleo/index.ts`:681
- **o quê:** As ações públicas responderCotacao (lerUm em 650 → gravarUm em 681), responderPrazo (717→756), relatarEntrega (764→785) e sugerirEtapa (793→814) leem o registro inteiro, mudam um pedaço e regravam o registro inteiro com gravarUm — SEM passar pelo unirPorId e sem nenhuma tranca/transação. Duas requisições concorrentes sobre o mesmo registro se atropelam: a segunda escrita apaga a primeira, e as dua
- **quando quebra:** O comprador manda o link da cotação para 3 fornecedores no WhatsApp ao mesmo tempo. Dois deles respondem quase juntos: as duas Edge Functions leem a cotação sem resposta nenhuma, cada uma grava c.fornecedores só com a própria resposta, e a que gravar por último vence. O fornecedor A vê '✅ Proposta enviada' com o total na tela, mas a proposta dele sumiu do quadro de comparação — ele não reenvia ('j

### [ALTO] Duas ordens de compra para a mesma cotação + vínculo SC↔OC perdido (ocIds/cotIds fora do CAMPOS_UNIAO)
- **onde:** `/Users/leonardopereira/Projetos/domo/cotacao.js`:514
- **o quê:** escolherFornecedor só barra a segunda escolha olhando o CACHE local (atual.ocId, linha 514) — o servidor não tem guarda nenhuma: gravar() aceita quantas OCs vierem. Além disso os vínculos sc.ocIds, sc.cotIds e cot.ocId são arrays/escalares simples, NÃO estão no CAMPOS_UNIAO (index.ts:79-83), então última escrita vence. O fechamento automático da solicitação no servidor (index.ts:157-179) itera exa
- **quando quebra:** Comprador no escritório e diretor no celular abrem a mesma cotação respondida dentro da janela de sync (90s) e cada um clica 'Escolher' num fornecedor. Saem DUAS ordens de compra numeradas, cada uma com tokenPublico e PDF prontos para ir ao WhatsApp — material comprado duas vezes. cot.ocId fica apontando só para a última; sc.ocIds sofre última-escrita-vence e perde o vínculo com uma das OCs. Quand

### [ALTO] Resposta do salvarLote devolve a OC COMPLETA (com preços) para o perfil obra e ela fica no cache do celular
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-nucleo/index.ts`:477
- **o quê:** O snapshot filtra a leitura da obra com semValores/filtrarLeitura (preço, total, condição de pagamento, dados bancários nunca saem). Mas o salvarLote devolve em `salvos` o registro completo que gravar() retornou (linhas 463 e 477), SEM filtrarLeitura. No cliente, subirFila grava esse registro inteiro em S.reg e chama gravarCache() (store.js:223-231), que persiste tudo em texto puro no localStorage
- **quando quebra:** O almoxarife (perfil obra) registra um recebimento na OC. A resposta do lote traz a OC com preço unitário, total, condição de pagamento e dados bancários do fornecedor; isso vai para o localStorage do celular dele. Se o aparelho ficar offline (ou a pessoa for desligada e o acesso revogado), a informação comercial continua legível no celular — e até o próximo puxar bem-sucedido a tela dele tem os c

### [ALTO] Foto pendente do recebimento: o toast promete "anexe depois", mas o perfil obra não tem NENHUMA tela para anexar — e os arquivos só existem na memória do modal
- **onde:** `compras.js`:1286
- **o quê:** Em telaReceberOC (compras.js), quando a foto não sobe, ela entra em `fotosPendentes` (array de File em RAM, compras.js:1314) e o toast diz "Recebimento salvo, mas N foto(s) não subiram — anexe quando a internet voltar" (compras.js:1286-1287). Só que: (1) o único lugar com botão de anexar é o cartão de recebimentos dentro de telaOC (compras.js:846-847 e 910-911), que vive na rota `compras/<id>` — e
- **quando quebra:** O almoxarife (perfil obra) confere o caminhão sem sinal, registra o recebimento e tira 3 fotos da nota e da carga. As fotos falham e o toast manda anexar quando a internet voltar. O sinal volta; ele procura onde anexar: a tela Recebimento não mostra nada, e "Ver ordem" cai em "Esta parte não é do seu acesso". No escritório, a OC mostra "3 foto(s) não subiram na obra — anexe aqui" — mas as fotos es

### [ALTO] Perfil obra clica "Encerrar cronograma", confirma, e o servidor desfaz EM SILÊNCIO — mas grava no histórico que foi encerrado
- **onde:** `cronograma.js`:323
- **o quê:** O botão "Encerrar cronograma" aparece para qualquer perfil quando o cronograma está ativo (cronograma.js:285) e o handler grava `situacao:'encerrado'` + histórico "Cronograma encerrado" (cronograma.js:323-331). No servidor, CAMPOS_OBRA.crono só permite etapas/responsaveis/historico/atualizadoEm/atualizadoPor (supabase/functions/_shared/acesso.ts:92-95); `reporProtegidos` (acesso.ts:131-148) repõe 
- **quando quebra:** O encarregado com acesso 'obra' abre Cronograma, toca "Encerrar cronograma" e confirma. A tela mostra encerrado por ~1s; o sync devolve o registro e tudo volta a 'ativo' sem mensagem nenhuma. Ele acha que encerrou (o histórico até diz "Cronograma encerrado" com o nome dele); semanas depois o concreteiro segue confirmando datas de um cronograma que a obra dava por morto.

### [ALTO] Botão "Sincronizar" chama render() incondicional e apaga o formulário de página inteira que está sendo preenchido (editor de OC, editor de OS, Configurações)
- **onde:** `app.js`:194
- **o quê:** sincronizarAgora() termina com `render()` seco (app.js:194), ignorando a proteção S.formAberto que o renderSeSeguro respeita (app.js:259-267). Os formulários de página inteira — editorOC (compras.js:524, marca S.formAberto=true), editorOS (servicos.js:250) e TELAS.config (app.js:939) — só leem os campos no clique de Salvar; o render() os reconstrói do zero a partir do registro guardado, descartand
- **quando quebra:** O comprador abre "+ Nova ordem de compra" e digita fornecedor, condições e 12 itens com preço. Vê no rodapé "2 item(ns) esperando envio" e toca "🔄 Sincronizar" para despachar (no desktop o botão fica sempre visível ao lado do formulário). O sync termina, render() redesenha o editor vazio: os 12 itens digitados somem sem aviso e sem volta — a OC nunca tinha sido salva.

### [MEDIO] Escrita pública 'novaSolicitacao' sem rate limit: flood de SCs, esgotamento da numeração e inchaço de banco/log
- **onde:** `supabase/functions/domo-nucleo/index.ts`:546
- **o quê:** novaSolicitacao é PÚBLICA (só TOKEN, que é público no bundle) e GRAVA: cada chamada cria um registro 'sc' via gravar(), consome um número atômico da sequência (proximoNumero → domo_seq incrementa de verdade) e escreve uma linha em domo_log. Não há rate limit, captcha, prova-de-trabalho, nem limite de volume por origem. Contrasta com a rota de LEITURA 'andamento', que ganhou cache de 60s exatamente
- **quando quebra:** Um script com o TOKEN do bundle envia 20.000 novaSolicitacao. A numeração de SC pula para SC-20xxx (documentos reais passam a sair com números absurdos e o índice domo_seq_idx é poluído), o quadro público 'andamento' fica soterrado de pedidos falsos, e domo_registros + domo_log incham sem freio. O legado Netlify (que 'continua aceitando o token') é vulnerável ao mesmo flood hoje.

### [MEDIO] Resposta pública de cotação aceita frete NEGATIVO — total forjado que vira o 'mais barato' e contamina a OC
- **onde:** `supabase/functions/domo-nucleo/index.ts`:667
- **o quê:** Em responderCotacao os preços têm clamp `v > 0` (index.ts:656-659), mas o frete não: `frete: num(body.frete)` (index.ts:667), e num() (index.ts:219) aceita negativo. No cliente público, numeroBR (ui.js:355-367) preserva o '-' digitado no campo Frete (cotacao.js:670). O total gravado (index.ts:663-664) e o totalCotacao da comparação (cotacao.js:8-10) somam o frete negativo.
- **quando quebra:** Fornecedor abre o link público e digita frete '-500' (ou faz o POST direto com o token do convite). O total da proposta dele cai R$ 500, ele aparece como o menor total na comparação e infla a 'economia' mostrada. Se for escolhido, a OC herda `frete: Number(f.frete)` negativo (cotacao.js:563) e totaisOC (compras.js:173) emite o documento oficial com valor líquido menor que o real — na entrega ele c

### [MEDIO] Gravação do comprador com cópia velha reverte a resposta atualizada do fornecedor (merge com o cliente ganhando)
- **onde:** `supabase/functions/domo-nucleo/index.ts`:99
- **o quê:** unirPorId faz `{ ...anterior, ...it }` com a entrada do CLIENTE ganhando nas chaves compartilhadas (index.ts:99), e o subobjeto precos também merge chave a chave com o cliente ganhando (index.ts:103-105). responderCotacao permite ao fornecedor reenviar a proposta ('Pode alterar e enviar de novo', cotacao.js:624), substituindo precos/frete/respondidoEm no servidor (index.ts:666-674). Qualquer grava
- **quando quebra:** Fornecedor reenvia a proposta às 10:00 baixando o item A de R$100 para R$80. O comprador, com snapshot de 9:59 (janela do sync de 90s — ou horas, se offline), convida um terceiro fornecedor às 10:01: o fornecedores[] velho sobe junto e, no merge, precos[A]=100, frete e respondidoEm antigos ganham do novo. O preço de R$80 desaparece do servidor sem rastro; se o comprador escolher esse fornecedor, a

### [MEDIO] Fotos anexadas ao recebimento somem por cópia velha e depois são APAGADAS do Storage pelo varredor de órfãos ('fotos' fora da união; 'itens_recebidos' é chave morta)
- **onde:** `supabase/functions/domo-nucleo/index.ts`:88
- **o quê:** SUBLISTAS_UNIAO = ["remessas", "entregas", "itens_recebidos"] (index.ts:88) — 'itens_recebidos' não existe em lugar nenhum do código (as chaves reais dentro de um recebimento são `itens` e `fotos`). Assim, quando dois aparelhos gravam o MESMO recebimento (mesmo id), o merge `{...anterior, ...it}` deixa a cópia do cliente ganhar em `fotos` e `fotosPendentes`. O fluxo 'Anexar foto ao recebimento' (c
- **quando quebra:** Almoxarife registra o recebimento R1 com 2 fotos pendentes (sem sinal) e sincroniza. O escritório usa 'Anexar foto' e R1 fica com fotos [f1, f2]. O engenheiro, com snapshot de antes do anexo, registra o recebimento R2 na mesma OC: o pacote dele leva R1 velho (fotos [], fotosPendentes 2); no merge a cópia velha ganha e as referências f1/f2 saem do registro. No dia seguinte a rotina apaga f1 e f2 do

### [MEDIO] Duas pessoas escolhendo fornecedor na mesma cotação geram DUAS ordens de compra; uma delas ainda perde o vínculo com a SC
- **onde:** `cotacao.js`:514
- **o quê:** A trava 'cotação já decidida não gera segunda ordem' é só do cliente (cotacao.js:514-519, lê a cópia local). O servidor não valida: gravar() aceita a cot com ocId sobrescrevendo o anterior. Além disso sc.ocIds é campo plano (não está em CAMPOS_UNIAO, index.ts:79-83): cada aparelho grava ocIds calculado da própria cópia, e o último a sincronizar apaga o id da outra OC.
- **quando quebra:** Direção e escritório abrem a mesma cotação respondida e clicam 'Escolher' (fornecedores diferentes) dentro da janela de sync de 90s — ou um deles offline. Cada aparelho cria e numera uma OC no servidor; a cot fica com o ocId de quem gravou por último, e sc.ocIds termina com só UMA das ordens (a outra vira órfã da SC, invisível na tela da solicitação). As duas OCs seguem vivas na lista de compras e

### [MEDIO] Servidor permite ao perfil 'obra' trocar a situacao da OC livremente (cancelar, dar por entregue, voltar a rascunho) sem recebimento
- **onde:** `supabase/functions/_shared/acesso.ts`:93
- **o quê:** CAMPOS_OBRA.oc inclui 'situacao' (acesso.ts:93; legado lib/acesso.mjs:87), então motivoRecusa/reporProtegidos deixam a obra alterar só a situacao. O recálculo do servidor só corrige a situacao quando há recebimentos no registro (index.ts:136-146) — numa OC sem recebimento, o valor enviado é gravado como veio. O fluxo legítimo da obra (registrar recebimento) nem precisa mandar situacao: o servidor 
- **quando quebra:** Alguém com a senha do perfil obra faz um POST salvarLote com {colecao:'oc', registro:{id, situacao:'cancelada'}} numa OC 'enviada' sem recebimentos: o cancelamento pega (recalc não roda). Ou manda situacao:'entregue' — a OC some da tela de Recebimento e do total 'em aberto' sem nenhum material ter chegado. Ou situacao:'rascunho' — o link público do fornecedor passa a responder 403 'Documento ainda

### [MEDIO] Escrita da direção com 'dono' velho re-encaminha o compromisso silenciosamente e fabrica evento no fio
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-nucleo/index.ts`:275
- **o quê:** O cliente reenvia o registro inteiro (com 'dono') em toda gravação: alternarFeitoComp (compromissos.js:230) e comentarCompromisso (compromissos.js:348) fazem Object.assign({}, c, ...) sobre a cópia local. No servidor, para a direção, prepararComp toma dono = txt(registro.dono) || atual.dono (index.ts:275) e, se diferir do guardado, trata como ENCAMINHAMENTO: troca o dono e grava 'Encaminhou de X p
- **quando quebra:** A direção encaminha o compromisso de Ana para Bruno pelo celular; no tablet da mesma direção (sync de 90s ainda não rodou) ela abre a conversa e marca 'feito' ou comenta. O tablet envia dono=ana; o servidor devolve o compromisso para Ana e grava o evento falso 'Encaminhou de Bruno para Ana'. Bruno perde a tarefa da lista dele sem ninguém pedir, e a trilha de auditoria registra um encaminhamento qu

### [MEDIO] Calendário alarma vencimento de ASO superado (não usa asoVigente)
- **onde:** `/Users/leonardopereira/Projetos/domo/rh.js`:493
- **o quê:** eventosDoMes varre TODOS os ASOs vivos da pessoa (for (const a of asosP(p))) e pinta chip 'ASO vence' (vermelho se diasAte < 0) na validade de cada um — enquanto a ficha (rh.js:160-166), a lista (rh.js:123) e a bolha do menu (asosVencendo, rh.js:37-43) julgam só o asoVigente (o de exame mais recente). O calendário contradiz o resto do módulo.
- **quando quebra:** Pedro fez Admissional válido até 20/08/2026 e renovou com um Periódico em 01/08/2026 válido até 2027. No calendário de agosto a direção vê o chip vermelho 'Pedro — ASO vence' no dia 20, enquanto a ficha e a bolha dizem que está tudo em dia — a direção agenda exame desnecessário ou passa a ignorar os alertas vermelhos do calendário.

### [MEDIO] Amortização dupla de adiantamento passa sem alerta: validação usa snapshot velho e adiantamentoExcesso nunca é exibido
- **onde:** `/Users/leonardopereira/Projetos/domo/servicos.js`:824
- **o quê:** salvarMedicao valida a amortização contra `t0 = totaisOS(o)` (linha 822), onde `o` é o retrato do render — não o registro relido na hora de gravar (linha 844). Como `medicoes` é campo de união no servidor, duas medições concorrentes com desconto tipo 'adiantamento' se somam. Depois disso `adiantamentoSaldo` trava em 0 (Math.max) e `adiantamentoExcesso` (linha 81), que denunciaria o estouro, é calc
- **quando quebra:** Saldo de adiantamento: R$ 5.000. Engenheiro e escritório abrem 'Nova medição' ao mesmo tempo (ou um deles fica com o modal aberto enquanto o sync traz a medição do outro); cada um lança desconto de amortização de R$ 5.000. As duas validações passam (cada uma vê saldo 5.000) e o servidor une as duas medições: amortizado = 10.000 sobre 5.000 adiantados. O prestador tem R$ 5.000 descontados a mais do

### [MEDIO] Medições duplicadas aprovadas em aparelhos separados ficam ambas pagáveis, e o aviso da tela diagnostica na direção errada
- **onde:** `/Users/leonardopereira/Projetos/domo/servicos.js`:868
- **o quê:** A única defesa contra número duplicado (dois offline criam a mesma 'Medição 02') é numerosRepetidos() dentro de aprovarMedicao — que roda contra o estado LOCAL. Se cada aparelho aprovar a sua cópia antes do sync, nenhum vê duplicata; depois da união as duas ficam 'aprovada' e pagarMedicao não repete a checagem, então ambas exibem 'Marcar paga' cobrando o MESMO trecho (mesmo % acumulado ⇒ mesmo val
- **quando quebra:** Etapa única de R$ 10.000, Medição 01 com 50% paga. Engenheiro e escritório, ambos sem sinal, lançam cada um a 'Medição 02' com acumulado 100% (R$ 5.000 cada) e cada um aprova a sua. Após o sync existem duas medições 02 aprovadas de R$ 5.000; a tela mostra dois botões 'Marcar paga' e o aviso sugere lançar aditivo 'para o prestador receber' — seguindo o texto, a Domo paga R$ 10.000 por um trecho de 

### [MEDIO] Nota do prestador ('Termina no prazo') usa atualizadoEm como data de conclusão porque concluidaEm nunca é gravado na OS
- **onde:** `/Users/leonardopereira/Projetos/domo/qualificacao.js`:207
- **o quê:** desempenhoPrestador calcula a pontualidade com `o.concluidaEm || o.atualizadoEm`, mas nenhum código grava `concluidaEm` em ordem de serviço — avancarOS (servicos.js:649) só troca `situacao` (o grep mostra concluidaEm apenas em etapas de cronograma). `atualizadoEm` muda em QUALQUER gravação posterior (liberar retenção, avaliação tardia, apontamento, ou o carimbo do próprio servidor em cada gravar).
- **quando quebra:** Serviço com término previsto 01/06 é concluído em dia. Em 15/08 a direção libera a retenção — a gravação atualiza `atualizadoEm` para 15/08. A partir daí a qualificação calcula 75 dias de atraso: 'Termina no prazo' vai a 0%, atraso médio +75d, e a nota do prestador despenca de A para C/D sem ele ter atrasado nada.

### [MEDIO] resposta:null retido na cópia local do painel apaga confirmação recém-feita pelo fornecedor
- **onde:** `cronograma.js`:457
- **o quê:** Ao mudar a data, editarEtapa grava resposta:null (cronograma.js:457) — correto para zerar a confirmação. Mas o null fica persistido na cópia local da etapa, e TODA edição futura reenvia a etapa inteira com resposta:null explícito (novo = Object.assign({}, e, d,...)). Na união do servidor, chave presente com null SOBRESCREVE ({...anterior,...it}, index.ts:99; nucleo.mjs:169) — diferente de chave au
- **quando quebra:** Segunda: engenheiro muda a data da concretagem (resposta zerada, ok). Terça 10h: o concreteiro confirma a data nova pelo link. Terça 10h30, antes do próximo pull (ou offline desde antes da confirmação): o engenheiro corrige a observação da mesma etapa → envia resposta:null → o servidor apaga a confirmação de 10h. A etapa volta a 'Aguardando confirmação' enquanto o histórico ainda diz '✅ confirmou'

### [MEDIO] 'Informar minha programação' fabrica uma confirmação (atende:true) que o fornecedor nunca deu
- **onde:** `cronograma.js`:716
- **o quê:** Em programar(), o cliente envia atende: e.resposta ? e.resposta.atende : true (cronograma.js:716). Se a etapa ainda não tem resposta, o responderPrazo grava resposta {atende:true, em, por} (index.ts:722,738-747; nucleo.mjs idem) e escreve no histórico '✅ fulano confirmou a etapa'. Pior: se o fornecedor tinha respondido 'NÃO atende' e clicou 'Mudar resposta' (que zera e.resposta localmente, cronogr
- **quando quebra:** O fornecedor abre o link, ignora os botões 'Consigo/Não consigo' e só preenche 'Informar minha programação' (2 caminhões). Para ele, o toast diz apenas 'Programação enviada'. Para o gestor, a etapa aparece 'Confirmada' com selo verde e o histórico registra '✅ confirmou' — o módulo cujo lema é 'cronograma que ninguém confirmou é só desejo' passa a exibir confirmações que ninguém deu; a obra deixa d

### [MEDIO] mudouData compara undefined com '' e zera confirmação sem a data ter mudado
- **onde:** `cronograma.js`:447
- **o quê:** editarEtapa decide mudouData por (e.inicio !== d.inicio || e.fim !== d.fim) (cronograma.js:447). Etapas criadas por novoAcompanhamento nascem SEM a chave fim (cronograma.js:1088-1094 monta só {nome,inicio,qtd,unid}); o formulário devolve fim:'' — undefined !== '' dá true. Qualquer salvamento da etapa então 'muda a data', executa resposta=null e registra 'data mudou, confirmação zerada' no históric
- **quando quebra:** Almoxarife cria acompanhamento 'aço da laje do 6º' para 10/09 (sem data de fim). O fornecedor confirma pelo link. Dias depois o engenheiro abre 'Editar' só para corrigir a quantidade de 4,2t para 4,8t e salva sem tocar em data → a confirmação é apagada, a etapa volta a 'Aguardando confirmação', o histórico afirma falsamente 'data mudou' e o fornecedor recebe nova cobrança para confirmar a MESMA da

### [MEDIO] Selo 'provisório' é ignorado nos dois pontos de escolha de fornecedor (dropdown do convite e sugestões da solicitação)
- **onde:** `cotacao.js`:431
- **o quê:** selo() existe justamente para marcar como 'provisório' a nota de quem nunca entregou (comentário em qualificacao.js:25-29: 'A · 10 de quem nunca entregou é a que mais engana'). Mas convidarFornecedor monta o rótulo com classeDe(q.nota) cru — '[A · 10,0]' sem provisório (cotacao.js:430-435) — e sugerirFornecedores descarta o flag: o objeto empurrado tem só {forn,pontos,vendas,nota,motivos} (compras
- **quando quebra:** Fornecedor novo respondeu UMA cotação (taxaResposta=100% → nota 10, provisória; entregou zero compras). Na solicitação, o cartão 'Quem pode fornecer isso' mostra o selo cheio 'A · 10,0'; no modal 'Convidar fornecedor' o dropdown mostra '[A · 10,0]'. O comprador, exatamente no momento da decisão, escolhe o 'A' que nunca entregou nada em vez do B·8 com 15 entregas — o caso que a etiqueta 'provisório

### [MEDIO] Pontualidade da qualificação: corte de dia em UTC e fallback para atualizadoEm distorcem a nota — avaliar o fornecedor derruba a nota dele
- **onde:** `qualificacao.js`:100
- **o quê:** desempenhoFornecedor usa chegou = String(o.recebidoEm || o.atualizadoEm).slice(0,10) (qualificacao.js:100-107). recebidoEm é agora() do servidor em UTC: sync depois das 21h locais (UTC-3) cai no dia UTC seguinte → +1 dia falso. E OC entregue sem recebidoEm (as 29 migradas em 31/07; entregas concluídas pelo backend Netlify que não carimba; 'entregue' manual sem recebimentos) cai em atualizadoEm — q
- **quando quebra:** OC entregue no prazo em 31/07, migrada sem recebidoEm. Em 10/08 o comprador avalia o fornecedor com 5 estrelas → salvar('oc') atualiza atualizadoEm para 10/08 → a entrega passa a contar 10 dias de atraso, pontualidade despenca e o selo cai de A para C — o ato de elogiar o fornecedor derrubou a nota dele. Variante de fuso: almoxarife recebe o ferro às 15h sem sinal; a fila sobe às 21h30 em casa → r

### [MEDIO] Editar responsável reaproveitando a linha mantém o token: o link no WhatsApp do fornecedor trocado continua abrindo e respondendo
- **onde:** `cronograma.js`:359
- **o quê:** editarResponsavel preserva o token ao trocar nome/telefone/origem (novo = Object.assign({}, r, d, {id: rid,...}), cronograma.js:359-361; a união no servidor também preserva). Não existe nenhum caminho para revogar ou regenerar o token de um responsável, e verPrazos/responderPrazo/relatarEntrega autenticam SÓ pelo token (index.ts:690,717; nucleo.mjs:684,711).
- **quando quebra:** A obra troca de concreteira: o engenheiro abre 'Editar responsável' e substitui a Concreteira X pela Y na mesma linha (UX natural — o botão se chama Editar). O link antigo, parado no WhatsApp da X demitida, continua abrindo as etapas — agora as da Y: a X vê datas e observações da concorrente, pode 'confirmar', 'recusar' e até 'informar entrega' em nome da Y, e o painel exibe tudo como resposta leg

### [MEDIO] Resposta pública de cotação aceita frete NEGATIVO — fornecedor manipula a comparação e o valor da OC
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-nucleo/index.ts`:667
- **o quê:** Em responderCotacao os preços são filtrados a >0 (index.ts:657-659), mas o frete não: `frete: num(body.frete)` (linha 667) aceita valor negativo, e o total do servidor (linhas 663-664) o soma. No cliente, numeroBR (ui.js:359) preserva o '-' (`[^\d.,-]`), então dá para digitar direto no campo da tela pública. totalCotacao (cotacao.js:9-10) e escolherFornecedor (cotacao.js:563 `frete: Number(f.frete
- **quando quebra:** Fornecedor B recebe o link público e responde os 3 itens por R$ 10.000 com frete '-2000'. O total dele vira R$ 8.000 e fica verde como o menor da comparação (o concorrente honesto cotou R$ 9.500). O comprador escolhe B; a OC nasce com frete -2.000 e totalLiquido R$ 8.000 — mas na entrega o fornecedor cobra os R$ 10.000 da mercadoria: a OC (documento com força de contrato) saiu R$ 2.000 abaixo do c

### [MEDIO] Merge raso do convidado na cotação: cache velho do escritório reverte a resposta reenviada do fornecedor
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-nucleo/index.ts`:99
- **o quê:** unirPorId funde cada fornecedor convidado com `{ ...anterior, ...it }` (linha 99) e os preços com `{ ...(anterior.precos), ...(it.precos) }` (linhas 103-105) — em ambos, o registro que CHEGA (o cache do cliente) ganha do guardado quando a mesma chave existe dos dois lados, sem comparar recência. Toda ação do escritório na cotação regrava o array fornecedores inteiro a partir do cache local: convid
- **quando quebra:** Fornecedor respondeu item A por R$ 10 ontem; hoje às 10:00:00 reenvia baixando para R$ 8 (e retira o preço do item B, que não tem mais). O tab do escritório sincronizou às 09:59 (tem A=10, B=5). Às 10:00:40, ainda antes do pull de 90s, o escritório convida um terceiro fornecedor — a gravação leva o array com A=10 e B=5; o merge produz A=10 (velho vence 8) e ressuscita B=5. A comparação e a OC gera

### [MEDIO] Solicitação fecha como 'atendida' sem cobrir os itens que ficaram fora da OC (proposta parcial)
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-nucleo/index.ts`:163
- **o quê:** Ao escolher uma proposta parcial, os itens sem preço ficam FORA da OC (cotacao.js:559-562) e o aviso promete que 'o resto continua pendente' / 'você precisa comprá-los à parte' (cotacao.js:531-533). Mas o fechamento da SC — tanto no servidor (index.ts:163-171: só confere se TODAS as OCs de sc.ocIds estão entregues) quanto no cliente (recalcularSC, compras.js:447) — não confere cobertura de ITENS: 
- **quando quebra:** SC-0042 pede vergalhão, arame e prego. O fornecedor escolhido cotou só vergalhão e arame; o comprador confirma o aviso ('compro o prego à parte') e a OC-0031 nasce com 2 itens. A OC é entregue completa na semana seguinte — o servidor fecha a SC-0042 como 'atendida' e ela some dos filtros de pendência. O prego nunca foi comprado e ninguém mais o vê: exatamente o 'material que sumiu do radar' que o 

### [MEDIO] OC cancelada que veio de cotação deixa a SC presa em 'Em cotação' apontando uma cotação que nunca mais decide
- **onde:** `/Users/leonardopereira/Projetos/domo/compras.js`:444
- **o quê:** recalcularSC (compras.js:443-449) conta como viva qualquer cotação fora de ['cancelada','recusada'] — inclusive 'aprovada'. Quando a OC gerada da cotação é cancelada, a SC volta para 'em_cotacao', mas a cotação está 'aprovada': os botões 'Escolher' só existem com situacao 'aberta' (cotacao.js:321) e escolherFornecedor bloqueia para sempre por atual.ocId (cotacao.js:514) — mesmo com a OC cancelada.
- **quando quebra:** Cotação CT-0007 com 3 respostas vira OC-0031; o fornecedor desiste e o escritório cancela a OC. A SC exibe 'Em cotação', mas ao abrir a CT-0007 não há botão de escolher e qualquer tentativa devolve 'Esta cotação já foi decidida — ordem OC-0031' (cancelada). As 3 propostas coletadas ficam inutilizáveis: para comprar é preciso criar cotação nova e convidar todo mundo de novo, enquanto o filtro de si

### [MEDIO] Servidor deixa o perfil 'obra' CRIAR ordens de compra e cronogramas novos (a régua só vale para edição)
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/_shared/acesso.ts`:113
- **o quê:** motivoRecusa aplica CAMPOS_OBRA apenas quando existe registro guardado: `if (!atual) return "";` (acesso.ts:113). Como 'oc' e 'crono' estão na lista escreve da obra (acesso.ts:33), um registro NOVO dessas coleções passa inteiro — com fornecedor, itens, preços e situacao à escolha — e gravar() ainda o numera e lhe dá tokenPublico (index.ts:188-195). reporProtegidos também devolve intacto quando !at
- **quando quebra:** Um almoxarife com a própria senha de obra manda um salvarLote com um registro 'oc' novo (id inventado, fornecedor qualquer, itens com preço, situacao 'emitida'). O servidor grava, numera OC-0044 e gera link público. Para o escritório ela aparece como ordem legítima na lista, entra na soma 'em aberto' e pode ir para o WhatsApp do fornecedor — uma decisão de compra criada por quem, pela regra do sis

### [MEDIO] Campo 'situacao' liberado à obra permite cancelar ou dar por entregue uma OC sem nenhum recebimento
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/_shared/acesso.ts`:93
- **o quê:** CAMPOS_OBRA.oc inclui 'situacao' (acesso.ts:93). O recálculo do servidor só corrige a situação quando há recebimentos (index.ts:136-147: exige novo.recebimentos não-vazio) e trata 'entregue' vindo do cliente como encerramento manual que não é rebaixado (index.ts:146). Resultado: com credencial de obra, um write de {id, situacao:'cancelada'} numa OC sem recebimentos é aceito tal qual; e {situacao:'
- **quando quebra:** Com a senha da obra, alguém envia salvarLote com {colecao:'oc', registro:{id: da OC-0012 'confirmada', situacao:'cancelada'}}. reporProtegidos mantém (campo permitido), motivoRecusa passa, não há recebimentos e o recálculo não roda: a OC-0012 some da tela de Recebimento (SIT_ESPERANDO não inclui cancelada) e a compra morre em silêncio. Variante: enviar situacao 'entregue' numa OC com 40 de 120 rec

### [MEDIO] Pontualidade do prestador é medida contra atualizadoEm — concluidaEm nunca é gravado na OS
- **onde:** `qualificacao.js`:207
- **o quê:** desempenhoPrestador usa `String(o.concluidaEm || o.atualizadoEm).slice(0,10)` como data de término, mas NENHUM código grava concluidaEm em registros 'os' (grep no repo: concluidaEm só existe em etapas de cronograma). avancarOS (servicos.js:649) só troca `situacao`. Como atualizadoEm muda a CADA gravação posterior (liberar retenção, apontamento de diário, adiantamento, avaliação), o 'Termina no pra
- **quando quebra:** OS com término previsto 30/06, concluída em 28/06 (no prazo). 45 dias depois a direção libera a retenção (salvar → atualizadoEm = 14/08). A ficha do prestador passa a mostrar o contrato com ~45 dias de atraso, pontualidade 0% e 'atraso médio 45d'; a nota dele despenca de A para C/D e a direção deixa de chamá-lo — com base num número falso que piora a cada novo toque no registro.

### [MEDIO] Validações da medição conferem contra o retrato da abertura do modal: amortização acima do saldo e regressão de % passam
- **onde:** `servicos.js`:822
- **o quê:** Em salvarMedicao, a trava de amortização usa `const t0 = totaisOS(o)` e a de regressão usa `ant = percMedido(o, ...)` (via lerLinhasMedicao, linha 764) — ambos sobre o `o` capturado quando o modal abriu. A gravação relê `atual` (linha 844) mas NÃO revalida contra ele. Com o modal aberto o puxar() de 90s traz medições de outros aparelhos e o render é adiado. Além disso, dois aparelhos offline amort
- **quando quebra:** Adiantamento de R$ 10.000 em aberto. O escritório abre o modal da medição 03 e demora preenchendo; a direção, em outro aparelho, salva a medição 02b amortizando os R$ 10.000 inteiros, e o sync chega ao aparelho do escritório. O escritório também lança 'Amortização de adiantamento R$ 10.000' — a trava da linha 824 compara com o saldo VELHO (10.000) e deixa passar. Resultado: R$ 20.000 descontados d

### [MEDIO] Transições de medição conferem a situação no retrato velho: dá para cancelar medição já paga e aprovar medição já cancelada
- **onde:** `servicos.js`:958
- **o quê:** cancelarMedicao valida `m.situacao === 'paga'` sobre o `m` vindo do render (linha 956-958), abre o prompt de motivo (janela de minutos), relê `atual` para gravar (linha 981) mas o map da linha 982-984 sobrescreve para 'cancelada' SEM reconferir a situação atual. aprovarMedicaoPasso tem o mesmo padrão (guarda na linha 867 sobre o `m` velho; escrita nas linhas 917-921 sem recheck). No servidor, unir
- **quando quebra:** A medição 02 (R$ 12.000) está 'aprovada'. O financeiro, num aparelho, marca como paga. No mesmo intervalo o engenheiro, com o prompt 'Por que está cancelando?' aberto no outro aparelho, confirma o cancelamento — o sync já tinha trazido o 'paga' para o store dele, mas a guarda rodou antes. A medição paga vira 'cancelada': os R$ 12.000 pagos somem de 'Já pago', a retenção dela sai do 'Retido', o % a

### [MEDIO] Salvar avaliação (e avançar situação) grava por cima com o registro capturado no render
- **onde:** `servicos.js`:1236
- **o quê:** avaliarPrestador faz `Object.assign({}, o, { avaliacao: aval })` com o `o` capturado na abertura do modal (sem reler via achar), e avancarOS (linha 649) faz `Object.assign({}, o, { situacao: destino })` com o `o` do render, inclusive depois de um `await confirmar(...)` que mantém o modal aberto e o render adiado. Mesma classe do achado do diário: campos escalares (`itens`, `situacao`, `total`) do 
- **quando quebra:** Ao concluir a OS, o modal de avaliação abre (setTimeout da linha 653) e o diretor demora preenchendo as 4 notas e a observação. Nesse meio tempo o escritório lança um aditivo (etapa nova em `itens`) que sincroniza. Ao clicar 'Salvar avaliação', o registro sobe com o `itens` velho e o aditivo é apagado do contrato no servidor. No caminho do avancarOS: enquanto o confirmar de 'Concluir mesmo assim?'

### [MEDIO] Retenção: liberação dupla em corrida e retenção nova que nunca pode ser liberada
- **onde:** `servicos.js`:1002
- **o quê:** liberarRetencao relê `atual` (linha 1001) mas não reconfere `atual.retencaoLiberada` antes de gravar — a única defesa contra dupla liberação é o botão sumir no render (linha 548), que fica congelado enquanto o confirmar está aberto. Além disso o botão exige `!o.retencaoLiberada`: se depois da liberação entrar mais uma medição (modal de medição aberto em outro aparelho quando a ordem foi concluída 
- **quando quebra:** (a) Dois sócios abrem a mesma OS concluída; um libera a retenção; no aparelho do outro, com o confirmar aberto, o sync chega mas o render fica adiado; ele confirma também — o histórico ganha DUAS linhas 'Retenção de garantia liberada: R$ 4.500' e cada um paga o prestador achando que a liberação é a sua: pagamento em dobro. (b) A dona da obra conclui a OS e libera R$ 4.500 de retenção; o mestre est

### [MEDIO] CND renovada como documento novo mantém a antiga vencida travando a medição para sempre
- **onde:** `servicos.js`:145
- **o quê:** pendenciasPrestador percorre TODOS os docsVivos e marca cada documento vencido como pendência grave, sem deduplicar por tipo: uma 'CND FGTS' válida na pasta não anula a 'CND FGTS' vencida do mês anterior. O fluxo natural de renovação é '+ Documento' (guardando a antiga como histórico); a alternativa — apagar a antiga — destrói o registro de que a empresa estava regular naquele período. Resultado: 
- **quando quebra:** O prestador manda a CND FGTS nova todo mês e o escritório cadastra cada uma como documento novo. Depois de 3 meses a pasta tem 2 CNDs FGTS vencidas + 1 válida: toda aprovação de medição abre o modal 'Pendência na pasta do prestador — CND FGTS vencida em …' obrigando o 'Aprovar mesmo assim' (que ainda carimba 'com pendência de documento' no histórico, linha 924), a lista mostra o prestador como pen

### [MEDIO] Rotina sem vigia: heartbeat gravado em domo_meta mas NENHUMA tela lê — e Configurações afirma que o backup diário acontece
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-rotina/index.ts`:141
- **o quê:** domo-rotina/index.ts:141 grava 'manutencao_status' em domo_meta com o comentário 'pra aparecer em Configurações', mas grep em todos os .js do cliente não encontra nenhum leitor de manutencao_status. Pior: a tela Configurações (app.js:994) afirma ao usuário 'Uma cópia de tudo é guardada sozinha todo dia no servidor (60 dias de histórico)' sem mostrar a data do último backup — afirmação que, combina
- **quando quebra:** O cron quebra (ou nunca rodou). A direção abre Configurações, lê 'uma cópia é guardada todo dia' e confia. Semanas depois precisa restaurar e descobre que o último backup automático não existe — a tela nunca teve como mostrar que a rotina estava morta.

### [MEDIO] Paginação sem ORDER BY em lerTudo/lerColecaoBruta/lerApagados: acima de 1000 linhas, páginas podem pular/repetir registros — e o varredor de órfãos apaga arquivo EM USO
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/_shared/dados.ts`:59
- **o quê:** dados.ts pagina com .range(de, de+999) sem nenhum .order() (lerTudo linha 59, lerColecaoBruta linha 85, lerApagados linha 101). Cada página é uma query separada e o Postgres não garante ordem estável sem ORDER BY — com mais de 1000 linhas em domo_registros e escrita concorrente entre as páginas (um upsert move a tupla), uma linha pode sair de todas as páginas ou vir duplicada. Consequências: snaps
- **quando quebra:** Base com 1200 registros. Às 06:00 a rotina roda; entre a página 1 e a 2 do lerTudo, alguém salva um registro (upsert muda a posição física). Uma OC com fotos de recebimento cai no vão entre as páginas: suas fotos não entram em 'usados' e o varredor as apaga do bucket. O registro continua existindo; as fotos viram 'Parte não encontrada' para sempre.

### [MEDIO] sw.js instala o shell pelo cache HTTP do navegador (addAll sem cache:'reload') — versão nova pode nascer com arquivo velho, permanentemente
- **onde:** `/Users/leonardopereira/Projetos/domo/sw.js`:13
- **o quê:** sw.js:13 usa caches.open(CACHE).then(c => c.addAll(ARQUIVOS)): addAll busca cada arquivo pela regra normal de cache HTTP, e o GitHub Pages serve tudo com Cache-Control: max-age=600. O sw.js em si é revalidado por fora do cache HTTP (comportamento padrão do registro de SW), então o SW novo instala — mas pode preencher 'domo-shell-v44' com app.js/index.html de ATÉ 10 MINUTOS ATRÁS vindos do cache HT
- **quando quebra:** Usuário abre o app às 10:00 (navegador guarda app.js v43 por 600s). Léo publica a v44 às 10:03. Usuário recarrega às 10:06: SW v44 instala, addAll pega o app.js v43 do cache HTTP e o congela no cache v44. O index.html v44 chama uma função que só existe no app.js v44 → tela quebrada em TODA abertura, até a v45 ser publicada.

### [MEDIO] Deploy não confere o bump do CACHE/VERSAO — e já houve push de correção (inclusive de segurança) sem bump, que não chega a nenhum PWA instalado
- **onde:** `/Users/leonardopereira/Projetos/domo/.github/workflows/deploy.yml`:32
- **o quê:** Com cache-first sem revalidação, um push que muda JS sem subir o CACHE do sw.js é invisível para todo navegador que já tem o SW: sw.js fica byte-idêntico → sem evento de install → shell antigo servido para sempre. O deploy.yml tem um guard para o backend Netlify (linhas 32-38) mas nenhum para 'CACHE/VERSAO subiu junto com mudança de arquivo do shell'. Já aconteceu no histórico: 36009fc ('Revisão d
- **quando quebra:** Léo corrige um bug de tela e dá push sem lembrar do bump (como em 36009fc). O Pages atualiza, mas o celular de todo mundo segue com o shell velho em cache-first; o bug 'corrigido' continua acontecendo na obra por dias, e a depuração enlouquece porque o código no ar está certo.

### [MEDIO] Sem fluxo de atualização na página: skipWaiting+claim mas nenhum aviso/reload — aparelho fica dias em versão velha (crítico na virada de backend)
- **onde:** `/Users/leonardopereira/Projetos/domo/app.js`:1499
- **o quê:** app.js:1499-1500 registra o SW e nunca mais fala com ele: não há reg.update() periódico, não há listener de updatefound/controllerchange, não há toast 'nova versão — recarregue'. O SW novo até ativa (skipWaiting+claim, sw.js:13-20), mas a página ABERTA continua executando o JS antigo carregado em memória até alguém recarregar manualmente — e um tablet de obra/PWA instalado fica aberto por dias. Na
- **quando quebra:** Dia da virada: dados migrados às 12h. O tablet do almoxarifado está com o app aberto desde de manhã (shell velho apontando ao Netlify) e segue registrando recebimentos nele a semana inteira — nenhum aviso aparece. Esses recebimentos ficam só no Blobs; o Supabase, já 'oficial', nunca os vê.

### [MEDIO] Snapshot integral sem paginação a cada 90s + cache inteiro no localStorage: o sync degrada até parar conforme a base cresce
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-nucleo/index.ts`:402
- **o quê:** A ação 'snapshot' (nucleo index.ts:402) devolve TODOS os registros de TODAS as coleções (incluindo a lixeira de até 90 dias) numa resposta só; o cliente repete isso a cada 90s (store.js:432) e a cada volta de foco (store.js:430), com timeout de 60s (store.js:64), e regrava o pacote inteiro no localStorage (gravarCache, store.js:121-127), cujo teto prático é ~5MB. Não há filtro incremental (o servi
- **quando quebra:** Ano 2 da obra: ~3.000 registros, snapshot de ~6MB. No celular da obra o download leva >60s → toda sincronização aborta com 'A internet demorou demais para responder'; o almoxarife segue enxergando o estoque/OCs de dias atrás enquanto o escritório acha que ele está atualizado. No mesmo aparelho o localStorage estoura e o cache congela numa foto antiga dos dados.

### [MEDIO] Varredor de órfãos com carência de só 1 dia contra uma fila offline sem prazo — arquivo já enviado é apagado antes de o registro subir
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-rotina/index.ts`:124
- **o quê:** domo-rotina index.ts:124-129 apaga qualquer arquivo não referenciado com criadoEm > 24h. Mas o registro que referencia o arquivo viaja pela fila offline do store.js, que não tem prazo: o upload do arquivo exige rede (enviarArquivo é chamada direta), porém o salvarLote seguinte pode falhar e ficar na fila — por 403 semSenha (a direção trocou a senha da pessoa: o erro mantém os itens na fila até ela
- **quando quebra:** Sexta 17h: almoxarife fotografa o recebimento, as fotos sobem, e na hora de salvar o registro a senha dele tinha sido trocada pela direção → 403 semSenha, item preso na fila. Ele só reloga segunda de manhã. Domingo 03:00 a rotina apagou as fotos como órfãs. Segunda o registro sobe apontando para arquivos inexistentes — a prova do recebimento sumiu de vez.

### [MEDIO] Backup diário mora no mesmo Postgres que protege e não é alcançável pelo app (domo_backup é write-only)
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/_shared/dados.ts`:167
- **o quê:** As cópias diárias vão para a tabela domo_backup do MESMO banco/projeto (dados.ts:167-170; 0001_init.sql:92-97): qualquer perda no nível do projeto (exclusão acidental, o mesmo tipo de interferência externa que já girou o TOKEN por fora, projeto pausado/perdido) leva dados e backups juntos — e Domo está fora do backups-impresilk (que cobre só os 5 sistemas Impresilk). Além disso NENHUMA ação expõe 
- **quando quebra:** Uma migração/limpeza mal escrita trunca domo_registros num sábado. A direção abre Configurações: 'Baixar backup agora' baixa o banco já vazio, e 'restaurar' não tem de onde ler o backup da véspera — ele está numa tabela que nenhuma tela alcança. A obra fica parada até alguém com acesso SQL montar a restauração à mão, sem procedimento testado.

### [MEDIO] Enviar programação sem ter respondido fabrica uma confirmação: 'Informar minha programação' grava atende=true
- **onde:** `/Users/leonardopereira/Projetos/domo/cronograma.js`:716
- **o quê:** No link público, o botão de programação reaproveita a ação responderPrazo e chuta a resposta: `atende: e.resposta ? e.resposta.atende : true` (cronograma.js:716). O servidor sempre grava o objeto `resposta` (index.ts:740-747), então um fornecedor que só detalhou remessas — sem nunca clicar em '✓ Consigo atender' — aparece para o gestor como 'Confirmada' (situacaoEtapa, cronograma.js:17) e entra no
- **quando quebra:** Fornecedor abre o link, ignora os botões de confirmação e clica em '📅 Informar minha programação' para dizer 'consigo mandar só metade, resto a combinar'. O servidor grava resposta {atende:true}. No painel a etapa vira 'Confirmada' e sai da lista de 'sem resposta' — o gestor deixa de cobrar uma data que o fornecedor nunca confirmou.

### [MEDIO] Pontualidade do fornecedor cai para OC entregue sem recebidoEm: atualizadoEm é envenenado por edições posteriores (inclusive pela própria avaliação)
- **onde:** `/Users/leonardopereira/Projetos/domo/qualificacao.js`:100
- **o quê:** qualificacao.js:100-103 usa `o.recebidoEm || o.atualizadoEm` como data de chegada. Ficam sem recebidoEm: (a) OC 'Encerrar mesmo com falta' (compras.js:968 não carimba) no backend Netlify — que é o que a equipe usa hoje — pois o gravar legado (nucleo.mjs:214-312) não tem o carimbo de recebidoEm que o porte Supabase ganhou (index.ts:156); (b) OC completada pela FUSÃO de recebimentos de dois aparelho
- **quando quebra:** OC prometida para 30/07 é encerrada com falta em 01/08 pelo app no Netlify (sem recebidoEm). Em 22/08 o comprador clica '⭐ Avaliar o fornecedor' → salvar('oc') → atualizadoEm=22/08 → atraso calculado = +23 dias → pontualidade despenca e o selo na próxima cotação mostra C/D, sendo que a entrega atrasou 2 dias.

### [MEDIO] Duas respostas públicas simultâneas no mesmo cronograma/cotação: leitura-modificação-gravação do registro inteiro perde uma delas
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-nucleo/index.ts`:756
- **o quê:** responderPrazo, relatarEntrega, sugerirEtapa e responderCotacao fazem lerUm → mexem no array → gravarUm do REGISTRO INTEIRO, sem transação, sem lock e sem passar pela união do gravar() (index.ts:714-756, 764-787, 793-815, 649-683; idem nucleo.mjs). Depois da fusão do cronograma, TODOS os fornecedores da obra moram num único registro crono — e o fluxo normal é o gestor disparar os links no WhatsApp
- **quando quebra:** Gestor manda datas para concreteiro e ferreiro no mesmo minuto. Os dois confirmam quase juntos: as duas Edge Functions leem o mesmo crono, cada uma grava sua cópia com uma resposta só — a segunda gravação apaga a confirmação da primeira. Ambos receberam 'ok'; o painel mostra o concreteiro como 'sem resposta' e o gestor cobra de novo quem já confirmou.

### [MEDIO] Fornecedor consegue responder/relatar entrega em etapa apagada — servidor aceita e o relato fica invisível
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-nucleo/index.ts`:768
- **o quê:** responderPrazo e relatarEntrega localizam a etapa só por `e.id === body.etapaId && e.responsavelId === r0.id`, sem conferir `!e.apagadoEm` (index.ts:719 e 768; nucleo.mjs:713 e 759). verPrazos filtra apagadas (index.ts:694), então a etapa some da tela — mas uma aba aberta antes da exclusão ainda tem os botões. O relato entra numa etapa apagada, que nenhuma tela do gestor mostra.
- **quando quebra:** O engenheiro apaga a etapa 'entrega do aço' (editarEtapa → Apagar) enquanto o fornecedor está com o link aberto. O fornecedor clica '🚚 Já entreguei', informa NF e quantidade, recebe 'Entrega informada. Obrigado!' — a tela promete que 'aparece na hora para a obra' (cronograma.js:746). O registro caiu numa etapa com apagadoEm: ninguém na obra vê a entrega e o material chega sem ninguém esperar.

### [MEDIO] Dropdown de convite da cotação ignora o 'provisório' e apresenta como 'A · 10,0' quem nunca entregou nada
- **onde:** `/Users/leonardopereira/Projetos/domo/cotacao.js`:434
- **o quê:** Em convidarFornecedor (cotacao.js:431-435) a opção mostra `classeDe(q.nota)` cru: `[A · 10,0]`, ignorando `q.provisorio`. É exatamente o caso que o selo() foi criado para impedir (qualificacao.js:26-39): fornecedor cuja única história é ter respondido cotações fica com nota 10 (taxaResposta) sem nunca ter entregue. O cabeçalho da comparação (cotacao.js:250) passa provisorio corretamente — o ponto 
- **quando quebra:** Fornecedor novo respondeu 2 cotações e nunca ganhou/entregou. No modal 'Convidar fornecedor para cotar' ele aparece como '[A · 10,0]' — acima de um fornecedor B·8 com 20 entregas reais — e o texto de ajuda diz 'A é preferencial'. O comprador escolhe pelo selo enganoso; se abrisse a ficha, veria 'provisório'.

### [MEDIO] Perfil obra clica 'Encerrar cronograma': servidor reverte a situação em silêncio mas grava 'Cronograma encerrado' no histórico
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/_shared/acesso.ts`:94
- **o quê:** CAMPOS_OBRA de crono permite só etapas/responsaveis/historico (acesso.ts:92-95); `situacao` é protegido. O botão 'Encerrar cronograma' (cronograma.js:323-331) aparece para qualquer perfil. No Supabase, reporProtegidos repõe situacao='ativo' mas o historico é campo permitido e a linha 'Cronograma encerrado' É gravada — a gravação passa e o registro fica ativo com histórico mentindo. No Netlify (em 
- **quando quebra:** O almoxarife (perfil obra) encerra o cronograma achando que os fornecedores param de responder. Localmente vira 'encerrado'; no próximo sync volta 'ativo'. O histórico exibe 'Cronograma encerrado' para todo mundo, mas os links públicos continuam aceitando respostas — direção e obra ficam com versões opostas do estado.

### [MEDIO] Backend Netlify (o que a equipe usa) não tem reporProtegidos: gravação de crono/oc do perfil obra é recusada por campo velho do cache
- **onde:** `/Users/leonardopereira/Projetos/domo/netlify/functions/nucleo.mjs`:450
- **o quê:** O salvarLote legado valida direto com motivoRecusa(quem, colecao, it.registro, atual) (nucleo.mjs:450), sem o reporProtegidos que o porte Supabase aplica antes de julgar (index.ts:460-462). Como o cliente sempre reenvia o registro inteiro, qualquer campo protegido desatualizado no cache da obra (nome do cronograma renomeado pelo escritório, entregaPrevista alterada na OC) faz o item inteiro ser re
- **quando quebra:** Escritório renomeia o cronograma para 'Cronograma da estrutura'. O celular do mestre (perfil obra), com o nome antigo em cache, conclui a etapa 'concretagem' → envia o crono inteiro → Netlify recusa: 'quem é da obra não altera "nome" em crono'. A conclusão se perde da fila com um aviso genérico de permissão, e o painel segue cobrando uma etapa já concluída.

### [MEDIO] Criar e encaminhar um compromisso OFFLINE desfaz o encaminhamento em silêncio (fila deduplica e o servidor força dono=criador)
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-nucleo/index.ts`:275
- **o quê:** store.js:179 deduplica a fila por id: encaminhar um compromisso recém-criado que ainda não subiu SUBSTITUI a entrada de criação por uma única entrada já com dono=destinatário. No servidor, prepararComp trata esse item como criação (atual=null) e, para quem não é direção, força dono=meuId ('const dono = (!ehDir && !atual) ? meuId : ...'), ignorando o dono enviado. O encaminhamento some sem recusa, 
- **quando quebra:** Ana (escritório ou obra, sem sinal no canteiro) cria o compromisso 'Receber o concreto amanhã 7h' e o encaminha para Bruno. O app confirma 'Encaminhado para Bruno'. Quando o sinal volta, a fila sobe um item só; o servidor grava o compromisso com dono=Ana. Bruno nunca recebe; o compromisso reaparece na agenda de Ana, que acha que já o passou adiante — a entrega das 7h fica sem ninguém.

### [MEDIO] Aparelho da direção com cache velho re-encaminha o compromisso como efeito colateral de marcar 'feito' ou comentar
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-nucleo/index.ts`:309
- **o quê:** prepararComp interpreta QUALQUER diferença entre registro.dono (que o cliente sempre manda, pois alternarFeitoComp/comentarCompromisso enviam o objeto inteiro lido do cache) e atual.dono como um encaminhamento intencional: troca o dono, carimba encaminhadoPor/encaminhadoEm e registra 'Encaminhou de X para Y' no fio. Não há como distinguir 'quero mudar o dono' de 'meu cache está 90s atrasado' — e o
- **quando quebra:** A direção, no celular, encaminha o compromisso de Ana para Bruno. No desktop (último sync antes disso), a direção marca o mesmo compromisso como feito. O desktop envia o registro com dono=ana; o servidor vê atual.dono=bruno ≠ ana e, além do 'feito', DEVOLVE o compromisso para Ana e grava o evento falso 'Encaminhou de Bruno para Ana'. Bruno perde a tarefa da lista sem aviso e a trilha da conversa r

### [MEDIO] Acervo: escritório baixa anexo da conversa de compromisso ALHEIO — a regra 'só o dono' vale apenas para o perfil obra
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-acervo/index.ts`:55
- **o quê:** Em podeBaixar, a checagem 'if (perfil !== "obra") return true' vem ANTES de 'if (o._col === "comp") return o.dono === eu.id'. Para escritório, qualquer arquivo referenciado por um compromisso de outra pessoa é liberado. Isso contradiz o modelo do núcleo, onde o snapshot esconde compromissos alheios de TODO não-direção (nucleo index.ts:410-411) — a agenda é pessoal também frente ao escritório. O pr
- **quando quebra:** A direção encaminha à funcionária do escritório um compromisso com um anexo sensível e depois o toma de volta (ou a funcionária o repassa). O compromisso some do snapshot dela, mas o arquivoId ficou no cache local (domo_cache_v1) e no histórico do navegador; com ele, a rota meta/baixarParte segue entregando o arquivo da conversa que não é mais dela — para sempre, mesmo depois de perder o acesso ao

### [MEDIO] Acervo: rota 'apagar' destrói arquivo DE VEZ sem lixeira e sem a trava de RH/leitura — aberta ao perfil escritório
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-acervo/index.ts`:192
- **o quê:** O case 'apagar' do acervo só passa por podeFazer(eu,'apagar') — que libera escritório — e não aplica NENHUMA das réguas que meta/baixarParte aplicam (podeBaixar, COLECOES_SO_DIRECAO), nem confere se o arquivo ainda é referenciado por registro vivo. Remove as partes do Storage e o _arqmeta imediatamente: não há lixeira de 90 dias para arquivo (essa proteção só existe para registros; a exclusão de a
- **quando quebra:** Um usuário de perfil escritório (ou alguém com a senha dele) envia POST ao domo-acervo com action:'apagar' e o id de um arquivo — por exemplo o arquivoId de uma planta que ele vê legitimamente no snapshot de 'proj'. As partes somem do bucket na hora; não há lixeira nem log dessa rota; a planta referenciada pelo projeto vivo passa a dar 'Parte não encontrada' para todo mundo, sem trilha de quem apa

### [MEDIO] hojeISO() usa data UTC: à noite (21h-0h em MG) o lembrete novo nasce datado de AMANHÃ, o pagamento cai na competência do mês seguinte e o calendário destaca o dia errado
- **onde:** `/Users/leonardopereira/Projetos/domo/ui.js`:75
- **o quê:** hojeISO() = new Date().toISOString().slice(0,10) devolve a data UTC; em Montes Claros (UTC-3), das 21:00 às 23:59 isso é o dia SEGUINTE — enquanto diasAte (ui.js:77) trabalha em meia-noite LOCAL. Consequências na lente: (a) novoLembrete pré-preenche a data com amanhã (rh.js:528 e o botão '+ Lembrete' em rh.js:615); (b) pgtoModal pré-preenche a competência do pagamento (rh.js:367) — na última noite
- **quando quebra:** Às 22h de 16/08 o dono anota pelo calendário o lembrete 'Ligar para o cartório HOJE cedo'. O campo de data vem pré-preenchido com 17/08; ele salva sem reparar. Na lista o lembrete aparece como 'amanhã' e não entra na bolha de urgentes nem no 'Para resolver hoje' da manhã seguinte... do dia certo. Variante pior: às 23h de 31/01 lança o salário pago no dia — a competência vem '2026-02' e o pagamento

### [MEDIO] Perfil obra pode CRIAR ordem de compra e cronograma novos com qualquer campo (régua só vale em update)
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/_shared/acesso.ts`:114
- **o quê:** motivoRecusa devolve '' quando não existe registro guardado (`if (!atual) return ""`, linha 114) e reporProtegidos também devolve o registro intacto sem `atual` (linha 132). CAMPOS_OBRA (recebimentos/historico/situacao para oc; etapas/responsaveis/historico para crono) só é conferido em EDIÇÃO. Como PERFIS.obra.escreve inclui 'oc' e 'crono', uma credencial de obra pode criar do zero uma OC inteira
- **quando quebra:** Alguém com a senha de perfil obra (ou um cliente com bug que manda um id inexistente — id novo => atual null) envia via salvarLote uma 'oc' nova com fornecedor e preços inventados. O servidor numera (OC-00xx), gera tokenPublico e o documento vira um link público apresentável a fornecedor como ordem de compra oficial da Domo — sem passar por escritório nem direção.

### [MEDIO] Snapshot/backup paginam com .range() sem ORDER BY — registros podem sumir ou duplicar acima de 1000 linhas
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/_shared/dados.ts`:59
- **o quê:** lerTudo (linhas 56-66), lerColecaoBruta (77-92) e lerApagados (96-108) paginam com .range(de, de+999) SEM .order(). Cada página é uma query separada; sem ORDER BY o Postgres não garante ordem estável entre elas (heap order muda com escrita concorrente/autovacuum), então uma linha pode aparecer em duas páginas (duplicata) ou em nenhuma (pulada). Um registro pulado no snapshot que não esteja na fila
- **quando quebra:** Com 1200 registros na base, o snapshot roda as duas páginas enquanto alguém grava; uma OC em trânsito cai entre as páginas e não vem. No celular do engenheiro (que não a editou nas últimas horas) a OC desaparece da lista e do cache até um snapshot futuro trazê-la de volta — e o backup daquela madrugada foi gravado sem ela.

### [MEDIO] Rotina apaga arquivo 'órfão' com carência de 1 dia, mas a fila offline segura o registro por mais tempo
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-rotina/index.ts`:124
- **o quê:** O passo 5 da rotina diária apaga qualquer arquivo do Storage que nenhum registro referencia, com carência de apenas 1 dia (`const ontem = diasAtras(1)`, linha 124). Só que o desenho offline-first do app separa os dois momentos: a foto/PDF sobe NA HORA (enviarArquivo, direto na API), e o registro que a referencia entra na FILA do aparelho — que pode ficar retida por dias (fim de semana, aparelho de
- **quando quebra:** Sexta 18h: o almoxarife registra o recebimento; as fotos da nota sobem com o 4G que ainda tinha, o sinal cai antes de a fila subir e o tablet fica no contêiner. Sábado 3h a rotina roda: as fotos não são referenciadas por registro nenhum e têm mais de 24h ao rodar de domingo — apagadas do bucket junto com o _arqmeta. Segunda o tablet sincroniza e o recebimento entra apontando para arquivoId morto: 

### [MEDIO] Compromisso criado e encaminhado offline volta calado para a agenda do autor
- **onde:** `/Users/leonardopereira/Projetos/domo/compromissos.js`:481
- **o quê:** encaminharCompromisso só grava `{ dono: para }` via salvar() (linha 481). Se o compromisso foi CRIADO offline (ou o create ainda não subiu), salvar() FUNDE as duas gravações numa única entrada da fila (store.js:179-180, dedupe por col+id). No servidor a entrada chega com atual=null, e prepararComp força `dono = meuId` para quem não é da direção quando não existe registro anterior (index.ts:275: '(
- **quando quebra:** O engenheiro (perfil escritório/obra) está sem sinal no canteiro, cria o compromisso 'comprar disco de corte' e o encaminha para a compradora — a tela confirma 'Encaminhado para Ana' e o item some da lista dele. Quando o sinal volta, a fila sobe uma gravação só, o servidor carimba o dono de volta nele mesmo; a Ana nunca vê o compromisso e ele só reaparece na agenda do engenheiro no próximo sync — 

### [MEDIO] No backend Netlify (o que a equipe usa), compromisso recém-salvo some da tela do autor após sincronizar
- **onde:** `/Users/leonardopereira/Projetos/domo/store.js`:311
- **o quê:** puxar() protege registros recém-mexidos que não vieram no snapshot com a janela de 3 minutos, mas abre exceção para 'comp' (linha 311: `if (col === 'comp') continue;`), assumindo que 'se não veio é porque foi encaminhado'. Isso só é verdade num snapshot de leitura forte (Supabase). No backend Netlify legado — o que a equipe ainda usa — a LISTAGEM do Blobs demora ~1min (comentário do próprio nucleo
- **quando quebra:** No app do Netlify, a secretária cria um compromisso e aperta '🔄 Sincronizar'. O item sobe, o snapshot roda em seguida, a listagem do Blobs ainda não o devolve e a exceção de 'comp' o descarta: o compromisso desaparece da tela na frente dela por ~1 minuto. Ela assume que não salvou e recria — agora existem dois. Num tablet com relógio 5min adiantado, o mesmo sumiço temporário acontece com solicitaç

### [MEDIO] Duas abas do mesmo navegador: gravarFila sobrescreve a fila offline da outra aba
- **onde:** `/Users/leonardopereira/Projetos/domo/store.js`:133
- **o quê:** A fila é lida do localStorage UMA vez no boot (lerCache, linha 98) e cada gravação persiste o S.fila inteiro da aba corrente (gravarFila, linha 133). Não há listener de 'storage' nem merge: com o app aberto em duas abas (ou PWA instalado + aba do navegador), a gravação da aba B regrava domo_fila_v1 sem as entradas que só a aba A tem em memória. Enquanto A continuar aberta e online ela ainda envia 
- **quando quebra:** No escritório, o comprador está com o sistema em duas abas e a internet cai. Na aba 1 ele lança um recebimento (entra na fila); na aba 2 edita uma solicitação — gravarFila da aba 2 persiste só a edição dela, apagando o recebimento do localStorage. Ele fecha o navegador no fim do dia ainda sem internet; no dia seguinte a fila restaurada só tem a solicitação: o recebimento sumiu sem nenhum aviso.

### [MEDIO] Lista "Concluídos" de Compromissos liga os cliques DUAS vezes: reabrir não funciona (toggle duplo) e Editar/Encaminhar abrem dois modais empilhados
- **onde:** `compromissos.js`:214
- **o quê:** TELAS.compromissos chama ligarLinhasComp(el) sobre a página inteira (compromissos.js:207), o que já liga os itens dentro do #feitosComp escondido (display:none não impede querySelectorAll). Ao clicar "Mostrar concluídos", liga DE NOVO (`ligarLinhasComp(cx)`, compromissos.js:214) — cada elemento fica com 2+ listeners (um a mais a cada mostrar). No quadradinho data-feito, os dois handlers rodam em s
- **quando quebra:** O engenheiro conclui um compromisso por engano, abre "Mostrar concluídos" e toca o ✓ para reabrir. Nada acontece — toca mais três vezes, nada. A conversa do compromisso ganha 8 eventos falsos de reabrir/concluir. Ao tocar ✎ para editar, aparece o modal; salva; surge OUTRO modal igual por baixo, com os dados antigos, e ele não sabe se salvou ou não.

### [MEDIO] Perfil obra: "Ver ordem" (Recebimento) e "Abrir" (Compras geradas na solicitação) levam direto à parede "Sem acesso"
- **onde:** `compras.js`:1134
- **o quê:** Na tela Recebimento, o botão "Ver ordem" (compras.js:1134) faz irPara('compras/'+id) sem checar podeVer (handler em compras.js:1146); na ficha da solicitação, o cartão "Compras geradas" mostra "Abrir" (data-veroc, compras.js:374, handler 429) para a mesma rota. O perfil obra não tem 'compras' nas telas (app.js:28) e o roteador barra com "Esta parte não é do seu acesso" (app.js:244-250). O próprio 
- **quando quebra:** O almoxarife (obra) abre Recebimento para conferir o que vem no caminhão e toca "Ver ordem" para ver detalhes. Cai em "🔒 Esta parte não é do seu acesso — Fale com a direção". Mesma coisa ao abrir a solicitação dele e tocar "Abrir" na compra gerada. Ele aprende que os botões "não funcionam" e para de confiar na tela.

### [MEDIO] Perfil obra vê "R$ 0,00" como valor das ordens (Recebimento e ficha da solicitação) porque o servidor tira o preço mas a tela imprime o campo mesmo assim
- **onde:** `compras.js`:1109
- **o quê:** O servidor remove totalLiquido/preço para o perfil obra (semValores, supabase/functions/_shared/acesso.ts:160-172), e fmt.brl(undefined) devolve "R$ 0,00" (ui.js:19-22). A tela Recebimento imprime `fmt.brl(o.totalLiquido)` sem condição no cabeçalho de CADA cartão (compras.js:1109), e a ficha da solicitação faz o mesmo no cartão "Compras geradas" (compras.js:373). O painel trata o caso de propósito
- **quando quebra:** O almoxarife abre Recebimento: todo cartão diz "Edifício Diamond · R$ 0,00". Ele comenta com o motorista do fornecedor que "a ordem veio zerada no sistema" e liga para o escritório achando que a compra veio errada — quando na verdade é o preço ocultado aparecendo como zero.

### [MEDIO] Cotação excluída e colaborador apagado prometem "vai para a lixeira — a direção pode restaurar", mas a Lixeira de Configurações não lista 'cot' nem 'pessoa'
- **onde:** `app.js`:1183
- **o quê:** pintarLixeira só varre { sc, oc, os, forn, doc, proj, prest } (app.js:1183-1184). O confirm de excluir cotação diz "Vai para a lixeira — a direção pode restaurar" (cotacao.js:403) e o de apagar colaborador idem (rh.js:242-243), e o servidor de fato só marca apagadoEm (nucleo, ação 'apagar'). Mas nenhuma UI mostra cot/pessoa apagados: não há como restaurar (a ação restaurarItem existe no servidor, 
- **quando quebra:** A direção exclui por engano a cotação errada (o confirm garantiu que dava para restaurar). Vai em Configurações → Lixeira: só aparecem solicitações, ordens, fornecedores, documentos, projetos e prestadores — a cotação não está lá. Depois de 90 dias a rotina a apaga de vez, com os preços que os 3 fornecedores tinham respondido. O mesmo vale para um colaborador do RH apagado sem querer.

### [MEDIO] Perfil obra cadastrando fornecedor novo em "Acompanhar fornecedor" / "+ Responsável": o servidor recusa o 'forn' com toast criptográfico e o cadastro prometido nunca acontece
- **onde:** `cronograma.js`:1126
- **o quê:** novoAcompanhamento grava um 'forn' novo quando o nome digitado não existe (cronograma.js:1119-1129 — o comentário promete "Fornecedor digitado na mão ENTRA no cadastro da empresa"), e editarResponsavel idem (cronograma.js:365-371). Ambos os fluxos são acessíveis ao perfil obra (tela 'cronogramas' está na lista dele, app.js:28), mas o servidor recusa: obra só escreve sc/oc/crono/comp (acesso.ts:33,
- **quando quebra:** O encarregado (obra) usa "+ Acompanhar fornecedor" para cobrar as datas do ferro: digita "Aço Forte, (38) 9…" e cria. Segundos depois pipoca "Não foi salvo: quem é da obra não grava forn — forn". Ele acha que perdeu o acompanhamento (que na verdade salvou) e refaz tudo — criando um segundo responsável duplicado no cronograma; e o escritório nunca vê "Aço Forte" na agenda de fornecedores.

### [BAIXO] sugerirEtapa/relatarEntrega crescem arrays do cronograma sem limite: DoS de registro via link do responsável
- **onde:** `supabase/functions/domo-nucleo/index.ts`:807
- **o quê:** Em sugerirEtapa, c.etapas = [...(c.etapas || []), etapa] acrescenta sem NENHUM teto ao array de etapas de um único registro 'crono', e em relatarEntrega e.entregas é unido via unirPorId também sem teto. Compare com as defesas irmãs no mesmo arquivo: responderPrazo limita remessas a 20 (.slice(0,20)) e relatarEntrega limita fotos a 5 (.slice(0,5)) — mas o número de etapas/entregas em si é ilimitado
- **quando quebra:** Um responsável mal-intencionado (ou alguém que recebeu o link repassado) chama sugerirEtapa milhares de vezes no mesmo cronograma. A linha JSONB do 'crono' cresce até ficar lenta/estourar limites do PostgREST, e verPrazos/snapshot desse cronograma passam a falhar ou ficar pesados para toda a equipe e para os demais responsáveis daquele registro.

### [BAIXO] Lista de cotações mostra 'Melhor preço' calculado com propostas parciais
- **onde:** `cotacao.js`:85
- **o quê:** Na tela de LISTA, `menor = Math.min(...resp.map(totalCotacao))` (cotacao.js:85) inclui quem respondeu só parte dos itens — exatamente o bug que já foi corrigido no detalhe (verde só entre propostas completas, cotacao.js:288-295) e no fluxo de escolha, mas ficou para trás na coluna 'Melhor preço' da listagem.
- **quando quebra:** Cotação de 3 itens: fornecedor A cotou 1 item (total R$ 50), fornecedor B cotou os 3 (total R$ 500). A lista mostra 'Melhor preço R$ 50,00' — o comprador que decide priorizar cotações pela coluna acha que há proposta fechada por R$ 50 quando não há nenhuma proposta completa nesse valor.

### [BAIXO] Editar compromisso de colaborador desligado troca o dono sem avisar (seletor cai na 1ª opção)
- **onde:** `/Users/leonardopereira/Projetos/domo/compromissos.js`:421
- **o quê:** No modal de edição da direção, o seletor 'De quem é' é montado com pessoasComp(), que filtra ativo !== false (compromissos.js:39). Se o dono atual foi desligado, o valor c.dono não existe nas opções e o browser seleciona a primeira ('Direção'). Ao salvar, d.dono é aplicado (compromissos.js:446) e o servidor registra encaminhamento (index.ts:309-317).
- **quando quebra:** A direção abre 'Editar' num compromisso do João (desligado na semana passada) só para corrigir o título. Sem tocar no campo 'De quem é', o Salvar grava dono='equipe' e o fio ganha 'Encaminhou de João para Direção'. Se João for religado (obra sazonal), os compromissos dele não voltam — mudaram de dono num ajuste de texto.

### [BAIXO] Rotas endereçadas por id pulam a regra de dono do comp e o acervo apaga DE VEZ sem log
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-acervo/index.ts`:192
- **o quê:** Duas assimetrias com a régua do salvarLote/podeBaixar: (1) nucleo 'apagar' (domo-nucleo/index.ts:481-496) só confere COLECOES_SO_DIRECAO — um escritório pode mandar para a lixeira um compromisso ALHEIO por id, exatamente o que prepararComp recusa na rota de gravação ('este compromisso não é seu'); (2) acervo 'apagar' (domo-acervo/index.ts:192-200) remove partes do Storage e o _arqmeta de qualquer 
- **quando quebra:** Um escritório que obteve o id de um anexo (ex.: reaproveitando um id visto antes de perder acesso, ou de um comp que já foi dele e foi encaminhado) chama acervo action 'apagar' e destrói o PDF definitivamente; nada é gravado no domo_log e a direção não tem como descobrir quem apagou.

### [BAIXO] Subtítulo da conversa mostra entidade HTML no nome (esc() dentro de textContent)
- **onde:** `/Users/leonardopereira/Projetos/domo/compromissos.js`:254
- **o quê:** cabecalho() usa textContent (app.js:222-224), mas telaCompromisso passa esc(nomeDono(c.dono, c.donoNome)) no subtítulo — o texto chega já escapado e o textContent o exibe literal.
- **quando quebra:** Compromisso de 'Márcia D'Angelo': o topo da conversa mostra '👤 Márcia D&#39;Angelo'. Qualquer nome com apóstrofo, & ou aspas aparece com o código no cabeçalho, para a direção, em toda conversa daquela pessoa.

### [BAIXO] Eventos além de 3 por dia ficam invisíveis e clicar no '+N' abre 'Novo lembrete'
- **onde:** `/Users/leonardopereira/Projetos/domo/rh.js`:579
- **o quê:** A célula mostra evs.slice(0, 3) e um '<div class="cal-mais">+N</div>' sem handler próprio (rh.js:577-579). Só os chips têm stopPropagation (rh.js:617); o clique no '+N' borbulha para a célula, que cria lembrete (rh.js:619). Não existe nenhuma visão do dia: o 4º evento em diante não é visível em lugar nenhum do calendário. Como os compromissos são adicionados por último em eventosDoMes (rh.js:505-5
- **quando quebra:** Dia 5: dois colaboradores de férias + um pagamento + a visita à obra da direção. O chip da visita some ('+1'); a direção clica no '+1' para ver o que falta e, em vez disso, abre o modal de novo lembrete — a visita continua invisível no calendário e só aparece se ela for à tela de Compromissos.

### [BAIXO] Salvar pessoa da equipe grava o prestador a partir do `p` do render e reverte campos escalares (PIX, telefone, situação)
- **onde:** `/Users/leonardopereira/Projetos/domo/servicos.js`:1598
- **o quê:** editarPessoa monta a equipe relendo `achar('prest', p.id)` (linhas 1596-1597), mas a gravação final usa `salvar('prest', Object.assign({}, p, { equipe }))` com o `p` capturado quando telaPrestador foi renderizada — inconsistente com editarDocPrestador (linha 1526) e com o ramo 'Apagar' da própria função (linha 1576), que releem. Documentos/equipe/avaliações sobrevivem (união por id no servidor), m
- **quando quebra:** A direção corrige a chave PIX do gesseiro no PC. No canteiro, o engenheiro está com o modal 'Editar pessoa' aberto desde antes (o sync trouxe a correção, mas o modal segura o `p` velho); ao salvar o ASO da pessoa, o registro sobe com o PIX antigo e o servidor o grava por cima — o próximo pagamento é feito para a chave errada, e ninguém vê aviso nenhum.

### [BAIXO] Perfil obra: encerrar cronograma é silenciosamente desfeito pelo servidor
- **onde:** `cronograma.js`:323
- **o quê:** O botão 'Encerrar cronograma' aparece para qualquer perfil (cronograma.js:285,323-331), mas 'situacao' não está em CAMPOS_OBRA.crono (acesso.ts:94: só etapas/responsaveis/historico/atualizadoEm/Por). No Supabase, reporProtegidos repõe situacao='ativo' e a gravação 'dá certo' sem erro; no Netlify, motivoRecusa recusa a gravação inteira (levando junto o histórico).
- **quando quebra:** O almoxarife (perfil obra) encerra o cronograma acreditando que 'os responsáveis param de poder responder' (texto do confirm). A tela mostra encerrado por alguns segundos; a resposta do servidor devolve o registro ainda 'ativo' e a tela reverte no próximo redesenho, sem nenhuma mensagem. Os links dos fornecedores continuam aceitando confirmações/entregas de um cronograma que a obra acha que morreu

### [BAIXO] Fluxo do cronograma no perfil obra grava em 'forn' e é recusado: toast de sem-permissão no meio do fluxo e origemId órfão
- **onde:** `cronograma.js`:1126
- **o quê:** novoAcompanhamento (cronograma.js:1119-1130) e editarResponsavel (365-371) chamam salvar('forn',...) para 'entrar no cadastro da empresa', mas o perfil obra só escreve sc/oc/crono/comp (acesso.ts:33) → o servidor recusa o item ('quem é da obra não grava forn'), o app.js mostra 'Não foi salvo: ...' (app.js:279-285), o registro local de forn evapora após a carência de 3min do pull, e o responsável f
- **quando quebra:** O almoxarife cria 'Acompanhar fornecedor' digitando a Aços Montes à mão. O acompanhamento salva, mas sobe junto um forn recusado: ele vê o toast vermelho 'Não foi salvo: quem é da obra não grava forn' no meio de um fluxo que deu certo (e não sabe o que fazer com isso). Na próxima obra, a promessa do código — 'senão o telefone dele era redigitado a cada obra' — falha: a Aços Montes não está no cada

### [BAIXO] Modal 'Link' do detalhe do cronograma gera link sem token (só '/' no fim) sem avisar
- **onde:** `cronograma.js`:304
- **o quê:** O handler data-linkr (cronograma.js:304-321) só checa if(!r) e monta linkPrazos com r.token||'' — responsável recém-criado ainda sem sync gera URL terminada em '/'. Os outros três caminhos guardam (mandarDatasWhats:519, data-copiar:1042, telaAcompanhaFornecedor:1176/1191 com 'pronto'); este ficou de fora.
- **quando quebra:** Engenheiro cadastra o responsável e, na mesma tela (antes do sync — 4G ruim ou offline), clica em 'Link' no cartão de Responsáveis, copia e cola no WhatsApp do fornecedor. O fornecedor abre e recebe 'Link inválido' (verPrazos: find exige x.token truthy). O engenheiro acha que o sistema quebrou; o fornecedor desiste de responder por ali.

### [BAIXO] Sugestão recusada some da tela do fornecedor sem motivo — recusadaEm devolvido é código morto
- **onde:** `cronograma.js`:491
- **o quê:** decidirSugestao ao recusar marca apagadoEm + recusadaEm + motivoRecusa na etapa (cronograma.js:491), mas verPrazos filtra !e.apagadoEm (index.ts:694; nucleo.mjs:688) — a etapa recusada nunca volta para o fornecedor, então o campo recusadaEm mapeado na resposta (index.ts:708) é inalcançável e o motivo digitado pelo engenheiro (obrigatório no modal) não chega a ninguém.
- **quando quebra:** O concreteiro sugere 'liberar a laje 2 dias antes para montar a bomba'; a tela dele mostra 'sugestão sua — esperando aprovação'. O engenheiro recusa e escreve o motivo ('a laje só desforma dia 12'). No próximo carregamento o cartão simplesmente desaparece do link do fornecedor: ele não sabe se foi aprovado, recusado ou apagado, monta a logística achando que ainda está em análise — e o motivo cuida

### [BAIXO] Endpoints públicos fazem ler-modificar-gravar do cronograma inteiro sem união: duas respostas simultâneas perdem uma
- **onde:** `supabase/functions/domo-nucleo/index.ts`:756
- **o quê:** responderPrazo/relatarEntrega/sugerirEtapa leem o crono, alteram em memória e regravam o registro COMPLETO com gravarUm/upsert direto (index.ts:713-758,762-788,791-817; nucleo.mjs:707-806 com setJSON), sem passar por gravar()/unirPorId. Entre o lerUm e o gravarUm de uma chamada, qualquer escrita concorrente (outro fornecedor respondendo, ou um salvarLote do painel) é sobrescrita — a proteção de un
- **quando quebra:** O engenheiro dispara as datas por WhatsApp para os 4 responsáveis do mesmo cronograma às 8h. Dois fornecedores clicam 'Consigo atender' quase juntos: as duas chamadas leem a mesma versão, cada uma grava o registro inteiro, e a segunda gravação apaga a resposta da primeira — a etapa do primeiro fornecedor volta a 'Sem resposta' sem que ninguém tenha errado, e o histórico fica sem a linha de confirm

### [BAIXO] Solicitação pública aceita quantidade negativa, que atravessa até o total da OC
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-nucleo/index.ts`:226
- **o quê:** limparSolicitacao usa `qtd: num(it.qtd)` (index.ts:226) sem clamp — num() aceita negativo. A rota pública novaSolicitacao (só TOKEN, que viaja no bundle) grava a SC assim. Ao gerar OC da solicitação, editorOC copia a qtd (compras.js:535) e totaisOC multiplica qtd×preço (compras.js:170), produzindo linha negativa que abate o total; numeroBR no cliente também aceita '-' (ui.js:359), então o mesmo va
- **quando quebra:** Pelo link público da obra, alguém envia uma solicitação com 'cimento, qtd -100'. O escritório aprova no fluxo rápido, gera a OC puxando os itens e preenche preço R$ 35: a linha vale -R$ 3.500 e o totalLiquido da OC sai R$ 3.500 menor que a compra real — se passar batido na conferência visual, o documento enviado ao fornecedor e a soma 'em aberto' do painel ficam ambos errados.

### [BAIXO] podeBaixar varre a base inteira UMA VEZ POR PARTE baixada — download de arquivo grande vira N varreduras completas
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-acervo/index.ts`:184
- **o quê:** Para perfis não-direção, podeBaixar (domo-acervo index.ts:48-63) chama lerTudo(null, NOMES_COLECOES) — a base inteira, paginada — para achar o registro dono do arquivo. Só que baixarParte chama podeBaixar em CADA parte (index.ts:184), e o cliente baixa uma parte por vez (store.js:406-416): uma planta de 40MB = 16 partes = 16 varreduras completas de todas as coleções + 1 da ação 'meta'. Com a base 
- **quando quebra:** Escritório com base de 2.000 registros baixa o executivo de 40MB: cada uma das 16 partes dispara 2+ páginas de lerTudo (~32 consultas de 1000 linhas cada). O download que levava segundos passa a levar minutos no 4G, e dois downloads simultâneos multiplicam a carga no Postgres do projeto compartilhado.

### [BAIXO] Sugestão de etapa recusada some sem nenhum retorno ao fornecedor — recusadaEm do payload é código morto
- **onde:** `/Users/leonardopereira/Projetos/domo/cronograma.js`:491
- **o quê:** decidirSugestao(recusar) marca apagadoEm + recusadaEm + motivoRecusa (cronograma.js:491). verPrazos filtra `!e.apagadoEm` (index.ts:694), então toda etapa recusada é excluída da resposta — o campo `recusadaEm: e.recusadaEm || null` (index.ts:708) nunca pode vir preenchido, e telaPrazoPublico nem o renderiza. O motivo digitado pelo engenheiro nunca chega ao fornecedor.
- **quando quebra:** Concreteiro sugere 'liberar a laje 2 dias antes para montar a bomba'. Engenheiro recusa com motivo 'laje só libera dia 10'. Na próxima abertura do link a sugestão simplesmente desapareceu, sem status nem motivo — o fornecedor assume que foi aceita (ou re-sugere), e chega com a bomba num dia em que a laje está ocupada.

### [BAIXO] Perfil obra criando acompanhamento com fornecedor digitado à mão: salvar('forn') é recusado e o cadastro some com origemId órfão
- **onde:** `/Users/leonardopereira/Projetos/domo/cronograma.js`:1126
- **o quê:** novoAcompanhamento (cronograma.js:1124-1129) e editarResponsavel (cronograma.js:368-371) fazem salvar('forn', …) quando o nome não está no cadastro. O perfil obra só escreve sc/oc/crono/comp (acesso.ts:33), então o servidor recusa o item 'forn': o usuário vê o aviso de 'sem permissão' no meio de um fluxo que funcionou, o fornecedor local some após a carência de 3min do puxar(), e o responsável fic
- **quando quebra:** Almoxarife (obra) cria acompanhamento do fornecedor 'Aço Forte' digitado à mão. O crono grava; o forn é recusado ('quem é da obra não grava forn'). Aparece o alerta de permissão, o cadastro 'Aço Forte' desaparece da agenda minutos depois e o responsável do cronograma carrega um origemId órfão — na próxima obra o telefone é redigitado, exatamente o que o código diz evitar.

### [BAIXO] Cartão de serviço na aba 'Por fornecedor' mostra 'Executado: 0%' para o perfil obra porque o snapshot remove medicoes
- **onde:** `/Users/leonardopereira/Projetos/domo/cronograma.js`:932
- **o quê:** filtrarLeitura apaga `medicoes` inteiro dos registros 'os' para o perfil obra (acesso.ts:180-184). cartaoServico (cronograma.js:932-934) calcula totaisOS/percFisico em cima disso e imprime o percentual e a barra de progresso sem ressalva — para obra sempre 0%, mesmo com o serviço 90% medido. Diferente do dinheiro (escondido de propósito via podeVer), o % físico é exibido com valor ERRADO em vez de
- **quando quebra:** Mestre de obras (perfil obra) abre Cronograma → Por fornecedor. Todos os cartões de OS mostram 'Executado: 0%' com a barra vazia, inclusive o do gesso que está quase entregue — ele conclui que nenhum empreiteiro mediu nada e aciona o escritório por um problema que não existe.

### [BAIXO] taxaResposta pune o fornecedor por cotação cancelada pela própria empresa e por convite recém-enviado
- **onde:** `/Users/leonardopereira/Projetos/domo/qualificacao.js`:114
- **o quê:** convitesDoFornecedor (qualificacao.js:80-91) varre lista('cot') sem excluir cotações canceladas nem considerar prazoResposta ainda aberto; taxaResposta (qualificacao.js:114-116, peso 3) conta cada convite não respondido como falha imediatamente. Cotação cancelada uma hora depois de aberta deixa um 'não respondeu' permanente para todos os convidados.
- **quando quebra:** Escritório abre cotação com itens errados, convida 3 fornecedores e cancela em seguida para refazer. Os 3 ficam para sempre com um convite sem resposta: um fornecedor com 2 convites (1 respondido + 1 desta cancelada) cai de 100% para 50% de taxa de resposta e a nota exibida no convite da próxima cotação despenca sem ele ter errado nada.

### [BAIXO] Modal 'Link' do responsável não confere o token e entrega link quebrado antes de sincronizar
- **onde:** `/Users/leonardopereira/Projetos/domo/cronograma.js`:308
- **o quê:** O handler data-linkr em telaCronograma (cronograma.js:304-312) monta linkPrazos(atual, r) sem checar r.token — linkPrazos usa `r.token || ''` (cronograma.js:24-25). Todos os outros caminhos guardam ('Aguarde sincronizar…': mandarDatasWhats:519, data-copiar:1042, telaAcompanhaFornecedor:1186-1191); este não. O verPrazos exige token não vazio, então o link termina em '/' e sempre dá 'Link inválido'.
- **quando quebra:** Engenheiro sem sinal cadastra o responsável, clica em 'Link' no cartão de Responsáveis, copia '…#/prazo/<id>/' (sem token) e cola no WhatsApp. O fornecedor abre e recebe 'Link inválido'; o engenheiro só descobre quando o fornecedor reclama.

### [BAIXO] Núcleo: rota 'apagar' não confere dono para a coleção 'comp' — escritório manda compromisso alheio para a lixeira
- **onde:** `/Users/leonardopereira/Projetos/domo/supabase/functions/domo-nucleo/index.ts`:485
- **o quê:** O case 'apagar' só barra COLECOES_SO_DIRECAO (pessoa) e o perfil obra (ACOES_NEGADAS_OBRA). Para 'comp' não há a checagem de dono que o caminho salvarLote/prepararComp aplica ('este compromisso não é seu'). Um escritório pode marcar apagadoEm em compromisso da direção ou de colega conhecendo o id (o cliente não usa essa rota para comp — usa exclusão suave —, então o furo exige chamada deliberada, 
- **quando quebra:** Funcionária do escritório que já viu o id de um compromisso da direção (aparelho compartilhado, ou compromisso que passou pela lista dela antes de ser encaminhado e ficou no cache local) envia POST action:'apagar', colecao:'comp', id:X com a própria senha. O compromisso da direção some das listas (lixeira) sem que a regra de agenda pessoal seja aplicada; a autoria fica no log, mas o sumiço só é no

### [BAIXO] Calendário acusa 'ASO vence/vencido' de ASO já SUPERADO por exame mais novo — alarme falso que contradiz a ficha
- **onde:** `/Users/leonardopereira/Projetos/domo/rh.js`:493
- **o quê:** eventosDoMes varre TODOS os asosP(p) e cria chip 'ASO vence' (âmbar/vermelho) para qualquer validadeEm no mês — sem conferir se aquele ASO é o vigente. Todo o resto do sistema (aviso da ficha rh.js:160-165, lista rh.js:123, bolha asosVencendo:37) usa asoVigente (o de exame mais recente). O ASO antigo, já substituído, continua gerando alerta vermelho no calendário até sair do mês.
- **quando quebra:** João fez o periódico em 10/07/2026 (válido até 2027); o ASO anterior vencia em 20/08/2026. No calendário de agosto a direção vê o chip vermelho 'João — ASO vencido' no dia 20; clica, e a ficha diz 'vigente, válido' sem pendência nenhuma. A direção ou perde confiança no alerta (e passa a ignorar os verdadeiros) ou agenda exame desnecessário.

### [BAIXO] Dia com mais de 3 eventos no calendário: excedente é INACESSÍVEL e clicar no '+N' abre o modal de lembrete
- **onde:** `/Users/leonardopereira/Projetos/domo/rh.js`:579
- **o quê:** A célula mostra só evs.slice(0,3) e um '<div class="cal-mais">+N</div>' que não tem data-ir, não tem handler próprio e não tem stopPropagation — o clique borbulha para a célula (rh.js:619), que abre novoLembrete. Não existe NENHUM caminho para ver os eventos escondidos (não há visão de dia). Só os chips têm stopPropagation (rh.js:617).
- **quando quebra:** Dia 5 é o pagamento de 6 colaboradores: a direção vê 3 chips verdes e '+3'. Clica no '+3' esperando ver o resto — abre 'Novo lembrete' para aquele dia. Os outros 3 pagamentos (e qualquer compromisso que caiu na mesma data) simplesmente não são alcançáveis pelo calendário; o usuário conclui que não foram lançados.

### [BAIXO] PDF do compromisso: lista de anexos não quebra página e os itens além do rodapé somem da folha
- **onde:** `/Users/leonardopereira/Projetos/domo/compromissos.js`:561
- **o quê:** Na seção 'Anexos' de pdfCompromisso há uma única checagem de página ANTES do título (y>265 na linha 557); o forEach dos itens soma y += 4.4 sem verificar o limite (~285-297mm do A4). O laço do histórico logo acima ganhou exatamente essa correção ('um comentário longo passava do rodapé e as linhas seguintes sumiam da folha' — linhas 546-551); a lista de anexos ficou com o mesmo defeito.
- **quando quebra:** Compromisso com conversa longa (o histórico termina com y≈270) e 8 anexos de fotos. Ao mandar por WhatsApp, o PDF lista 3-4 anexos e os demais são desenhados abaixo do limite da folha — o fornecedor/colega recebe o documento afirmando menos anexos do que existem, sem nenhum indício de corte.

### [BAIXO] Cabeçalho da conversa passa esc() para dentro de textContent: nome com apóstrofo/& aparece como entidade HTML
- **onde:** `/Users/leonardopereira/Projetos/domo/compromissos.js`:254
- **o quê:** telaCompromisso monta o subtítulo com esc(nomeDono(...)) e o entrega a cabecalho(), que usa textContent (app.js:222-224) — o escape vira texto literal. O mesmo ocorre no modo lista quando o grupo é por pessoa? Não — lá é innerHTML com esc, correto; o problema é só no cabeçalho da conversa (linhas 253-254), onde o esc é indevido.
- **quando quebra:** Compromisso da colaboradora "D'Ávila" (ou fornecedor "M&M"): a direção abre a conversa e o subtítulo mostra '👤 D&#39;Ávila' / 'M&amp;M' no topo da tela, em toda visita à conversa.

### [BAIXO] Login de outra pessoa no mesmo aparelho herda e envia a fila do usuário anterior
- **onde:** `/Users/leonardopereira/Projetos/domo/app.js`:341
- **o quê:** Quando entra um usuário diferente do que estava no cache, o entrar() zera S.reg e remove K.cache (linhas 338-342), mas NÃO mexe em K.fila nem em S.fila. O puxar() da linha 363 começa com subirFila(): os itens enfileirados pelo usuário anterior sobem autenticados pela senha do novo — o servidor carimba `por`/atualizadoPor com o NOME DO NOVO usuário (index.ts:348), falsificando o histórico/auditoria
- **quando quebra:** A direção troca a senha da equipe. No tablet da obra, o almoxarife tinha um recebimento na fila; o app derruba a senha ('A senha do painel mudou'). O engenheiro entra com a senha nova no mesmo tablet: o recebimento sobe assinado 'Engenheiro' no histórico da OC e no log de auditoria — quem conferiu a carga foi outra pessoa, e a trilha de quem-fez-o-quê (razão declarada dos acessos individuais) fica

### [BAIXO] S.cfg nulo (cache descartado por memória cheia ou primeiro snapshot falho) derruba botões de WhatsApp e a tela "Links para fornecedor" sem nenhuma mensagem
- **onde:** `app.js`:632
- **o quê:** Dez pontos desreferenciam `S.cfg.empresa` sem checar S.cfg: app.js:632 (TELAS.acessos — quebra a montagem da tela inteira quando há cotação aberta), compras.js:1021 (enviarOCWhats), 1152 (Cobrar entrega), 1460 (Zap fornecedor), cotacao.js:493, cronograma.js:524 e 1021, servicos.js:612 e 1428, qualificacao.js:411. S.cfg fica nulo em cenários reais: gravarFila descarta o cache para abrir espaço quan
- **quando quebra:** O celular do almoxarife enche a memória; a fila sobrevive mas o cache (com o cfg) é jogado fora. Ele reabre o app sem sinal, vê a OC pendente no Recebimento e toca "Cobrar entrega" para mandar WhatsApp ao fornecedor: o botão simplesmente não faz nada (TypeError engolido), sem mensagem — ele toca cinco vezes e desiste achando que o app travou.

### [BAIXO] Dois "Sair" com efeitos diferentes: o de Configurações mantém no aparelho o cache inteiro (dados da empresa, fila, perfil) que o Sair do menu promete apagar
- **onde:** `app.js`:1107
- **o quê:** O sair() do rodapé lateral limpa senha, perfil, usuário, cache e fila (app.js:209-217) exatamente porque "os dados ficam em texto no celular e continuavam lá depois de a pessoa sair" (comentário app.js:197-199). Já o botão "Sair do painel neste aparelho" em Configurações remove SÓ a senha (app.js:1107-1112): todo o cache (valores de compras, contratos, RH se direção), a fila e o perfil continuam n
- **quando quebra:** A diretora usa o tablet compartilhado do escritório, entra como direção e sai pelo botão de Configurações antes de emprestar o aparelho. O tablet fica sem login, mas domo_cache_v1 continua com salários do RH, preços de contrato e a lista de acessos em texto puro — qualquer um com o aparelho lê pelo inspetor/armazenamento, ou simplesmente herda os dados ao entrar depois com a senha da equipe.

### [BAIXO] Apagar sem internet estoura "Não consegui apagar: Failed to fetch" em 8 telas — o aviso amigável só foi posto na exclusão de cotação
- **onde:** `compras.js`:901
- **o quê:** excluirCot checa navigator.onLine e avisa "Sem internet agora — tente quando conectar" (cotacao.js:406-407, com comentário explicando que era para não estourar "um 'Failed to fetch' técnico na obra"). Mas todos os outros pontos que chamam api('apagar') direto ficaram sem a mesma guarda e mostram o erro técnico cru: apagarSC (compras.js:425), apagarOC (compras.js:901), apagar fornecedor (compras.js
- **quando quebra:** O comprador, no canteiro sem sinal, confirma "Apagar esta ordem de compra? Vai para a lixeira." e recebe "Não consegui apagar: Failed to fetch". Ele não sabe se apagou, se vai apagar sozinho depois ou o que é 'fetch' — e tenta mais duas vezes, ao contrário da cotação, onde a mesma situação diz claramente para tentar quando conectar.
