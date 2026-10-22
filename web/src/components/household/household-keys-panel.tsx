import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MemberAvatar } from '@/components/ui/member-avatar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useHouseholdKeys, useRevokeHouseholdKey } from '@/hooks/use-api-keys';
import { useToast } from '@/components/ui/toast';
import { useFormatters } from '@/hooks/use-formatters';
import { isStaleKey } from '@/lib/api-key-staleness';
import type { HouseholdApiKey } from '@/lib/types';

interface Props {
  /** Never set by the registry today (the tab is admin-only); honoured anyway. */
  readOnly?: boolean;
}

/** Group keys by owner, keeping the API's order (by member name, then age). */
function byMember(keys: HouseholdApiKey[]): Array<{ member: HouseholdApiKey['member']; keys: HouseholdApiKey[] }> {
  const groups = new Map<string, { member: HouseholdApiKey['member']; keys: HouseholdApiKey[] }>();
  for (const key of keys) {
    const group = groups.get(key.member.id) ?? { member: key.member, keys: [] };
    group.keys.push(key);
    groups.set(key.member.id, group);
  }
  return [...groups.values()];
}

/**
 * Admin overview of every member's API keys: spot forgotten ones and revoke
 * them. The secret is never shown here — members mint and copy their own keys
 * on their profile.
 */
export default function HouseholdKeysPanel({ readOnly = false }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { formatDate } = useFormatters();
  const { data } = useHouseholdKeys();
  const revoke = useRevokeHouseholdKey();
  const groups = byMember(data?.data ?? []);

  const handleRevoke = async (key: HouseholdApiKey) => {
    if (!confirm(t('settings.householdKeys.revokeConfirm', { member: key.member.displayName, name: key.name }))) return;
    await revoke.mutateAsync(key.id);
    toast(t('settings.apiKeys.revoked'), 'success');
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-ash">{t('settings.householdKeys.intro')}</p>
      {groups.length === 0 ? (
        <div className="text-sm text-ash py-4 text-center">{t('settings.householdKeys.none')}</div>
      ) : (
        groups.map(({ member, keys }) => (
          <section key={member.id} aria-labelledby={`keys-${member.id}`}>
            <div className="flex items-center gap-2 mb-1">
              <MemberAvatar name={member.displayName} color={member.avatarColor} size="sm" />
              <h3 id={`keys-${member.id}`} className="font-medium text-ink">{member.displayName}</h3>
              <span className="text-sm text-ash">{t('settings.householdKeys.keyCount', { count: keys.length })}</span>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>{t('settings.apiKeys.headerName')}</TableHead><TableHead>{t('settings.apiKeys.headerPrefix')}</TableHead><TableHead>{t('settings.householdKeys.headerCreated')}</TableHead><TableHead>{t('settings.apiKeys.headerLastUsed')}</TableHead><TableHead className="w-12"></TableHead></TableRow></TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell><code className="text-xs bg-linen px-1.5 py-0.5 rounded">{k.prefix}…</code></TableCell>
                    <TableCell className="text-sm text-ash">{formatDate(k.createdAt)}</TableCell>
                    <TableCell className="text-sm text-ash">
                      <span className="inline-flex items-center gap-2">
                        {k.lastUsedAt ? formatDate(k.lastUsedAt) : t('settings.apiKeys.never')}
                        {isStaleKey(k) && (
                          <Badge variant="warning" title={t('settings.householdKeys.staleHint')}>{t('settings.householdKeys.stale')}</Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      {!readOnly && (
                        <Button
                          variant="ghost" size="icon" className="text-danger"
                          aria-label={t('settings.householdKeys.revokeLabel', { name: k.name })}
                          onClick={() => handleRevoke(k)} disabled={revoke.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ))
      )}
    </div>
  );
}
