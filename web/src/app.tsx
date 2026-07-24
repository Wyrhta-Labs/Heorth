import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter, createRoute, createRootRoute, RouterProvider, Outlet, redirect,
} from '@tanstack/react-router';
import { AuthProvider } from '@/hooks/use-auth';
import { TOKEN_KEY } from '@/api/client';
import AppShell from '@/components/layout/app-shell';
import LoginPage from '@/pages/login';
import DashboardPage from '@/pages/dashboard';
import CalendarPage from '@/pages/calendar';
import TasksPage from '@/pages/tasks';
import MealsPage from '@/pages/meals';
import FeohPage from '@/pages/feoh';
import HouseholdPage from '@/pages/household';
import LibraryPage from '@/pages/library';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

const rootRoute = createRootRoute({ component: () => <Outlet /> });
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

const dashboardRoute = createRoute({ getParentRoute: () => authRoute, path: '/', component: DashboardPage });
const calendarRoute = createRoute({ getParentRoute: () => authRoute, path: '/calendar', component: CalendarPage });
const tasksRoute = createRoute({ getParentRoute: () => authRoute, path: '/tasks', component: TasksPage });
const mealsRoute = createRoute({ getParentRoute: () => authRoute, path: '/meals', component: MealsPage });
const feohRoute = createRoute({ getParentRoute: () => authRoute, path: '/feoh', component: FeohPage });
const householdRoute = createRoute({ getParentRoute: () => authRoute, path: '/household', component: HouseholdPage });
const libraryRoute = createRoute({ getParentRoute: () => authRoute, path: '/library', component: LibraryPage });

const routeTree = rootRoute.addChildren([
  loginRoute,
  authRoute.addChildren([dashboardRoute, calendarRoute, tasksRoute, mealsRoute, feohRoute, householdRoute, libraryRoute]),
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
