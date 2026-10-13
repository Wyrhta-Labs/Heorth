import { useEffect, useRef } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import Sidebar from './sidebar';
import TopBar from './top-bar';
import MobileNav from './mobile-nav';
import { ToastProvider } from '@/components/ui/toast';
import { SCROLL_ROOT_ATTR } from '@/components/ui/dialog';
import { useNavCounts } from '@/hooks/use-nav-counts';
import type { NavLabelKey } from './sidebar';

type PageTitleKey = NavLabelKey | 'nav.homeTitle';

const PAGE_TITLES: Record<string, PageTitleKey> = {
  '/': 'nav.homeTitle',
  '/calendar': 'nav.calendar',
  '/meals': 'nav.meals',
  '/feoh': 'nav.feoh',
  '/ethel': 'nav.ethel',
  '/weorc': 'nav.weorc',
  '/library': 'nav.library',
  '/household': 'nav.household',
  '/today': 'nav.today',
  '/shopping': 'nav.shoppingList',
  '/capture': 'nav.quickCapture',
  '/profile': 'nav.profile',
};

/**
 * Resolve the header title for a path. Exact match first, then longest matching
 * prefix — /household is a layout now, so /household/members must still resolve
 * to "Household" instead of falling through to the app name.
 */
export function titleKeyFor(pathname: string): PageTitleKey | undefined {
  const exact = PAGE_TITLES[pathname];
  if (exact) return exact;
  return Object.entries(PAGE_TITLES)
    .filter(([path]) => path !== '/' && pathname.startsWith(`${path}/`))
    .sort((a, b) => b[0].length - a[0].length)[0]?.[1];
}

export default function AppShell() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const titleKey = titleKeyFor(pathname);
  const title = titleKey ? t(titleKey) : 'Heorth';
  const mainRef = useRef<HTMLElement>(null);
  const counts = useNavCounts();

  // <main> is the page's scroller (the shell is viewport-high), so the
  // router's window scroll restoration does not reach it: start each page at the top.
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [pathname]);

  return (
    <ToastProvider>
      <div className="flex h-dvh overflow-hidden bg-ground">
        <Sidebar counts={counts} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TopBar title={title} />
          <main
            ref={mainRef}
            {...{ [SCROLL_ROOT_ATTR]: '' }}
            className="min-h-0 flex-1 overflow-y-auto p-3 pb-20 sm:p-5 md:pb-6"
          >
            <Outlet />
          </main>
        </div>
        <MobileNav counts={counts} />
      </div>
    </ToastProvider>
  );
}
