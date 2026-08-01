import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@h09a/types'],
  output: 'standalone',
};

export default config;
