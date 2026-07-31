-- ============================================================================
-- Cron diário — substitui o [functions."rotina"] schedule = "@daily" do Netlify.
--
-- Job agendado sem substituto é funcionalidade morrendo em silêncio: sem isto,
-- o sistema para de fazer backup e a lixeira nunca é esvaziada, e ninguém
-- percebe até precisar restaurar.
--
-- Preencha os dois valores abaixo ANTES de rodar (o script de virada faz isso
-- sozinho): a URL do projeto e o ROTINA_TOKEN.
-- ============================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 06:00 UTC = 03:00 em Montes Claros (UTC-3). Madrugada, com o sistema parado.
select cron.schedule(
  'domo-rotina-diaria',
  '0 6 * * *',
  $$
  select net.http_post(
    url     := 'https://reoghclxripktzpdwhiy.supabase.co/functions/v1/domo-rotina',
    headers := jsonb_build_object('content-type', 'application/json', 'x-rotina-token', 'SEU_ROTINA_TOKEN'),
    body    := '{}'::jsonb
  );
  $$
);
