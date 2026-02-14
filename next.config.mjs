/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Next.js 14 app directory features
    serverComponentsExternalPackages: [],
  },
  images: {
    domains: ['avatars.githubusercontent.com'],
  },
}

export default nextConfig