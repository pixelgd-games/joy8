export async function loadProductAccounting(db) {
  await db.exec(`
    create role fixture_product_owner nologin;
    create role fixture_product_runtime nologin;
    create schema fixture_product authorization fixture_product_owner;
    set role fixture_product_owner;
    create table fixture_product.accounts(ref text primary key, balance numeric not null, locked numeric not null default 0);
    create table fixture_product.matches(id uuid primary key, state text not null, reserves jsonb not null, settlement_id uuid);
    insert into fixture_product.accounts values('bot-1',1000,0);
    create function fixture_product.accounting(action text, match_id uuid, payload jsonb)
    returns jsonb language plpgsql security definer set search_path='' as $$
    declare item jsonb; amount numeric; reservations jsonb;
    begin
      perform ref from fixture_product.accounts order by ref for update;
      if action='open' then
        reservations:=payload->'request'->'product_participants';
        for item in select value from jsonb_array_elements(reservations) loop
          amount:=(item->>'reserve')::numeric;
          update fixture_product.accounts set locked=locked+amount where ref=item->>'account_ref' and balance-locked>=amount;
          if not found then raise exception 'LOOTY_ADAPTER_REJECTED'; end if;
        end loop;
        insert into fixture_product.matches values(match_id,'open',reservations,null);
      else
        select reserves into strict reservations from fixture_product.matches where id=match_id and state='open' for update;
        for item in select value from jsonb_array_elements(reservations) loop
          update fixture_product.accounts set locked=locked-(item->>'reserve')::numeric where ref=item->>'account_ref';
        end loop;
        if action='settle' then
          for item in select value from jsonb_array_elements(payload->'request'->'entries') where value->>'kind'='product' loop
            update fixture_product.accounts set balance=balance+(item->>'amount')::numeric where ref=item->>'account_ref';
          end loop;
        end if;
        update fixture_product.matches set state=action,settlement_id=(payload->>'settlement_id')::uuid where id=match_id;
      end if;
      if payload->'request'->'product_commit'->>'fail'='true' then raise exception 'LOOTY_ADAPTER_REJECTED'; end if;
      return jsonb_build_object('committed',true);
    end;
    $$;
    revoke all on function fixture_product.accounting(text,uuid,jsonb) from public;
    reset role;
  `)
}
