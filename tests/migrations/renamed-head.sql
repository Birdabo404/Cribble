CREATE TABLE public.users (
  id SERIAL PRIMARY KEY,
  auth_provider_id TEXT,
  username TEXT,
  display_name TEXT,
  profile_image TEXT,
  access_token TEXT
);
CREATE TABLE public.events_raw (
  id BIGSERIAL PRIMARY KEY,
  legacy_user_id INTEGER
);
INSERT INTO public.users
  (auth_provider_id, username, display_name, profile_image, access_token)
VALUES ('provider-1', 'handle', 'Display', 'image', 'token');
INSERT INTO public.events_raw (legacy_user_id) VALUES (1);
