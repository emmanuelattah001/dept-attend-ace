import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ScanFace, Camera, Check, Loader2, RefreshCw } from 'lucide-react';

interface Props {
  enrolledAt: string | null;
  onEnrolled?: (at: string) => void;
}

export const FaceEnrollment = ({ enrolledAt, onEnrolled }: Props) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  useEffect(() => () => stopCamera(), []);

  const startCamera = async () => {
    setPreview(null);
    setOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
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
    try {
      const { data, error } = await supabase.functions.invoke('verify-face', {
        body: { action: 'enroll', image: preview },
      });
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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <ScanFace className="w-5 h-5 text-primary" /> Face Verification
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {enrolledAt
            ? `Enrolled on ${new Date(enrolledAt).toLocaleDateString()}. Your selfie is matched at every QR scan.`
            : 'Enroll a clear photo of your face. It is required to verify you when scanning attendance QR codes.'}
        </p>

        {open && (
          <div className="space-y-3">
            {preview ? (
              <img src={preview} alt="Captured selfie preview" className="w-40 h-40 rounded-lg object-cover border" />
            ) : (
              <video ref={videoRef} playsInline muted className="w-40 h-40 rounded-lg object-cover border bg-muted" />
            )}
            <div className="flex flex-wrap gap-2">
              {!preview ? (
                <Button size="sm" onClick={capture}><Camera className="w-4 h-4 mr-1" /> Capture</Button>
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
            <ScanFace className="w-4 h-4 mr-1" /> {enrolledAt ? 'Re-enroll face' : 'Enroll my face'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default FaceEnrollment;
