export function PagePlaceholder({ name }: { name: string }) {
  return <div className="text-ash">The {name} page lands in a later task.</div>;
}
export const DashboardPage = () => <PagePlaceholder name="Dashboard" />;
export const CalendarPage = () => <PagePlaceholder name="Calendar" />;
export const MealsPage = () => <PagePlaceholder name="Meals" />;
export const FeohPage = () => <PagePlaceholder name="Feoh" />;
export const HouseholdPage = () => <PagePlaceholder name="Household" />;
