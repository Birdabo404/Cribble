/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dev artifacts live apart from production builds: `next dev` writes
  // .next-dev while `next build` / `next start` use .next. A build (or a
  // second tool wiping .next) can no longer corrupt a running dev server
  // mid-flight — that shared directory caused repeated ENOENT
  // routes-manifest.json 500s. Vercel is unaffected (NODE_ENV=production).
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  // The join OG card reads its fonts and brand mark off the filesystem at
  // request time; Vercel's tracer misses them (they're never statically
  // imported), so without this the lambda renders every invite unfurl in
  // fallback fonts with no mark. Glob key covers the page and the
  // colocated opengraph-image route.
  //
  // The /u/[username] OG card reads the SAME files from the join route
  // directory (no point duplicating ~340KB of binaries), so its route key
  // must pull them into that lambda too. Route groups are stripped before
  // key matching — '/u/**' matches /(app)/u/[username]/opengraph-image.
  //
  // The root OG card (src/app/opengraph-image.tsx) colocates its serif
  // faces at src/app/*.ttf and borrows the join route's mono + mark; the
  // live /status card (src/app/status/opengraph-image.tsx) reads the
  // same three assets.
  outputFileTracingIncludes: {
    '/join/**': ['./src/app/join/**/*.ttf', './src/app/join/**/*.png'],
    '/u/**': ['./src/app/join/**/*.ttf', './src/app/join/**/*.png'],
    '/opengraph-image': [
      './src/app/*.ttf',
      './src/app/join/**/*.ttf',
      './src/app/join/**/*.png',
    ],
    '/status/**': [
      './src/app/*.ttf',
      './src/app/join/**/*.ttf',
      './src/app/join/**/*.png',
    ],
  },
  experimental: {
    // This app exercises many routes during local visual verification.
    // Let Webpack release compilation data more aggressively so the dev
    // server does not cross Next's memory threshold and restart mid-navigation.
    webpackMemoryOptimizations: true,
  },
  // The Billboard product renamed to Sponsorship: old emails, bookmarks
  // and vacant-rail deep links (?slot= rides along automatically) keep
  // landing. API routes under /api/billboard/* are unaffected.
  async redirects() {
    return [
      { source: '/billboard', destination: '/sponsorship', permanent: true },
      { source: '/admin/billboard', destination: '/admin/sponsorship', permanent: true },
    ]
  },
  // Crawlers (X especially) often refuse image URLs with no extension.
  // File-convention OG routes live at /…/opengraph-image; these aliases
  // keep the generated card and give the URL a .png suffix.
  async rewrites() {
    return [
      { source: '/opengraph-image.png', destination: '/opengraph-image' },
      { source: '/status/opengraph-image.png', destination: '/status/opengraph-image' },
      { source: '/join/:code/opengraph-image.png', destination: '/join/:code/opengraph-image' },
      { source: '/u/:username/opengraph-image.png', destination: '/u/:username/opengraph-image' },
    ]
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
    ],
  },
}

export default nextConfig
