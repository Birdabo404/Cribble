-- ============================================================
-- Migration 032: Insights cohort dimensions + tool taxonomy
-- ============================================================
-- Foundation for aggregate usage insights (with 033):
--
--   1. Two coarse cohort columns on user_devices, captured by the
--      extension sync route:
--        - timezone: IANA zone name reported by the dashboard
--          handshake (Intl.DateTimeFormat().resolvedOptions()).
--        - country_code: ISO 3166-1 alpha-2, derived at the edge
--          from the x-vercel-ip-country request header. Only the
--          two-letter code is persisted — the IP itself is never
--          stored.
--   2. tool_taxonomy: vendor + category per tracked domain, the
--      DB mirror of src/lib/toolTaxonomy.ts (which stays the
--      source of truth — re-run this migration after editing it).
--      The nightly rollup (033) stamps these onto
--      daily_tool_aggregates slices.
--
-- Safe to run multiple times.
-- ============================================================

ALTER TABLE IF EXISTS user_devices
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS country_code TEXT;

COMMENT ON COLUMN user_devices.timezone IS
  'IANA timezone reported by the dashboard handshake (e.g. Europe/Berlin).';
COMMENT ON COLUMN user_devices.country_code IS
  'ISO 3166-1 alpha-2 from the x-vercel-ip-country header at sync time; the IP itself is never stored.';

CREATE TABLE IF NOT EXISTS tool_taxonomy (
    domain TEXT PRIMARY KEY,
    vendor TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
        'chat', 'coding', 'image', 'video', 'audio',
        'writing', 'agent', 'platform', 'other'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS with no policies + revoked grants: service-role only, the
-- same lockdown as billboard_ads (030) and team_affiliations (029).
ALTER TABLE tool_taxonomy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE tool_taxonomy FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tool_taxonomy TO service_role;

-- Seed: must match src/lib/toolTaxonomy.ts exactly (coverage is
-- pinned to the tracked allowlist by src/lib/toolTaxonomy.test.ts).
INSERT INTO tool_taxonomy (domain, vendor, category) VALUES
    -- Chat assistants
    ('claude.ai', 'Anthropic', 'chat'),
    ('console.anthropic.com', 'Anthropic', 'platform'),
    ('chatgpt.com', 'OpenAI', 'chat'),
    ('chat.openai.com', 'OpenAI', 'chat'),
    ('platform.openai.com', 'OpenAI', 'platform'),
    ('grok.com', 'xAI', 'chat'),
    ('grok.x.ai', 'xAI', 'chat'),
    ('x.com', 'xAI', 'chat'),
    ('chat.deepseek.com', 'DeepSeek', 'chat'),
    ('copilot.microsoft.com', 'Microsoft', 'chat'),
    ('meta.ai', 'Meta', 'chat'),
    ('kimi.com', 'Moonshot AI', 'chat'),
    ('chat.qwen.ai', 'Alibaba', 'chat'),
    ('z.ai', 'Zhipu AI', 'chat'),
    ('chat.mistral.ai', 'Mistral AI', 'chat'),
    ('perplexity.ai', 'Perplexity', 'chat'),
    ('you.com', 'You.com', 'chat'),
    ('poe.com', 'Quora', 'chat'),
    ('phind.com', 'Phind', 'chat'),
    ('lmarena.ai', 'LMArena', 'chat'),
    ('arena.ai', 'LMArena', 'chat'),
    ('character.ai', 'Character.AI', 'chat'),
    ('my.replika.ai', 'Replika', 'chat'),
    ('manus.im', 'Manus', 'agent'),
    ('genspark.ai', 'Genspark', 'agent'),
    -- Google
    ('gemini.google.com', 'Google', 'chat'),
    ('aistudio.google.com', 'Google', 'platform'),
    ('notebooklm.google.com', 'Google', 'writing'),
    ('labs.google', 'Google', 'platform'),
    ('jules.google', 'Google', 'agent'),
    ('jules.google.com', 'Google', 'agent'),
    -- Coding & app builders
    ('github.com', 'GitHub', 'coding'),
    ('cursor.com', 'Anysphere', 'coding'),
    ('v0.app', 'Vercel', 'coding'),
    ('lovable.dev', 'Lovable', 'coding'),
    ('bolt.new', 'StackBlitz', 'coding'),
    ('replit.com', 'Replit', 'coding'),
    ('app.base44.com', 'Wix', 'coding'),
    -- Video generation
    ('sora.chatgpt.com', 'OpenAI', 'video'),
    ('sora.com', 'OpenAI', 'video'),
    ('app.arcads.ai', 'Arcads', 'video'),
    ('higgsfield.ai', 'Higgsfield', 'video'),
    ('app.runwayml.com', 'Runway', 'video'),
    ('pika.art', 'Pika', 'video'),
    ('lumalabs.ai', 'Luma AI', 'video'),
    ('kling.ai', 'Kuaishou', 'video'),
    ('hailuoai.video', 'MiniMax', 'video'),
    ('app.heygen.com', 'HeyGen', 'video'),
    ('app.synthesia.io', 'Synthesia', 'video'),
    ('ai.invideo.io', 'InVideo', 'video'),
    -- Image generation & photo
    ('midjourney.com', 'Midjourney', 'image'),
    ('app.leonardo.ai', 'Canva', 'image'),
    ('ideogram.ai', 'Ideogram', 'image'),
    ('krea.ai', 'Krea', 'image'),
    ('recraft.ai', 'Recraft', 'image'),
    ('firefly.adobe.com', 'Adobe', 'image'),
    ('civitai.com', 'Civitai', 'image'),
    ('app.photoroom.com', 'Photoroom', 'image'),
    ('fal.ai', 'fal', 'platform'),
    -- Audio & music
    ('elevenlabs.io', 'ElevenLabs', 'audio'),
    ('suno.com', 'Suno', 'audio'),
    ('udio.com', 'Udio', 'audio'),
    -- Writing & productivity
    ('app.jasper.ai', 'Jasper', 'writing'),
    ('app.writesonic.com', 'Writesonic', 'writing'),
    ('app.copy.ai', 'Copy.ai', 'writing'),
    ('app.rytr.me', 'Rytr', 'writing'),
    ('gamma.app', 'Gamma', 'writing'),
    -- Platforms & hosted playgrounds
    ('huggingface.co', 'Hugging Face', 'platform'),
    ('groq.com', 'Groq', 'platform'),
    ('api.together.ai', 'Together AI', 'platform'),
    ('replicate.com', 'Replicate', 'platform'),
    ('studio.ai21.com', 'AI21 Labs', 'platform'),
    -- Cribble
    ('cribble.dev', 'Cribble', 'other')
ON CONFLICT (domain) DO UPDATE SET
    vendor = EXCLUDED.vendor,
    category = EXCLUDED.category,
    updated_at = NOW();
