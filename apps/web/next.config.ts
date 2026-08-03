import type { NextConfig } from 'next';

/**
 * Standalone output is required for the production image, but Next copies the
 * traced graph with symlinks. Windows without Developer Mode raises EPERM and
 * fails the local / pre-push build even after a successful compile. Keep
 * standalone on non-Windows (including GitHub Actions). Override with
 * NEXT_OUTPUT_STANDALONE=0|1 when needed.
 */
const standaloneEnv = process.env.NEXT_OUTPUT_STANDALONE;
const useStandalone =
  standaloneEnv === '1' ? true : standaloneEnv === '0' ? false : process.platform !== 'win32';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@h09a/types'],
  ...(useStandalone ? { output: 'standalone' as const } : {}),
};

export default config;
