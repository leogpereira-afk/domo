# Migração Netlify → Supabase + GitHub Pages

Estado: **backend novo no ar e testado. O Netlify continua servindo a equipe até a virada.**

- Site novo (pronto, ainda não é o oficial): https://leogpereira-afk.github.io/domo/
- Site em uso pela equipe: https://domo-construtora.netlify.app
- Supabase: projeto `reoghclxripktzpdwhiy`, tudo com prefixo `domo_` / `domo-`

## O que já está pronto neste repositório

| Peça | Onde | Situação |
|---|---|---|
| Backup dos dados | `backup-migracao/backup-domo-2026-07-31.json` | ✅ 29 registros + numeração (fora do git, de propósito) |
| Schema do banco | `supabase/migrations/0001_init.sql` | ✅ tabelas, RLS, numeração atômica, bucket |
| Cron diário | `supabase/migrations/0002_cron.sql` | ✅ falta preencher ref e token |
| Edge Function `nucleo` | `supabase/functions/nucleo/` | ✅ porte do `nucleo.mjs`, tipos conferidos |
| Edge Function `acervo` | `supabase/functions/acervo/` | ✅ mesmo protocolo de partes |
| Edge Function `rotina` | `supabase/functions/rotina/` | ✅ backup + faxina diária |
| Migração dos dados | `scripts/migrar-para-supabase.mjs` | ✅ com portão de contagem |
| Deploy no Pages | `.github/workflows/deploy.yml` | ✅ |
| Config do cliente | `config.supabase.js` | ✅ falta o project ref |

## De-para

| Netlify | Supabase |
|---|---|
| Function `nucleo` | Edge Function `nucleo` |
| Function `acervo` | Edge Function `acervo` |
| Function `rotina` (`@daily`) | Edge Function `rotina` + pg_cron |
| Blobs store `domo` | tabela `registros` |
| Blobs store `cfg` | tabela `cfg` (linha única) |
| Blobs store `seq` + `onlyIfNew` | tabelas `seq`/`seq_idx` + função `proximo_numero()` |
| Blobs store `log` | tabela `log` |
| Blobs store `backup` | tabela `backup` |
| Blobs store `arq` | Storage, bucket `arquivos` |
| env `TOKEN` / `PAINEL_SENHA` | segredos do Supabase, mesmos nomes |
| `netlify.toml` schedule | `cron.schedule` no Postgres |

## Decisões tomadas (e por quê)

**Projeto Supabase próprio, não o da Impresilk.** A Domo é outra empresa: outro
CNPJ, outra equipe, outros dados. Misturar num projeto só só faria sentido se
fosse a mesma operação.

**O login continua sendo o da Domo, não o Supabase Auth.** Aqui a pessoa entra
com nome + senha, e o sistema a identifica *pela senha* — não há campo de
usuário. Trocar por Auth mudaria a UX de todo mundo sem ganho. Os hashes moram
na tabela `cfg` e nunca saem do servidor (`cfgSemSegredo`).

**As Functions foram PORTADAS, não reescritas.** A camada `_shared/dados.ts`
imita o formato do Blobs para que a lógica — numeração, união de campos,
recálculo da situação da ordem, regras de acesso — viesse junto, linha por
linha. Aquela lógica passou por uma auditoria adversarial de 34 correções;
reescrever do zero convidaria os mesmos bugs de volta.

## O que falta para virar (precisa de credencial)

1. **Criar o projeto** no Supabase (região São Paulo) e pegar o *project ref*.
2. **Rodar as migrations** e criar os segredos `TOKEN`, `PAINEL_SENHA`, `ROTINA_TOKEN`.
3. **Publicar as três functions** (`supabase functions deploy`).
4. **Migrar os dados** com o script (portão: contagem tem que bater).
5. **Ligar o cron** e comprovar uma execução.
6. **Publicar no Pages** e testar fim-a-fim.
7. **Virada**: fila zerada em todos os aparelhos → todos trocam de URL.
8. **Só então** desligar o Netlify.

### O que a direção precisa saber antes da virada

**As senhas individuais não migram.** O backup sai sem os hashes — de
propósito, é o que impede um backup vazado de virar acesso. Então:

- A **senha da equipe** continua valendo: ela vem do segredo `PAINEL_SENHA`,
  e é só recriá-lo no Supabase. O valor NUNCA entra neste repositório.
- O acesso do **francisco** migra com nome, cargo e perfil, mas **sem senha**.
  Na primeira entrada, você abre *Acessos da equipe → Nova senha*, o sistema
  gera uma e manda no WhatsApp dele. Leva 20 segundos.

**O PWA antigo sobrevive à morte do site.** Quem já instalou o atalho continua
abrindo do cache do service worker mesmo depois de o Netlify sair do ar — e
sincronizando no endereço velho. Por isso a virada é combinada: fila zerada,
todos reinstalam o atalho no endereço novo, e só depois o Netlify morre.

## Credenciais necessárias (nunca no repositório)

| Para quê | O que é |
|---|---|
| Criar projeto e publicar functions | token pessoal do Supabase (`sbp_…`) |
| Migrar os dados | `service_role` key do projeto novo |
| Publicar no Pages | acesso ao GitHub (`gh auth`) |

A única chave que pode ser commitada é a **anon/publishable** — pública por
design. A `service_role` nunca.
