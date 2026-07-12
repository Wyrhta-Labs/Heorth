import { Link, useRouter } from '@tanstack/react-router';
import { LayoutDashboard, CalendarDays, UtensilsCrossed, Wallet, Home, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', label: 'This week', icon: LayoutDashboard, exact: true },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/meals', label: 'Meals', icon: UtensilsCrossed },
  { to: '/feoh', label: 'Feoh', icon: Wallet },
  { to: '/household', label: 'Household', icon: Home },
];

export default function Sidebar() {
  const router = useRouter();
  const pathname = router.state.location.pathname;
  return (
    <aside className="flex flex-col w-60 min-h-screen bg-ink text-parchment">
      <div className="flex items-center gap-2 px-6 py-5 border-b border-white/10">
        <Flame className="h-6 w-6 text-ember-soft" />
        <span className="font-serif text-xl">Heorth</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ to, label, icon: Icon, exact }) => {
          const active = exact ? pathname === to : pathname.startsWith(to);
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
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
