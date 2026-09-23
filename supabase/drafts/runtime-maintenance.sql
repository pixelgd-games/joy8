begin;

create or replace function public.joy8_cleanup_gateway_runtime()
returns table(expired_sessions integer,removed_rate_limits integer)
language plpgsql security definer set search_path = '' as $$
declare v_sessions integer; v_limits integer;
begin
  update public.game_sessions set status='expired',closed_at=coalesce(closed_at,now())
    where status='active' and (expires_at<=now() or
      (gateway_token_hash is null and launch_code_used_at is null and launch_code_expires_at<=now()));
  get diagnostics v_sessions=row_count;
  delete from public.gateway_rate_limits where expires_at<=now();
  get diagnostics v_limits=row_count;
  return query select v_sessions,v_limits;
end;
$$;
revoke all on function public.joy8_cleanup_gateway_runtime() from public,anon,authenticated,service_role;
grant execute on function public.joy8_cleanup_gateway_runtime() to service_role;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('joy8-runtime-cleanup','*/10 * * * *','select public.joy8_cleanup_gateway_runtime();');
select public.joy8_validate_product_adapters();

commit;
