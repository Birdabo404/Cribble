/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dev artifacts live apart from production builds: `next dev` writes
  // .next-dev while `next build` / `next start` use .next. A build (or a
  // second tool wiping .next) can no longer corrupt a running dev server
  // mid-flight — that shared directory caused repeated ENOENT
  // routes-manifest.json 500s. Vercel is unaffected (NODE_ENV=production).
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
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
