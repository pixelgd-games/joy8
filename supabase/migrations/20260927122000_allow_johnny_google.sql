begin;
set local lock_timeout='5s';
insert into public.joy8_email_allowlist(email)
values('johnnyli1226@gmail.com')
on conflict(email) do nothing;
commit;
