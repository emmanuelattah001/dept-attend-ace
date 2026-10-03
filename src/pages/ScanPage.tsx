import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import {
  FaceDetector,
  FilesetResolver,
  type Detection,
} from "@mediapipe/tasks-vision";
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
  UserRoundCheck,
  CircleAlert,
} from "lucide-react";

const DEVICE_KEY = "attendance_device_id";

const FACE_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm";

const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

const REQUIRED_STABLE_FRAMES = 8;

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

type FaceStatus =
  | "loading"
  | "searching"
  | "detected"
  | "move-closer"
  | "move-away"
  | "center"
  | "hold"
  | "capturing"
  | "captured"
  | "error";

export default function ScanPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { toast } = useToast();

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const submittedRef = useRef(false);
  const tokenRef = useRef("");
  const urlTokenHandledRef = useRef<string | null>(null);
  const qrStartingRef = useRef(false);
  const faceStartingRef = useRef(false);
  const cameraRequestIdRef = useRef(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const selfieStreamRef = useRef<MediaStream | null>(null);
  const faceDetectorRef = useRef<FaceDetector | null>(null);

  const animationFrameRef = useRef<number | null>(null);
  const stableFramesRef = useRef(0);
  const autoCaptureRef = useRef(false);

  const [deviceId] = useState<string>(() => getDeviceId());

  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);

  const [faceChecked, setFaceChecked] = useState(false);
  const [hasFaceEnrollment, setHasFaceEnrollment] = useState(false);

  const [selfie, setSelfie] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);

  const [faceStatus, setFaceStatus] = useState<FaceStatus>("searching");
  const [faceMessage, setFaceMessage] = useState("Looking for your face...");

  const [stableProgress, setStableProgress] = useState(0);

  const [location, setLocation] = useState<LocationData | null>(null);

  /*
   * --------------------------------------------------------------------------
   * Authentication / Face Enrollment
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
          .eq("auth_user_id", user.id)
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

    void checkFaceEnrollment();

    return () => {
      mounted = false;
    };
  }, [user, toast]);

  /*
   * --------------------------------------------------------------------------
   * Face Detector
   * --------------------------------------------------------------------------
   */

  const initializeFaceDetector = async () => {
    if (faceDetectorRef.current) {
      return faceDetectorRef.current;
    }

    const vision = await FilesetResolver.forVisionTasks(FACE_WASM_URL);

    const createDetector = (delegate: "GPU" | "CPU") =>
      FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: FACE_MODEL_URL,
          delegate,
        },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.65,
      });

    // GPU acceleration is not available in some Android WebViews. Falling back
    // to CPU keeps detection functional instead of failing before the camera
    // can start.
    let detector: FaceDetector;
    try {
      detector = await createDetector("GPU");
    } catch (gpuError) {
      console.warn(
        "GPU face detector unavailable; falling back to CPU detection.",
        gpuError,
      );
      detector = await createDetector("CPU");
    }

    faceDetectorRef.current = detector;

    return detector;
  };

  /*
   * --------------------------------------------------------------------------
   * Stop Face Detection Loop
   * --------------------------------------------------------------------------
   */

  const stopFaceDetection = () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    stableFramesRef.current = 0;
    setStableProgress(0);
  };

  /*
   * --------------------------------------------------------------------------
   * Stop Selfie Camera
   * --------------------------------------------------------------------------
   */

  const stopSelfieCamera = useCallback(() => {
    // Invalidate any pending model/camera setup before stopping the stream.
    cameraRequestIdRef.current += 1;
    faceStartingRef.current = false;
    stopFaceDetection();

    const stream = selfieStreamRef.current;

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    selfieStreamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
  }, []);

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
   * Capture Current Video Frame
   * --------------------------------------------------------------------------
   */

  const captureCurrentFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      throw new Error("Camera is not ready.");
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Unable to capture camera frame.");
    }

    context.drawImage(video, 0, 0, width, height);

    return canvas.toDataURL("image/jpeg", 0.88);
  };

  /*
   * --------------------------------------------------------------------------
   * Automatic Face Capture
   * --------------------------------------------------------------------------
   */

  const autoCaptureFace = async () => {
    if (autoCaptureRef.current || !selfieStreamRef.current) {
      return;
    }

    autoCaptureRef.current = true;

    stopFaceDetection();

    setFaceStatus("capturing");
    setFaceMessage("Face looks good — capturing...");
    setStableProgress(REQUIRED_STABLE_FRAMES);

    try {
      const image = captureCurrentFrame();

      setSelfie(image);

      setFaceStatus("captured");
      setFaceMessage("Face captured. Verifying attendance...");

      stopSelfieCamera();

      /*
       * Automatically continue into attendance verification.
       */
      submittedRef.current = false;

      // React state updates are asynchronous. Pass the frame directly so the
      // attendance request cannot see the previous `selfie` value and reopen
      // the camera instead of submitting the captured image.
      await submitToken(tokenRef.current, image);
    } catch (error) {
      console.error("Automatic face capture failed:", error);

      autoCaptureRef.current = false;
      setFaceStatus("error");
      setFaceMessage("Capture failed. Please try again.");

      toast({
        title: "Face capture failed",
        description:
          "We could not capture a clear image. Please position your face and try again.",
        variant: "destructive",
      });
    }
  };

  /*
   * --------------------------------------------------------------------------
   * Face Quality Evaluation
   * --------------------------------------------------------------------------
   */

  const evaluateFace = (
    detection: Detection,
    width: number,
    height: number,
  ) => {
    const box = detection.boundingBox;

    if (!box) {
      return {
        valid: false,
        status: "searching" as FaceStatus,
        message: "Looking for your face...",
      };
    }

    const faceWidth = box.width;
    const faceHeight = box.height;

    const centerX = box.originX + faceWidth / 2;
    const centerY = box.originY + faceHeight / 2;

    const normalizedCenterX = centerX / width;
    const normalizedCenterY = centerY / height;

    const faceArea = (faceWidth * faceHeight) / (width * height);

    /*
     * The detector's bounding box is smaller than the visible face guide.
     * A 12% minimum forced users on common phone cameras to move too close,
     * which made the preview appear to flicker between detection states.
     */
    if (faceArea < 0.06) {
      return {
        valid: false,
        status: "move-closer" as FaceStatus,
        message: "Move a little closer",
      };
    }

    if (faceArea > 0.55) {
      return {
        valid: false,
        status: "move-away" as FaceStatus,
        message: "Move a little farther away",
      };
    }

    /*
     * Keep face reasonably centered.
     */
    if (
      normalizedCenterX < 0.28 ||
      normalizedCenterX > 0.72 ||
      normalizedCenterY < 0.24 ||
      normalizedCenterY > 0.76
    ) {
      return {
        valid: false,
        status: "center" as FaceStatus,
        message: "Center your face inside the frame",
      };
    }

    return {
      valid: true,
      status: "hold" as FaceStatus,
      message: "Hold still...",
    };
  };

  /*
   * --------------------------------------------------------------------------
   * Live Face Detection Loop
   * --------------------------------------------------------------------------
   */

  const runFaceDetection = () => {
    const video = videoRef.current;
    const detector = faceDetectorRef.current;

    if (!video || !detector || !selfieStreamRef.current || autoCaptureRef.current) {
      return;
    }

    if (video.readyState < 2) {
      animationFrameRef.current = requestAnimationFrame(runFaceDetection);
      return;
    }

    try {
      const result = detector.detectForVideo(video, performance.now());

      const detections = result.detections ?? [];

      /*
       * Exactly one face is required.
       */
      if (detections.length === 0) {
        stableFramesRef.current = 0;
        setStableProgress(0);
        setFaceStatus("searching");
        setFaceMessage("Looking for your face...");
      } else if (detections.length > 1) {
        stableFramesRef.current = 0;
        setStableProgress(0);
        setFaceStatus("error");
        setFaceMessage("Only one face should be visible");
      } else {
        const quality = evaluateFace(
          detections[0],
          video.videoWidth,
          video.videoHeight,
        );

        setFaceStatus(quality.status);
        setFaceMessage(quality.message);

        if (quality.valid) {
          stableFramesRef.current += 1;

          const progress = Math.min(
            100,
            Math.round(
              (stableFramesRef.current / REQUIRED_STABLE_FRAMES) * 100,
            ),
          );

          setStableProgress(progress);

          if (stableFramesRef.current >= REQUIRED_STABLE_FRAMES) {
            void autoCaptureFace();
            return;
          }
        } else {
          stableFramesRef.current = 0;
          setStableProgress(0);
        }
      }
    } catch (error) {
      console.error("Live face detection error:", error);
      stableFramesRef.current = 0;
      setStableProgress(0);
      setFaceStatus("error");
      setFaceMessage("Face detection paused. Restart verification to try again.");
      return;
    }

    animationFrameRef.current = requestAnimationFrame(runFaceDetection);
  };

  /*
   * --------------------------------------------------------------------------
   * Start Selfie Camera
   * --------------------------------------------------------------------------
   */

  const startSelfieCamera = async () => {
    if (faceStartingRef.current || selfieStreamRef.current) {
      return;
    }

    faceStartingRef.current = true;
    const requestId = ++cameraRequestIdRef.current;

    try {
      // A manual token can be submitted while the QR camera is still open.
      // Release it before requesting the front camera to avoid camera-device
      // contention, especially in Android WebViews.
      await stopScanner();

      autoCaptureRef.current = false;
      stableFramesRef.current = 0;

      setStableProgress(0);
      setFaceStatus("loading");
      setFaceMessage("Preparing face verification...");
      setSelfie(null);

      const detector = await initializeFaceDetector();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: {
            ideal: 1280,
          },
          height: {
            ideal: 720,
          },
          frameRate: {
            ideal: 30,
            max: 30,
          },
        },
        audio: false,
      });

      if (requestId !== cameraRequestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      selfieStreamRef.current = stream;

      setCameraActive(true);

      /*
       * Wait for React to attach the stream to the video element.
       */
      const attachCameraAndStartDetection = async () => {
        if (
          requestId !== cameraRequestIdRef.current ||
          selfieStreamRef.current !== stream
        ) {
          return;
        }

        const video = videoRef.current;

        if (!video) {
          // The video only mounts after `cameraActive` is rendered. Retrying
          // avoids a timing race where the first animation frame runs before
          // React has attached the ref, which previously left detection idle.
          animationFrameRef.current = requestAnimationFrame(() => {
            void attachCameraAndStartDetection();
          });
          return;
        }

        if (video.srcObject !== stream) video.srcObject = stream;

        try {
          await video.play();
        } catch (e) {
          if ((e as Error)?.name !== "AbortError") throw e;
        }

        if (detector) {
          setFaceStatus("searching");
          setFaceMessage("Looking for your face...");

          animationFrameRef.current = requestAnimationFrame(runFaceDetection);
        }
      };

      requestAnimationFrame(() => {
        void attachCameraAndStartDetection();
      });
    } catch (error) {
      if (requestId !== cameraRequestIdRef.current) {
        return;
      }

      console.error("Selfie camera error:", error);

      stopSelfieCamera();

      setFaceStatus("error");
      setFaceMessage("Camera could not be started.");

      toast({
        title: "Camera unavailable",
        description:
          "Please allow camera access and make sure your camera is available.",
        variant: "destructive",
      });
    } finally {
      if (requestId === cameraRequestIdRef.current) {
        faceStartingRef.current = false;
      }
    }
  };

  /*
   * --------------------------------------------------------------------------
   * Cancel Face Verification
   * --------------------------------------------------------------------------
   */

  const cancelSelfie = () => {
    stopSelfieCamera();

    setSelfie(null);
    setFaceStatus("searching");
    setFaceMessage("Looking for your face...");
    setStableProgress(0);

    submittedRef.current = false;
    autoCaptureRef.current = false;
  };

  /*
   * --------------------------------------------------------------------------
   * Submit Attendance Token
   * --------------------------------------------------------------------------
   */

  const submitToken = async (value?: string, capturedSelfie?: string) => {
    const attendanceToken = (value ?? tokenRef.current).trim();
    const selfieForSubmission = capturedSelfie ?? selfie;

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

    /*
     * Face enrollment requires a fresh live selfie.
     */
    if (hasFaceEnrollment && !selfieForSubmission) {
      setToken(attendanceToken);
      tokenRef.current = attendanceToken;
      setLoading(false);

      await startSelfieCamera();

      return;
    }

    submittedRef.current = true;
    setLoading(true);

    try {
      /*
       * Get native device location.
       */
      const loc = await getLocation();

      if (!loc) {
        setLoading(false);
        submittedRef.current = false;
        return;
      }

      const body: Record<string, unknown> = {
        token: attendanceToken,
        device_id: deviceId,
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
      };

      if (selfieForSubmission) {
        body.selfie = selfieForSubmission;
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
      tokenRef.current = "";
      setSelfie(null);
      setLocation(null);

      submittedRef.current = false;
      autoCaptureRef.current = false;

      /*
       * Give the user a fresh scanner after successful attendance.
       */
      setFaceStatus("searching");
      setFaceMessage("Ready for the next attendance scan.");
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

      /*
       * Allow another attempt.
       */
      setSelfie(null);
      submittedRef.current = false;
      autoCaptureRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  /*
   * --------------------------------------------------------------------------
   * QR Scan Result
   * --------------------------------------------------------------------------
   */

  const handleScanResult = async (decodedText: string) => {
    const scannedToken = decodedText.trim();

    if (!scannedToken || submittedRef.current) {
      return;
    }

    setToken(scannedToken);
    tokenRef.current = scannedToken;

    await stopScanner();

    await submitToken(scannedToken);
  };

  /*
   * --------------------------------------------------------------------------
   * QR Scanner
   * --------------------------------------------------------------------------
   */

  const startScanner = async () => {
    if (qrStartingRef.current || scannerRef.current?.isScanning) {
      return;
    }

    qrStartingRef.current = true;

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
          // Ignore individual QR scan failures.
        },
      );
    } catch (error) {
      console.error("QR scanner error:", error);

      await stopScanner();

      toast({
        title: "Scanner unavailable",
        description:
          "Unable to start the QR scanner. Check camera permissions and try again.",
        variant: "destructive",
      });
    } finally {
      qrStartingRef.current = false;
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
   * Auto-submit Token From URL
   * --------------------------------------------------------------------------
   */

  useEffect(() => {
    if (user && faceChecked && hasFaceEnrollment && !loading && !cameraActive) {
      const urlToken = searchParams.get("token");

      if (urlToken) {
        if (urlTokenHandledRef.current === urlToken) {
          return;
        }

        urlTokenHandledRef.current = urlToken;
        setToken(urlToken);
        tokenRef.current = urlToken;
        void submitToken(urlToken);
      }
    }
  }, [
    user,
    faceChecked,
    hasFaceEnrollment,
    loading,
    cameraActive,
    searchParams,
  ]);

  /*
   * --------------------------------------------------------------------------
   * Cleanup
   * --------------------------------------------------------------------------
   */

  useEffect(() => {
    return () => {
      void stopScanner();

      stopFaceDetection();

      const stream = selfieStreamRef.current;

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      selfieStreamRef.current = null;

      if (faceDetectorRef.current) {
        faceDetectorRef.current.close();
        faceDetectorRef.current = null;
      }
    };
  }, []);

  /*
   * --------------------------------------------------------------------------
   * Loading
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
   * Face Enrollment Required
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
   * Live Face Verification UI
   * --------------------------------------------------------------------------
   */

  if (cameraActive || selfie) {
    const statusIsGood =
      faceStatus === "detected" ||
      faceStatus === "hold" ||
      faceStatus === "captured";

    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Live Face Verification
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Position your face inside the guide. Capture happens
                automatically.
              </p>
            </div>

            {cameraActive && (
              <div className="relative overflow-hidden rounded-2xl border bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="aspect-[4/3] w-full object-cover"
                  style={{
                    transform: "scaleX(-1)",
                  }}
                />

                {/* Face guide */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div
                    className={`h-[62%] w-[52%] rounded-[45%] border-4 transition-all ${
                      statusIsGood
                        ? "border-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.45)]"
                        : "border-white/70"
                    }`}
                  />
                </div>

                {/* Live status */}
                <div className="absolute bottom-4 left-1/2 w-[90%] -translate-x-1/2">
                  <div className="rounded-xl bg-black/70 p-3 text-center text-white backdrop-blur">
                    <div className="flex items-center justify-center gap-2">
                      {statusIsGood ? (
                        <UserRoundCheck className="h-5 w-5 text-emerald-400" />
                      ) : faceStatus === "error" ? (
                        <CircleAlert className="h-5 w-5 text-red-400" />
                      ) : (
                        <ScanLine className="h-5 w-5 animate-pulse" />
                      )}

                      <span className="text-sm font-medium">{faceMessage}</span>
                    </div>

                    {stableProgress > 0 && stableProgress < 100 && (
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/20">
                        <div
                          className="h-full rounded-full bg-emerald-400 transition-all duration-100"
                          style={{
                            width: `${stableProgress}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {selfie && !cameraActive && (
              <div className="overflow-hidden rounded-xl border">
                <img
                  src={selfie}
                  alt="Automatically captured face"
                  className="aspect-video w-full object-cover"
                />
              </div>
            )}

            <canvas ref={canvasRef} className="hidden" />

            {cameraActive && (
              <div className="rounded-xl border bg-muted/40 p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex items-center gap-2 text-sm">
                    <UserRoundCheck className="h-4 w-4" />
                    <span>One face</span>
                  </div>

                  <div className="flex items-center gap-2 text-sm">
                    <ShieldCheck className="h-4 w-4" />
                    <span>Face position</span>
                  </div>

                  <div className="flex items-center gap-2 text-sm">
                    <Camera className="h-4 w-4" />
                    <span>Live camera</span>
                  </div>
                </div>
              </div>
            )}

            {loading && (
              <div className="rounded-xl border bg-muted/40 p-4 text-center">
                <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />

                <p className="text-sm font-medium">Verifying attendance...</p>

                <p className="mt-1 text-xs text-muted-foreground">
                  Checking your face, location and attendance session.
                </p>
              </div>
            )}

            {!loading && cameraActive && (
              <div className="grid gap-3 sm:grid-cols-2">
                {faceStatus === "error" && (
                  <Button
                    className="w-full"
                    onClick={() => {
                      stopSelfieCamera();
                      void startSelfieCamera();
                    }}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" /> Try Again
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={cancelSelfie}
                >
                  Cancel Verification
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  /*
   * --------------------------------------------------------------------------
   * Main QR Scanner
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
              onChange={(event) => {
                setToken(event.target.value);
                tokenRef.current = event.target.value;
              }}
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
                <span className="text-sm font-medium">
                  Live Face Verification
                </span>
              </div>

              <p className="mt-1 text-xs text-muted-foreground">
                Your face is detected live and automatically captured when
                positioned correctly.
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
