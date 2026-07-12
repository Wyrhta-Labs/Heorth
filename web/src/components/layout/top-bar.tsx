import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MemberAvatar } from '@/components/ui/member-avatar';
import { useAuth } from '@/hooks/use-auth';
import { useWhoami } from '@/hooks/use-household';

export default function TopBar({ title }: { title: string }) {
  const { logout } = useAuth();
  const { data } = useWhoami();
  const me = data?.data;
  return (
    <header className="flex items-center justify-between px-6 py-4 bg-card border-b border-tan">
      <h2 className="font-serif text-2xl text-ink">{title}</h2>
      <div className="flex items-center gap-3">
        {me && <MemberAvatar name={me.displayName} color={me.avatarColor} size="sm" />}
        <span className="text-sm text-ash hidden sm:block">{me?.displayName}</span>
        <Button variant="ghost" size="icon" onClick={logout} title="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
