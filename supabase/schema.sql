-- Daily Planner 동기화용 테이블. Supabase > SQL Editor에 통째로 붙여 넣고 Run.
-- 여러 번 실행해도 안전합니다.
-- 모든 기기(PC, 나중에 폰)가 이 표 하나에 각자의 행을 JSON으로 올리고 내려받습니다.
-- 행 보안(RLS) 때문에 로그인한 사람은 자기 행만 보고 쓸 수 있습니다.

create table if not exists public.sync_rows (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tbl text not null,          -- lists / tasks / events / notes
  id text not null,
  data jsonb not null,        -- 행 전체 (deleted_at 포함: 지운 것도 전파)
  updated_at text not null,   -- ISO 시각, 나중에 고친 쪽이 이김
  seq bigint not null default 0, -- 서버가 매기는 변경 순번 (내려받기 위치)
  primary key (user_id, tbl, id)
);

create sequence if not exists public.sync_rows_seq;
create index if not exists sync_rows_user_seq on public.sync_rows (user_id, seq);

create or replace function public.sync_rows_bump() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.seq := nextval('public.sync_rows_seq');
  return new;
end $$;

drop trigger if exists sync_rows_bump on public.sync_rows;
create trigger sync_rows_bump before insert or update on public.sync_rows
  for each row execute function public.sync_rows_bump();

alter table public.sync_rows enable row level security;
drop policy if exists "own rows" on public.sync_rows;
create policy "own rows" on public.sync_rows for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.sync_rows from anon;
grant select, insert, update, delete on public.sync_rows to authenticated;

-- 올리기: 서버에 있는 것보다 나중에 고친 행만 덮어씀.
create or replace function public.sync_push(rows jsonb) returns integer
language sql security invoker set search_path = public as $$
  with ins as (
    insert into public.sync_rows as s (user_id, tbl, id, data, updated_at)
    select auth.uid(), r->>'tbl', r->>'id', r->'data', r->>'updated_at'
    from jsonb_array_elements(rows) r
    on conflict (user_id, tbl, id) do update
      set data = excluded.data, updated_at = excluded.updated_at
      where s.updated_at < excluded.updated_at
    returning 1
  )
  select count(*)::int from ins;
$$;
revoke all on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;

-- 다른 PC에서 바꾸면 바로 알 수 있게 실시간 알림 켜기.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_rows') then
    alter publication supabase_realtime add table public.sync_rows;
  end if;
end $$;
