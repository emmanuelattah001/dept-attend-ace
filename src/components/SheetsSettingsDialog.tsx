import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Settings, Loader2, ExternalLink, Check, AlertCircle } from 'lucide-react';

interface TabSchema { name: string; description: string; columns: string[]; }
interface SettingsResponse {
  ok: boolean;
  sheetId: string | null;
  sheetUrl: string | null;
  schema: { tabs: TabSchema[] };
  serviceAccountConfigured: boolean;
}

export function SheetsSettingsDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [input, setInput] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data: resp, error } = await supabase.functions.invoke('sheets-settings', { body: { action: 'get' } });
      if (error) throw error;
      setData(resp as SettingsResponse);
      setInput((resp as SettingsResponse)?.sheetId ?? '');
    } catch (e: any) {
      toast.error('Failed to load settings', { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) load(); }, [open]);

  const save = async () => {
    if (!confirmed) {
      toast.error('Please confirm the tabs and columns match your sheet.');
      return;
    }
    setSaving(true);
    try {
      const { data: resp, error } = await supabase.functions.invoke('sheets-settings', {
        body: { action: 'set', sheetId: input.trim() },
      });
      if (error) throw error;
      const r = resp as { ok: boolean; sheetId?: string; error?: string };
      if (!r.ok) throw new Error(r.error || 'Save failed');
      toast.success('Google Sheet configured', { description: r.sheetId });
      await load();
    } catch (e: any) {
      toast.error('Failed to save', { description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="sheets-settings-btn">
          <Settings className="w-4 h-4 mr-1" /> Sheets Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Google Sheets Configuration</DialogTitle>
          <DialogDescription>
            Set the spreadsheet ID used for archiving attendance, and confirm the required tab names and columns before syncing.
          </DialogDescription>
        </DialogHeader>

        {loading || !data ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-md border p-3 text-sm flex items-start gap-2">
              {data.serviceAccountConfigured ? (
                <><Check className="w-4 h-4 text-green-600 mt-0.5" /> <span>Google service account is configured.</span></>
              ) : (
                <><AlertCircle className="w-4 h-4 text-destructive mt-0.5" />
                  <span>Missing <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> secret. Sync will fail until it is set.</span></>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="sheet-id">Spreadsheet ID or URL</Label>
              <Input
                id="sheet-id"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              {data.sheetUrl && (
                <a href={data.sheetUrl} target="_blank" rel="noreferrer"
                  className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                  Open current sheet <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <p className="text-xs text-muted-foreground">
                Share the spreadsheet with the service account email as an <strong>Editor</strong>.
              </p>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Required tabs &amp; columns</h4>
              {data.schema.tabs.map((tab) => (
                <div key={tab.name} className="rounded-md border p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="secondary">{tab.name}</Badge>
                    <span className="text-xs text-muted-foreground">{tab.description}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {tab.columns.map((c, i) => (
                      <code key={c} className="text-[11px] bg-muted rounded px-1.5 py-0.5">
                        {String.fromCharCode(65 + i)}: {c}
                      </code>
                    ))}
                  </div>
                </div>
              ))}
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>I confirm my spreadsheet has these exact tab names and header rows.</span>
              </label>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading || !input.trim() || !confirmed}>
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            Save configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
