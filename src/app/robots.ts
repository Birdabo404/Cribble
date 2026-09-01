// robots.txt — crawl policy for the public surface. Allow rules are
// listed explicitly (and before the disallows) so first-match crawlers
// keep /teams even though the /team dashboard prefix is blocked;
// longest-match crawlers (Googlebot) resolve the same way.

import type { MetadataRoute } from 'next'
import { resolveShareOrigin } from '@/lib/appUrl'

export default function robots(): MetadataRoute.Robots {
  const origin = resolveShareOrigin()

  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/leaderboard',
          '/u/',
          '/teams',
          '/sponsorship',
          '/status',
          '/privacy',
          '/welcome'
        ],
        disallow: [
          '/admin',
          '/api',
          '/dashboard',
          '/settings',
          '/shop',
          '/bag',
          '/team',
          '/join',
          '/login',
          '/restricted',
          '/maintenance'
        ]
      }
    ],
    sitemap: `${origin}/sitemap.xml`
  }
}
