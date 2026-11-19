-- Импорт справочников 1С с включённым safeupdate в Supabase.
-- sort_order — первичный ключ: условие охватывает все строки справочника.
-- Проверки входных данных, права RPC и атомарная замена сохранены.

create or replace function public.an_onec_ref_write(p_ref text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'an_onec_bad_rows' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r) <> 'object') then
    raise exception 'an_onec_bad_rows' using errcode = '22023';
  end if;
  if p_ref = 'studios' then
    delete from public.an_onec_studios where sort_order is not null;
    insert into public.an_onec_studios (sort_order, studio, status, city, partner, comment)
    select o, r->>'studio', r->>'status', r->>'city', r->>'partner', r->>'comment'
      from jsonb_array_elements(p_rows) with ordinality x(r, o);
  elsif p_ref = 'nomenclature' then
    if exists (select 1 from jsonb_array_elements(p_rows) r where btrim(coalesce(r->>'code', '')) = '') then
      raise exception 'an_onec_no_code' using errcode = '22023';
    end if;
    delete from public.an_onec_nomenclature where sort_order is not null;
    insert into public.an_onec_nomenclature (sort_order, code, names, category, direction)
    select o, r->>'code', coalesce(r->>'names', ''), coalesce(r->>'category', ''),
           coalesce(r->>'direction', '')
      from jsonb_array_elements(p_rows) with ordinality x(r, o);
  elsif p_ref = 'break_even' then
    delete from public.an_onec_break_even where sort_order is not null;
    insert into public.an_onec_break_even (sort_order, direction, source_city, source_partner, amount,
      studios_count, source_status, source_comment, board_city, board_partner, match_status, check_comment)
    select o, r->>'direction', r->>'source_city', r->>'source_partner', r->>'amount',
           r->>'studios_count', r->>'source_status', r->>'source_comment', r->>'board_city',
           r->>'board_partner', r->>'match_status', r->>'check_comment'
      from jsonb_array_elements(p_rows) with ordinality x(r, o);
  else
    raise exception 'an_onec_bad_ref' using errcode = '22023';
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.an_onec_ref_write(text, jsonb) from public, anon, authenticated;
grant execute on function public.an_onec_ref_write(text, jsonb) to service_role;
