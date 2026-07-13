import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import {
  useCreateLibraryThing, useStartTraktDevice, usePollTraktDevice,
} from '@/hooks/use-library';
import type { TraktDevice } from '@/api/library';

export default function ConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const createLT = useCreateLibraryThing();
  const startDevice = useStartTraktDevice();
  const pollDevice = usePollTraktDevice();
  const [userid, setUserid] = useState('');
  const [key, setKey] = useState('');
  const [device, setDevice] = useState<TraktDevice | null>(null);

  const connectLT = async () => {
    await createLT.mutateAsync({ userid, key });
    toast('LibraryThing connected', 'success');
    onClose();
  };

  const beginTrakt = async () => {
    const res = await startDevice.mutateAsync();
    setDevice(res.data);
    // Poll until authorized or expired.
    const started = Date.now();
    const tick = async () => {
      if (Date.now() - started > res.data.expires_in * 1000) { toast('Trakt code expired', 'error'); setDevice(null); return; }
      const poll = await pollDevice.mutateAsync(res.data.device_code);
      if ('status' in poll.data && poll.data.status === 'pending') {
        setTimeout(tick, res.data.interval * 1000);
      } else {
        toast('Trakt connected', 'success'); setDevice(null); onClose();
      }
    };
    setTimeout(tick, res.data.interval * 1000);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect an account</DialogTitle>
          <DialogClose onClose={onClose} />
        </DialogHeader>
        <Tabs defaultValue="trakt">
          <TabsList>
            <TabsTrigger value="trakt">Trakt</TabsTrigger>
            <TabsTrigger value="librarything">LibraryThing</TabsTrigger>
          </TabsList>
          <TabsContent value="trakt">
            {device ? (
              <div className="space-y-2">
                <p>Go to <a className="underline" href={device.verification_url} target="_blank" rel="noreferrer">{device.verification_url}</a> and enter:</p>
                <p className="text-2xl font-mono tracking-widest">{device.user_code}</p>
                <p className="text-sm text-muted-foreground">Waiting for authorization…</p>
              </div>
            ) : (
              <Button onClick={beginTrakt} disabled={startDevice.isPending}>Connect Trakt</Button>
            )}
          </TabsContent>
          <TabsContent value="librarything">
            <div className="space-y-2">
              <Input placeholder="LibraryThing user id" value={userid} onChange={(e) => setUserid(e.target.value)} />
              <Input placeholder="API key" value={key} onChange={(e) => setKey(e.target.value)} />
              <Button onClick={connectLT} disabled={!userid || !key || createLT.isPending}>Connect LibraryThing</Button>
              <p className="text-sm text-muted-foreground">If the LibraryThing API is unavailable, connect anyway then upload your Export Books file from the connection card.</p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
