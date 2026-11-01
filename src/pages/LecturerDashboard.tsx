import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import {
  Activity,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  QrCode,
  RefreshCw,
  Users,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type StaffRole = "lecturer" | "course_rep";

type AssignedCourse = {
  id: string;
  code: string;
  name: string;
  department_id: string | null;
};

type AttendanceRow = {
  id: string;
  course_id: string;
  date: string;
  status: string;
  created_at: string;
  verified_via: string;
};

type ActiveSession = {
  id: string;
  token: string;
  course_id: string;
  date: string;
  expires_at: string;
  latitude: number | null;
  longitude: number | null;
  radius_m: number | null;
};

const today = () => new Date().toISOString().slice(0, 10);

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}

export default function LecturerDashboard({
  staffRole = "lecturer",
}: {
  staffRole?: StaffRole;
}) {
  const { user, profile } = useAuth();
  const [courses, setCourses] = useState<AssignedCourse[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [sessionDate, setSessionDate] = useState(today);
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [radiusMeters, setRadiusMeters] = useState(100);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [rotatingCode, setRotatingCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const loadDashboard = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const { data: assignments, error: assignmentError } = await supabase
        .from("course_staff")
        .select("course_id, department_id")
        .eq("user_id", user.id)
        .eq("staff_role", staffRole);
      if (assignmentError) throw assignmentError;

      const courseIds = [...new Set((assignments ?? []).map((row) => row.course_id))];
      if (courseIds.length === 0) {
        setCourses([]);
        setAttendance([]);
        setActiveSession(null);
        setSelectedCourseId("");
        return;
      }

      const [courseResult, attendanceResult, sessionResult] = await Promise.all([
        supabase
          .from("courses")
          .select("id, code, name, department_id")
          .in("id", courseIds)
          .order("code"),
        supabase
          .from("attendance")
          .select("id, course_id, date, status, created_at, verified_via")
          .in("course_id", courseIds)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("attendance_sessions")
          .select("id, token, course_id, date, expires_at, latitude, longitude, radius_m")
          .eq("created_by", user.id)
          .in("course_id", courseIds)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1),
      ]);

      const error =
        courseResult.error ?? attendanceResult.error ?? sessionResult.error;
      if (error) throw error;

      const allowedDepartmentIds = new Set(
        assignments?.map((row) => row.department_id).filter(Boolean),
      );
      const assignedCourses = (courseResult.data ?? []).filter(
        (course) =>
          course.department_id &&
          allowedDepartmentIds.has(course.department_id) &&
          (!profile?.department_id ||
            course.department_id === profile.department_id),
      );
      setCourses(assignedCourses);
      setAttendance(
        (attendanceResult.data ?? []).filter((row) =>
          assignedCourses.some((course) => course.id === row.course_id),
        ),
      );

      const session = (sessionResult.data ?? []).find((row) =>
        assignedCourses.some((course) => course.id === row.course_id),
      );
      setActiveSession(session ?? null);
      setSelectedCourseId((current) =>
        assignedCourses.some((course) => course.id === current)
          ? current
          : assignedCourses[0]?.id ?? "",
      );
    } catch (error) {
      console.error("Lecturer dashboard load failed:", error);
      setLoadError(
        error instanceof Error ? error.message : "Unable to load your courses.",
      );
    } finally {
      setLoading(false);
    }
  }, [profile?.department_id, staffRole, user]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!activeSession) {
      setRotatingCode(null);
      setSecondsLeft(null);
      return;
    }

    let cancelled = false;
    const fetchCode = async () => {
      const { data, error } = await supabase.functions.invoke("session-token", {
        body: { token: activeSession.token },
      });
      if (cancelled) return;
      if (error || data?.error) {
        console.error("Session QR refresh failed:", error ?? data.error);
        setRotatingCode(null);
        return;
      }
      setRotatingCode(data?.code ?? null);
      setSecondsLeft(
        typeof data?.seconds_left === "number" ? data.seconds_left : null,
      );
    };

    void fetchCode();
    const codeTimer = window.setInterval(() => void fetchCode(), 5000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(codeTimer);
      window.clearInterval(clockTimer);
    };
  }, [activeSession]);

  const courseStats = useMemo(() => {
    return courses.map((course) => {
      const rows = attendance.filter((row) => row.course_id === course.id);
      const present = rows.filter((row) => row.status === "present").length;
      return { ...course, total: rows.length, present };
    });
  }, [attendance, courses]);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId);
  const activeCourse = courses.find(
    (course) => course.id === activeSession?.course_id,
  );
  const recentAttendance = attendance.slice(0, 8);
  const presentCount = attendance.filter((row) => row.status === "present").length;
  const activeRemaining = activeSession
    ? Math.max(0, Math.ceil((new Date(activeSession.expires_at).getTime() - now) / 1000))
    : 0;
  const liveSession = Boolean(activeSession && activeRemaining > 0);
  const scanUrl = activeSession
    ? `${window.location.origin}/scan?${new URLSearchParams({
        token: activeSession.token,
        ...(rotatingCode ? { c: rotatingCode } : {}),
      }).toString()}`
    : "";

  const captureLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Location is not available in this browser.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        toast.success("Class location captured.");
        setBusy(false);
      },
      (error) => {
        toast.error(`Could not get location: ${error.message}`);
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const startSession = async () => {
    if (!user || !selectedCourse || !profile?.department_id) {
      toast.error("Your lecturer profile or course assignment is incomplete.");
      return;
    }
    if (selectedCourse.department_id !== profile.department_id) {
      toast.error("This course is outside your assigned department.");
      return;
    }
    if (!location) {
      toast.error("Capture the classroom location before starting the session.");
      return;
    }
    setBusy(true);
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const expiresAt = new Date(Date.now() + durationMinutes * 60_000).toISOString();
      const { data, error } = await supabase
        .from("attendance_sessions")
        .insert({
          course_id: selectedCourse.id,
          department_id: selectedCourse.department_id,
          date: sessionDate,
          token,
          expires_at: expiresAt,
          created_by: user.id,
          latitude: location.latitude,
          longitude: location.longitude,
          radius_m: radiusMeters,
          rotating: true,
        })
        .select("id, token, course_id, date, expires_at, latitude, longitude, radius_m")
        .single();
      if (error) throw error;
      setActiveSession(data);
      toast.success("Attendance session started.");
      await loadDashboard();
    } catch (error) {
      console.error("Unable to start lecturer session:", error);
      toast.error(error instanceof Error ? error.message : "Could not start session.");
    } finally {
      setBusy(false);
    }
  };

  const endSession = async () => {
    if (!activeSession || !user) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("attendance_sessions")
        .update({ expires_at: new Date().toISOString() })
        .eq("id", activeSession.id)
        .eq("created_by", user.id);
      if (error) throw error;
      setActiveSession(null);
      toast.success("Attendance session ended.");
      await loadDashboard();
    } catch (error) {
      console.error("Unable to end lecturer session:", error);
      toast.error(error instanceof Error ? error.message : "Could not end session.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-heading font-bold">
              {staffRole === "lecturer" ? "Lecturer Dashboard" : "Course Rep Dashboard"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Manage only the courses assigned to your staff account.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void loadDashboard()}
            disabled={loading || busy}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {loadError && (
          <div role="alert" className="rounded-md border border-destructive p-4 text-sm text-destructive">
            {loadError}
          </div>
        )}

        {!profile?.department_id && !loading && (
          <div role="alert" className="rounded-md border border-destructive p-4 text-sm">
            Your account has no department assignment. Contact your department administrator.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardContent className="flex items-center gap-3 pt-6"><BookOpen className="h-5 w-5 text-primary" /><div><p className="text-2xl font-semibold">{courses.length}</p><p className="text-sm text-muted-foreground">Assigned courses</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 pt-6"><Activity className="h-5 w-5 text-primary" /><div><p className="text-2xl font-semibold">{attendance.length}</p><p className="text-sm text-muted-foreground">Attendance records</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 pt-6"><CheckCircle2 className="h-5 w-5 text-emerald-600" /><div><p className="text-2xl font-semibold">{presentCount}</p><p className="text-sm text-muted-foreground">Present records</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 pt-6"><QrCode className="h-5 w-5 text-primary" /><div><p className="text-2xl font-semibold">{liveSession ? 1 : 0}</p><p className="text-sm text-muted-foreground">Live sessions</p></div></CardContent></Card>
        </div>

        {loading ? (
          <div className="flex items-center justify-center rounded-lg border p-10 text-muted-foreground">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading assigned courses…
          </div>
        ) : courses.length === 0 ? (
          <Card>
            <CardContent className="space-y-2 py-10 text-center">
              <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
              <h3 className="font-semibold">No courses assigned yet</h3>
              <p className="text-sm text-muted-foreground">
                Ask your department administrator to assign courses to your lecturer account.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <Card>
                <CardHeader><CardTitle>My courses</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {courseStats.map((course) => (
                    <div key={course.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                      <div>
                        <p className="font-semibold">{course.code} · {course.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {course.total} recorded attendance entries · {course.present} present
                        </p>
                      </div>
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                        Assigned
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Start an attendance session</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="lecturer-course">Course</label>
                    <Select value={selectedCourseId} onValueChange={setSelectedCourseId} disabled={liveSession}>
                      <SelectTrigger id="lecturer-course"><SelectValue placeholder="Choose an assigned course" /></SelectTrigger>
                      <SelectContent>
                        {courses.map((course) => (
                          <SelectItem key={course.id} value={course.id}>{course.code} · {course.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium" htmlFor="lecturer-date">Class date</label>
                      <Input id="lecturer-date" type="date" value={sessionDate} onChange={(event) => setSessionDate(event.target.value)} disabled={liveSession} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium" htmlFor="lecturer-duration">Duration (minutes)</label>
                      <Input id="lecturer-duration" type="number" min={1} max={180} value={durationMinutes} onChange={(event) => setDurationMinutes(Math.min(180, Math.max(1, Number(event.target.value) || 1)))} disabled={liveSession} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="lecturer-radius">Allowed scan radius (metres)</label>
                    <Input id="lecturer-radius" type="number" min={10} max={5000} value={radiusMeters} onChange={(event) => setRadiusMeters(Math.min(5000, Math.max(10, Number(event.target.value) || 10)))} disabled={liveSession} />
                  </div>
                  <Button variant="outline" className="w-full" onClick={captureLocation} disabled={busy || liveSession}>
                    <MapPin className="mr-2 h-4 w-4" />
                    {location ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : "Capture classroom location"}
                  </Button>
                  {!liveSession && (
                    <Button className="w-full" onClick={() => void startSession()} disabled={busy || !selectedCourseId || !location || !sessionDate}>
                      {busy ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}
                      Start attendance session
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    The student scanner proceeds directly from a valid QR scan to face verification.
                  </p>
                </CardContent>
              </Card>
            </div>

            {liveSession && activeSession && activeCourse && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" />Live session · {activeCourse.code}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
                  <div className="flex flex-col items-center gap-3 rounded-xl bg-muted/40 p-5 text-center">
                    <div className="rounded-lg bg-white p-3">
                      <QRCodeCanvas value={scanUrl} size={220} includeMargin />
                    </div>
                    <p className="text-sm">{activeCourse.name}</p>
                    <p className="flex items-center gap-2 font-mono text-lg font-bold">
                      <Clock3 className="h-4 w-4" />
                      {Math.floor(activeRemaining / 60).toString().padStart(2, "0")}:{(activeRemaining % 60).toString().padStart(2, "0")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Rotating code: <span className="font-mono font-bold tracking-widest">{rotatingCode ?? "Refreshing…"}</span>
                      {secondsLeft !== null && ` · changes in ${secondsLeft}s`}
                    </p>
                    <Button variant="destructive" onClick={() => void endSession()} disabled={busy}>
                      <XCircle className="mr-2 h-4 w-4" /> End session
                    </Button>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm"><CalendarDays className="h-4 w-4 text-muted-foreground" />Date: {formatDate(activeSession.date)}</div>
                    <div className="flex items-center gap-2 text-sm"><MapPin className="h-4 w-4 text-muted-foreground" />Radius: {activeSession.radius_m ?? radiusMeters} metres</div>
                    <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                      Keep this QR visible during class. Students must scan it while the session is live and be within the location radius.
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Recent attendance</CardTitle></CardHeader>
              <CardContent>
                {recentAttendance.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No attendance records for your assigned courses yet.</p>
                ) : (
                  <div className="divide-y">
                    {recentAttendance.map((row) => {
                      const course = courses.find((item) => item.id === row.course_id);
                      return (
                        <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                          <div>
                            <p className="font-medium">{course ? `${course.code} · ${course.name}` : "Assigned course"}</p>
                            <p className="text-sm text-muted-foreground">{formatDate(row.date)} · {formatTime(row.created_at)}</p>
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${row.status === "present" ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                            {row.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
