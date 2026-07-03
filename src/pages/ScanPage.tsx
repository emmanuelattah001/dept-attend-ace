import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, ArrowLeft, Camera, Loader2 } from 'lucide-react';

const ScanPage = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, loading } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string; course?: string; date?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate(`/login?next=/scan${params.toString() ? `?${params.toString()}` : ''}`);
    }
  }, [user, loading, navigate, params]);

  const getLocation = () => new Promise<{ lat: number; lng: number; accuracy: number } | null>((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });

  const submitToken = async (token: string) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      const loc = await getLocation();
      const body: any = { token };
      if (loc) { body.lat = loc.lat; body.lng = loc.lng; body.accuracy = loc.accuracy; }
      const { data, error } = await supabase.functions.invoke('mark-via-qr', { body });
      if (error || (data as any)?.error) {
        const msg = (data as any)?.error || error?.message || 'Failed to mark attendance';
        setResult({ ok: false, message: msg });
        toast.error(msg);
        submittedRef.current = false;
      } else {
        const course = (data as any)?.course;
        const courseLabel = course ? `${course.code ? course.code + ' - ' : ''}${course.name}` : 'attendance';
        setResult({ ok: true, message: 'You have been marked present!', course: courseLabel, date: (data as any)?.date });
        toast.success('Marked present');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Auto-submit if token in URL
  useEffect(() => {
    const tok = params.get('token');
    if (user && tok && !submittedRef.current) submitToken(tok);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, params]);

  const startCamera = async () => {
    setResult(null);
    submittedRef.current = false;
    setScanning(true);
    try {
      const html5 = new Html5Qrcode('qr-reader');
      scannerRef.current = html5;
      await html5.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decoded) => {
          // Decoded value may be URL with ?token=...
          let token = decoded;
          try { const u = new URL(decoded); token = u.searchParams.get('token') ?? decoded; } catch { /* ignore */ }
          await html5.stop().catch(() => {});
          setScanning(false);
          await submitToken(token);
        },
        () => { /* ignore decode errors */ }
      );
    } catch (e: any) {
      setScanning(false);
      toast.error('Could not start camera: ' + (e?.message || e));
    }
  };

  useEffect(() => () => {
    scannerRef.current?.stop().catch(() => {});
  }, []);

  if (loading) return null;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-md mx-auto space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Scan Attendance QR</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {result && (
              <div className={`p-4 rounded-lg flex items-start gap-3 ${result.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                {result.ok ? <CheckCircle2 className="w-6 h-6 shrink-0" /> : <XCircle className="w-6 h-6 shrink-0" />}
                <div className="text-sm">
                  <p className="font-semibold">{result.message}</p>
                  {result.course && <p className="opacity-80">{result.course}</p>}
                  {result.date && <p className="opacity-80">{result.date}</p>}
                </div>
              </div>
            )}

            <div id="qr-reader" className={`w-full ${scanning ? '' : 'hidden'}`} />

            {!scanning && (
              <Button onClick={startCamera} className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
                {submitting ? 'Marking...' : 'Open camera & scan'}
              </Button>
            )}

            <div className="pt-3 border-t">
              <p className="text-xs text-muted-foreground mb-2">Or paste the session code</p>
              <div className="flex gap-2">
                <Input value={manualToken} onChange={e => setManualToken(e.target.value)} placeholder="Session token" />
                <Button onClick={() => { submittedRef.current = false; submitToken(manualToken.trim()); }} disabled={!manualToken.trim() || submitting}>
                  Submit
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ScanPage;
