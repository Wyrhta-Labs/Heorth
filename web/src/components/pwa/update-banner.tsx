import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { registerServiceWorker, applyServiceWorkerUpdate } from '@/lib/sw-register';

/**
 * Thin "reload for update" strip — mounted once at the app root (outside the
 * router) so it works on every route, including /login. Deliberately not the
 * shared toast system: that lives inside AppShell, which isn't mounted on the
 * login screen, and this banner needs to survive a SW update at any point.
 */
export default function UpdateBanner() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    registerServiceWorker(() => setAvailable(true));
  }, []);

  if (!available) return null;

  return (
    <div className="flex items-center justify-center gap-3 bg-ink text-parchment text-sm px-4 py-2">
      <span>A new version of Heorth is ready.</span>
      <button
        onClick={() => applyServiceWorkerUpdate()}
        className="inline-flex items-center gap-1.5 rounded-md bg-ember px-3 py-1 font-medium text-white hover:bg-ember/90"
      >
        <RefreshCw className="h-3.5 w-3.5" /> Reload
      </button>
    </div>
  );
}
