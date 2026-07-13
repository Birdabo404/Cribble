-- 016_user_type_vocabulary.sql
-- Frees users.user_type from the stale CHECK constraint added in 003.
--
-- Why: the /welcome wizard (and now the profile editor) offers the
-- role vocabulary from src/lib/roles.ts — student, researcher,
-- developer, designer, founder, product, writer, other. The old
-- constraint only allowed ('student','developer','researcher',
-- 'analyst','content_creator','crypto','affiliate'), so saving any of
-- the newer roles violated it and the whole users UPDATE failed —
-- onboarding answers (role included) silently never persisted, which
-- is why role badges didn't update system-wide.
--
-- The vocabulary now lives in application code (src/lib/roles.ts) and
-- both write paths (/api/user/onboarding, /api/user/profile) validate
-- against it, so the column carries no CHECK going forward.
--
-- Idempotent: safe to re-run.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_type_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS check_user_type;

-- 003 also defaulted the column to 'developer' and force-filled it,
-- stamping a role on users who never chose one. New rows start NULL.
ALTER TABLE users ALTER COLUMN user_type DROP DEFAULT;

-- Clear values from the retired vocabulary — nobody picked these in
-- the current product, so showing them as badges would be wrong.
UPDATE users
SET user_type = NULL
WHERE user_type IS NOT NULL
  AND user_type NOT IN (
    'student', 'researcher', 'developer', 'designer',
    'founder', 'product', 'writer', 'other'
  );

-- Clear the force-filled 'developer' default for users who never
-- completed onboarding and never picked a role themselves.
UPDATE users
SET user_type = NULL
WHERE user_type = 'developer'
  AND onboarded_at IS NULL
  AND (metadata->>'role') IS NULL;
