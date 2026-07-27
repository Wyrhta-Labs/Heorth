import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { exportCsv, exportLedger } from '@/api/feoh';
import { useImportCsv } from '@/hooks/use-feoh';

function download(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function CsvPanel() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [csv, setCsv] = useState('');
  const importMut = useImportCsv();

  const doImport = async () => {
    if (!csv.trim()) return;
    const res = await importMut.mutateAsync(csv);
    toast(t('feoh.csv.imported', { count: res.data.imported }), 'success');
    setCsv('');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={async () => download('heorth-transactions.csv', await exportCsv(), 'text/csv')}>
          <Download className="h-4 w-4" /> {t('feoh.csv.exportCsv')}
        </Button>
        <Button variant="outline" size="sm" onClick={async () => download('heorth-ledger.txt', await exportLedger(), 'text/plain')}>
          <Download className="h-4 w-4" /> {t('feoh.csv.exportLedger')}
        </Button>
      </div>
      <div className="space-y-2">
        <Textarea rows={6} value={csv} onChange={(e) => setCsv(e.target.value)}
          placeholder={t('feoh.csv.importPlaceholder')} />
        <Button size="sm" onClick={doImport} disabled={!csv.trim() || importMut.isPending}>
          <Upload className="h-4 w-4" /> {t('feoh.csv.importCsv')}
        </Button>
      </div>
    </div>
  );
}
