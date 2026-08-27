-- Extend the two inherited source allowlists for local-runtime observations.
-- Keep both constraints named and closed so unknown collectors still fail closed.
begin;

alter table public.agent_usage_events
  drop constraint if exists agent_usage_events_source_supported;
alter table public.agent_usage_events
  add constraint agent_usage_events_source_supported
  check (source = any (array['ccusage'::text, 'cribble-agent'::text])) not valid;
alter table public.agent_usage_events
  validate constraint agent_usage_events_source_supported;

alter table public.agent_usage_daily
  drop constraint if exists agent_usage_daily_source_supported;
alter table public.agent_usage_daily
  add constraint agent_usage_daily_source_supported
  check (source = any (array['ccusage'::text, 'cribble-agent'::text])) not valid;
alter table public.agent_usage_daily
  validate constraint agent_usage_daily_source_supported;

commit;
