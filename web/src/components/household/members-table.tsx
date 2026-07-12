import { Trash2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { MemberAvatar } from '@/components/ui/member-avatar';
import { ROLE_OPTIONS } from '@/lib/constants';
import type { Member, Role } from '@/lib/types';

interface Props {
  members: Member[];
  canManage: boolean;
  onEdit: (m: Member) => void;
  onRole: (id: string, role: Role) => void;
  onDelete: (m: Member) => void;
}

export default function MembersTable({ members, canManage, onEdit, onRole, onDelete }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead className="w-24"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m) => (
          <TableRow key={m.id}>
            <TableCell>
              <div className="flex items-center gap-2">
                <MemberAvatar name={m.displayName} color={m.avatarColor} size="sm" />
                <span className="font-medium">{m.displayName}</span>
              </div>
            </TableCell>
            <TableCell className="text-sm text-ash">{m.email}</TableCell>
            <TableCell>
              {canManage ? (
                <select value={m.role} onChange={(e) => onRole(m.id, e.target.value as Role)}
                  className="h-8 rounded-md border border-tan bg-card px-2 text-xs">
                  {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              ) : <Badge variant="outline">{m.role}</Badge>}
            </TableCell>
            <TableCell>
              {canManage && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => onEdit(m)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="text-red-500" onClick={() => onDelete(m)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
