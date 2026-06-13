import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'H09A Apple',
  description: 'UNSW COMP3900 capstone project',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
