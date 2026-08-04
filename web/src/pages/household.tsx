import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import MembersTable from '@/components/household/members-table';
import MemberForm from '@/components/household/member-form';
import ApiKeysPanel from '@/components/household/api-keys-panel';
import HouseholdSettings from '@/components/household/household-settings';
import ConnectionsPanel from '@/components/household/connections-panel';
import { ErrorState } from '@/components/ui/error-state';
import { retryOf } from '@/lib/query-error';
import { useMembers, useCreateMember, useUpdateMember, useSetMemberRole, useDeleteMember, useWhoami } from '@/hooks/use-household';
import type { Member, Role } from '@/lib/types';
import { ApiError } from '@/api/client';

export default function HouseholdPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const whoamiQuery = useWhoami();
  const canManage = whoamiQuery.data?.data.role === 'admin';
  const membersQuery = useMembers();
  const members = membersQuery.data?.data ?? [];
  const retry = retryOf(whoamiQuery, membersQuery);

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
    <Tabs defaultValue="members" className="space-y-4">
      <TabsList>
        <TabsTrigger value="members">{t('settings.tabs.members')}</TabsTrigger>
        {canManage && <TabsTrigger value="keys">{t('settings.tabs.apiKeys')}</TabsTrigger>}
        {canManage && <TabsTrigger value="settings">{t('settings.tabs.settings')}</TabsTrigger>}
        {canManage && <TabsTrigger value="connections">{t('settings.tabs.connections')}</TabsTrigger>}
      </TabsList>

      <TabsContent value="members">
        {canManage && (
          <div className="flex justify-end mb-4">
            <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4" /> {t('settings.members.addMember')}</Button>
          </div>
        )}
        <Card><CardContent className="p-2">
          <MembersTable members={members} canManage={canManage} onEdit={(m) => { setEditing(m); setOpen(true); }} onRole={changeRole} onDelete={remove} />
        </CardContent></Card>
      </TabsContent>

      {canManage && (
        <TabsContent value="keys">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">{t('settings.tabs.apiKeys')}</CardTitle></CardHeader>
            <CardContent><ApiKeysPanel /></CardContent>
          </Card>
        </TabsContent>
      )}

      {canManage && (
        <TabsContent value="settings">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">{t('nav.household')}</CardTitle></CardHeader>
            <CardContent><HouseholdSettings canManage={canManage} /></CardContent>
          </Card>
        </TabsContent>
      )}

      {canManage && (
        <TabsContent value="connections">
          <ConnectionsPanel />
        </TabsContent>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('settings.members.editMember') : t('settings.members.addMember')}</DialogTitle>
            <DialogClose onClose={() => setOpen(false)} />
          </DialogHeader>
          <MemberForm member={editing ?? undefined} onSubmit={submit} onCancel={() => setOpen(false)} isLoading={createM.isPending || updateM.isPending} />
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
