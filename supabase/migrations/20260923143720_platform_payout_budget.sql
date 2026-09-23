begin;

do $$
begin
  if exists(select 1 from public.joy8_matches where funding_mode='platform' and state='open') then
    raise exception 'JOY8_BUDGET_REQUIRES_NO_OPEN_PLATFORM_MATCHES';
  end if;
end;
$$;

create table public.joy8_payout_budgets (
  game_id uuid primary key references public.games(id) on delete restrict,
  approved_amount numeric(18,2) not null default 0 check(approved_amount>=0),
  paid_amount numeric(18,2) not null default 0 check(paid_amount>=0),
  reserved_amount numeric(18,2) not null default 0 check(reserved_amount>=0),
  check(paid_amount+reserved_amount<=approved_amount)
);
alter table public.joy8_payout_budgets enable row level security;
revoke all on public.joy8_payout_budgets from public,anon,authenticated,service_role;

alter table public.joy8_matches add column platform_paid_amount numeric(18,2) not null default 0
  check(platform_paid_amount>=0 and platform_paid_amount<=max_payout_amount);

create function public.joy8_reserve_payout_budget()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.funding_mode='platform' then
    update public.joy8_payout_budgets set reserved_amount=reserved_amount+new.max_payout_amount
    where game_id=new.game_id and approved_amount-paid_amount-reserved_amount>=new.max_payout_amount;
    if not found then raise exception 'JOY8_PAYOUT_BUDGET_EXCEEDED' using errcode='22003'; end if;
  end if;
  return new;
end;
$$;

create function public.joy8_consume_payout_budget()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_match public.joy8_matches%rowtype; v_cost numeric;
begin
  select m.* into v_match from public.joy8_matches m
    join public.joy8_settlements s on s.match_id=m.id where s.id=new.settlement_id for update of m;
  if v_match.funding_mode<>'platform' or new.kind='platform' or new.amount<=0 then return new; end if;
  v_cost:=new.amount;
  if v_match.platform_paid_amount+v_cost>v_match.max_payout_amount then
    raise exception 'JOY8_PAYOUT_BUDGET_EXCEEDED' using errcode='22003';
  end if;
  update public.joy8_payout_budgets set paid_amount=paid_amount+v_cost,reserved_amount=reserved_amount-v_cost
    where game_id=v_match.game_id and reserved_amount>=v_cost;
  if not found then raise exception 'JOY8_PAYOUT_BUDGET_EXCEEDED' using errcode='22003'; end if;
  update public.joy8_matches set platform_paid_amount=platform_paid_amount+v_cost where id=v_match.id;
  return new;
end;
$$;

create function public.joy8_release_payout_budget()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.funding_mode='platform' and old.state='open' and new.state in ('settled','cancelled') then
    update public.joy8_payout_budgets
      set reserved_amount=reserved_amount-(new.max_payout_amount-new.platform_paid_amount)
      where game_id=new.game_id;
    if not found then raise exception 'JOY8_PAYOUT_BUDGET_EXCEEDED' using errcode='22003'; end if;
  end if;
  return new;
end;
$$;

create trigger joy8_reserve_payout_budget before insert on public.joy8_matches
  for each row execute function public.joy8_reserve_payout_budget();
create trigger joy8_consume_payout_budget before insert on public.joy8_settlement_entries
  for each row execute function public.joy8_consume_payout_budget();
create trigger joy8_release_payout_budget after update of state on public.joy8_matches
  for each row execute function public.joy8_release_payout_budget();

revoke all on function public.joy8_reserve_payout_budget(),public.joy8_consume_payout_budget(),public.joy8_release_payout_budget()
  from public,anon,authenticated,service_role;
select public.joy8_validate_product_adapters();

commit;
