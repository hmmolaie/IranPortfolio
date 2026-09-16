const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // مرورگر از origin صفحه /api می‌زند؛ host:3001 نباید در باندل باشد
  env: {
    NEXT_PUBLIC_API_URL: '',
  },
};

module.exports = nextConfig;
