import { Outlet, useRouter } from '@tanstack/react-router';
import Sidebar from './sidebar';
import TopBar from './top-bar';
import { ToastProvider } from '@/components/ui/toast';

const PAGE_TITLES: Record<string, string> = {
  '/': 'This week at home',
  '/calendar': 'Calendar',
  '/meals': 'Meals',
  '/feoh': 'Feoh',
  '/household': 'Household',
};

export default function AppShell() {
  const router = useRouter();
  const title = PAGE_TITLES[router.state.location.pathname] ?? 'Heorth';
  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-parchment">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <TopBar title={title} />
          <main className="flex-1 p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
