import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MemberAvatar } from '@/components/ui/member-avatar';
import { AVATAR_COLOR_OPTIONS } from '@/lib/constants';
import type { Member, AvatarColor } from '@/lib/types';
import type { CreateMemberInput } from '@/api/household';

interface Props { member?: Member; onSubmit: (input: CreateMemberInput) => Promise<void>; onCancel: () => void; isLoading?: boolean; }

export default function MemberForm({ member, onSubmit, onCancel, isLoading }: Props) {
  const [email, setEmail] = useState(member?.email ?? '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(member?.displayName ?? '');
  const [avatarColor, setAvatarColor] = useState<AvatarColor>(member?.avatarColor ?? 'ember');
  const [role, setRole] = useState<'adult' | 'child'>((member?.role === 'child' ? 'child' : 'adult'));
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member && password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setError('');
    await onSubmit({ email, password, displayName, avatarColor, role });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="displayName">Display name *</Label>
        <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">Email *</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="password">{member ? 'New password (optional)' : 'Password *'}</Label>
        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
      </div>
      <div className="space-y-1">
        <Label>Avatar color</Label>
        <div className="flex gap-2">
          {AVATAR_COLOR_OPTIONS.map((c) => (
            <button key={c.value} type="button" onClick={() => setAvatarColor(c.value)}
              className={`rounded-full p-0.5 ${avatarColor === c.value ? 'ring-2 ring-ember' : ''}`}>
              <MemberAvatar name={displayName || '?'} color={c.value} size="md" />
            </button>
          ))}
        </div>
      </div>
      {!member && (
        <div className="space-y-1">
          <Label htmlFor="role">Role</Label>
          <select id="role" value={role} onChange={(e) => setRole(e.target.value as 'adult' | 'child')}
            className="h-9 w-full rounded-md border border-tan bg-card px-3 text-sm">
            <option value="adult">Adult</option>
            <option value="child">Child</option>
          </select>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={isLoading}>{isLoading ? 'Saving…' : member ? 'Update' : 'Add member'}</Button>
      </div>
    </form>
  );
}
