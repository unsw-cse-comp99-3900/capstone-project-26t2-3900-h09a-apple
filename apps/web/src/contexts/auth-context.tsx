'use client';

import type { AuthUser, UserRole } from '@h09a/types';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { roleLandingPath } from '@/lib/auth/constants';
import { isProtectedPath } from '@/lib/auth/protected-paths';
import { broadcastExtensionLogout } from '@/lib/extension-logout';

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  refreshSession: () => Promise<AuthUser | null>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<AuthUser | null> {
  const response = await fetch('/api/auth/me', { cache: 'no-store' });
  if (!response.ok) {
    return null;
  }
  return response.json();
}

async function silentRefresh(): Promise<boolean> {
  const response = await fetch('/api/auth/refresh', { method: 'POST' });
  return response.ok;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    let nextUser = await fetchMe();
    if (!nextUser) {
      const refreshed = await silentRefresh();
      if (refreshed) {
        nextUser = await fetchMe();
      }
    }
    setUser(nextUser);
    return nextUser;
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
        let nextUser = await fetchMe();
        if (!nextUser) {
          const refreshed = await silentRefresh();
          if (refreshed) {
            nextUser = await fetchMe();
          }
        }
        if (!cancelled) {
          setUser(nextUser);
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

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    broadcastExtensionLogout();
    setUser(null);
    window.location.href = '/login';
  }, []);

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
