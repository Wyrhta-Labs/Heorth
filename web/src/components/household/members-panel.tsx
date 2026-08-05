import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import MembersTable from '@/components/household/members-table';
import MemberForm from '@/components/household/member-form';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { useMembers, useCreateMember, useUpdateMember, useSetMemberRole, useDeleteMember } from '@/hooks/use-household';
import type { Member, Role } from '@/lib/types';
import { ApiError } from '@/api/client';

interface Props {
  /** Presentation only — every member mutation is admin-gated server-side. */
  readOnly?: boolean;
}

/**
 * The household member roster and its add/edit dialog. Uses the RAW
 * `useMembers()` (not `useHouseholdMembers()`) because this table is one of the
 * two places that must still show the maintenance admin.
 */
export default function MembersPanel({ readOnly = false }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const membersQuery = useMembers();
  const members = membersQuery.data?.data ?? [];
  const retry = retryOf(membersQuery);

  const createM = useCreateMember();
  const updateM = useUpdateMember();
  const setRole = useSetMemberRole();
  const deleteM = useDeleteMember();

  const [editing, setEditing] = useState<Member | null>(null);
  const [open, setOpen] = useState(false);

  const submit = async (input: Parameters<typeof createM.mutateAsync>[0]) => {
    try {
      if (editing) {
        const patch: { displayName?: string; avatarColor?: typeof input.avatarColor; email?: string; password?: string } = {
          displayName: input.displayName, avatarColor: input.avatarColor, email: input.email,
        };
        if (input.password) patch.password = input.password;
        await updateM.mutateAsync({ id: editing.id, input: patch });
      } else {
        await createM.mutateAsync(input);
      }
      setOpen(false);
      toast(t('settings.members.saved'), 'success');
    } catch (e) {
      const msg = e instanceof ApiError && e.code === 'CONFLICT' ? t('settings.members.emailTaken') : (e as Error).message;
      toast(msg || t('settings.members.saveFailed'), 'error');
    }
  };

  const changeRole = async (id: string, role: Role) => {
    try { await setRole.mutateAsync({ id, role }); toast(t('settings.members.roleUpdated'), 'success'); }
    catch (e) { toast((e as Error).message || t('settings.members.roleUpdateFailed'), 'error'); }
  };

  const remove = async (m: Member) => {
    if (!confirm(t('settings.members.removeConfirm', { name: m.displayName }))) return;
    try { await deleteM.mutateAsync(m.id); toast(t('settings.members.removed'), 'success'); }
    catch (e) {
      const msg = e instanceof ApiError && e.code === 'CONFLICT' ? t('settings.members.removeLastAdminError') : (e as Error).message;
      toast(msg || t('settings.members.removeFailed'), 'error');
    }
  };

  if (retry) return <ErrorState message={t('settings.loadError')} onRetry={retry} />;

  return (
    <>
      {!readOnly && (
        <div className="flex justify-end mb-4">
          <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4" /> {t('settings.members.addMember')}</Button>
        </div>
      )}
      <Card><CardContent className="p-2">
        <MembersTable members={members} canManage={!readOnly} onEdit={(m) => { setEditing(m); setOpen(true); }} onRole={changeRole} onDelete={remove} />
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('settings.members.editMember') : t('settings.members.addMember')}</DialogTitle>
            <DialogClose onClose={() => setOpen(false)} />
          </DialogHeader>
          <MemberForm member={editing ?? undefined} onSubmit={submit} onCancel={() => setOpen(false)} isLoading={createM.isPending || updateM.isPending} />
        </DialogContent>
      </Dialog>
    </>
  );
}
