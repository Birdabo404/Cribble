CREATE TABLE public.users (
  id SERIAL PRIMARY KEY,
  twitter_id TEXT UNIQUE,
  twitter_username TEXT,
  twitter_name TEXT,
  twitter_profile_image TEXT,
  twitter_access_token TEXT,
  subscription_tier TEXT DEFAULT 'FREE',
  user_type TEXT,
  status TEXT DEFAULT 'active',
  active_device_uuid UUID,
  last_extension_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_login TIMESTAMPTZ
);

CREATE TABLE public.events_raw (
  id BIGSERIAL PRIMARY KEY,
  twitter_user_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.user_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES public.users(id),
  session_token TEXT,
  expires_at TIMESTAMPTZ
);

CREATE TABLE public.admin_activity_log (
  id BIGSERIAL PRIMARY KEY,
  admin_user_id INTEGER REFERENCES public.users(id),
  target_user_id INTEGER REFERENCES public.users(id),
  action VARCHAR(100) NOT NULL,
  old_values JSONB,
  new_values JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.daily_metrics (
  id BIGSERIAL PRIMARY KEY
);
ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.extension_user_mappings (
  id BIGSERIAL PRIMARY KEY,
  twitter_user_id INTEGER REFERENCES public.users(id)
);
ALTER TABLE public.extension_user_mappings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.founding_members (
  id BIGSERIAL PRIMARY KEY,
  email TEXT
);
ALTER TABLE public.founding_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID
);
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
