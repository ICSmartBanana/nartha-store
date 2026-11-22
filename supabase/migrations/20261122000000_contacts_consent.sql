-- Customer contact details and marketing consent (WhatsApp + email), captured at try-on sign-in.
-- contacts:    current state, one row per signed-in user.
-- consent_log: append-only record of every explicit choice (proof of consent / withdrawal).
-- Writes go only through save_contact(); customers can read just their own rows.

create table public.contacts (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  email             text not null,
  phone             text check (phone is null or phone ~ '^\+91[6-9][0-9]{9}$'),
  phone_verified    boolean not null default false,
  marketing_consent boolean not null default false,
  consent_channels  text[] not null default '{}',
  consent_text      text,
  consent_at        timestamptz,
  withdrawn_at      timestamptz,
  source            text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.consent_log (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  email        text not null,
  phone        text,
  granted      boolean not null,
  channels     text[] not null,
  consent_text text not null,
  source       text not null,
  user_agent   text,
  created_at   timestamptz not null default now()
);
create index consent_log_user_idx on public.consent_log (user_id, created_at desc);

alter table public.contacts enable row level security;
alter table public.consent_log enable row level security;
create policy "read own contact" on public.contacts for select to authenticated using (user_id = (select auth.uid()));
create policy "read own consent log" on public.consent_log for select to authenticated using (user_id = (select auth.uid()));
-- No insert/update/delete policies: writes happen only inside save_contact().

-- p_phone:   null = leave as is, '' = remove, otherwise an Indian mobile (10 digits, optional +91/91/0 prefix)
-- p_consent: null = leave as is, true/false = the customer's explicit choice
create or replace function public.save_contact(
  p_phone text, p_consent boolean, p_consent_text text, p_source text, p_user_agent text default null
) returns public.contacts
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_phone text;
  v_prev  public.contacts;
  v_row   public.contacts;
  v_now   timestamptz := now();
begin
  if v_uid is null then raise exception 'sign_in_required' using errcode = '28000'; end if;
  if p_source is null or p_source not in ('tryon_signin', 'tryon_prompt', 'tryon_settings') then
    raise exception 'bad_source' using errcode = '22023';
  end if;
  if p_consent is not null and coalesce(length(p_consent_text), 0) not between 10 and 500 then
    raise exception 'consent_text_required' using errcode = '22023';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  select * into v_prev from public.contacts c where c.user_id = v_uid;

  if p_phone is null then
    v_phone := v_prev.phone;
  else
    v_phone := nullif(regexp_replace(p_phone, '[^0-9]', '', 'g'), '');
    if v_phone is not null then
      if v_phone ~ '^(91|0)[6-9][0-9]{9}$' then v_phone := right(v_phone, 10); end if;
      if v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'invalid_phone' using errcode = '22023'; end if;
      v_phone := '+91' || v_phone;
    end if;
  end if;

  insert into public.contacts as c (user_id, email, phone, phone_verified, marketing_consent, consent_channels,
                                    consent_text, consent_at, withdrawn_at, source, updated_at)
  values (
    v_uid, v_email, v_phone, false,
    coalesce(p_consent, false),
    case when coalesce(p_consent, false)
         then case when v_phone is null then array['email'] else array['whatsapp', 'email'] end
         else '{}'::text[] end,
    case when p_consent is not null then p_consent_text end,
    case when p_consent then v_now end,
    case when p_consent = false then v_now end,
    p_source, v_now)
  on conflict (user_id) do update set
    email             = excluded.email,
    phone             = excluded.phone,
    phone_verified    = case when excluded.phone is distinct from c.phone then false else c.phone_verified end,
    marketing_consent = coalesce(p_consent, c.marketing_consent),
    consent_channels  = case when coalesce(p_consent, c.marketing_consent)
                             then case when excluded.phone is null then array['email'] else array['whatsapp', 'email'] end
                             else '{}'::text[] end,
    consent_text      = coalesce(case when p_consent is not null then p_consent_text end, c.consent_text),
    consent_at        = case when p_consent and not c.marketing_consent then v_now else c.consent_at end,
    withdrawn_at      = case when p_consent = false and c.marketing_consent then v_now
                             when p_consent then null else c.withdrawn_at end,
    source            = p_source,
    updated_at        = v_now
  returning * into v_row;

  -- Log every explicit choice, plus any change to the number while consent is on.
  if p_consent is not null
     or (v_row.marketing_consent and v_row.phone is distinct from v_prev.phone) then
    insert into public.consent_log (user_id, email, phone, granted, channels, consent_text, source, user_agent)
    values (v_uid, v_email, v_row.phone, v_row.marketing_consent, v_row.consent_channels,
            coalesce(case when p_consent is not null then p_consent_text end, v_row.consent_text, ''),
            p_source, left(p_user_agent, 300));
  end if;

  return v_row;
end $$;

revoke all on function public.save_contact(text, boolean, text, text, text) from public, anon;
grant execute on function public.save_contact(text, boolean, text, text, text) to authenticated;
