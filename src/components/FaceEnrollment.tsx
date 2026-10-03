import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ScanFace, Camera, Check, CheckCircle2, Loader2, RefreshCw, UserRoundCheck, CircleAlert, ScanLine } from 'lucide-react';

const FACE_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

interface Props {
  enrolledAt: string | null;
  onEnrolled?: (at: string) => void;
}

type DetectState = 'loading' | 'searching' | 'detected' | 'multiple' | 'error';

export const FaceEnrollment = ({ enrolledAt, onEnrolled }: Props) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [detectState, setDetectState] = useState<DetectState>('loading');
  const [detectMessage, setDetectMessage] = useState('Starting face detection...');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<FaceDetector | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopDetection = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const stopCamera = () => {
    stopDetection();
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  useEffect(() => () => stopCamera(), []);

  const initDetector = async () => {
    if (detectorRef.current) return detectorRef.current;
    const vision = await FilesetResolver.forVisionTasks(FACE_WASM_URL);
    const detector = await FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5,
    });
    detectorRef.current = detector;
    return detector;
  };

  const runDetection = () => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector || !streamRef.current) return;

    if (video.readyState >= 2) {
      try {
        const result = detector.detectForVideo(video, performance.now());
        const count = result.detections?.length ?? 0;
        if (count === 0) {
          setDetectState('searching');
          setDetectMessage('Looking for your face...');
        } else if (count > 1) {
          setDetectState('multiple');
          setDetectMessage('Only one face should be visible');
        } else {
          setDetectState('detected');
          setDetectMessage('Face detected — you can capture now');
        }
      } catch {
        // keep looping on transient errors
      }
    }
    rafRef.current = requestAnimationFrame(runDetection);
  };

  const startCamera = async () => {
    setPreview(null);
    setIssues([]);
    setOpen(true);
    setDetectState('loading');
    setDetectMessage('Starting face detection...');
    try {
      const [stream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } }),
        initDetector().catch(() => null),
      ]);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (detectorRef.current) {
        setDetectState('searching');
        setDetectMessage('Looking for your face...');
        rafRef.current = requestAnimationFrame(runDetection);
      } else {
        setDetectState('error');
        setDetectMessage('Live detection unavailable — you can still capture manually.');
      }
    } catch (e: any) {
      setOpen(false);
      toast.error('Camera unavailable: ' + (e?.message || e));
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    const size = 480;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const side = Math.min(video.videoWidth, video.videoHeight);
    ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, size, size);
    setPreview(canvas.toDataURL('image/jpeg', 0.85));
    stopCamera();
  };

  const save = async () => {
    if (!preview) return;
    setBusy(true);
    setIssues([]);
    try {
      let { data, error } = await supabase.functions.invoke('verify-face', {
        body: { action: 'enroll', image: preview },
      });
      if (error && !data) {
        try { data = await (error as any)?.context?.json?.(); } catch { /* ignore */ }
      }
      if ((data as any)?.quality_rejected) {
        setIssues((data as any)?.issues?.length ? (data as any).issues : ['Make sure your face is clear, centered and well lit.']);
        toast.error('Photo not clear enough — please retake');
        return;
      }
      const err = (data as any)?.error || error?.message;
      if (err) throw new Error(err);
      toast.success('Face enrolled');
      onEnrolled?.((data as any)?.enrolled_at ?? new Date().toISOString());
      setOpen(false);
      setPreview(null);
    } catch (e: any) {
      toast.error(e?.message || 'Enrollment failed');
    } finally {
      setBusy(false);
    }
  };

  const statusIsGood = detectState === 'detected';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <ScanFace className="w-5 h-5 text-primary" /> Face Verification
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {enrolledAt ? (
          <div className="rounded-lg border border-success/20 bg-success/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle2 className="h-4 w-4" /> Face enrolled
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Your face is verified automatically during QR attendance.</p>
            <p className="mt-2 text-xs text-muted-foreground">Enrolled: {new Date(enrolledAt).toLocaleDateString()}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Face verification is not enrolled yet. Enroll a clear photo before scanning attendance QR codes.</p>
        )}

        {open && (
          <div className="space-y-3">
            {!preview && (
              <p className="text-xs text-muted-foreground">Face the camera in good light, remove sunglasses or masks, and keep your whole face in view.</p>
            )}
            {preview ? (
              <img src={preview} alt="Captured selfie preview" className="w-40 h-40 rounded-lg object-cover border" />
            ) : (
              <div className="space-y-2">
                <div className="relative w-40 h-40">
                  <video ref={videoRef} playsInline muted className="w-40 h-40 rounded-lg object-cover border bg-muted" style={{ transform: 'scaleX(-1)' }} />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div
                      className={`h-[70%] w-[58%] rounded-[45%] border-2 transition-all ${
                        statusIsGood
                          ? 'border-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.5)]'
                          : 'border-white/70'
                      }`}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  {statusIsGood ? (
                    <UserRoundCheck className="w-3.5 h-3.5 text-emerald-500" />
                  ) : detectState === 'multiple' || detectState === 'error' ? (
                    <CircleAlert className="w-3.5 h-3.5 text-destructive" />
                  ) : (
                    <ScanLine className="w-3.5 h-3.5 animate-pulse text-muted-foreground" />
                  )}
                  <span className={statusIsGood ? 'text-emerald-600 font-medium' : 'text-muted-foreground'}>
                    {detectMessage}
                  </span>
                </div>
              </div>
            )}
            {busy && <p className="text-xs text-muted-foreground">Checking photo quality...</p>}
            {issues.length > 0 && (
              <div className="rounded-md bg-destructive/10 text-destructive p-3 text-xs space-y-1">
                <p className="font-semibold">Please retake your photo:</p>
                <ul className="list-disc pl-4">{issues.map((i, k) => <li key={k}>{i}</li>)}</ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {!preview ? (
                <Button size="sm" onClick={capture} disabled={detectState === 'loading' || detectState === 'searching' || detectState === 'multiple'}>
                  <Camera className="w-4 h-4 mr-1" /> Capture
                </Button>
              ) : (
                <>
                  <Button size="sm" onClick={save} disabled={busy}>
                    {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />} Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={startCamera} disabled={busy}>
                    <RefreshCw className="w-4 h-4 mr-1" /> Retake
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => { stopCamera(); setOpen(false); setPreview(null); }} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!open && (
          <Button size="sm" variant={enrolledAt ? 'outline' : 'default'} onClick={startCamera}>
            <ScanFace className="w-4 h-4 mr-1" /> {enrolledAt ? 'Re-enroll Face' : 'Enroll Face'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default FaceEnrollment;
