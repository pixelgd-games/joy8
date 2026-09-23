begin;

alter table mahjong_clash.processed_actions
  add constraint processed_actions_history_limit
  check (committed_revision <= 100000);

commit;
