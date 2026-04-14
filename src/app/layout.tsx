import type { Metadata } from 'next';
import { Providers } from './Providers';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'Avalon Online - Social Deduction Game',
  description: 'Play the classic social deduction game Avalon with friends online. Create rooms, assign roles, and discover who serves Arthur or Mordred.',
  keywords: ['Avalon', 'board game', 'social deduction', 'multiplayer', 'online game'],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="bg-avalon-midnight">
      <body className="min-h-screen bg-avalon-midnight text-avalon-text antialiased">
        <Providers>
          <main className="min-h-screen flex flex-col bg-avalon-midnight">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
