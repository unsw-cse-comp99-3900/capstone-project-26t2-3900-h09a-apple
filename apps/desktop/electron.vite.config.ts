import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    main: {
      define: {
        __API_BASE_URL__: JSON.stringify(env.WORKTRACE_API_BASE_URL),
        __WEB_APP_URL__: JSON.stringify(env.WORKTRACE_WEB_URL),
      },
    },
    preload: {
      build: {
        rollupOptions: {
          input: {
            index: resolve('src/preload/index.ts'),
            walkthrough: resolve('src/preload/walkthrough.ts'),
          },
        },
      },
    },
    renderer: {
      build: {
        rollupOptions: {
          input: {
            index: resolve('src/renderer/index.html'),
            walkthrough: resolve('src/renderer/walkthrough.html'),
          },
        },
      },
    },
  };
});
