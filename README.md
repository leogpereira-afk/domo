# Domo Construtora — Sistema de Gestão

No ar: **https://leogpereira-afk.github.io/domo**

Sistema de gestão de obras da Domo Incorporadora e Construtora. Primeira obra
cadastrada: **Edifício Diamond**. O sistema já nasce multi-obra — é só cadastrar
a próxima em Configurações.

## O que ele faz

| Área | O que resolve |
|---|---|
| **Solicitações** | A obra pede material por um link público, sem senha. Vira SC-0001, SC-0002…. Ao abrir o pedido, o sistema já mostra **quem pode fornecer isso** (cadastro + histórico de compras e cotações) e manda o pedido de preço para os marcados |
| **Cotações** | Convida fornecedores, cada um responde por um link próprio; compara lado a lado e a escolhida vira OC preenchida |
| **Ordens de compra** | Emitir → mandar no WhatsApp com link e PDF → comprado → a caminho |
| **Recebimento** | Confere item a item na obra, aceita entrega parcial, guarda foto da nota e da carga |
| **Ordens de serviço** | Contrato do prestador por ETAPAS + medição por % executado, retenção técnica, adiantamento, aditivo e boletim assinado |
| **Cronograma e entregas** | Duas visões da mesma coisa: **por fornecedor** (joga as datas dele, manda no WhatsApp, ele diz se entrega) e **linha do tempo da obra** (todas as etapas juntas). As ordens de serviço em andamento entram na mesma lista — o prestador é fornecedor de mão de obra, com % executado, prazo e trava por documento vencido. Pelo link, o fornecedor confirma a data, informa a programação de remessas, relata entrega e sugere etapa |
| **Qualificação** | Nota 0–10 e classe A/B/C/D para fornecedor e prestador: 60% do que o sistema mede (prazo, entrega completa, resposta a cotação, pasta em dia) + 40% das estrelas da equipe. Aparece na hora de convidar para cotar |
| **Sair / Sincronizar** | Botões no rodapé da lateral: sincronizar na hora (o ciclo automático é de 90s) e trocar de usuário, limpando o cache do aparelho |
| **Acessos da equipe** | Uma senha por pessoa, com três níveis (Direção / Escritório / Obra). O histórico passa a dizer quem fez, e desligar alguém não obriga a trocar a senha de todos. A trava vale no servidor |
| **Links para fornecedor e obra** | Todo link entregável num lugar só, com Copiar e WhatsApp |
| **Fornecedores e prestadores** | Uma agenda com duas abas: **material** (cadastro, o que fornece, quanto já se comprou) e **mão de obra** (pasta do prestador: CNDs e contrato com validade, ficha de quem ele põe na obra — ASO, NR-18/NR-35 —, diário de efetivo e avaliação) |
| **Projetos** | Pranchas e arquivos pesados, com revisão (R00, R01…) — a obra baixa sempre a versão nova |
| **Documentos** | CNPJ, contrato social, alvará, certidões — com alerta de vencimento |

## Como as pessoas entram

- **Obra (sem senha):** `…netlify.app/#/solicitar` — pedir material.
  E `…/#/acompanhar` — **quadro de andamento**: escreve só o nome e vê todos os
  pedidos da obra, os seus em destaque, com o que já foi comprado e quando chega.
  Nunca aparece preço, valor de ordem nem telefone de quem pediu.
- **Fornecedor (sem senha):** recebe pelo WhatsApp um link `…/#/ver/oc/<id>/<token>`
  que abre a ordem de compra e baixa o PDF. O token é sorteado por documento.
- **Equipe interna:** senha única do painel, conferida no servidor.
  A senha inicial é entregue pela direção — **troque em Configurações** na primeira entrada.
  (Senha NUNCA entra neste repositório: ela vive só no segredo `PAINEL_SENHA` do Supabase.)
  Cada pessoa escreve o próprio nome ao entrar; é esse nome que fica no histórico
  de quem aprovou, comprou e recebeu.

## Stack

Sem framework e sem build: HTML/CSS/JS puro servido estático + Edge Functions do Supabase
(v2, ESM) + Netlify Blobs. Funciona offline (grava no aparelho e sobe depois) e
instala como aplicativo no celular (PWA).

```
index.html          carrega tudo nesta ordem ↓
config.js           TOKEN e endereços das Functions
libs/jspdf…         gerador de PDF (vendorado, sem CDN)
store.js            servidor, cache local, fila offline, arquivos em partes
ui.js               formatação, etiquetas, modal — e o objeto TELAS
pdf.js              PDF da OC e da OS
compras.js          solicitações, OC, recebimento, fornecedores
acervo.js           projetos e documentos
servicos.js         contrato do prestador, medição, diário, avaliação e a pasta (CND/equipe)
app.js              menu, roteador, painel, configurações, telas públicas

netlify/functions/
  lib/colecoes.mjs  LISTA ÚNICA das coleções (mexa aqui + COLECOES_APP do store.js)
  nucleo.mjs        API principal (Blobs: domo, cfg, seq, log, backup)
  acervo.mjs        arquivos grandes em partes de 2,5MB (Blobs: arq)
  rotina.mjs        @daily: backup do dia, limpa lixeira/log antigos
```

## Publicar

O site **não** está ligado a repositório: publica por upload.

```bash
cd ~/Projetos/domo
npx -y @netlify/mcp@latest --site-id f4c2d7c1-95e3-487e-aecc-d9d1413353ae --proxy-path "<link do deploy-site>"
```

**Sempre suba o número do cache** em `sw.js` (`domo-shell-vN`) e o `VERSAO` do
`config.js` a cada publicação — senão o navegador continua servindo o arquivo velho.

## Variáveis de ambiente (Netlify)

| Nome | Para quê |
|---|---|
| `TOKEN` | Mesma string do `config.js`. Autenticação leve, barra robô. |
| `PAINEL_SENHA` | Senha inicial do painel. Depois que alguém troca em Configurações, quem manda é o hash gravado nos Blobs. |

## Ferramentas de administração (Configurações)

- **Esvaziar lixeira agora** — apaga de vez o que está na lixeira, junto com os arquivos que só aqueles registros usavam.
- **Recomeçar a numeração** — vira de ano ou limpeza de teste. Cuidado: número já usado repete.
- **Baixar backup agora** — JSON com registros, configuração e a numeração.
- A rotina diária ainda apaga arquivo órfão (parte no Blobs que nenhum registro usa),
  com carência de 1 dia para não pegar upload esperando registro na fila de um celular sem sinal.

## Como funciona a medição (o miolo dos serviços)

1. O contrato é quebrado em **etapas medíveis** (forro, sanca, acabamento), cada uma com quantidade e preço.
2. A cada quinzena/mês abre-se uma **medição**: informa-se o **% total já executado** de cada etapa
   (acumulado, não o do período) e o sistema calcula o que entra nesta medição.
3. Sai automático: **retenção técnica** (padrão 5%, devolvida no fim) e os **descontos**
   (amortização de adiantamento, material da obra, multa).
4. A medição nasce **rascunho** → **aprovada** (libera o pagamento) → **paga**.
   Na aprovação o sistema confere a pasta do prestador e **avisa se há CND ou ASO vencido** —
   dá para aprovar mesmo assim, mas fica registrado no histórico quem aprovou com pendência.
5. O **boletim em PDF** traz % anterior, % atual, valor do período e acumulado, com três assinaturas.
   É o papel que o prestador assina reconhecendo o que foi medido.
6. No fim: **liberar retenção** e **avaliar** (qualidade, prazo, limpeza, segurança).

## Limitações conhecidas (de propósito, por enquanto)

1. **Foto de recebimento exige internet** no momento do clique. O resto do app é offline-first.
2. **Gravação campo a campo é "última escrita vence"** entre dois aparelhos. As listas
   (histórico, recebimentos, cotações) são unidas por id, e a situação da ordem de compra
   é recalculada no servidor — o resto, não.
3. Senha única compartilhada: o histórico registra o NOME que cada pessoa digita ao entrar,
   não uma identidade verificada.

## Armadilhas já pagas (não repetir)

1. **Leitura do Blobs é eventual.** Um registro recém-gravado volta como
   inexistente por mais de 5 segundos. Resolve com `consistency: 'strong'`, que
   **só funciona em Function v2** (ESM + `export default`); na runtime antiga
   (`exports.handler` + `connectLambda`) toda leitura passa a dar erro.
2. **A listagem (`list`) demora ~1 minuto.** Por isso o `puxar()` do store.js
   preserva o que foi mexido nos últimos 3 minutos, senão o registro some da tela
   de quem acabou de criá-lo.
3. **Numeração:** uma chave por número com `onlyIfNew` (atômico). Contador
   "lê, soma 1, grava" duplica de verdade.
4. **`await` em toda gravação de índice.** A Function congela ao responder;
   promessa solta não chega a gravar.
5. **Ordem dos scripts:** quem preenche `TELAS` (compras.js, acervo.js) carrega
   antes do app.js, então `const TELAS = {}` mora no ui.js.
6. **Renomear function não substitui o pacote antigo na hora** — o endpoint velho
   continuou respondendo código antigo. Se um deploy "não pegar" na Function,
   confira com um marcador no `ping`.
7. **`verPublico` usa LISTA BRANCA de campos.** Lista negra (`delete x.historico`) sempre fica
   para trás quando um módulo novo passa a gravar campo novo dentro do mesmo registro — foi assim
   que medição, diário e avaliação interna começaram a sair no link do prestador.
8. **Campo de UNIÃO no servidor (`CAMPOS_UNIAO`) nunca REMOVE item de array.** Para apagar um
   documento/pessoa da pasta, marque `apagadoEm` no sub-registro e filtre na leitura — tirar do
   array faz o item voltar no próximo sync.
9. **Nunca grave a partir do objeto que a tela desenhou.** Com o modal aberto o app não redesenha,
   mas o sync troca os dados por baixo: releia com `achar()` na hora de salvar.
10. **jsPDF:** só Helvetica. Registrar outra fonte sem registrar todos os estilos
   faz cair em Times sem avisar.
