import { useState, useEffect } from 'react';
import { Plus, Trash2, Key, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose, DialogFooter } from '@/components/ui/dialog';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/hooks/use-api-keys';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/format';

export default function ApiKeysPanel() {
  const { toast } = useToast();
  const { data } = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const keys = data?.data ?? [];

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => () => setCreatedKey(null), []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    const res = await create.mutateAsync(name.trim());
    setCreatedKey(res.data.raw); // raw key returned once
    setName('');
    setShowCreate(false);
    toast('API key created', 'success');
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (id: string, keyName: string) => {
    if (!confirm(`Revoke API key "${keyName}"?`)) return;
    await revoke.mutateAsync(id);
    toast('API key revoked', 'success');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-ash">Mint <code className="text-xs">he_</code> keys for agents (MCP).</p>
        <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> New key</Button>
      </div>
      {keys.length === 0 ? (
        <div className="text-sm text-ash py-4 text-center">No API keys yet.</div>
      ) : (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Prefix</TableHead><TableHead>Last used</TableHead><TableHead className="w-12"></TableHead></TableRow></TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">{k.name}</TableCell>
                <TableCell><code className="text-xs bg-linen px-1.5 py-0.5 rounded">{k.keyPrefix}…</code></TableCell>
                <TableCell className="text-sm text-ash">{k.lastUsedAt ? formatDate(k.lastUsedAt) : 'Never'}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="text-red-500" onClick={() => handleRevoke(k.id, k.name)} disabled={revoke.isPending}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create API key</DialogTitle><DialogClose onClose={() => setShowCreate(false)} /></DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="keyName">Name *</Label>
            <Input id="keyName" value={name} onChange={(e) => setName(e.target.value)} placeholder="Home assistant" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!name.trim() || create.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createdKey} onOpenChange={(open) => !open && setCreatedKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Key className="h-5 w-5 text-ember" /> API key created</DialogTitle>
            <DialogClose onClose={() => setCreatedKey(null)} />
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-amber/10 border border-amber/40 rounded-lg p-3 text-sm text-ink">Copy this key now — you won&rsquo;t see it again.</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-linen px-3 py-2 rounded-lg text-sm font-mono break-all">{createdKey}</code>
              <Button variant="outline" size="icon" onClick={handleCopy}>{copied ? <Check className="h-4 w-4 text-sage" /> : <Copy className="h-4 w-4" />}</Button>
            </div>
          </div>
          <DialogFooter><Button onClick={() => setCreatedKey(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
