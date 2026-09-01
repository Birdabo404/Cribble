-- ============================================================
-- Migration 067: Cursor profile ownership verification
-- ============================================================
-- The claim flow (062) is trust-based — any logged-in account may take
-- an unclaimed handle. Fine while the stake was a vanity badge; not
-- once team burn folds claimed profiles into a paying team's ranked
-- BURN total. The proof is a display-name challenge: the user puts a
-- short CRIB-XXXX code in their cursor.com display name, one scrape
-- (fetchCursorProfile already returns displayName) confirms it, and
-- the code comes back out.
--
--   verify_code — the outstanding challenge, minted by the verify
--                 route. Regenerating overwrites; success clears it.
--                 No expiry: a code is only useful inside the real
--                 owner's own display name, so a stale one grants
--                 nothing to anyone else.
--   verified_at — set when the scraped display name carried the code;
--                 NULL until then. Reset to NULL whenever the claimed
--                 handle changes (a re-claim of the SAME handle keeps
--                 it), and gone on unlink — the row dies with the link.
--
-- The personal CURSOR burn board stays trust-based and ignores both
-- columns; only surfaces that need proven ownership (team burn) gate
-- on verified_at.
-- Safe to run multiple times.
-- ============================================================

ALTER TABLE public.cursor_profiles
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE public.cursor_profiles
  ADD COLUMN IF NOT EXISTS verify_code TEXT;

-- Format guard, matching generateCursorVerifyCode in lib/cursorVerify.ts:
-- CRIB- plus 4 unambiguous uppercase alphanumerics (no 0/O/1/I). NULL
-- passes a CHECK (unknown is not a violation).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'cursor_profiles_verify_code_format'
          AND conrelid = 'public.cursor_profiles'::regclass
    ) THEN
        ALTER TABLE public.cursor_profiles
            ADD CONSTRAINT cursor_profiles_verify_code_format
            CHECK (verify_code ~ '^CRIB-[2-9A-HJ-NP-Z]{4}$');
    END IF;
END $$;

COMMENT ON COLUMN public.cursor_profiles.verified_at IS
  'When the display-name challenge proved ownership; NULL until then. Reset on handle change, gone on unlink. Team burn gates on this; the personal CURSOR board does not.';
COMMENT ON COLUMN public.cursor_profiles.verify_code IS
  'Outstanding CRIB-XXXX display-name challenge code; cleared on success and on handle change. No expiry — only useful inside the owner''s own display name.';
