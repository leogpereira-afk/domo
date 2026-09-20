-- Estado privado do espelho: a folha original e as decisões da Domo ficam separados.
create table if not exists public.domo_vagas_estado (
  obra text primary key check (obra = 'diamond'),
  revisao bigint not null default 1,
  estado jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.domo_vagas_estado enable row level security;
revoke all on public.domo_vagas_estado from anon, authenticated;
grant all on public.domo_vagas_estado to service_role;
-- Compare-and-swap evita que duas telas sobrescrevam decisões concorrentes.
create or replace function public.domo_vagas_salvar(p_revisao bigint, p_estado jsonb)
returns bigint language plpgsql security invoker set search_path = public as $$
declare nova bigint;
begin
  update public.domo_vagas_estado set estado=p_estado, revisao=revisao+1, atualizado_em=now()
  where obra='diamond' and revisao=p_revisao returning revisao into nova;
  if nova is null then raise exception 'VAGAS_CONFLITO'; end if;
  return nova;
end; $$;
revoke all on function public.domo_vagas_salvar(bigint,jsonb) from public, anon, authenticated;
grant execute on function public.domo_vagas_salvar(bigint,jsonb) to service_role;
