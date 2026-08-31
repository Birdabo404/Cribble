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
  outputFileTracingIncludes: {
    '/join/**': ['./src/app/join/**/*.ttf', './src/app/join/**/*.png'],
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
