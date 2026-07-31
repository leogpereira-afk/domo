-- ============================================================================
-- Schema da Domo Construtora no Supabase (substitui o Netlify Blobs).
--
-- Espelho fiel do que existia: cada "store" do Blobs vira uma tabela, e o
-- contrato do cliente (store.js) não muda — só troca o backend por trás das
-- Edge Functions.
--
--   Blobs "domo"   → registros    (1 linha por colecao+id, igual a 1 blob)
--   Blobs "cfg"    → cfg          (linha única: empresa, obras, usuários)
--   Blobs "seq"    → seq + seq_idx (numeração SC-0001, OC-0002…)
--   Blobs "log"    → log
--   Blobs "backup" → backup       (cópia diária, 60 dias)
--   Blobs "arq"    → Storage, bucket "arquivos"
--
-- RLS LIGADA EM TUDO E SEM POLICY: só as Edge Functions (service_role, que
-- ignora RLS) tocam nestas tabelas. É a mesma barreira de hoje — "só a Function
-- fala com o Blobs". Ninguém no navegador lê o Postgres direto com a anon key.
-- ============================================================================

-- ---- registros: o cofre ----------------------------------------------------
create table if not exists public.domo_registros (
  colecao       text not null,
  id            text not null,
  registro      jsonb not null,
  atualizado_em timestamptz not null default now(),
  apagado       boolean not null default false,
  primary key (colecao, id)
);
create index if not exists domo_registros_colecao_idx on public.domo_registros (colecao);
-- A lixeira é varrida todo dia procurando quem foi apagado há mais de 90 dias.
create index if not exists domo_registros_apagado_idx on public.domo_registros (apagado) where apagado;
alter table public.domo_registros enable row level security;

-- ---- cfg: linha única ------------------------------------------------------
-- Guarda empresa, obras, listas e — atenção — os HASHES de senha (senhaHash e
-- usuarios[].hash). Nenhum deles sai daqui: a Edge Function remove antes de
-- responder (cfgSemSegredo). Por isso RLS sem policy é obrigatório aqui.
create table if not exists public.domo_cfg (
  id            boolean primary key default true check (id),
  config        jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
alter table public.domo_cfg enable row level security;
insert into public.domo_cfg (id, config) values (true, '{}'::jsonb) on conflict (id) do nothing;

-- ---- seq: numeração sem duplicata -----------------------------------------
create table if not exists public.domo_seq (
  colecao text primary key,
  n       integer not null default 0
);
alter table public.domo_seq enable row level security;

-- Índice número → id. O Blobs demorava ~1min para LISTAR, então existia este
-- atalho para quem acabou de pedir material achar o próprio pedido. No Postgres
-- não seria necessário, mas mantemos: é barato e o contrato do cliente é o mesmo.
create table if not exists public.domo_seq_idx (
  colecao text not null,
  numero  integer not null,
  reg_id  text not null,
  primary key (colecao, numero)
);
alter table public.domo_seq_idx enable row level security;

-- Pega o próximo número de forma ATÔMICA. No Netlify isso era feito com
-- onlyIfNew (reivindicar uma chave por número), porque "lê, soma 1, grava"
-- duplicava na prática. Aqui um único INSERT ... ON CONFLICT DO UPDATE resolve:
-- o Postgres trava a linha e dois pedidos simultâneos saem com números
-- diferentes, sem laço de tentativa.
create or replace function public.domo_proximo_numero(p_colecao text)
returns integer
language plpgsql
as $$
declare v_n integer;
begin
  insert into public.domo_seq (colecao, n) values (p_colecao, 1)
  on conflict (colecao) do update set n = public.domo_seq.n + 1
  returning public.domo_seq.n into v_n;
  return v_n;
end;
$$;

-- ---- log -------------------------------------------------------------------
create table if not exists public.domo_log (
  id      bigserial primary key,
  em      timestamptz not null default now(),
  entrada jsonb not null
);
create index if not exists domo_log_em_idx on public.domo_log (em desc);
alter table public.domo_log enable row level security;

-- ---- backup diário ---------------------------------------------------------
create table if not exists public.domo_backup (
  dia      date primary key,
  conteudo jsonb not null,
  em       timestamptz not null default now()
);
alter table public.domo_backup enable row level security;

-- ---- meta: contador de versão para o pull econômico ------------------------
create table if not exists public.domo_meta (
  chave         text primary key,
  valor         jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.domo_meta enable row level security;

-- ---- Storage: bucket privado dos arquivos ---------------------------------
-- Plantas, documentos da empresa, fotos de recebimento e do diário. Privado:
-- quem baixa passa pela Edge Function, que confere a senha antes.
insert into storage.buckets (id, name, public)
values ('domo-arquivos', 'domo-arquivos', false)
on conflict (id) do nothing;
