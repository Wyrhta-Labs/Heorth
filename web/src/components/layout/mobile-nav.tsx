import { useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Sun, ShoppingCart, PlusCircle, Menu, LogOut } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-auth';
import { navItems } from './sidebar';
import { cn } from '@/lib/utils';

const TABS = [
  { to: '/today', labelKey: 'nav.today', icon: Sun },
  { to: '/shopping', labelKey: 'nav.shoppingTab', icon: ShoppingCart },
  { to: '/capture', labelKey: 'nav.captureTab', icon: PlusCircle },
] as const;

/**
 * Thumb-reach bottom navigation for phone widths (hidden at `md` and up,
 * where the sidebar takes over). Surfaces the three PWA priority screens
 * directly; "More" opens the full nav list for everything else.
 */
export default function MobileNav() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { logout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t border-tan bg-card">
        {TABS.map(({ to, labelKey, icon: Icon }) => {
          const active = pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                'flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium',
                active ? 'text-ember' : 'text-ash',
              )}
            >
              <Icon className="h-5 w-5" />
              {t(labelKey)}
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium text-ash"
        >
          <Menu className="h-5 w-5" />
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
            {navItems.map(({ to, labelKey, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink hover:bg-linen"
              >
                <Icon className="h-4 w-4 shrink-0 text-ash" />
                {t(labelKey)}
              </Link>
            ))}
            <button
              onClick={() => logout()}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink hover:bg-linen"
            >
              <LogOut className="h-4 w-4 shrink-0 text-ash" />
              {t('nav.signOut')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
