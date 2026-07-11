'use client';

import { useEffect } from 'react';

import { useCurrentUser } from '@/contexts/auth-context';
import { broadcastExtensionHandoff } from '@/lib/extension-handoff';

export function ExtensionHandoffSync() {
  const { user, loading } = useCurrentUser();

  useEffect(() => {
    if (loading || !user) {
      return;
    }

    void broadcastExtensionHandoff();

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void broadcastExtensionHandoff();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loading, user]);

  return null;
}
