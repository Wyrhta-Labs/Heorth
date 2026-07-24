import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter, createRoute, createRootRoute, RouterProvider, Outlet, redirect,
} from '@tanstack/react-router';
import { AuthProvider } from '@/hooks/use-auth';
import { TOKEN_KEY } from '@/api/client';
import AppShell from '@/components/layout/app-shell';
import UpdateBanner from '@/components/pwa/update-banner';
import LoginPage from '@/pages/login';
import DashboardPage from '@/pages/dashboard';
import CalendarPage from '@/pages/calendar';
import TasksPage from '@/pages/tasks';
import MealsPage from '@/pages/meals';
import FeohPage from '@/pages/feoh';
import HouseholdPage from '@/pages/household';
import LibraryPage from '@/pages/library';
import TodayPage from '@/pages/today';
import ShoppingPage from '@/pages/shopping';
import CapturePage from '@/pages/capture';
import HearthPage from '@/pages/hearth';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

// UpdateBanner is mounted here (inside the router tree, at the root) rather
// than beside <RouterProvider> so it can read the current route (it needs
// router context to suppress itself on /hearth — see the component for why).
const rootRoute = createRootRoute({
  component: () => (
    <>
      <UpdateBanner />
      <Outlet />
    </>
  ),
});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search['redirect'] === 'string' ? (search['redirect'] as string) : undefined,
  }),
  component: LoginPage,
});
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  beforeLoad: ({ location }) => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: AppShell,
});

// The Hearth wall is auth-gated like the app, but renders full-bleed OUTSIDE the
// AppShell chrome (no sidebar / mobile nav / top bar) — its own kiosk surface.
const hearthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/hearth',
  beforeLoad: ({ location }) => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: HearthPage,
});

const dashboardRoute = createRoute({ getParentRoute: () => authRoute, path: '/', component: DashboardPage });
const calendarRoute = createRoute({ getParentRoute: () => authRoute, path: '/calendar', component: CalendarPage });
const tasksRoute = createRoute({ getParentRoute: () => authRoute, path: '/tasks', component: TasksPage });
const mealsRoute = createRoute({ getParentRoute: () => authRoute, path: '/meals', component: MealsPage });
const feohRoute = createRoute({ getParentRoute: () => authRoute, path: '/feoh', component: FeohPage });
const householdRoute = createRoute({ getParentRoute: () => authRoute, path: '/household', component: HouseholdPage });
const libraryRoute = createRoute({ getParentRoute: () => authRoute, path: '/library', component: LibraryPage });
const todayRoute = createRoute({ getParentRoute: () => authRoute, path: '/today', component: TodayPage });
const shoppingRoute = createRoute({ getParentRoute: () => authRoute, path: '/shopping', component: ShoppingPage });
const captureRoute = createRoute({ getParentRoute: () => authRoute, path: '/capture', component: CapturePage });

const routeTree = rootRoute.addChildren([
  loginRoute,
  hearthRoute,
  authRoute.addChildren([
    dashboardRoute, calendarRoute, tasksRoute, mealsRoute, feohRoute, householdRoute, libraryRoute,
    todayRoute, shoppingRoute, captureRoute,
  ]),
]);

const router = createRouter({ routeTree });
declare module '@tanstack/react-router' {
  interface Register { router: typeof router; }
}

export default function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AuthProvider>
  );
}
