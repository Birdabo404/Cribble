-- ============================================================================
-- CLEAN WORKING MIGRATION FOR SUPABASE - Copy & Paste Ready
-- ============================================================================
-- This migration fixes all schema issues and adds the new scoring system

begin;

-- ============================================================================
-- STEP 1: CLEAN UP DUPLICATES SAFELY
-- ============================================================================

do $$
begin
    -- Only clean if we haven't already
    if not exists (select 1 from information_schema.table_constraints
                   where table_name = 'events_raw'
                   and constraint_name = 'unique_event_per_user_domain_timestamp') then

        raise notice 'Cleaning up duplicate events...';

        -- Create temp table to identify duplicates
        create temp table duplicate_events as
        select
          user_id,
          domain,
          timestamp,
          array_agg(id order by id desc) as event_ids
        from events_raw
        group by user_id, domain, timestamp
        having count(*) > 1;

        -- Delete duplicates (keep most recent)
        delete from events_raw
        where id in (
          select unnest(event_ids[2:])
          from duplicate_events
        );

        -- Clean up
        drop table duplicate_events;

        raise notice 'Duplicate cleanup completed';
    end if;
end $$;

-- ============================================================================
-- STEP 2: ADD UNIQUE CONSTRAINT (TYPE-SAFE)
-- ============================================================================

do $$
declare
    user_id_type text;
    users_id_type text;
begin
    -- Check if constraint already exists
    if not exists (select 1 from information_schema.table_constraints
                   where table_name = 'events_raw'
                   and constraint_name = 'unique_event_per_user_domain_timestamp') then

        -- Check column types
        select data_type into user_id_type
        from information_schema.columns
        where table_name = 'events_raw' and column_name = 'user_id';

        select data_type into users_id_type
        from information_schema.columns
        where table_name = 'users' and column_name = 'id';

        -- Only add constraint if types match
        if user_id_type = users_id_type then
            alter table events_raw
            add constraint unique_event_per_user_domain_timestamp
            unique (user_id, domain, timestamp);
            raise notice 'Added unique constraint successfully';
        else
            raise notice 'Skipped unique constraint - type mismatch: events_raw.user_id (%) vs users.id (%)', user_id_type, users_id_type;
        end if;
    end if;
end $$;

-- ============================================================================
-- STEP 3: ADD INDEXES FOR PERFORMANCE
-- ============================================================================

create index if not exists idx_events_raw_user_domain_timestamp on events_raw (user_id, domain, timestamp);
create index if not exists idx_events_raw_timestamp_desc on events_raw (timestamp desc);
create index if not exists idx_events_raw_device_timestamp on events_raw (device_uuid, timestamp desc);
create index if not exists idx_events_raw_user_timestamp_desc on events_raw (user_id, timestamp desc);
create index if not exists idx_events_raw_domain_timestamp on events_raw (domain, timestamp desc);
create index if not exists idx_events_raw_device_timestamp_desc on events_raw (device_uuid, timestamp desc);
create index if not exists idx_user_devices_active_only on user_devices (user_id, last_sync_at desc) where is_active = true;

-- ============================================================================
-- STEP 4: ADD CHECK CONSTRAINTS (SAFE)
-- ============================================================================

-- Add check constraints safely (PostgreSQL doesn't support 'if not exists' for constraints)
do $$
begin
    if not exists (select 1 from information_schema.table_constraints
                   where table_name = 'events_raw' and constraint_name = 'chk_events_raw_active_ms_positive') then
        alter table events_raw add constraint chk_events_raw_active_ms_positive check (active_ms >= 0);
    end if;

    if not exists (select 1 from information_schema.table_constraints
                   where table_name = 'events_raw' and constraint_name = 'chk_events_raw_total_ms_positive') then
        alter table events_raw add constraint chk_events_raw_total_ms_positive check (total_ms >= 0);
    end if;

    if not exists (select 1 from information_schema.table_constraints
                   where table_name = 'events_raw' and constraint_name = 'chk_events_raw_visits_positive') then
        alter table events_raw add constraint chk_events_raw_visits_positive check (visits >= 0);
    end if;

    if not exists (select 1 from information_schema.table_constraints
                   where table_name = 'events_raw' and constraint_name = 'chk_events_raw_domain_not_empty') then
        alter table events_raw add constraint chk_events_raw_domain_not_empty check (length(trim(domain)) > 0);
    end if;

    if not exists (select 1 from information_schema.table_constraints
                   where table_name = 'events_raw' and constraint_name = 'chk_events_raw_client_version_not_empty') then
        alter table events_raw add constraint chk_events_raw_client_version_not_empty check (length(trim(client_version)) > 0);
    end if;
end $$;

-- Add device constraints safely
do $$
begin
    if not exists (select 1 from information_schema.table_constraints
                   where table_name = 'user_devices' and constraint_name = 'chk_user_devices_device_name_not_empty') then
        alter table user_devices add constraint chk_user_devices_device_name_not_empty check (length(trim(device_name)) > 0);
    end if;

    if not exists (select 1 from information_schema.table_constraints
                   where table_name = 'user_devices' and constraint_name = 'chk_user_devices_browser_info_valid') then
        alter table user_devices add constraint chk_user_devices_browser_info_valid check (jsonb_typeof(browser_info) = 'object');
    end if;
end $$;

-- ============================================================================
-- STEP 5: CREATE USER_SCORES TABLE
-- ============================================================================

create table if not exists user_scores (
  user_id integer primary key,
  total_score integer not null default 0,
  today_score integer not null default 0,
  week_score integer not null default 0,
  month_score integer not null default 0,
  last_calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add foreign key reference (only if types match and constraint doesn't exist)
do $$
declare
    user_scores_user_id_type text;
    users_id_type text;
begin
    select data_type into user_scores_user_id_type
    from information_schema.columns
    where table_name = 'user_scores' and column_name = 'user_id';

    select data_type into users_id_type
    from information_schema.columns
    where table_name = 'users' and column_name = 'id';

    -- Check if constraint already exists
    if not exists (select 1 from information_schema.table_constraints
                   where table_name = 'user_scores' and constraint_name = 'fk_user_scores_user') then

        -- Only add if types match
        if user_scores_user_id_type = users_id_type then
            alter table user_scores add constraint fk_user_scores_user
            foreign key (user_id) references users(id) on delete cascade;
        end if;
    end if;
end $$;

-- Performance index for scores
create index if not exists idx_user_scores_total_score on user_scores (total_score desc);

-- ============================================================================
-- STEP 6: CREATE SCORING FUNCTION (TYPE-SAFE)
-- ============================================================================

create or replace function recalculate_user_score(p_user_id integer)
returns void
language plpgsql
security definer
as $$
declare
  v_total_score integer := 0;
  v_today_score integer := 0;
  v_week_score integer := 0;
  v_month_score integer := 0;
  v_now timestamptz := now();
  v_user_id_text text := p_user_id::text;
begin
  -- Calculate total score (handle both UUID and integer user_id types)
  select coalesce(sum(active_ms) * 0.001 + sum(visits) * 50, 0)::integer
  into v_total_score
  from events_raw
  where (user_id::text = v_user_id_text or twitter_user_id = p_user_id);

  -- Calculate today's score
  select coalesce(sum(active_ms) * 0.001 + sum(visits) * 50, 0)::integer
  into v_today_score
  from events_raw
  where (user_id::text = v_user_id_text or twitter_user_id = p_user_id)
  and timestamp >= date_trunc('day', v_now);

  -- Calculate week's score
  select coalesce(sum(active_ms) * 0.001 + sum(visits) * 50, 0)::integer
  into v_week_score
  from events_raw
  where (user_id::text = v_user_id_text or twitter_user_id = p_user_id)
  and timestamp >= date_trunc('week', v_now);

  -- Calculate month's score
  select coalesce(sum(active_ms) * 0.001 + sum(visits) * 50, 0)::integer
  into v_month_score
  from events_raw
  where (user_id::text = v_user_id_text or twitter_user_id = p_user_id)
  and timestamp >= date_trunc('month', v_now);

  -- Insert or update
  insert into user_scores (user_id, total_score, today_score, week_score, month_score, last_calculated_at, updated_at)
  values (p_user_id, v_total_score, v_today_score, v_week_score, v_month_score, v_now, v_now)
  on conflict (user_id)
  do update set
    total_score = excluded.total_score,
    today_score = excluded.today_score,
    week_score = excluded.week_score,
    month_score = excluded.month_score,
    last_calculated_at = excluded.last_calculated_at,
    updated_at = excluded.updated_at;
end;
$$;

-- ============================================================================
-- STEP 7: CREATE DEVICE SYNC TRIGGER
-- ============================================================================

create or replace function update_device_last_sync()
returns trigger
language plpgsql
as $$
begin
  update user_devices
  set last_sync_at = NEW.timestamp
  where device_uuid = NEW.device_uuid
  and (last_sync_at is null or last_sync_at < NEW.timestamp);

  return NEW;
end;
$$;

drop trigger if exists trigger_update_device_last_sync on events_raw;
create trigger trigger_update_device_last_sync
  after insert on events_raw
  for each row
  execute function update_device_last_sync();

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

commit;

-- ============================================================================
-- POST-MIGRATION: Populate user_scores for existing users
-- ============================================================================

-- This will calculate scores for all existing users
-- Run this separately after the migration completes

/*
-- Uncomment and run this after migration completes:

do $$
declare
    user_record record;
begin
    for user_record in select id from users loop
        perform recalculate_user_score(user_record.id);
        raise notice 'Calculated scores for user %', user_record.id;
    end loop;

    raise notice 'Score calculation completed for all users';
end $$;

*/
