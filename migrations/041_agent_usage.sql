-- ============================================================
-- Migration 041: Agent API keys + daily token usage
-- ============================================================
-- Adds named, revocable personal access keys for the Cribble agent CLI
-- and per-machine daily token-usage facts. These tables are an isolated
-- product surface: they do not feed extension events, scores, insights,
-- achievements, or the leaderboard.
--
-- Safe to run multiple times. Service-role only; no RLS policies.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_api_keys (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE
    CONSTRAINT agent_api_keys_key_hash_format
      CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  key_prefix TEXT NOT NULL
    CONSTRAINT agent_api_keys_key_prefix_format
      CHECK (key_prefix ~ '^crib_ag_[0-9a-f]{4}$'),
  label TEXT NOT NULL
    CONSTRAINT agent_api_keys_label_length
      CHECK (BTRIM(label) <> '' AND CHAR_LENGTH(label) <= 40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT agent_api_keys_timestamps_ordered
    CHECK (last_used_at IS NULL OR last_used_at >= created_at),
  CONSTRAINT agent_api_keys_revocation_ordered
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

COMMENT ON TABLE public.agent_api_keys IS
  'Named, revocable personal access keys for agent CLI ingestion. Only SHA-256 hashes are stored; service-role only.';
COMMENT ON COLUMN public.agent_api_keys.id IS
  'Internal identifier used for management and per-key rate limiting.';
COMMENT ON COLUMN public.agent_api_keys.user_id IS
  'Owner of the key; rows are erased when the account is deleted.';
COMMENT ON COLUMN public.agent_api_keys.key_hash IS
  'SHA-256 hex digest of the full plaintext bearer key.';
COMMENT ON COLUMN public.agent_api_keys.key_prefix IS
  'Non-secret leading characters displayed in Settings to identify the key.';
COMMENT ON COLUMN public.agent_api_keys.label IS
  'User-provided name for the machine or key.';
COMMENT ON COLUMN public.agent_api_keys.created_at IS
  'Time the key was minted.';
COMMENT ON COLUMN public.agent_api_keys.last_used_at IS
  'Most recent successful bearer-key resolution, updated best effort.';
COMMENT ON COLUMN public.agent_api_keys.revoked_at IS
  'Revocation time; NULL means the key is active.';

CREATE INDEX IF NOT EXISTS idx_agent_api_keys_user
  ON public.agent_api_keys (user_id);

CREATE TABLE IF NOT EXISTS public.agent_usage_daily (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL,
  date DATE NOT NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0
    CONSTRAINT agent_usage_daily_input_tokens_nonnegative
      CHECK (input_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0
    CONSTRAINT agent_usage_daily_output_tokens_nonnegative
      CHECK (output_tokens >= 0),
  cache_creation_tokens BIGINT NOT NULL DEFAULT 0
    CONSTRAINT agent_usage_daily_cache_creation_tokens_nonnegative
      CHECK (cache_creation_tokens >= 0),
  cache_read_tokens BIGINT NOT NULL DEFAULT 0
    CONSTRAINT agent_usage_daily_cache_read_tokens_nonnegative
      CHECK (cache_read_tokens >= 0),
  total_tokens BIGINT NOT NULL DEFAULT 0
    CONSTRAINT agent_usage_daily_total_tokens_nonnegative
      CHECK (total_tokens >= 0),
  cost_usd NUMERIC NOT NULL DEFAULT 0
    CONSTRAINT agent_usage_daily_cost_nonnegative
      CHECK (cost_usd >= 0),
  agents TEXT[] NOT NULL DEFAULT '{}'
    CONSTRAINT agent_usage_daily_agents_bounded
      CHECK (CARDINALITY(agents) <= 32),
  models TEXT[] NOT NULL DEFAULT '{}'
    CONSTRAINT agent_usage_daily_models_bounded
      CHECK (CARDINALITY(models) <= 32),
  timezone TEXT
    CONSTRAINT agent_usage_daily_timezone_length
      CHECK (timezone IS NULL OR CHAR_LENGTH(timezone) BETWEEN 1 AND 64),
  source TEXT NOT NULL DEFAULT 'ccusage'
    CONSTRAINT agent_usage_daily_source_supported
      CHECK (source = 'ccusage'),
  cli_version TEXT
    CONSTRAINT agent_usage_daily_cli_version_length
      CHECK (cli_version IS NULL OR CHAR_LENGTH(cli_version) BETWEEN 1 AND 64),
  generated_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_usage_daily_total_matches_parts
    CHECK (
      total_tokens = input_tokens + output_tokens
        + cache_creation_tokens + cache_read_tokens
    ),
  CONSTRAINT agent_usage_daily_user_client_date_key
    UNIQUE (user_id, client_id, date)
);

COMMENT ON TABLE public.agent_usage_daily IS
  'Per-user, per-local-client daily token usage. The CLI and future menu-bar UI share this isolated ingest surface; service-role only.';
COMMENT ON COLUMN public.agent_usage_daily.id IS
  'Internal daily-fact identifier.';
COMMENT ON COLUMN public.agent_usage_daily.user_id IS
  'Owner of the usage row; rows are erased when the account is deleted.';
COMMENT ON COLUMN public.agent_usage_daily.client_id IS
  'Stable UUID generated by one local client installation; multiple machines remain independent.';
COMMENT ON COLUMN public.agent_usage_daily.date IS
  'Usage day reported by ccusage in the source timezone.';
COMMENT ON COLUMN public.agent_usage_daily.input_tokens IS
  'Input tokens reported for this client and day.';
COMMENT ON COLUMN public.agent_usage_daily.output_tokens IS
  'Output tokens reported for this client and day.';
COMMENT ON COLUMN public.agent_usage_daily.cache_creation_tokens IS
  'Cache-creation tokens reported for this client and day.';
COMMENT ON COLUMN public.agent_usage_daily.cache_read_tokens IS
  'Cache-read tokens reported for this client and day.';
COMMENT ON COLUMN public.agent_usage_daily.total_tokens IS
  'Total tokens reported for this client and day.';
COMMENT ON COLUMN public.agent_usage_daily.cost_usd IS
  'Estimated USD cost reported by the CLI, rounded to at most six decimal places.';
COMMENT ON COLUMN public.agent_usage_daily.agents IS
  'Agent names contributing to this client and day.';
COMMENT ON COLUMN public.agent_usage_daily.models IS
  'Model names contributing to this client and day; no per-model usage breakdown.';
COMMENT ON COLUMN public.agent_usage_daily.timezone IS
  'Optional IANA timezone used for the reported day.';
COMMENT ON COLUMN public.agent_usage_daily.source IS
  'Usage collector that produced the row; defaults to ccusage.';
COMMENT ON COLUMN public.agent_usage_daily.cli_version IS
  'Version of the shared Cribble agent engine that produced the snapshot; retained as the schema-v1 wire name.';
COMMENT ON COLUMN public.agent_usage_daily.generated_at IS
  'Client snapshot time used to reject stale or identical replacements.';
COMMENT ON COLUMN public.agent_usage_daily.ingested_at IS
  'Time the server inserted or most recently replaced the row.';

CREATE INDEX IF NOT EXISTS idx_agent_usage_daily_user_date
  ON public.agent_usage_daily (user_id, date);

ALTER TABLE public.agent_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_usage_daily ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_api_keys FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.agent_usage_daily FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.agent_api_keys_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.agent_usage_daily_id_seq FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_api_keys TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_usage_daily TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.agent_api_keys_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.agent_usage_daily_id_seq TO service_role;
