import type { Metadata } from 'next';

import { AuthProvider } from '@/contexts/auth-context';
import { ExtensionHandoffSync } from '@/components/extension-handoff-sync';

import './globals.css';

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'H09A Apple';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'UNSW COMP3900 capstone project',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <ExtensionHandoffSync />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
