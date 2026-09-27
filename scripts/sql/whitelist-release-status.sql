begin read only;
select jsonb_build_object(
  'auth_users',(select count(*) from auth.users),
  'admin_retained',exists(select 1 from auth.users where id='ac5cb167-7cdc-4e49-ba50-47a8a5220b88' and email='pixelgd.games@gmail.com'),
  'nonadmin_auth_users',(select count(*) from auth.users u where not exists(select 1 from public.admin_users a where lower(a.email)=lower(u.email))),
  'players',(select count(*) from public.player_accounts),
  'wallets',(select count(*) from public.wallet_accounts),
  'transactions',(select count(*) from public.wallet_transactions),
  'sessions',(select count(*) from public.game_sessions),
  'matches',(select count(*) from public.joy8_matches),
  'participants',(select count(*) from public.joy8_match_participants),
  'settlements',(select count(*) from public.joy8_settlements),
  'entries',(select count(*) from public.joy8_settlement_entries),
  'immutable_triggers_enabled',(select count(*) from pg_trigger where tgname in ('joy8_wallet_transactions_immutable','joy8_settlement_entries_immutable','joy8_settlements_immutable') and tgenabled='O'),
  'mahjong',(select jsonb_build_object('published',g.published,'reservation_mode',p.reservation_mode,'max_reserve_amount',p.max_reserve_amount,'max_payout_amount',p.max_payout_amount,'funding_mode',p.funding_mode) from public.games g join public.joy8_game_policies p on p.game_id=g.id where g.slug='mahjong-clash'),
  'mahjong_key_scopes',(select scopes from public.joy8_backend_keys where id='a2eeea4b-026b-4e32-bfd8-1d75223ad92b')
) as release_status;
commit;
