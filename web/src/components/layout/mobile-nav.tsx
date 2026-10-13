import { useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Sun, ShoppingCart, PlusCircle, Menu, LogOut } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-auth';
import { useFeatures } from '@/hooks/use-features';
import { GROUP_KEYS, NavBadge, navGroups, navItemsForFeatures, type NavCounts } from './sidebar';
import { cn } from '@/lib/utils';

const TABS = [
  { to: '/today', labelKey: 'nav.today', icon: Sun },
  { to: '/shopping', labelKey: 'nav.shoppingTab', icon: ShoppingCart, count: 'shopping' as const },
  { to: '/capture', labelKey: 'nav.captureTab', icon: PlusCircle },
] as const;

/**
 * Thumb-reach bottom navigation for phone widths (hidden at `md` and up,
 * where the sidebar takes over). Surfaces the three PWA priority screens
 * directly; "More" opens the full nav list for everything else.
 */
export default function MobileNav({ counts = {} }: { counts?: NavCounts }) {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { logout } = useAuth();
  const features = useFeatures();
  const navItems = navItemsForFeatures(features.data?.data.kithledgerUrl);
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t border-nav-active bg-nav pb-[env(safe-area-inset-bottom,0px)]">
        {TABS.map((tab) => {
          const { to, labelKey, icon: Icon } = tab;
          const active = pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                'relative flex flex-1 flex-col items-center gap-px py-1.5 text-[10px] font-medium',
                active ? 'text-nav-fg' : 'text-nav-muted',
              )}
            >
              <Icon className="size-5" />
              {t(labelKey)}
              {'count' in tab && (
                <NavBadge
                  count={counts[tab.count]}
                  className="absolute right-[calc(50%-22px)] top-0.5 min-w-4 px-[5px] text-[9.5px]"
                />
              )}
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className="relative flex flex-1 flex-col items-center gap-px py-1.5 text-[10px] font-medium text-nav-muted"
        >
          <Menu className="size-5" />
          {t('nav.more')}
        </button>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="mb-0 self-end rounded-b-none">
          <DialogHeader>
            <DialogTitle>Heorth</DialogTitle>
            <DialogClose onClose={() => setMoreOpen(false)} />
          </DialogHeader>
          <div className="space-y-1">
            {navGroups(navItems).map(({ group, items }) => (
              <div key={group}>
                <div className="px-3 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-[0.7px] text-muted">
                  {t(GROUP_KEYS[group])}
                </div>
                {items.map((item) => {
                  const { to, labelKey, icon: Icon, external } = item;
                  const badge = <NavBadge count={item.count ? counts[item.count] : undefined} className="ml-auto" />;
                  return external ? (
                    <a
                      key={to}
                      href={to}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => setMoreOpen(false)}
                      className="flex items-center gap-3 rounded-md px-3 py-2.5 text-[13.5px] font-medium text-fg hover:bg-surface-2"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted" />
                      {t(labelKey)}
                      {badge}
                    </a>
                  ) : (
                    <Link
                      key={to}
                      to={to}
                      onClick={() => setMoreOpen(false)}
                      className="flex items-center gap-3 rounded-md px-3 py-2.5 text-[13.5px] font-medium text-fg hover:bg-surface-2"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted" />
                      {t(labelKey)}
                      {badge}
                    </Link>
                  );
                })}
              </div>
            ))}
            <button
              onClick={() => logout()}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[13.5px] font-medium text-fg hover:bg-surface-2"
            >
              <LogOut className="h-4 w-4 shrink-0 text-muted" />
              {t('nav.signOut')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
