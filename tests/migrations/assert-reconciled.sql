DO $$
DECLARE
  missing_count integer;
  generic_count integer;
BEGIN
  SELECT count(*) INTO missing_count
  FROM unnest(ARRAY[
    'twitter_id', 'twitter_username', 'twitter_name',
    'twitter_profile_image', 'twitter_access_token'
  ]) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = expected.name
  );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'missing % deployed users columns', missing_count;
  END IF;

  SELECT count(*) INTO generic_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'users'
    AND column_name = ANY(ARRAY[
      'auth_provider_id', 'username', 'display_name', 'profile_image', 'access_token'
    ]);
  IF generic_count <> 0 THEN
    RAISE EXCEPTION 'found % abandoned generic users columns', generic_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE twitter_id = 'provider-1'
      AND twitter_username = 'handle'
      AND twitter_name = 'Display'
      AND twitter_profile_image = 'image'
      AND twitter_access_token = 'token'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.events_raw WHERE twitter_user_id = 1
  ) THEN
    RAISE EXCEPTION 'reconciliation did not preserve row data';
  END IF;
END
$$;
