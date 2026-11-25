-- Удаление подключения amoCRM только из портала. Данные в amoCRM не меняются.
-- Токен, настройки, кэш и версии удаляются одной транзакцией.
-- Зафиксированные месячные отчёты общие для сети и сохраняются.
create or replace function public.an_amo_connection_delete(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.an_require_admin();
  perform 1 from public.an_amo_connections where id = p_id for update;
  if not found then
    raise exception 'Подключение уже удалено или не найдено.' using errcode = 'P0002';
  end if;
  perform 1 from public.an_amo_sync_state where connection_id = p_id for update;
  if exists (select 1 from public.an_amo_sync_state
              where connection_id = p_id and is_running
                and last_started_at > now() - interval '30 minutes')
     or exists (select 1 from public.an_amo_ops_runs
                 where connection_id = p_id and status = 'running'
                   and started_at > now() - interval '30 minutes') then
    raise exception 'Дождитесь завершения загрузки этого подключения и повторите удаление.'
      using errcode = 'P0001';
  end if;
  delete from public.an_amo_versions where connection_id = p_id;
  delete from public.an_amo_connections where id = p_id;
  delete from public.an_secrets where kind = 'amocrm' and ref = p_id::text;
  perform public.an_audit_add(auth.uid(), 'amocrm_connection_deleted', p_id::text);
end;
$$;
revoke all on function public.an_amo_connection_delete(bigint) from public, anon;
grant execute on function public.an_amo_connection_delete(bigint) to authenticated;
