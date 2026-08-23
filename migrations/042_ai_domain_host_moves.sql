-- ============================================================
-- Migration 042: Tracked-domain host moves (Kimi, Claude Console,
-- Gemini Notebook, Copilot, Luma)
-- ============================================================
-- DB mirror of src/lib/toolTaxonomy.ts for hosts that products moved
-- onto after migration 032. Safe to run multiple times.
-- ============================================================

INSERT INTO tool_taxonomy (domain, vendor, category) VALUES
    ('kimi.ai', 'Moonshot AI', 'chat'),
    ('platform.claude.com', 'Anthropic', 'platform'),
    ('copilot.com', 'Microsoft', 'chat'),
    ('copilot.cloud.microsoft', 'Microsoft', 'chat'),
    ('notebooklm.google', 'Google', 'writing'),
    ('notebook.google.com', 'Google', 'writing'),
    ('notebook.google', 'Google', 'writing'),
    ('app.lumalabs.ai', 'Luma AI', 'video')
ON CONFLICT (domain) DO UPDATE SET
    vendor = EXCLUDED.vendor,
    category = EXCLUDED.category,
    updated_at = NOW();
