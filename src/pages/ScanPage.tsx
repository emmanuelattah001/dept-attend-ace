import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import { Geolocation } from "@capacitor/geolocation";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

import {
  Camera,
  MapPin,
  RefreshCw,
  Check,
  AlertCircle,
  ShieldCheck,
  ScanLine,
} from "lucide-react";

const DEVICE_KEY = "attendance_device_id";

function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);

  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }

  return id;
}

type LocationData = {
  lat: number;
  lng: number;
  accuracy: number;
};

export default function ScanPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { toast } = useToast();

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const submittedRef = useRef(false);

  const [deviceId] = useState<string>(() => getDeviceId());

  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);

  const [faceChecked, setFaceChecked] = useState(false);
  const [hasFaceEnrollment, setHasFaceEnrollment] = useState(false);

  const [selfie, setSelfie] = useState<string | null>(null);
  const [selfieStream, setSelfieStream] = useState<MediaStream | null>(null);

  const [cameraActive, setCameraActive] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [location, setLocation] = useState<LocationData | null>(null);

  /*
   * --------------------------------------------------------------------------
   * Authentication / Face Enrollment Check
   * --------------------------------------------------------------------------
   */

  useEffect(() => {
    if (!user) {
      navigate("/auth?redirect=/scan");
    }
  }, [user, navigate]);

  useEffect(() => {
    let mounted = true;

    const checkFaceEnrollment = async () => {
      if (!user) {
        if (mounted) {
          setFaceChecked(true);
        }
        return;
      }

      try {
        const { data, error } = await supabase
          .from("students")
          .select("face_url")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) {
          console.error("Face enrollment check failed:", error);

          toast({
            title: "Unable to verify face enrollment",
            description:
              "Please try again or contact your department administrator.",
            variant: "destructive",
          });

          return;
        }

        if (mounted) {
          setHasFaceEnrollment(Boolean(data?.face_url));
          setFaceChecked(true);
        }
      } catch (error) {
        console.error("Face enrollment check failed:", error);

        if (mounted) {
          setFaceChecked(true);
        }
      }
    };

    checkFaceEnrollment();

    return () => {
      mounted = false;
    };
  }, [user, toast]);

  /*
   * --------------------------------------------------------------------------
   * Stop Selfie Camera
   * --------------------------------------------------------------------------
   */

  const stopSelfieCamera = () => {
    if (selfieStream) {
      selfieStream.getTracks().forEach((track) => track.stop());
    }

    setSelfieStream(null);
    setCameraActive(false);
  };

  /*
   * --------------------------------------------------------------------------
   * Capacitor Location
   * --------------------------------------------------------------------------
   */

  const getLocation = async (): Promise<LocationData | null> => {
    try {
      let permission = await Geolocation.checkPermissions();

      if (
        permission.location === "prompt" ||
        permission.location === "denied"
      ) {
        permission = await Geolocation.requestPermissions();
      }

      if (permission.location !== "granted") {
        toast({
          title: "Location permission required",
          description:
            "Location permission is required to verify classroom attendance.",
          variant: "destructive",
        });

        return null;
      }

      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });

      const locationData: LocationData = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };

      setLocation(locationData);

      return locationData;
    } catch (error) {
      console.error("Location reading failed:", error);

      toast({
        title: "Location unavailable",
        description:
          "Failed to read your device location. Ensure location is switched ON and try again.",
        variant: "destructive",
      });

      return null;
    }
  };

  /*
   * --------------------------------------------------------------------------
   * Selfie Camera
   * --------------------------------------------------------------------------
   */

  const startSelfieCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: {
            ideal: 1280,
          },
          height: {
            ideal: 720,
          },
        },
        audio: false,
      });

      setSelfieStream(stream);
      setCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (error) {
      console.error("Selfie camera error:", error);

      toast({
        title: "Camera unavailable",
        description:
          "Please allow camera access and make sure your camera is available.",
        variant: "destructive",
      });

      setCameraActive(false);
    }
  };

  /*
   * --------------------------------------------------------------------------
   * Capture Selfie
   * --------------------------------------------------------------------------
   */

  const captureSelfie = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      toast({
        title: "Camera not ready",
        description: "Please wait for the camera to initialize.",
        variant: "destructive",
      });

      return;
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      toast({
        title: "Capture failed",
        description: "Unable to capture the selfie.",
        variant: "destructive",
      });

      return;
    }

    context.drawImage(video, 0, 0, width, height);

    const image = canvas.toDataURL("image/jpeg", 0.85);

    setSelfie(image);
    stopSelfieCamera();
  };

  /*
   * --------------------------------------------------------------------------
   * Cancel Selfie
   * --------------------------------------------------------------------------
   */

  const cancelSelfie = () => {
    stopSelfieCamera();
    setSelfie(null);

    submittedRef.current = false;
  };

  /*
   * --------------------------------------------------------------------------
   * Submit Attendance Token
   * --------------------------------------------------------------------------
   */

  const submitToken = async (value?: string) => {
    const attendanceToken = (value ?? token).trim();

    if (!attendanceToken) {
      toast({
        title: "QR token required",
        description: "Scan the lecturer QR code or enter the token manually.",
        variant: "destructive",
      });

      return;
    }

    if (submittedRef.current) {
      return;
    }

    submittedRef.current = true;
    setLoading(true);

    try {
      /*
       * Mandatory face enrollment flow:
       *
       * A student must already have a face enrolled before attendance
       * scanning can proceed.
       *
       * Once enrolled, the student must provide a fresh selfie for
       * attendance verification.
       */

      if (hasFaceEnrollment && !selfie) {
        setToken(attendanceToken);

        setLoading(false);

        await startSelfieCamera();

        submittedRef.current = false;

        return;
      }

      /*
       * Get device location using Capacitor.
       */

      const loc = await getLocation();

      /*
       * Location is required for this attendance verification flow.
       */

      if (!loc) {
        setLoading(false);
        submittedRef.current = false;
        return;
      }

      /*
       * Prepare request for the Supabase Edge Function.
       */

      const body: Record<string, unknown> = {
        token: attendanceToken,
        device_id: deviceId,
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
      };

      if (selfie) {
        body.selfie = selfie;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session has expired. Please sign in again.");
      }

      const { data, error } = await supabase.functions.invoke("mark-via-qr", {
        body,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error("No response was received from the attendance server.");
      }

      if (data.success === false) {
        throw new Error(data.message || "Attendance verification failed.");
      }

      toast({
        title: "Attendance marked",
        description:
          data.message || "Your attendance has been successfully recorded.",
      });

      setToken("");
      setSelfie(null);
      setLocation(null);

      submittedRef.current = false;
    } catch (error) {
      console.error("Attendance submission failed:", error);

      const message =
        error instanceof Error
          ? error.message
          : "Unable to mark attendance. Please try again.";

      toast({
        title: "Attendance failed",
        description: message,
        variant: "destructive",
      });

      submittedRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  /*
   * --------------------------------------------------------------------------
   * Confirm Selfie
   * --------------------------------------------------------------------------
   */

  const confirmSelfieAndSubmit = async () => {
    if (!selfie) {
      toast({
        title: "Selfie required",
        description: "Please capture your selfie before continuing.",
        variant: "destructive",
      });

      return;
    }

    submittedRef.current = false;

    await submitToken(token);
  };

  /*
   * --------------------------------------------------------------------------
   * QR Scan Result
   * --------------------------------------------------------------------------
   */

  const handleScanResult = async (decodedText: string) => {
    const scannedToken = decodedText.trim();

    if (!scannedToken) {
      return;
    }

    setToken(scannedToken);

    await stopScanner();

    await submitToken(scannedToken);
  };

  /*
   * --------------------------------------------------------------------------
   * QR Scanner
   * --------------------------------------------------------------------------
   */

  const startScanner = async () => {
    try {
      if (scannerRef.current) {
        await stopScanner();
      }

      const scanner = new Html5Qrcode("qr-reader");

      scannerRef.current = scanner;

      await scanner.start(
        {
          facingMode: "environment",
        },
        {
          fps: 10,
          qrbox: {
            width: 250,
            height: 250,
          },
        },
        handleScanResult,
        () => {
          // Ignore individual QR scan failures while scanning.
        },
      );
    } catch (error) {
      console.error("QR scanner error:", error);

      toast({
        title: "Scanner unavailable",
        description:
          "Unable to start the QR scanner. Check camera permissions and try again.",
        variant: "destructive",
      });
    }
  };

  /*
   * --------------------------------------------------------------------------
   * Stop QR Scanner
   * --------------------------------------------------------------------------
   */

  const stopScanner = async () => {
    if (!scannerRef.current) {
      return;
    }

    try {
      if (scannerRef.current.isScanning) {
        await scannerRef.current.stop();
      }
    } catch (error) {
      console.error("Failed to stop QR scanner:", error);
    }

    try {
      await scannerRef.current.clear();
    } catch (error) {
      console.error("Failed to clear QR scanner:", error);
    }

    scannerRef.current = null;
  };

  /*
   * --------------------------------------------------------------------------
   * Auto-submit token from URL
   * --------------------------------------------------------------------------
   */

  useEffect(() => {
    if (user && faceChecked && hasFaceEnrollment && !loading) {
      const urlToken = searchParams.get("token");

      if (urlToken) {
        setToken(urlToken);
        void submitToken(urlToken);
      }
    }
  }, [user, faceChecked, hasFaceEnrollment, loading, searchParams, submitToken]);

  /*
   * --------------------------------------------------------------------------
   * Cleanup
   * --------------------------------------------------------------------------
   */

  useEffect(() => {
    return () => {
      void stopScanner();

      if (selfieStream) {
        selfieStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [selfieStream]);

  /*
   * --------------------------------------------------------------------------
   * Loading State
   * --------------------------------------------------------------------------
   */

  if (!user || !faceChecked) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="h-8 w-8 animate-spin" />
          <p className="text-sm text-muted-foreground">
            Checking your attendance verification setup...
          </p>
        </div>
      </div>
    );
  }

  /*
   * --------------------------------------------------------------------------
   * Mandatory Face Enrollment
   * --------------------------------------------------------------------------
   */

  if (!hasFaceEnrollment) {
    return (
      <div className="container mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center px-4">
        <Card className="w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>

            <CardTitle className="text-2xl">Face Enrollment Required</CardTitle>
          </CardHeader>

          <CardContent className="space-y-6 text-center">
            <p className="text-muted-foreground">
              You must complete your face enrollment before you can scan a QR
              code and record attendance.
            </p>

            <div className="rounded-lg border bg-muted/50 p-4 text-left">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />

                <div>
                  <p className="font-medium">Why is this required?</p>

                  <p className="mt-1 text-sm text-muted-foreground">
                    Your enrolled face is used as part of the attendance
                    verification process to help confirm that the student
                    recording attendance is the registered student.
                  </p>
                </div>
              </div>
            </div>

            <Button className="w-full" onClick={() => navigate("/")}>
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  /*
   * --------------------------------------------------------------------------
   * Selfie Verification UI
   * --------------------------------------------------------------------------
   */

  if (cameraActive || selfie) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Face Verification
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Take a clear selfie. Make sure your face is visible, centered, and
              well lit.
            </p>

            {cameraActive && (
              <div className="overflow-hidden rounded-xl border bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="aspect-video w-full object-cover"
                />
              </div>
            )}

            {selfie && !cameraActive && (
              <div className="overflow-hidden rounded-xl border">
                <img
                  src={selfie}
                  alt="Captured selfie"
                  className="aspect-video w-full object-cover"
                />
              </div>
            )}

            <canvas ref={canvasRef} className="hidden" />

            {cameraActive ? (
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={cancelSelfie}
                  disabled={loading}
                >
                  Cancel
                </Button>

                <Button
                  className="flex-1"
                  onClick={captureSelfie}
                  disabled={loading}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Capture Selfie
                </Button>
              </div>
            ) : selfie ? (
              <div className="space-y-3">
                <Button
                  className="w-full"
                  onClick={confirmSelfieAndSubmit}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Verifying Attendance...
                    </>
                  ) : (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Confirm & Mark Attendance
                    </>
                  )}
                </Button>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setSelfie(null);
                    void startSelfieCamera();
                  }}
                  disabled={loading}
                >
                  Retake Selfie
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  /*
   * --------------------------------------------------------------------------
   * Main Scanner UI
   * --------------------------------------------------------------------------
   */

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <ScanLine className="h-7 w-7 text-primary" />
        </div>

        <h1 className="text-2xl font-bold">Scan Attendance QR</h1>

        <p className="mt-2 text-sm text-muted-foreground">
          Scan the QR code displayed by your lecturer to record your attendance.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5" />
            QR Scanner
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          <div
            id="qr-reader"
            className="min-h-[280px] overflow-hidden rounded-xl border bg-muted/30"
          />

          <Button
            className="w-full"
            onClick={() => void startScanner()}
            disabled={loading}
          >
            <ScanLine className="mr-2 h-4 w-4" />
            Start QR Scanner
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>

            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-3 text-muted-foreground">
                Or enter token manually
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <Input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Enter attendance token"
              disabled={loading}
            />

            <Button
              className="w-full"
              onClick={() => void submitToken()}
              disabled={loading || !token.trim()}
            >
              {loading ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Continue
                </>
              )}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                <span className="text-sm font-medium">Face Verification</span>
              </div>

              <p className="mt-1 text-xs text-muted-foreground">
                Your enrolled face is verified during attendance.
              </p>
            </div>

            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <span className="text-sm font-medium">
                  Location Verification
                </span>
              </div>

              <p className="mt-1 text-xs text-muted-foreground">
                Your device location is captured during verification.
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>
              <strong>Device ID:</strong>{" "}
              <span className="break-all">{deviceId}</span>
            </p>

            {location && (
              <p className="mt-1">
                <strong>Location accuracy:</strong>{" "}
                {Math.round(location.accuracy)}m
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
