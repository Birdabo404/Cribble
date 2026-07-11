-- 009: Per-device secret sync token for extension ingestion auth.
--
-- Before this migration, possession of a device UUID alone was enough to
-- submit score events for the bound user. Now the server issues a random
-- 32-byte token at (re-)registration — a path that requires a valid
-- dashboard session cookie — and every ingestion request must present it in
-- the X-Cribble-Device-Token header. Only the SHA-256 hash is stored.
--
-- NULL sync_token_hash = device not yet provisioned; its syncs are rejected
-- with 401 until the owner re-links via the dashboard (which happens
-- automatically in the dashboard handshake).

ALTER TABLE public.user_devices
  ADD COLUMN IF NOT EXISTS sync_token_hash text;

COMMENT ON COLUMN public.user_devices.sync_token_hash IS
  'SHA-256 hex hash of the device sync token. Plaintext is only ever returned once, in the registration response.';
