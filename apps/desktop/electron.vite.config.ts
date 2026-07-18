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
    preload: {},
    renderer: {},
  };
});