import { useState } from 'react';
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
import { useMembers, useCreateMember, useUpdateMember, useSetMemberRole, useDeleteMember, useWhoami } from '@/hooks/use-household';
import type { Member, Role } from '@/lib/types';
import { ApiError } from '@/api/client';

export default function HouseholdPage() {
  const { toast } = useToast();
  const { data: whoami } = useWhoami();
  const canManage = whoami?.data.role === 'admin';
  const { data } = useMembers();
  const members = data?.data ?? [];

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
      toast('Member saved', 'success');
    } catch (e) {
      const msg = e instanceof ApiError && e.code === 'CONFLICT' ? 'That email is already taken' : (e as Error).message;
      toast(msg ?? 'Failed to save member', 'error');
    }
  };

  const changeRole = async (id: string, role: Role) => {
    try { await setRole.mutateAsync({ id, role }); toast('Role updated', 'success'); }
    catch (e) { toast((e as Error).message ?? 'Failed to update role', 'error'); }
  };

  const remove = async (m: Member) => {
    if (!confirm(`Remove ${m.displayName}?`)) return;
    try { await deleteM.mutateAsync(m.id); toast('Member removed', 'success'); }
    catch (e) {
      const msg = e instanceof ApiError && e.code === 'CONFLICT' ? 'Cannot remove the last admin' : (e as Error).message;
      toast(msg ?? 'Failed to remove member', 'error');
    }
  };

  return (
    <Tabs defaultValue="members" className="space-y-4">
      <TabsList>
        <TabsTrigger value="members">Members</TabsTrigger>
        <TabsTrigger value="keys">API keys</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>

      <TabsContent value="members">
        {canManage && (
          <div className="flex justify-end mb-4">
            <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4" /> Add member</Button>
          </div>
        )}
        <Card><CardContent className="p-2">
          <MembersTable members={members} canManage={canManage} onEdit={(m) => { setEditing(m); setOpen(true); }} onRole={changeRole} onDelete={remove} />
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="keys">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">API keys</CardTitle></CardHeader>
          <CardContent><ApiKeysPanel /></CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="settings">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Household</CardTitle></CardHeader>
          <CardContent><HouseholdSettings canManage={canManage} /></CardContent>
        </Card>
      </TabsContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit member' : 'Add member'}</DialogTitle>
            <DialogClose onClose={() => setOpen(false)} />
          </DialogHeader>
          <MemberForm member={editing ?? undefined} onSubmit={submit} onCancel={() => setOpen(false)} isLoading={createM.isPending || updateM.isPending} />
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
