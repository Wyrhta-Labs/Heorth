import { Link, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, CalendarDays, ListChecks, UtensilsCrossed, Wallet, Home, Flame, Library,
  Sun, ShoppingCart, PlusCircle, Tv, Package, ClipboardList, BookUser, ExternalLink, LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFeatures } from '@/hooks/use-features';
import { useWhoami } from '@/hooks/use-household';
import { useAuth } from '@/hooks/use-auth';
import { MemberAvatar } from '@/components/ui/member-avatar';

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
  | 'nav.profile'
  | 'nav.ethel'
  | 'nav.weorc'
  | 'nav.kithledger';

export type NavGroup = 'day' | 'household' | 'system';
export type NavCountKey = 'tasks' | 'shopping' | 'weorc' | 'feoh';
export type NavCounts = Partial<Record<NavCountKey, number | undefined>>;

export interface NavItem {
  to: string;
  labelKey: NavLabelKey;
  icon: typeof LayoutDashboard;
  group: NavGroup;
  /** Which nav count badge this item shows, if any (hooks/use-nav-counts.ts). */
  count?: NavCountKey;
  exact?: boolean;
  /**
   * Path range that counts as "on this item", when `to` is deeper than the
   * section it represents. /household is a layout whose index only redirects, so
   * the item links straight to a tab but must stay lit on all of them.
   */
  activePrefix?: string;
  external?: boolean;
}

/** Exported for testing: is `pathname` within this item's active range? */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.to;
  const base = item.activePrefix ?? item.to;
  return pathname === base || pathname.startsWith(`${base}/`);
}

export const navItems: NavItem[] = [
  { to: '/', labelKey: 'nav.thisWeek', icon: LayoutDashboard, group: 'day', exact: true },
  { to: '/today', labelKey: 'nav.today', icon: Sun, group: 'day' },
  { to: '/calendar', labelKey: 'nav.calendar', icon: CalendarDays, group: 'day' },
  { to: '/tasks', labelKey: 'nav.tasks', icon: ListChecks, group: 'day', count: 'tasks' },
  { to: '/shopping', labelKey: 'nav.shoppingList', icon: ShoppingCart, group: 'day', count: 'shopping' },
  { to: '/capture', labelKey: 'nav.quickCapture', icon: PlusCircle, group: 'day' },
  { to: '/meals', labelKey: 'nav.meals', icon: UtensilsCrossed, group: 'day' },
  { to: '/feoh', labelKey: 'nav.feoh', icon: Wallet, group: 'household', count: 'feoh' },
  { to: '/ethel', labelKey: 'nav.ethel', icon: Package, group: 'household' },
  { to: '/weorc', labelKey: 'nav.weorc', icon: ClipboardList, group: 'household', count: 'weorc' },
  { to: '/library', labelKey: 'nav.library', icon: Library, group: 'household' },
  { to: '/household/members', labelKey: 'nav.household', icon: Home, group: 'system', activePrefix: '/household' },
  { to: '/hearth', labelKey: 'nav.hearth', icon: Tv, group: 'system' },
];

export function navItemsForFeatures(kithledgerUrl: string | null | undefined): NavItem[] {
  if (!kithledgerUrl) return navItems;
  return [...navItems, { to: kithledgerUrl, labelKey: 'nav.kithledger', icon: BookUser, group: 'system', external: true }];
}

export const GROUP_KEYS = { day: 'nav.group.day', household: 'nav.group.household', system: 'nav.group.system' } as const;
const ROLE_KEYS = { admin: 'options.role.admin', adult: 'options.role.adult', child: 'options.role.child' } as const;
const GROUP_ORDER: NavGroup[] = ['day', 'household', 'system'];

export function navGroups(items: NavItem[]): Array<{ group: NavGroup; items: NavItem[] }> {
  return GROUP_ORDER
    .map((group) => ({ group, items: items.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0);
}

/** A count pill; nothing for zero or an unknown count. */
export function NavBadge({ count, className }: { count: number | undefined; className?: string }) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <span
      data-nav-badge
      aria-label={t('nav.countLabel', { count })}
      className={cn('min-w-5 rounded-full bg-primary px-[7px] text-center text-[11px] font-bold tabular-nums text-on-primary', className)}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export default function Sidebar({ counts = {} }: { counts?: NavCounts }) {
  const { t } = useTranslation();
  // useRouterState (not useRouter().state) — only the former subscribes to
  // router state, and the shell above us does not re-render on navigation.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const features = useFeatures();
  const me = useWhoami().data?.data;
  const { logout } = useAuth();
  const groups = navGroups(navItemsForFeatures(features.data?.data.kithledgerUrl));

  return (
    <aside className={cn(
      'hidden md:flex h-dvh w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto bg-nav px-2.5 py-3.5 text-nav-fg',
      'max-[1100px]:w-16',
    )}>
      <div className={cn('flex items-center gap-2.5 px-2 pb-4 pt-1', 'max-[1100px]:justify-center max-[1100px]:px-0')}>
        <span className="grid size-[30px] shrink-0 place-items-center rounded-card bg-primary text-on-primary">
          <Flame className="size-[17px]" aria-hidden="true" />
        </span>
        <span className={cn('text-base font-extrabold tracking-[-0.2px]', 'max-[1100px]:hidden')}>Heorth</span>
      </div>
      <nav className="flex flex-col gap-0.5">
        {groups.map(({ group, items }) => (
          <div key={group} data-nav-group={group} className="flex flex-col gap-0.5">
            <div className={cn('px-2.5 pb-1 pt-3.5 text-[10.5px] font-bold uppercase tracking-[0.7px] text-nav-muted', 'max-[1100px]:hidden')}>
              {t(GROUP_KEYS[group])}
            </div>
            {items.map((item) => {
              const { to, labelKey, icon: Icon } = item;
              const active = !item.external && isNavItemActive(item, pathname);
              const label = t(labelKey);
              const count = item.count ? counts[item.count] : undefined;
              const className = cn(
                'relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left font-medium transition-colors hover:bg-nav-hover',
                active && 'bg-nav-active font-[650]',
                'max-[1100px]:justify-center max-[1100px]:px-0 max-[1100px]:py-2.5',
              );
              const body = (
                <>
                  <Icon className="size-[17px] shrink-0 opacity-85" aria-hidden="true" />
                  <span className={cn('flex-1', 'max-[1100px]:hidden')}>{label}</span>
                  {item.external && <ExternalLink className={cn('size-3.5 shrink-0', 'max-[1100px]:hidden')} aria-hidden="true" />}
                  <NavBadge count={count} className={cn('max-[1100px]:absolute max-[1100px]:right-1 max-[1100px]:top-0.5 max-[1100px]:min-w-4 max-[1100px]:px-[5px] max-[1100px]:text-[9.5px]')} />
                </>
              );
              return item.external ? (
                <a key={to} href={to} target="_blank" rel="noreferrer" title={label} className={className}>{body}</a>
              ) : (
                <Link key={to} to={to} title={label} aria-current={active ? 'page' : undefined} className={className}>{body}</Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="min-h-3 flex-1" />
      <div className={cn('flex items-center gap-2.5 border-t border-nav-active px-2 pb-0.5 pt-2.5', 'max-[1100px]:flex-col max-[1100px]:px-0')}>
        <Link to="/profile" className="flex min-w-0 flex-1 items-center gap-2.5" title={me?.displayName}>
          {me && <MemberAvatar name={me.displayName} color={me.avatarColor} size="sm" />}
          <span className={cn('min-w-0 text-[12.5px] leading-tight', 'max-[1100px]:hidden')}>
            <span className="block truncate">{me?.displayName}</span>
            {me && <span className="block text-[11px] text-nav-muted">{t(ROLE_KEYS[me.role])}</span>}
          </span>
        </Link>
        <button type="button" onClick={logout} title={t('nav.signOut')} aria-label={t('nav.signOut')}
          className="grid size-8 shrink-0 place-items-center rounded-md text-nav-muted hover:bg-nav-hover hover:text-nav-fg">
          <LogOut className="size-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
