import '@fontsource-variable/figtree/index.css';
import './globals.css';
import Providers from './providers';

export const metadata = { title: 'Abuse Reporter — Category suggestion', description: 'Workspace klasifikasi dan review manusia untuk kebijakan X.' };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function Layout({ children }) {
  return <html lang="id"><body><Providers>{children}</Providers></body></html>;
}
