import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MemberAvatar } from '@/components/ui/member-avatar';
import { AVATAR_COLOR_OPTIONS, ROLE_OPTIONS } from '@/lib/constants';
import type { Member, AvatarColor, MemberRole } from '@/lib/types';

const MEMBER_ROLE_OPTIONS = ROLE_OPTIONS.filter((r): r is typeof ROLE_OPTIONS[number] & { value: MemberRole } => r.value !== 'admin');
import type { CreateMemberInput } from '@/api/household';

interface Props { member?: Member; onSubmit: (input: CreateMemberInput) => Promise<void>; onCancel: () => void; isLoading?: boolean; }

export default function MemberForm({ member, onSubmit, onCancel, isLoading }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(member?.email ?? '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(member?.displayName ?? '');
  const [avatarColor, setAvatarColor] = useState<AvatarColor>(member?.avatarColor ?? 'ember');
  const [role, setRole] = useState<MemberRole>((member?.role === 'child' ? 'child' : 'adult'));
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member && password.length < 8) { setError(t('settings.form.passwordTooShort')); return; }
    setError('');
    await onSubmit({ email, password, displayName, avatarColor, role });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="displayName">{t('settings.form.displayName')}</Label>
        <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">{t('settings.form.email')}</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="password">{member ? t('settings.form.passwordNew') : t('settings.form.password')}</Label>
        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('settings.form.passwordPlaceholder')} />
      </div>
      <div className="space-y-1">
        <Label>{t('settings.form.avatarColor')}</Label>
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
          <Label htmlFor="role">{t('settings.form.role')}</Label>
          <select id="role" value={role} onChange={(e) => setRole(e.target.value as MemberRole)}
            className="h-9 w-full rounded-md border border-tan bg-card px-3 text-sm">
            {MEMBER_ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{t(r.labelKey)}</option>)}
          </select>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>{t('settings.form.cancel')}</Button>
        <Button type="submit" disabled={isLoading}>{isLoading ? t('settings.form.saving') : member ? t('settings.form.update') : t('settings.form.addMember')}</Button>
      </div>
    </form>
  );
}
