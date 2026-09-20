begin read only;

select jsonb_build_object(
  'resolver_installed',to_regprocedure('public.joy8_resolve_branded_entry(text,text)') is not null,
  'entries',(select jsonb_agg(jsonb_build_object(
    'slug',g.slug,'published',g.published,'enabled',e.enabled,
    'entry_origin',e.entry_origin,'launch_url',e.launch_url
  )) from public.games g join public.joy8_private_entries e on e.game_id=g.id),
  'players',(select count(*) from public.player_accounts),
  'wallets',(select count(*) from public.wallet_accounts),
  'balance',(select coalesce(sum(balance),0) from public.wallet_accounts),
  'locked',(select coalesce(sum(locked_balance),0) from public.wallet_accounts),
  'transactions',(select count(*) from public.wallet_transactions),
  'sessions',(select count(*) from public.game_sessions),
  'unfinished_matches',(select count(*) from public.joy8_matches where state not in ('settled','cancelled')),
  'unfinished_mahjong_matches',(select count(*) from mahjong_clash.matches where status not in ('finished','voided'))
) as branded_entry_preflight;

commit;
