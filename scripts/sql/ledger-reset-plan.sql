begin read only;
with scopes as (
  select null::uuid as game_id, 'all' as scope
  union all select id, slug from public.games
), matches as (
  select s.game_id as scope_id, m.id from scopes s join public.joy8_matches m on s.game_id is null or m.game_id=s.game_id
)
select s.scope, (select o.open from (select count(*) open from public.joy8_matches m where m.state='open' and (s.game_id is null or m.game_id=s.game_id)) o) as open_matches,
  jsonb_build_object(
    'game_id',s.game_id,
    'wallet_transactions',(select count(*) from public.wallet_transactions t where s.game_id is null
      or (t.game_id=s.game_id and coalesce(t.source_type,'') not in ('mail_reward','mail_compensation'))),
    'joy8_matches',(select count(*) from matches x where x.scope_id is not distinct from s.game_id),
    'joy8_match_participants',(select count(*) from public.joy8_match_participants p join matches x on x.id=p.match_id where x.scope_id is not distinct from s.game_id),
    'joy8_settlements',(select count(*) from public.joy8_settlements t join matches x on x.id=t.match_id where x.scope_id is not distinct from s.game_id),
    'joy8_settlement_entries',(select count(*) from public.joy8_settlement_entries e join public.joy8_settlements t on t.id=e.settlement_id join matches x on x.id=t.match_id where x.scope_id is not distinct from s.game_id),
    'joy8_reserve_operations',(select count(*) from public.joy8_reserve_operations r join matches x on x.id=r.match_id where x.scope_id is not distinct from s.game_id),
    'joy8_match_recoveries',(select count(*) from public.joy8_match_recoveries r join matches x on x.id=r.match_id where x.scope_id is not distinct from s.game_id),
    'game_sessions',(select count(*) from public.game_sessions g where s.game_id is null or g.game_id=s.game_id),
    'joy8_mail_messages',case when s.game_id is null then (select count(*) from public.joy8_mail_messages) else 0 end,
    'joy8_mail_recipients',case when s.game_id is null then (select count(*) from public.joy8_mail_recipients) else 0 end
  ) as expected
from scopes s order by s.game_id is not null, s.scope;
