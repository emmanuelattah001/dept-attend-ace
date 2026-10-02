import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, ArrowLeft, Camera, Loader2, ShieldCheck, MapPin, ScanFace, Smartphone, RefreshCw, Check } from 'lucide-react';

const DEVICE_KEY = 'aips_device_id';

function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2));
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

type FaceStep = 'idle' | 'camera' | 'preview';

const ScanPage = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, loading } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [needsFace, setNeedsFace] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; course?: string; date?: string; score?: number; proofs?: any } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const submittedRef = useRef(false);

  // Guided selfie state
  const [faceStep, setFaceStep] = useState<FaceStep>('idle');
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const pendingRef = useRef<{ token: string; code?: string } | null>(null);
  const selfieVideoRef = useRef<HTMLVideoElement | null>(null);
  const selfieStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      navigate(`/login?next=/scan${params.toString() ? `?${params.toString()}` : ''}`);
    }
  }, [user, loading, navigate, params]);

  // Face enrollment is mandatory before scanning.
  const [faceChecked, setFaceChecked] = useState(false);
  useEffect(() => {
    if (!user) return;
    supabase.from('students').select('face_url').eq('auth_user_id', user.id).maybeSingle()
      .then(({ data }) => { setNeedsFace(Boolean((data as any)?.face_url)); setFaceChecked(true); });
  }, [user]);

  const stopSelfieCamera = () => {
    selfieStreamRef.current?.getTracks().forEach(t => t.stop());
    selfieStreamRef.current = null;
  };

  const getLocation = () => new Promise<{ lat: number; lng: number; accuracy: number } | null>((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });

  // ---- Guided selfie flow ----
  const startSelfieCamera = async () => {
    setSelfiePreview(null);
    setFaceStep('camera');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      selfieStreamRef.current = stream;
      // Wait a tick so the <video> element is mounted
      await new Promise(r => setTimeout(r, 50));
      if (selfieVideoRef.current) {
        selfieVideoRef.current.srcObject = stream;
        await selfieVideoRef.current.play();
      }
    } catch (e: any) {
      setFaceStep('idle');
      pendingRef.current = null;
      submittedRef.current = false;
      setResult({ ok: false, message: 'Face check required — allow camera access and try again.' });
      toast.error('Camera access required for face verification');
    }
  };

  const captureSelfieFrame = () => {
    const video = selfieVideoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    const size = 480;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const side = Math.min(video.videoWidth, video.videoHeight);
    ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, size, size);
    setSelfiePreview(canvas.toDataURL('image/jpeg', 0.85));
    stopSelfieCamera();
    setFaceStep('preview');
  };

  const cancelSelfie = () => {
    stopSelfieCamera();
    setSelfiePreview(null);
    setFaceStep('idle');
    pendingRef.current = null;
    submittedRef.current = false;
  };

  // ---- Submission ----
  const submitToken = async (token: string, code?: string, selfie?: string | null) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setResult(null);

    // If face verification is needed and we don't have a confirmed selfie yet,
    // park the token and open the guided selfie screen first.
    if (needsFace && !selfie) {
      pendingRef.current = { token, code };
      await startSelfieCamera();
      return;
    }

    setSubmitting(true);
    try {
      const loc = await getLocation();
      const body: any = { token, device_id: getDeviceId() };
      if (code) body.code = code.trim().toUpperCase();
      if (loc) { body.lat = loc.lat; body.lng = loc.lng; body.accuracy = loc.accuracy; }
      if (selfie) body.selfie = selfie;

      let { data, error } = await supabase.functions.invoke('mark-via-qr', { body });
      if (error && !data) {
        try { data = await (error as any)?.context?.json?.(); } catch { /* ignore */ }
      }
      if (error || (data as any)?.error) {
        const msg = (data as any)?.error || error?.message || 'Failed to mark attendance';
        setResult({ ok: false, message: msg, score: (data as any)?.confidence_score, proofs: (data as any)?.proofs });
        toast.error(msg);
        submittedRef.current = false;
      } else {
        const course = (data as any)?.course;
        const courseLabel = course ? `${course.code ? course.code + ' - ' : ''}${course.name}` : 'attendance';
        setResult({
          ok: true, message: 'Verified and marked present!',
          course: courseLabel, date: (data as any)?.date,
          score: (data as any)?.confidence_score, proofs: (data as any)?.proofs,
        });
        toast.success('Marked present');
      }
    } finally {
      setSubmitting(false);
      setFaceStep('idle');
      setSelfiePreview(null);
      pendingRef.current = null;
    }
  };

  const confirmSelfieAndSubmit = async () => {
    const pending = pendingRef.current;
    if (!pending || !selfiePreview) return;
    submittedRef.current = false; // allow the real submit to proceed
    await submitToken(pending.token, pending.code, selfiePreview);
  };

  const parseScan = (decoded: string): { token: string; code?: string } => {
    try {
      const u = new URL(decoded);
      return { token: u.searchParams.get('token') ?? decoded, code: u.searchParams.get('c') ?? undefined };
    } catch {
      return { token: decoded };
    }
  };

  // Auto-submit if token in URL
  useEffect(() => {
    const tok = params.get('token');
    if (user && faceChecked && needsFace && tok && !submittedRef.current) submitToken(tok, params.get('c') ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, params, needsFace, faceChecked]);

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
          const { token, code } = parseScan(decoded);
          await html5.stop().catch(() => {});
          setScanning(false);
          await submitToken(token, code);
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
    stopSelfieCamera();
  }, []);

  if (loading || (user && !faceChecked)) return null;

  if (user && !needsFace) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-md mx-auto space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ScanFace className="w-5 h-5 text-primary" /> Face enrollment required
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                You need to save your face on your dashboard before you can scan the QR code to mark attendance.
              </p>
              <Button className="w-full" onClick={() => navigate('/')}>Go to dashboard to enroll</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const proofs = result?.proofs ?? {};

  // ---- Guided selfie screen ----
  if (faceStep !== 'idle') {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-md mx-auto space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ScanFace className="w-5 h-5 text-primary" /> Face Verification
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {faceStep === 'camera'
                  ? 'Center your face inside the oval, make sure you are in good light, then tap Capture.'
                  : 'Check your photo — make sure your face is clear and well lit, then confirm.'}
              </p>

              <div className="relative mx-auto w-64 h-64 rounded-2xl overflow-hidden border bg-muted">
                {faceStep === 'camera' ? (
                  <>
                    <video ref={selfieVideoRef} playsInline muted className="w-full h-full object-cover" />
                    {/* Face oval guide */}
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <div className="w-40 h-52 rounded-[50%] border-2 border-primary/80 border-dashed" />
                    </div>
                  </>
                ) : (
                  selfiePreview && <img src={selfiePreview} alt="Your captured selfie" className="w-full h-full object-cover" />
                )}
              </div>

              <div className="flex flex-col gap-2">
                {faceStep === 'camera' ? (
                  <Button onClick={captureSelfieFrame} className="w-full">
                    <Camera className="w-4 h-4 mr-2" /> Capture
                  </Button>
                ) : (
                  <>
                    <Button onClick={confirmSelfieAndSubmit} className="w-full" disabled={submitting}>
                      {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                      {submitting ? 'Verifying...' : 'Confirm & mark attendance'}
                    </Button>
                    <Button variant="outline" onClick={startSelfieCamera} disabled={submitting}>
                      <RefreshCw className="w-4 h-4 mr-2" /> Retake
                    </Button>
                  </>
                )}
                <Button variant="ghost" onClick={cancelSelfie} disabled={submitting}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-md mx-auto space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Verify & Mark Attendance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Rotating QR</span>
              <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Location</span>
              <span className="flex items-center gap-1"><ScanFace className="w-3.5 h-3.5" /> Face</span>
              <span className="flex items-center gap-1"><Smartphone className="w-3.5 h-3.5" /> Device</span>
            </div>

            {result && (
              <div className={`p-4 rounded-lg flex items-start gap-3 ${result.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                {result.ok ? <CheckCircle2 className="w-6 h-6 shrink-0" /> : <XCircle className="w-6 h-6 shrink-0" />}
                <div className="text-sm space-y-0.5">
                  <p className="font-semibold">{result.message}</p>
                  {result.course && <p className="opacity-80">{result.course}</p>}
                  {result.date && <p className="opacity-80">{result.date}</p>}
                  {typeof result.score === 'number' && <p className="opacity-80">Confidence: {result.score}%</p>}
                  {proofs.location?.distance_m != null && <p className="opacity-80">Distance: {proofs.location.distance_m}m</p>}
                  {proofs.face?.confidence != null && <p className="opacity-80">Face match: {proofs.face.confidence}%</p>}
                </div>
              </div>
            )}

            <div id="qr-reader" className={`w-full ${scanning ? '' : 'hidden'}`} />

            {!scanning && (
              <Button onClick={startCamera} className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
                {submitting ? 'Verifying...' : 'Open camera & scan'}
              </Button>
            )}

            <div className="pt-3 border-t space-y-2">
              <p className="text-xs text-muted-foreground">Or enter the session code shown on screen</p>
              <Input value={manualToken} onChange={e => setManualToken(e.target.value)} placeholder="Session token" />
              <div className="flex gap-2">
                <Input value={manualCode} onChange={e => setManualCode(e.target.value)} placeholder="6-digit rotating code" className="uppercase" />
                <Button onClick={() => { submittedRef.current = false; submitToken(manualToken.trim(), manualCode.trim() || undefined); }} disabled={!manualToken.trim() || submitting}>
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
