const buildVersion = process.env.NEXT_PUBLIC_BUILD_VERSION
  || process.env.VERCEL_GIT_COMMIT_SHA
  || process.env.GITHUB_SHA
  || `local-${Date.now().toString(36)}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_VERSION: buildVersion,
  },
  images: {
    formats: ['image/webp'],
    qualities: [72],
    imageSizes: [64, 96, 128, 256, 384],
    deviceSizes: [640, 750, 828, 1080, 1200, 1600],
  },
  outputFileTracingExcludes: {
    '/*': ['next.config.js'],
  },
};

module.exports = nextConfig;
