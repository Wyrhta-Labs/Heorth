import { Link, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, CalendarDays, ListChecks, UtensilsCrossed, Wallet, Home, Flame, Library,
  Sun, ShoppingCart, PlusCircle, Tv,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFinanceEnabled } from '@/hooks/use-finance-enabled';

/** Literal catalog-key union so `t(item.labelKey)` type-checks against the
 * real translation resources instead of accepting an arbitrary string. */
export type NavLabelKey =
  | 'nav.thisWeek'
  | 'nav.today'
  | 'nav.calendar'
  | 'nav.tasks'
  | 'nav.shoppingList'
  | 'nav.quickCapture'
  | 'nav.meals'
  | 'nav.feoh'
  | 'nav.library'
  | 'nav.household'
  | 'nav.hearth'
  | 'nav.profile';

interface NavItem {
  to: string;
  labelKey: NavLabelKey;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  /**
   * Path range that counts as "on this item", when `to` is deeper than the
   * section it represents. /household is a layout whose index only redirects, so
   * the item links straight to a tab but must stay lit on all of them.
   */
  activePrefix?: string;
}

/** Exported for testing: is `pathname` within this item's active range? */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.to;
  const base = item.activePrefix ?? item.to;
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Shared nav-visibility rule for both the sidebar and the mobile "More" sheet:
 * the only item currently gated is Feoh, on the runtime finance flag.
 */
export function filterNavItems(items: NavItem[], financeEnabled: boolean): NavItem[] {
  return items.filter((item) => item.labelKey !== 'nav.feoh' || financeEnabled);
}

export const navItems: NavItem[] = [
  { to: '/', labelKey: 'nav.thisWeek', icon: LayoutDashboard, exact: true },
  { to: '/today', labelKey: 'nav.today', icon: Sun },
  { to: '/calendar', labelKey: 'nav.calendar', icon: CalendarDays },
  { to: '/tasks', labelKey: 'nav.tasks', icon: ListChecks },
  { to: '/shopping', labelKey: 'nav.shoppingList', icon: ShoppingCart },
  { to: '/capture', labelKey: 'nav.quickCapture', icon: PlusCircle },
  { to: '/meals', labelKey: 'nav.meals', icon: UtensilsCrossed },
  { to: '/feoh', labelKey: 'nav.feoh', icon: Wallet },
  { to: '/library', labelKey: 'nav.library', icon: Library },
  { to: '/household/members', labelKey: 'nav.household', icon: Home, activePrefix: '/household' },
  { to: '/hearth', labelKey: 'nav.hearth', icon: Tv },
];

export default function Sidebar() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const financeEnabled = useFinanceEnabled();
  const visibleItems = filterNavItems(navItems, financeEnabled);
  return (
    <aside className="hidden md:flex flex-col w-60 min-h-screen bg-ink text-parchment">
      <div className="flex items-center gap-2 px-6 py-5 border-b border-white/10">
        <Flame className="h-6 w-6 text-ember-soft" />
        <span className="font-serif text-xl">Heorth</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {visibleItems.map((item) => {
          const { to, labelKey, icon: Icon } = item;
          const active = isNavItemActive(item, pathname);
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                active ? 'bg-ember text-white' : 'text-parchment/70 hover:bg-white/10 hover:text-white',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t(labelKey)}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
