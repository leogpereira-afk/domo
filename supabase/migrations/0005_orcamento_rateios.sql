-- Publicar esta migração antes das Functions do Orçamento. Nenhum dado da fonte
-- é corrigido: rateios legados permanecem identificáveis, inclusive divergências.
begin;

-- Lixeira usa o CAS genérico. Adquirir a trava antes da linha do orçamento
-- mantém a mesma ordem de locks da RPC especializada.
create or replace function public.domo_gravar_se_inalterado(
  p_colecao text, p_id text, p_esperado jsonb, p_registro jsonb
) returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_linhas integer;
begin
  if p_colecao is null or p_id is null or p_registro is null
      or jsonb_typeof(p_registro) <> 'object' or p_registro->>'id' is distinct from p_id then
    raise exception 'Registro inválido';
  end if;
  if p_colecao = 'orc' then perform pg_advisory_xact_lock(20261024, 5); end if;
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

create table if not exists public.domo_orcamento_rateios (
  orcamento_id text not null,
  origem_colecao text not null,
  origem_id text not null,
  etapa text not null,
  valor_centavos numeric not null check (valor_centavos >= 0 and valor_centavos <= 9007199254740991 and valor_centavos = trunc(valor_centavos)),
  primary key (orcamento_id, origem_colecao, origem_id, etapa)
);
create index if not exists domo_orcamento_rateios_origem_idx
  on public.domo_orcamento_rateios (origem_colecao, origem_id, etapa);
alter table public.domo_orcamento_rateios enable row level security;
revoke all on public.domo_orcamento_rateios from public, anon, authenticated;
grant all on public.domo_orcamento_rateios to service_role;

-- Cenários e revisões internas não são alocações. Apenas vínculos ativos de
-- orçamentos ativos consomem saldo, de forma independente por etapa.
create or replace function public.domo_rateios_orcamento(p_registro jsonb)
returns table (col text, id text, etapa text, valor numeric, itens jsonb)
language sql immutable set search_path = public, pg_temp as $$
  select v->>'col', v->>'registroId', v->>'etapa',
    sum((v->>'valorCentavos')::numeric),
    jsonb_agg(jsonb_build_object('id',v->>'id','item',v->>'item','valorCentavos',v->'valorCentavos') order by v->>'id')
  from jsonb_array_elements(coalesce(p_registro->'vinculos','[]'::jsonb)) v
  where coalesce(p_registro->>'apagadoEm','') = '' and coalesce(p_registro->>'inativoEm','') = ''
    and coalesce(v->>'apagadoEm','') = '' and coalesce(v->>'inativoEm','') = ''
    and v->>'etapa' in ('contratado','recebido','executado','pago','permuta')
  group by v->>'col', v->>'registroId', v->>'etapa';
$$;
revoke all on function public.domo_rateios_orcamento(jsonb) from public, anon, authenticated;
grant execute on function public.domo_rateios_orcamento(jsonb) to service_role;

create or replace function public.domo_indexar_rateios_orcamento()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if (tg_op = 'DELETE' and old.colecao <> 'orc') or (tg_op <> 'DELETE' and new.colecao <> 'orc') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  -- Todos os escritores do agregado usam a mesma trava, inclusive lixeira.
  perform pg_advisory_xact_lock(20261024, 5);
  if tg_op <> 'DELETE' and not new.apagado
      and coalesce(new.registro->>'inativoEm','') = ''
      and current_setting('domo.orcamento_em_gravacao', true) is distinct from new.id then
    raise exception 'Orçamento exige gravação transacional atualizada.';
  end if;
  if tg_op <> 'INSERT' then delete from public.domo_orcamento_rateios where orcamento_id = old.id; end if;
  if tg_op <> 'DELETE' then
    insert into public.domo_orcamento_rateios(orcamento_id, origem_colecao, origem_id, etapa, valor_centavos)
      select new.id, r.col, r.id, r.etapa, r.valor from public.domo_rateios_orcamento(new.registro) r;
    return new;
  end if;
  return old;
end $$;
revoke all on function public.domo_indexar_rateios_orcamento() from public, anon, authenticated;

-- A migração conserva o consumo legado; não o duplica nem escolhe um orçamento
-- vencedor. Corrigir/desativar um vínculo ou arquivar o orçamento libera saldo.
lock table public.domo_registros in share row exclusive mode;
insert into public.domo_orcamento_rateios(orcamento_id, origem_colecao, origem_id, etapa, valor_centavos)
  select o.id, r.col, r.id, r.etapa, r.valor
  from public.domo_registros o cross join lateral public.domo_rateios_orcamento(o.registro) r
  where o.colecao = 'orc' and not o.apagado
  on conflict (orcamento_id, origem_colecao, origem_id, etapa)
    do update set valor_centavos = excluded.valor_centavos;
drop trigger if exists domo_orcamento_rateios_trg on public.domo_registros;
create trigger domo_orcamento_rateios_trg after insert or update or delete
  on public.domo_registros for each row execute function public.domo_indexar_rateios_orcamento();

create or replace function public.domo_gravar_orcamento(
  p_id text, p_esperado jsonb, p_registro jsonb, p_fontes jsonb, p_limites jsonb, p_arquivos jsonb
) returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_atual jsonb; v_fonte jsonb; v_meta jsonb; v_ref jsonb; v_grupo record;
  v_antes jsonb; v_limite numeric; v_alocado numeric; v_salvo boolean; v_arquivo text;
begin
  if p_id is null or p_registro is null or jsonb_typeof(p_registro) <> 'object'
      or p_registro->>'id' is distinct from p_id then raise exception 'Orçamento inválido'; end if;
  -- Serializa alocações entre orçamentos. A trava precede a leitura do ledger;
  -- duas requisições concorrentes nunca aprovam com o mesmo saldo anterior.
  perform pg_advisory_xact_lock(20261024, 5);
  select registro into v_atual from public.domo_registros where colecao = 'orc' and id = p_id for update;
  if v_atual is distinct from p_esperado then return false; end if;
  if coalesce(v_atual->>'excluindoEm','') <> '' then raise exception 'Orçamento reservado para limpeza definitiva.'; end if;

  -- O limite foi calculado pelo modelo compartilhado. Guardar e travar todos os
  -- retratos usados (inclusive ordens da permuta) impede aplicar limite obsoleto.
  for v_ref in select value from jsonb_array_elements(coalesce(p_fontes,'[]'::jsonb)) order by value->>'col', value->>'id' loop
    select registro into v_fonte from public.domo_registros
      where colecao = v_ref->>'col' and id = v_ref->>'id' for share;
    if v_fonte is distinct from nullif(v_ref->'registro','null'::jsonb) then
      raise exception 'Origem do rateio mudou durante a gravação. Atualize e confira o vínculo.';
    end if;
  end loop;

  for v_grupo in select * from public.domo_rateios_orcamento(p_registro) loop
    select itens into v_antes from public.domo_rateios_orcamento(p_esperado)
      where col = v_grupo.col and id = v_grupo.id and etapa = v_grupo.etapa;
    -- Uma inconsistência preexistente não bloqueia edição de responsável ou
    -- prazo. Qualquer grupo financeiro alterado volta a ter validação estrita.
    if v_antes is not distinct from v_grupo.itens then continue; end if;
    if not exists (select 1 from jsonb_array_elements(coalesce(p_fontes,'[]'::jsonb)) f
      where f->>'col' = v_grupo.col and f->>'id' = v_grupo.id and f->'registro' <> 'null'::jsonb) then
      raise exception 'Origem do rateio inexistente.';
    end if;
    select (l->>'limiteCentavos')::numeric into v_limite
      from jsonb_array_elements(coalesce(p_limites,'[]'::jsonb)) l
      where l->>'col' = v_grupo.col and l->>'id' = v_grupo.id and l->>'etapa' = v_grupo.etapa;
    if v_limite is null or v_limite < 0 or v_limite > 9007199254740991 or v_limite <> trunc(v_limite) then
      raise exception 'Rateio sem limite ou evidência válida na origem.';
    end if;
    select coalesce(sum(valor_centavos),0) into v_alocado from public.domo_orcamento_rateios
      where orcamento_id <> p_id and origem_colecao = v_grupo.col and origem_id = v_grupo.id and etapa = v_grupo.etapa;
    if v_alocado + v_grupo.valor > v_limite then
      raise exception 'Rateios entre orçamentos excedem o valor da origem (% / %).', v_alocado + v_grupo.valor, v_limite;
    end if;
  end loop;

  for v_arquivo in select distinct jsonb_array_elements_text(coalesce(p_arquivos,'[]'::jsonb)) order by 1 loop
    select registro into v_meta from public.domo_registros where colecao = '_arqmeta' and id = v_arquivo for update;
    if v_meta is null or v_meta->'pronto' is distinct from 'true'::jsonb or coalesce(v_meta->>'apagadoEm','') <> '' or coalesce(v_meta->>'excluindoEm','') <> '' then
      raise exception 'Arquivo inexistente ou envio não concluído. Reenvie o anexo.';
    end if;
    if v_meta->'vinculoPendente' is not null and
      (v_meta#>>'{vinculoPendente,colecao}' is distinct from 'orc' or v_meta#>>'{vinculoPendente,registroId}' is distinct from p_id) then
      raise exception 'Arquivo reservado para outro registro.';
    end if;
  end loop;

  perform set_config('domo.orcamento_em_gravacao', p_id, true);
  v_salvo := public.domo_gravar_se_inalterado('orc', p_id, p_esperado, p_registro);
  perform set_config('domo.orcamento_em_gravacao', '', true);
  if v_salvo then
    for v_arquivo in select distinct jsonb_array_elements_text(coalesce(p_arquivos,'[]'::jsonb)) loop
      update public.domo_registros set registro = registro ||
        jsonb_build_object('vinculadoEm', coalesce(registro->>'vinculadoEm',now()::text), '_revisao',gen_random_uuid()::text,
          'vinculoPendente', coalesce(registro->'vinculoPendente',jsonb_build_object('colecao','orc','registroId',p_id))), atualizado_em = now()
        where colecao = '_arqmeta' and id = v_arquivo;
    end loop;
  end if;
  return v_salvo;
end $$;
revoke all on function public.domo_gravar_orcamento(text,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.domo_gravar_orcamento(text,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;

-- Limpeza manual disputa a mesma trava da restauração. Primeiro marca o
-- orçamento apagado; só depois seus arquivos podem ser removidos. Se a
-- restauração venceu, a base difere e nada é reservado/removido.
create or replace function public.domo_reservar_exclusao_orcamento(p_id text, p_esperado jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_reservado jsonb;
begin
  perform pg_advisory_xact_lock(20261024, 5);
  update public.domo_registros set registro = registro || jsonb_build_object(
    'excluindoEm',coalesce(registro->>'excluindoEm',now()::text),'_revisao',gen_random_uuid()::text), atualizado_em=now()
    where colecao='orc' and id=p_id and apagado and registro=p_esperado
      and coalesce(registro->>'apagadoEm','') <> '' returning registro into v_reservado;
  return v_reservado;
end $$;
create or replace function public.domo_remover_orcamento(p_id text, p_esperado jsonb)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_linhas integer;
begin
  perform pg_advisory_xact_lock(20261024, 5);
  delete from public.domo_registros where colecao='orc' and id=p_id and apagado and registro=p_esperado
    and coalesce(registro->>'excluindoEm','') <> '';
  get diagnostics v_linhas=row_count;
  return v_linhas=1;
end $$;
revoke all on function public.domo_reservar_exclusao_orcamento(text,jsonb) from public, anon, authenticated;
revoke all on function public.domo_remover_orcamento(text,jsonb) from public, anon, authenticated;
grant execute on function public.domo_reservar_exclusao_orcamento(text,jsonb) to service_role;
grant execute on function public.domo_remover_orcamento(text,jsonb) to service_role;
commit;
