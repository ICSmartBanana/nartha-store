-- "Share your look": customers can let NARTHA post a try-on result on its social channels,
-- and get extra try-on credit (share_config.daily_bonus per day, valid for 7 days).
-- Nothing is posted until it is approved on the site's #/admin page (or share_config.auto_publish is on).
-- Posting is done by the "Publish shared try-ons" GitHub Action (scripts/publish_shares.py).

-- One-row settings table. Edit it in Supabase → Table editor → share_config.
create table public.share_config (
  id                boolean primary key default true check (id),
  enabled           boolean not null default true,          -- show the share option to customers
  auto_publish      boolean not null default false,         -- false = every share waits for approval
  channels          text[]  not null default '{}'           -- any of: instagram, facebook, youtube ('{}' = queue only)
                    check (channels <@ array['instagram', 'facebook', 'youtube']),
  daily_bonus       int     not null default 1 check (daily_bonus between 0 and 5),
  max_posts_per_run int     not null default 2 check (max_posts_per_run between 1 and 20),
  caption_template  text    not null default
    E'{title} ✨\nVirtually tried on at NARTHA. Handcrafted cotton, ₹{price}.\n\nTry it on yourself: {url}\n\n#NARTHA #CottonSaree #Handloom #SareeLove #VirtualTryOn',
  site_url          text    not null default 'https://icsmartbanana.github.io/nartha-store/',
  updated_at        timestamptz not null default now()
);
insert into public.share_config default values;

create table public.share_admins (email text primary key check (email = lower(email)));

create table public.shares (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  tryon_id        uuid not null unique references public.tryons(id) on delete cascade,
  handle          text not null,
  result_path     text not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'published', 'withdrawn')),
  consent_text    text not null,
  attested        boolean not null,
  bonus_granted   boolean not null default false,
  user_agent      text,
  post_image_path text,                        -- composed post in the public share-media bucket
  caption         text,
  posts           jsonb not null default '{}', -- {"instagram": {"id": "...", "url": "..."}, ...}
  attempts        int not null default 0,
  publish_error   text,
  reviewed_by     text,
  reviewed_at     timestamptz,
  published_at    timestamptz,
  withdrawn_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index shares_user_idx on public.shares (user_id, created_at desc);
create index shares_status_idx on public.shares (status, created_at);

alter table public.share_config enable row level security;
alter table public.share_admins enable row level security;
alter table public.shares enable row level security;

create or replace function public.is_share_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.share_admins a where a.email = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;

create policy "read own shares" on public.shares for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_share_admin()));
create policy "admins read config" on public.share_config for select to authenticated
  using ((select public.is_share_admin()));
-- No write policies: writes go through the functions below (or the service key used by the publisher).

-- Admins can open the private try-on image of anything that was shared with NARTHA.
create policy "share admins read shared tryons" on storage.objects for select to authenticated
  using (bucket_id = 'tryons' and (select public.is_share_admin())
         and exists (select 1 from public.shares s where s.result_path = name));

-- Public bucket for approved, composed posts (Instagram needs a public image URL).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('share-media', 'share-media', true, 52428800, array['image/jpeg', 'video/mp4'])
on conflict (id) do nothing;

-- What the customer's browser needs: is sharing on, and is today's bonus still available?
create or replace function public.share_settings() returns json
language plpgsql stable security definer set search_path = '' as $$
declare c public.share_config; v_today int;
begin
  select * into c from public.share_config;
  if auth.uid() is null or c.id is null then return json_build_object('enabled', false); end if;
  select count(*) into v_today from public.shares
    where user_id = auth.uid() and bonus_granted
      and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  return json_build_object('enabled', c.enabled, 'daily_bonus', c.daily_bonus,
                           'bonus_left_today', greatest(c.daily_bonus - v_today, 0));
end $$;

create or replace function public.create_share(
  p_tryon uuid, p_consent_text text, p_attested boolean, p_user_agent text default null
) returns public.shares
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  c      public.share_config;
  t      public.tryons;
  v_prev public.shares;
  v_row  public.shares;
  v_today int;
begin
  if v_uid is null then raise exception 'sign_in_required' using errcode = '28000'; end if;
  select * into c from public.share_config;
  if not coalesce(c.enabled, false) then raise exception 'sharing_off' using errcode = '22023'; end if;
  if p_attested is not true then raise exception 'attestation_required' using errcode = '22023'; end if;
  if coalesce(length(p_consent_text), 0) not between 20 and 600 then
    raise exception 'consent_text_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('share' || v_uid::text));
  select * into t from public.tryons where id = p_tryon and user_id = v_uid and status = 'done' and result_path is not null;
  if t.id is null then raise exception 'unknown_tryon' using errcode = '22023'; end if;

  select * into v_prev from public.shares where tryon_id = p_tryon;
  if v_prev.id is not null and v_prev.status <> 'withdrawn' then return v_prev; end if;

  select count(*) into v_today from public.shares
    where user_id = v_uid and bonus_granted
      and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';

  if v_prev.id is not null then
    -- Shared again after removing it: back into the queue, no new bonus.
    update public.shares set status = 'pending', consent_text = p_consent_text, attested = true,
           user_agent = left(p_user_agent, 300), withdrawn_at = null, reviewed_by = null, reviewed_at = null,
           attempts = 0, publish_error = null
      where id = v_prev.id returning * into v_row;
  else
    insert into public.shares (user_id, tryon_id, handle, result_path, consent_text, attested, bonus_granted, user_agent)
    values (v_uid, p_tryon, t.product_handle, t.result_path, p_consent_text, true,
            v_today < c.daily_bonus, left(p_user_agent, 300))
    returning * into v_row;
  end if;
  return v_row;
end $$;

-- Customer removes their share. The publisher then deletes any live posts.
create or replace function public.withdraw_share(p_id uuid) returns public.shares
language plpgsql security definer set search_path = '' as $$
declare v_row public.shares;
begin
  if auth.uid() is null then raise exception 'sign_in_required' using errcode = '28000'; end if;
  update public.shares set status = 'withdrawn', withdrawn_at = now()
    where id = p_id and user_id = auth.uid() and status <> 'withdrawn'
    returning * into v_row;
  return v_row;
end $$;

-- Admin approves or rejects. Rejecting something already posted makes the publisher take it down.
create or replace function public.review_share(p_id uuid, p_approve boolean) returns public.shares
language plpgsql security definer set search_path = '' as $$
declare v_row public.shares;
begin
  if not public.is_share_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.shares set
      status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = lower(auth.jwt() ->> 'email'), reviewed_at = now(), attempts = 0, publish_error = null
    where id = p_id and status in ('pending', 'approved', 'rejected', 'published')
      and (not p_approve or status in ('pending', 'rejected'))
    returning * into v_row;
  return v_row;
end $$;

revoke all on function public.share_settings() from public, anon;
revoke all on function public.create_share(uuid, text, boolean, text) from public, anon;
revoke all on function public.withdraw_share(uuid) from public, anon;
revoke all on function public.review_share(uuid, boolean) from public, anon;
grant execute on function public.share_settings() to authenticated;
grant execute on function public.create_share(uuid, text, boolean, text) to authenticated;
grant execute on function public.withdraw_share(uuid) to authenticated;
grant execute on function public.review_share(uuid, boolean) to authenticated;
revoke all on function public.is_share_admin() from public, anon;
grant execute on function public.is_share_admin() to authenticated;
