/** @type {import('next').NextConfig} */
const nextConfig = {
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
