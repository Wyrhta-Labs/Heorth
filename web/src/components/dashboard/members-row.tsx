import { MemberAvatar } from '@/components/ui/member-avatar';
import { ErrorState } from '@/components/ui/error-state';
import { useMembers } from '@/hooks/use-household';

export default function MembersRow() {
  const { data, isError, refetch } = useMembers();
  const members = data?.data ?? [];
  if (isError) return <ErrorState compact message="Couldn’t load members." onRetry={() => refetch()} />;
  return (
    <div className="flex flex-wrap items-center gap-4">
      {members.map((m) => (
        <div key={m.id} className="flex flex-col items-center gap-1">
          <MemberAvatar name={m.displayName} color={m.avatarColor} size="lg" />
          <span className="text-xs text-ash">{m.displayName}</span>
        </div>
      ))}
    </div>
  );
}
