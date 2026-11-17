import { cookies } from 'next/headers';
import '@fontsource-variable/figtree/index.css';
import './globals.css';
import Providers from './providers';

export const metadata = { title: 'Abuse Reporter — Category suggestion', description: 'Workspace klasifikasi dan review manusia untuk kebijakan X.' };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function Layout({ children }) {
  const saved = (await cookies()).get('theme')?.value;
  const initialMode = ['light', 'dark', 'system'].includes(saved) ? saved : 'system';
  return <html lang="id"><body><Providers initialMode={initialMode}>{children}</Providers></body></html>;
}
