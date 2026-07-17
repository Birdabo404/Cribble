// Owner-level breakglass allowlist. ADMIN_USERNAMES (comma-separated
// GitHub handles) always resolves to the 'owner' staff role via
// resolveStaffRole in staffAuth.ts, so the operator can never be locked
// out of the panel by a bad DB write. The GitHub OAuth callback also
// re-asserts is_admin for allowlisted handles on every login.
//
// Authorization for staff routes lives in staffAuth.ts (getStaffUser);
// this module is intentionally just the allowlist primitives.

export function adminUsernameAllowlist(): string[] {
  return (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
}

export function isAllowlistedAdmin(username: string | null | undefined): boolean {
  if (!username) return false
  return adminUsernameAllowlist().includes(username.toLowerCase())
}
