'use client';

import type { AuthUser, UserRole } from '@h09a/types';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { roleLandingPath } from '@/lib/auth/constants';
import { isProtectedPath } from '@/lib/auth/protected-paths';
import { silentRefreshAccessToken } from '@/lib/auth/session-refresh';
import { broadcastExtensionLogout } from '@/lib/extension-logout';

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  refreshSession: () => Promise<AuthUser | null>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const PROACTIVE_REFRESH_MARGIN_MS = 60_000;
const PROACTIVE_REFRESH_MIN_DELAY_MS = 5_000;

type MePayload = AuthUser & { expires_in?: number | null };

async function fetchMe(): Promise<{ user: AuthUser | null; expiresIn: number | null }> {
  const response = await fetch('/api/auth/me', { cache: 'no-store' });
  if (!response.ok) {
    return { user: null, expiresIn: null };
  }
  const body = (await response.json()) as MePayload;
  const { expires_in: expiresIn, ...user } = body;
  return {
    user,
    expiresIn: typeof expiresIn === 'number' ? expiresIn : null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessExpiresIn, setAccessExpiresIn] = useState<number | null>(null);
  const proactiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearProactiveTimer = useCallback(() => {
    if (proactiveTimer.current !== null) {
      clearTimeout(proactiveTimer.current);
      proactiveTimer.current = null;
    }
  }, []);

  const refreshSession = useCallback(async () => {
    let next = await fetchMe();
    if (!next.user) {
      const refreshed = await silentRefreshAccessToken();
      if (refreshed.ok) {
        next = await fetchMe();
        if (refreshed.expires_in !== null) {
          setAccessExpiresIn(refreshed.expires_in);
        }
      }
    } else if (next.expiresIn !== null) {
      setAccessExpiresIn(next.expiresIn);
    }
    setUser(next.user);
    return next.user;
  }, []);

  useEffect(() => {
    if (loading || user) {
      return;
    }

    const pathname = window.location.pathname;
    if (isProtectedPath(pathname)) {
      window.location.replace('/login');
    }
  }, [loading, user]);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        let next = await fetchMe();
        if (!next.user) {
          const refreshed = await silentRefreshAccessToken();
          if (refreshed.ok) {
            next = await fetchMe();
            if (!cancelled && refreshed.expires_in !== null) {
              setAccessExpiresIn(refreshed.expires_in);
            }
          }
        } else if (!cancelled && next.expiresIn !== null) {
          setAccessExpiresIn(next.expiresIn);
        }
        if (!cancelled) {
          setUser(next.user);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void restore();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    clearProactiveTimer();

    if (!user || accessExpiresIn === null) {
      return;
    }

    const delayMs = Math.max(
      accessExpiresIn * 1000 - PROACTIVE_REFRESH_MARGIN_MS,
      PROACTIVE_REFRESH_MIN_DELAY_MS,
    );

    proactiveTimer.current = setTimeout(() => {
      void (async () => {
        const refreshed = await silentRefreshAccessToken();
        if (refreshed.ok && refreshed.expires_in !== null) {
          setAccessExpiresIn(refreshed.expires_in);
        } else if (!refreshed.ok) {
          setUser(null);
          setAccessExpiresIn(null);
        }
      })();
    }, delayMs);

    return clearProactiveTimer;
  }, [user, accessExpiresIn, clearProactiveTimer]);

  const logout = useCallback(async () => {
    clearProactiveTimer();
    await fetch('/api/auth/logout', { method: 'POST' });
    broadcastExtensionLogout();
    setUser(null);
    setAccessExpiresIn(null);
    window.location.href = '/login';
  }, [clearProactiveTimer]);

  const value = useMemo(
    () => ({
      user,
      loading,
      refreshSession,
      logout,
    }),
    [user, loading, refreshSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useCurrentUser(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useCurrentUser must be used within AuthProvider');
  }
  return context;
}

export function redirectPathForRole(role: UserRole): string {
  return roleLandingPath(role);
}
