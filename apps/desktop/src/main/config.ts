declare const __API_BASE_URL__: string;
declare const __WEB_APP_URL__: string;

export const API_BASE_URL = __API_BASE_URL__;
export const WEB_APP_URL = __WEB_APP_URL__;

if (!API_BASE_URL) {
  throw new Error('WORKTRACE_API_BASE_URL is not configured');
}

if (!WEB_APP_URL) {
  throw new Error('WORKTRACE_WEB_URL is not configured');
}