import { Outlet, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import Sidebar from './sidebar';
import TopBar from './top-bar';
import MobileNav from './mobile-nav';
import { ToastProvider } from '@/components/ui/toast';
import type { NavLabelKey } from './sidebar';

type PageTitleKey = NavLabelKey | 'nav.homeTitle';

const PAGE_TITLES: Record<string, PageTitleKey> = {
  '/': 'nav.homeTitle',
  '/calendar': 'nav.calendar',
  '/meals': 'nav.meals',
  '/feoh': 'nav.feoh',
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
  const router = useRouter();
  const titleKey = titleKeyFor(router.state.location.pathname);
  const title = titleKey ? t(titleKey) : 'Heorth';
  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-parchment">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <TopBar title={title} />
          <main className="flex-1 p-3 sm:p-6 pb-20 md:pb-6 overflow-auto">
            <Outlet />
          </main>
        </div>
        <MobileNav />
      </div>
    </ToastProvider>
  );
}
