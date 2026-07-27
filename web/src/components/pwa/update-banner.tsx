import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { registerServiceWorker, applyServiceWorkerUpdate } from '@/lib/sw-register';
import { useIdle } from '@/components/hearth/use-idle';

/**
 * Thin "reload for update" strip — mounted once at the router root (see
 * app.tsx) so it works on every route, including /login. Deliberately not the
 * shared toast system: that lives inside AppShell, which isn't mounted on the
 * login screen, and this banner needs to survive a SW update at any point.
 *
 * /hearth is the exception: it's an always-on kitchen wall — nobody is there
 * to tap "Reload", and a banner permanently squatting on the display is worse
 * than the thing it's warning about (Finding 1, Phase 2 review). So on
 * /hearth we never render the strip; instead we apply the waiting update
 * ourselves the next time the wall goes idle (`useIdle`, the same idle-dim
 * signal the wall already uses for screen-burn care) — the reload's brief
 * flash then lands at a moment nobody is reading the screen, rather than
 * mid-glance. We chose "wait for idle" over "reload immediately" as the
 * least-intrusive option: an immediate reload could interrupt someone
 * checking the wall the instant a deploy ships.
 */
export default function UpdateBanner() {
  const { t } = useTranslation();
  const [available, setAvailable] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHearth = pathname === '/hearth';
  const idle = useIdle();

  useEffect(() => {
    registerServiceWorker(() => setAvailable(true));
  }, []);

  // Wall-only: silently activate the waiting update once the wall is idle.
  useEffect(() => {
    if (isHearth && available && idle) applyServiceWorkerUpdate();
  }, [isHearth, available, idle]);

  if (!available || isHearth) return null;

  return (
    <div className="flex items-center justify-center gap-3 bg-ink text-parchment text-sm px-4 py-2">
      <span>{t('pwa.updateReady')}</span>
      <button
        onClick={() => applyServiceWorkerUpdate()}
        className="inline-flex items-center gap-1.5 rounded-md bg-ember px-3 py-1 font-medium text-white hover:bg-ember/90"
      >
        <RefreshCw className="h-3.5 w-3.5" /> {t('pwa.reload')}
      </button>
    </div>
  );
}
