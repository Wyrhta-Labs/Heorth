import { Link } from '@tanstack/react-router';
import { MemberAvatar } from '@/components/ui/member-avatar';
import { useWhoami } from '@/hooks/use-household';

/** The page title. The member and sign-out live in the sidebar footer; on
 *  phone widths, where the sidebar is hidden, the avatar stays here. */
export default function TopBar({ title }: { title: string }) {
  const me = useWhoami().data?.data;
  return (
    <header className="z-[2] flex h-[52px] shrink-0 items-center gap-3.5 border-b border-line bg-surface px-4 shadow-card md:px-5">
      <h1 className="font-sans text-[15px] font-bold text-fg">{title}</h1>
      {me && (
        <Link to="/profile" className="ml-auto md:hidden" title={me.displayName}>
          <MemberAvatar name={me.displayName} color={me.avatarColor} size="sm" />
        </Link>
      )}
    </header>
  );
}
