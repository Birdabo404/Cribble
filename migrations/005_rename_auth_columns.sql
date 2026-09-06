-- Migration 005 was drafted as an opt-in rename, but the application and
-- every later migration retained the deployed twitter_* column contract.
--
-- Keep this numbered step as an explicit no-op so ordered migration runners
-- do not rename columns out from under migrations 039 and 043-060. Databases
-- where the draft rename was applied are reconciled by migration 062.
DO $$
BEGIN
  RAISE NOTICE '005 auth-column rename intentionally skipped; see migration 062';
END
$$;
