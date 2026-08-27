-- Reconcile databases where the opt-in draft migration 005 was applied.
-- The deployed application and all migrations after 005 use twitter_* names.
-- Renames preserve column data, defaults, constraints, indexes, and identity.
DO $$
DECLARE
  rename_pair text[];
BEGIN
  FOREACH rename_pair SLICE 1 IN ARRAY ARRAY[
    ['auth_provider_id', 'twitter_id'],
    ['username', 'twitter_username'],
    ['display_name', 'twitter_name'],
    ['profile_image', 'twitter_profile_image'],
    ['access_token', 'twitter_access_token']
  ]::text[][]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
        AND column_name = rename_pair[1]
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
        AND column_name = rename_pair[2]
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.users RENAME COLUMN %I TO %I',
        rename_pair[1], rename_pair[2]
      );
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events_raw'
      AND column_name = 'legacy_user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events_raw'
      AND column_name = 'twitter_user_id'
  ) THEN
    ALTER TABLE public.events_raw
      RENAME COLUMN legacy_user_id TO twitter_user_id;
  END IF;
END
$$;
