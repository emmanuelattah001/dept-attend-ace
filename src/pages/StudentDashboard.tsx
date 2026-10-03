import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Activity, ArrowRight, CalendarCheck, CalendarDays, CheckCircle2,
  CircleAlert, ClipboardList, QrCode, RefreshCw, XCircle,
} from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import FaceEnrollment from '@/components/FaceEnrollment';

const ATTENDANCE_THRESHOLD = 75;

interface AttendanceRecord {
  id: string;
  date: string;
  status: string;
  department: string | null;
  course: string | null;
  time?: string | null;
  method?: string | null;
  verified?: boolean | null;
}

interface Stats {
  present: number;
  absent: number;
  total: number;
  percentage: number;
}

interface CourseAttendance extends Stats {
  course: string;
}

const emptyStats: Stats = { present: 0, absent: 0, total: 0, percentage: 0 };

const statusClasses: Record<string, string> = {
  present: 'bg-success/15 text-success',
  absent: 'bg-destructive/10 text-destructive',
  late: 'bg-warning/15 text-amber-700',
};

function asStats(present: number, absent: number, total = present + absent): Stats {
  return {
    present,
    absent,
    total,
    percentage: total > 0 ? Math.round((present / total) * 100) : 0,
  };
}

function formatDate(date: string) {
  if (!date) return 'Date unavailable';
  const value = new Date(`${date}T00:00:00`);
  if (Number.isNaN(value.getTime())) return date;
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(value);
}

function formatActivityDate(date: string) {
  const value = new Date(`${date}T00:00:00`);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (value.toDateString() === today.toDateString()) return 'Today';
  if (value.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(value);
}

function formatTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function courseStatus(percentage: number) {
  return percentage >= ATTENDANCE_THRESHOLD ? 'Good' : 'Attention';
}

const DashboardSkeleton = () => (
  <div className="space-y-6" aria-label="Loading attendance dashboard" aria-busy="true">
    <div className="space-y-2"><Skeleton className="h-8 w-60" /><Skeleton className="h-4 w-48" /></div>
    <Skeleton className="h-14 w-full" />
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32" />)}</div>
    <Skeleton className="h-36 w-full" />
    <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-56" /><Skeleton className="h-56" /></div>
  </div>
);

const StudentDashboard = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const historyRef = useRef<HTMLElement | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [courses, setCourses] = useState<CourseAttendance[]>([]);
  const [studentName, setStudentName] = useState<string | null>(null);
  const [faceEnrolledAt, setFaceEnrolledAt] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAttendance = useCallback(async () => {
    if (!user) return;
    setInitialLoading(true);
    setError(null);

    try {
      const { data: studentRow, error: studentError } = await supabase
        .from('students')
        .select('id, name, matric_no, face_enrolled_at')
        .eq('auth_user_id', user.id)
        .maybeSingle();

      if (studentError) throw studentError;
      if (!studentRow) {
        setStudentName(profile?.name ?? null);
        setRecords([]);
        setStats(emptyStats);
        setCourses([]);
        return;
      }

      setStudentName(studentRow.name || profile?.name || null);
      setFaceEnrolledAt(studentRow.face_enrolled_at ?? null);

      // The direct query is scoped to the current authenticated student's row;
      // the existing sheet calls retain archived records cleaned from the DB.
      const [dbRes, sheetRes, progressRes] = await Promise.all([
        supabase
          .from('attendance')
          .select('id, date, status, created_at, verified_via, confidence_score, departments(name), courses(code, name)')
          .eq('student_ref', studentRow.id)
          .order('date', { ascending: false }),
        studentRow.matric_no
          ? supabase.functions.invoke('sheets-sync', { body: { action: 'lookup_by_matric', matric_no: studentRow.matric_no } })
          : Promise.resolve({ data: { rows: [] }, error: null } as never),
        studentRow.matric_no
          ? supabase.functions.invoke('get-student-progress', { body: { matric_no: studentRow.matric_no } })
          : Promise.resolve({ data: { rows: [] }, error: null } as never),
      ]);

      if (dbRes.error) throw dbRes.error;
      if (sheetRes.error) console.error('Archived attendance fetch failed:', sheetRes.error);
      if (progressRes.error) console.error('Archived progress fetch failed:', progressRes.error);

      const dbRows: AttendanceRecord[] = ((dbRes.data ?? []) as any[]).map((row) => ({
        id: row.id,
        date: row.date,
        status: row.status,
        department: row.departments?.name ?? null,
        course: row.courses ? `${row.courses.code}${row.courses.name ? ` — ${row.courses.name}` : ''}` : null,
        time: row.created_at,
        method: row.verified_via ?? null,
        verified: row.confidence_score !== null,
      }));
      const sheetRows: AttendanceRecord[] = ((sheetRes.data?.rows ?? []) as any[]).map((row, index) => ({
        id: row.attendance_id ?? `sheet-${index}`,
        date: row.date,
        status: row.status,
        department: row.department ?? null,
        course: row.course_code ? `${row.course_code}${row.course_name ? ` — ${row.course_name}` : ''}` : (row.course_name ?? null),
      }));

      const seen = new Set<string>();
      const merged = [...dbRows, ...sheetRows].filter((record) => {
        const key = `${record.date}|${record.course ?? ''}|${record.status}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
      setRecords(merged);

      const progressRows: any[] = progressRes.data?.rows ?? [];
      const progressPresent = progressRows.reduce((sum, row) => sum + Number(row.total_present ?? 0), 0);
      const progressAbsent = progressRows.reduce((sum, row) => sum + Number(row.total_absent ?? 0), 0);
      const progressTotal = progressRows.reduce((sum, row) => sum + Number(row.total_classes ?? 0), 0);
      const fallbackPresent = merged.filter((record) => record.status === 'present').length;
      const fallbackAbsent = merged.filter((record) => record.status === 'absent').length;
      setStats(progressTotal > 0 ? asStats(progressPresent, progressAbsent, progressTotal) : asStats(fallbackPresent, fallbackAbsent));

      const fromProgress = progressRows
        .filter((row) => row.course && Number(row.total_classes ?? 0) > 0)
        .map((row) => ({
          course: String(row.course),
          ...asStats(Number(row.total_present ?? 0), Number(row.total_absent ?? 0), Number(row.total_classes ?? 0)),
        }));
      if (fromProgress.length) {
        setCourses(fromProgress);
      } else {
        const grouped = new Map<string, AttendanceRecord[]>();
        merged.forEach((record) => {
          if (!record.course) return;
          grouped.set(record.course, [...(grouped.get(record.course) ?? []), record]);
        });
        setCourses(Array.from(grouped, ([course, courseRecords]) => {
          const present = courseRecords.filter((record) => record.status === 'present').length;
          const absent = courseRecords.filter((record) => record.status === 'absent').length;
          return { course, ...asStats(present, absent) };
        }));
      }
    } catch (fetchError) {
      console.error('Student attendance fetch failed:', fetchError);
      setError('Unable to load your attendance data. Please try again.');
    } finally {
      setInitialLoading(false);
    }
  }, [profile?.name, user]);

  useEffect(() => { void fetchAttendance(); }, [fetchAttendance]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  }, []);
  const attendanceStatus = stats.total === 0
    ? { title: 'Attendance status unavailable', description: 'Your attendance status will appear after your first class record.', tone: 'text-muted-foreground', icon: CircleAlert }
    : stats.percentage >= ATTENDANCE_THRESHOLD
      ? { title: "You're on track", description: `Your attendance is currently above the required ${ATTENDANCE_THRESHOLD}% threshold.`, tone: 'text-success', icon: CheckCircle2 }
      : stats.percentage >= ATTENDANCE_THRESHOLD - 10
        ? { title: 'Attendance needs attention', description: `Your attendance is getting close to the required ${ATTENDANCE_THRESHOLD}% threshold.`, tone: 'text-amber-700', icon: CircleAlert }
        : { title: 'Attendance warning', description: `Your current attendance is below the required ${ATTENDANCE_THRESHOLD}% threshold.`, tone: 'text-destructive', icon: CircleAlert };
  const StatusIcon = attendanceStatus.icon;
  const recentRecords = records.slice(0, 5);
  const trendRecords = [...records].slice(0, 8).reverse();

  if (initialLoading) return <DashboardLayout><DashboardSkeleton /></DashboardLayout>;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <header className="space-y-1">
          <h2 className="text-2xl font-heading font-bold sm:text-3xl">
            {studentName ? `${greeting}, ${studentName}` : 'My Attendance'}
          </h2>
          <p className="text-sm text-muted-foreground">{studentName ? "Here's your attendance overview." : 'View your attendance records'}</p>
        </header>

        {error && (
          <Card className="border-destructive/30">
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void fetchAttendance()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
            </CardContent>
          </Card>
        )}

        <Button size="lg" onClick={() => navigate('/scan')} className="h-14 w-full text-base shadow-sm sm:w-auto" aria-label="Scan QR code to mark attendance">
          <QrCode className="mr-2 h-5 w-5" /> Scan QR to Mark Attendance
        </Button>

        <section aria-label="Attendance statistics" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Attendance Rate', value: `${stats.percentage}%`, icon: CalendarCheck, color: 'text-primary' },
            { label: 'Present', value: stats.present, icon: CheckCircle2, color: 'text-success' },
            { label: 'Absent', value: stats.absent, icon: XCircle, color: 'text-destructive' },
            { label: 'Total Classes', value: stats.total, icon: ClipboardList, color: 'text-primary' },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}><CardContent className="p-4 text-center sm:p-5"><Icon className={`mx-auto mb-2 h-6 w-6 ${color}`} /><p className="text-2xl font-bold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></CardContent></Card>
          ))}
        </section>

        <Card>
          <CardContent className="flex gap-3 p-5"><StatusIcon className={`mt-0.5 h-5 w-5 shrink-0 ${attendanceStatus.tone}`} /><div><h3 className="font-semibold">{attendanceStatus.title}</h3><p className="mt-1 text-sm text-muted-foreground">{attendanceStatus.description}</p></div></CardContent>
        </Card>

        <section aria-labelledby="courses-title">
          <div className="mb-3 flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" /><h3 id="courses-title" className="text-lg font-semibold">My Courses</h3></div>
          {courses.length ? <div className="grid gap-3 lg:grid-cols-2">{courses.map((course) => <Card key={course.course}><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="font-semibold">{course.course}</h4><p className="mt-1 text-sm text-muted-foreground">{course.present} / {course.total} classes attended</p></div><span className={`shrink-0 text-lg font-bold ${course.percentage >= ATTENDANCE_THRESHOLD ? 'text-success' : 'text-destructive'}`}>{course.percentage}%</span></div><div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>Present: {course.present}</span><span>Absent: {course.absent}</span><span>Total: {course.total}</span><span className="font-medium text-foreground">Status: {courseStatus(course.percentage)}</span></div></CardContent></Card>)}</div> : <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No course attendance records yet.</CardContent></Card>}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="recent-title"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" /><h3 id="recent-title" className="text-lg font-semibold">Recent Attendance</h3></div><Button variant="link" className="h-auto px-0 text-sm" onClick={() => historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>View Full History <ArrowRight className="ml-1 h-4 w-4" /></Button></div><Card><CardContent className="divide-y p-0">{recentRecords.length ? recentRecords.map((record) => <div key={record.id} className="flex items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="truncate text-sm font-medium">{record.course ?? 'Course unavailable'}</p><p className="mt-1 text-xs text-muted-foreground">{formatActivityDate(record.date)}{formatTime(record.time) ? ` · ${formatTime(record.time)}` : ''}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium capitalize ${statusClasses[record.status] ?? 'bg-muted text-muted-foreground'}`}>{record.status}</span></div>) : <p className="p-8 text-center text-sm text-muted-foreground">No attendance records yet.</p>}</CardContent></Card></section>
          <section aria-labelledby="trend-title"><div className="mb-3 flex items-center gap-2"><Activity className="h-5 w-5 text-primary" /><h3 id="trend-title" className="text-lg font-semibold">Attendance Trend</h3></div><Card><CardContent className="p-5">{trendRecords.length >= 2 ? <div className="flex h-36 items-end gap-2" aria-label="Attendance trend by recent class records">{trendRecords.map((record) => <div className="flex min-w-0 flex-1 flex-col items-center gap-2" key={record.id}><div className={`w-full rounded-t ${record.status === 'present' ? 'h-24 bg-success' : record.status === 'absent' ? 'h-5 bg-destructive' : 'h-16 bg-amber-500'}`} title={`${record.course ?? 'Course'}: ${record.status}`} /><span className="w-full truncate text-center text-[10px] text-muted-foreground">{formatActivityDate(record.date)}</span></div>)}</div> : <p className="py-8 text-center text-sm text-muted-foreground">Attendance trends will appear after you have more attendance records.</p>}</CardContent></Card></section>
        </div>

        <FaceEnrollment enrolledAt={faceEnrolledAt} onEnrolled={setFaceEnrolledAt} />

        <section ref={historyRef} aria-labelledby="history-title" className="scroll-mt-24"><Card><CardHeader><CardTitle id="history-title" className="text-lg">Attendance History</CardTitle></CardHeader><CardContent>{records.length ? <><div className="space-y-3 sm:hidden">{records.map((record) => <article key={record.id} className="rounded-lg border p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{record.course ?? 'Course unavailable'}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(record.date)}{formatTime(record.time) ? ` · ${formatTime(record.time)}` : ''}</p></div><span className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${statusClasses[record.status] ?? 'bg-muted text-muted-foreground'}`}>{record.status}</span></div><p className="mt-2 text-xs text-muted-foreground">{record.department ?? 'Department unavailable'}{record.method ? ` · ${record.method.replaceAll('_', ' ')}` : ''}{record.verified ? ' · Verified' : ''}</p></article>)}</div><div className="hidden sm:block"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Course</TableHead><TableHead>Department</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{records.map((record) => <TableRow key={record.id}><TableCell>{formatDate(record.date)}</TableCell><TableCell>{record.course ?? '-'}</TableCell><TableCell>{record.department ?? '-'}</TableCell><TableCell className="capitalize">{record.method?.replaceAll('_', ' ') ?? '-'}</TableCell><TableCell><span className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${statusClasses[record.status] ?? 'bg-muted text-muted-foreground'}`}>{record.status}</span></TableCell></TableRow>)}</TableBody></Table></div></> : <p className="py-8 text-center text-sm text-muted-foreground">No attendance records yet.</p>}</CardContent></Card></section>
      </div>
    </DashboardLayout>
  );
};

export default StudentDashboard;
