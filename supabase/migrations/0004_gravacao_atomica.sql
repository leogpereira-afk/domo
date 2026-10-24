-- Aplicar antes de publicar as Functions que usam CAS. Não há fallback inseguro.
-- Falha e reverte se já houver duas OCs vivas para uma cotação ou uma ordem em
-- duas permutas; esses casos exigem revisão humana, nunca exclusão automática.
begin;

create or replace function public.domo_gravar_se_inalterado(
  p_colecao text, p_id text, p_esperado jsonb, p_registro jsonb
) returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_linhas integer;
begin
  if p_colecao is null or p_id is null or p_registro is null
      or jsonb_typeof(p_registro) <> 'object' or p_registro->>'id' is distinct from p_id then
    raise exception 'Registro inválido';
  end if;
  if p_esperado is null then
    insert into public.domo_registros(colecao, id, registro, atualizado_em, apagado)
      values (p_colecao, p_id, p_registro, now(), coalesce((p_registro->>'apagadoEm') <> '', false))
      on conflict (colecao, id) do nothing;
  else
    update public.domo_registros set registro = p_registro, atualizado_em = now(),
      apagado = coalesce((p_registro->>'apagadoEm') <> '', false)
      where colecao = p_colecao and id = p_id and registro = p_esperado;
  end if;
  get diagnostics v_linhas = row_count;
  return v_linhas = 1;
end $$;
revoke all on function public.domo_gravar_se_inalterado(text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.domo_gravar_se_inalterado(text,text,jsonb,jsonb) to service_role;

-- Índice único é arbitragem transacional; consultar antes no handler não basta.
create unique index if not exists domo_oc_cotacao_unica
  on public.domo_registros ((registro->>'cotacaoId'))
  where colecao = 'oc' and not apagado and coalesce(registro->>'cotacaoId', '') <> '';

create table if not exists public.domo_ordens_permutas (
  ordem_colecao text not null,
  ordem_id text not null,
  permuta_id text not null,
  primary key (ordem_colecao, ordem_id)
);
alter table public.domo_ordens_permutas enable row level security;
revoke all on public.domo_ordens_permutas from anon, authenticated;
grant all on public.domo_ordens_permutas to service_role;

create or replace function public.domo_vincular_ordens_permuta()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op <> 'INSERT' and old.colecao = 'permuta' then
    delete from public.domo_ordens_permutas where permuta_id = old.id;
  end if;
  if tg_op <> 'DELETE' and new.colecao = 'permuta' and not new.apagado then
    insert into public.domo_ordens_permutas(ordem_colecao, ordem_id, permuta_id)
      select distinct o->>'col', o->>'id', new.id
      from jsonb_array_elements(coalesce(new.registro->'ordens', '[]'::jsonb)) o
      where coalesce(o->>'apagadoEm', '') = '' and coalesce(o->>'id', '') <> ''
      order by 1, 2;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.domo_vincular_ordens_permuta() from public, anon, authenticated;
-- Backfill é protegido pela mesma chave única e pela transação da migração.
lock table public.domo_registros in share row exclusive mode;
insert into public.domo_ordens_permutas(ordem_colecao, ordem_id, permuta_id)
  select distinct o->>'col', o->>'id', r.id
  from public.domo_registros r,
    lateral jsonb_array_elements(coalesce(r.registro->'ordens', '[]'::jsonb)) o
  where r.colecao = 'permuta' and not r.apagado and coalesce(o->>'apagadoEm', '') = ''
    and coalesce(o->>'id', '') <> '';
drop trigger if exists domo_ordens_permuta_trg on public.domo_registros;
create trigger domo_ordens_permuta_trg after insert or update or delete
  on public.domo_registros for each row execute function public.domo_vincular_ordens_permuta();
commit;
