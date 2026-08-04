import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import DashboardLayout from '@/components/DashboardLayout';
import LoadingScreen from '@/components/LoadingScreen';
import { ProgressSummary } from '@/components/ProgressSummary';
import { LocationPicker } from '@/components/LocationPicker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { QRCodeCanvas } from 'qrcode.react';
import { toast } from 'sonner';
import { BookOpen, Copy, History, Loader2, QrCode, XCircle } from 'lucide-react';

interface Course { id: string; name: string; code: string; department_id: string }
interface Row {
  id: string;
  date: string;
  status: string;
  course_id: string;
  confidence_score: number | null;
  students: { name: string; matric_no: string | null } | null;
}

const StaffDashboard = () => {
  const { profile, user, role } = useAuth();
  const canRunSessions = role === 'lecturer' || role === 'course_rep';
  const readOnly = role === 'hod';

  const [loading, setLoading] = useState(true);
  const [departmentName, setDepartmentName] = useState('');
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [records, setRecords] = useState<Row[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [tab, setTab] = useState<'overview' | 'history'>('overview');

  // QR session state
  const [showQr, setShowQr] = useState(false);
  const [qrCourseId, setQrCourseId] = useState('');
  const [qrDate, setQrDate] = useState(new Date().toISOString().split('T')[0]);
  const [qrDurationMin, setQrDurationMin] = useState(15);
  const [qrLat, setQrLat] = useState<number | null>(null);
  const [qrLng, setQrLng] = useState<number | null>(null);
  const [qrRadius, setQrRadius] = useState(100);
  const [qrCreating, setQrCreating] = useState(false);
  const [qrEnding, setQrEnding] = useState(false);
  const [qrSession, setQrSession] = useState<{ token: string; expires_at: string } | null>(null);
  const [rotatingCode, setRotatingCode] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!profile?.department_id || !user) return;
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.department_id, user?.id, role]);

  const init = async () => {
    setLoading(true);
    try {
      const [deptRes, staffRes] = await Promise.all([
        supabase.from('departments').select('name').eq('id', profile!.department_id!).single(),
        readOnly
          ? Promise.resolve({ data: null } as any)
          : (supabase as any).from('course_staff').select('course_id').eq('user_id', user!.id),
      ]);
      if (deptRes.data) setDepartmentName(deptRes.data.name);

      let list: Course[] = [];
      if (readOnly) {
        const { data } = await supabase
          .from('courses').select('id, name, code, department_id')
          .eq('department_id', profile!.department_id!).order('code');
        list = (data ?? []) as Course[];
      } else {
        const ids = ((staffRes as any).data ?? []).map((r: any) => r.course_id);
        if (ids.length) {
          const { data } = await supabase
            .from('courses').select('id, name, code, department_id').in('id', ids).order('code');
          list = (data ?? []) as Course[];
        }
      }
      setCourses(list);
      if (list.length) { setSelectedCourse(list[0].id); setQrCourseId(list[0].id); }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedCourse) return;
    void fetchRecords(selectedCourse);
  }, [selectedCourse]);

  const fetchRecords = async (courseId: string) => {
    setRecordsLoading(true);
    try {
      const { data, error } = await supabase
        .from('attendance')
        .select('id, date, status, course_id, confidence_score, students(name, matric_no)')
        .eq('course_id', courseId)
        .order('date', { ascending: false })
        .limit(500);
      if (error) throw error;
      setRecords((data ?? []) as unknown as Row[]);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load records');
    } finally {
      setRecordsLoading(false);
    }
  };

  // rotating code polling
  useEffect(() => {
    if (!qrSession) { setRotatingCode(null); return; }
    const tick = setInterval(() => setNow(Date.now()), 1000);
    let cancelled = false;
    const pull = async () => {
      const { data } = await supabase.functions.invoke('session-token', { body: { token: qrSession.token } });
      if (!cancelled && (data as any)?.code) setRotatingCode((data as any).code);
    };
    void pull();
    const poll = setInterval(pull, 10_000);
    return () => { cancelled = true; clearInterval(tick); clearInterval(poll); };
  }, [qrSession]);

  const useMyLocation = () => {
    if (!navigator.geolocation) { toast.error('Geolocation not supported'); return; }
    toast.message('Getting your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setQrLat(pos.coords.latitude); setQrLng(pos.coords.longitude); toast.success('Location captured'); },
      (err) => toast.error('Location failed: ' + err.message),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const createSession = async () => {
    if (!qrCourseId) { toast.error('Pick a course'); return; }
    if (qrLat == null || qrLng == null) { toast.error('Pick the class location on the map'); return; }
    setQrCreating(true);
    try {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(18)))
        .map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
      const { data, error } = await (supabase as any).from('attendance_sessions').insert({
        course_id: qrCourseId,
        department_id: profile!.department_id,
        date: qrDate,
        token,
        expires_at: new Date(Date.now() + qrDurationMin * 60_000).toISOString(),
        created_by: user!.id,
        latitude: qrLat,
        longitude: qrLng,
        radius_m: qrRadius,
      }).select('token, expires_at').single();
      if (error) throw error;
      setQrSession(data);
      toast.success('Live session started');
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to start session');
    } finally {
      setQrCreating(false);
    }
  };

  const endSession = async () => {
    if (!qrSession) return;
    await (supabase as any).from('attendance_sessions')
      .update({ expires_at: new Date().toISOString() }).eq('token', qrSession.token);
    setQrSession(null);
    toast.message('Session ended');
  };

  const endAndMarkAbsent = async () => {
    if (!qrSession) return;
    setQrEnding(true);
    try {
      const { data, error } = await supabase.functions.invoke('end-session', { body: { token: qrSession.token } });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
      toast.success(`Session ended. ${(data as any)?.marked_absent ?? 0} student(s) marked absent.`);
      setQrSession(null);
      if (selectedCourse) void fetchRecords(selectedCourse);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to end session');
    } finally {
      setQrEnding(false);
    }
  };

  const selected = useMemo(() => courses.find(c => c.id === selectedCourse), [courses, selectedCourse]);

  if (loading) return <LoadingScreen />;

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-xl font-heading font-bold">
              {readOnly ? 'Department Overview' : 'My Courses'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {departmentName}
              {readOnly && ' · read-only access to every course in your department'}
            </p>
          </div>
          {canRunSessions && (
            <Button onClick={() => setShowQr(true)} disabled={courses.length === 0}>
              <QrCode className="w-4 h-4 mr-1" /> Live QR Session
            </Button>
          )}
        </div>

        {courses.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center space-y-2">
              <BookOpen className="w-8 h-8 mx-auto text-muted-foreground" />
              <p className="font-medium">No courses assigned yet</p>
              <p className="text-sm text-muted-foreground">
                Ask your department admin to assign you to a course under “Staff & Reps”.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Select Course</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {courses.map(c => (
                  <Button
                    key={c.id}
                    size="sm"
                    variant={selectedCourse === c.id ? 'default' : 'outline'}
                    onClick={() => setSelectedCourse(c.id)}
                  >
                    {c.code}
                  </Button>
                ))}
              </CardContent>
            </Card>

            <div className="flex gap-1 border-b">
              {([
                { id: 'overview' as const, label: 'Overview', icon: BookOpen },
                { id: 'history' as const, label: 'Attendance', icon: History },
              ]).map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <t.icon className="w-4 h-4" /> {t.label}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <ProgressSummary department={departmentName} courseCode={selected?.code} />
            )}

            {tab === 'history' && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {selected ? `${selected.code} — ${selected.name}` : 'Attendance'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  {recordsLoading ? (
                    <div className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading records…
                    </div>
                  ) : records.length === 0 ? (
                    <p className="py-6 text-sm text-muted-foreground">No attendance records yet for this course.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Student</TableHead>
                          <TableHead>Matric No</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Confidence</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {records.map(r => (
                          <TableRow key={r.id}>
                            <TableCell>{r.date}</TableCell>
                            <TableCell>{r.students?.name ?? '—'}</TableCell>
                            <TableCell>{r.students?.matric_no ?? '—'}</TableCell>
                            <TableCell>
                              <Badge variant={r.status === 'present' || r.status === 'P' ? 'default' : 'secondary'}>
                                {r.status}
                              </Badge>
                            </TableCell>
                            <TableCell>{r.confidence_score != null ? `${r.confidence_score}%` : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {canRunSessions && (
          <Dialog open={showQr} onOpenChange={(o) => { setShowQr(o); if (!o) setQrSession(null); }}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Live QR Attendance Session</DialogTitle></DialogHeader>
              {!qrSession ? (
                <div className="space-y-3 pt-2">
                  <div>
                    <label className="text-sm font-medium">Course</label>
                    <Select value={qrCourseId} onValueChange={setQrCourseId}>
                      <SelectTrigger><SelectValue placeholder="Pick a course" /></SelectTrigger>
                      <SelectContent>
                        {courses.map(c => <SelectItem key={c.id} value={c.id}>{c.code} - {c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Date</label>
                    <Input type="date" value={qrDate} onChange={e => setQrDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Duration</label>
                    <Select value={String(qrDurationMin)} onValueChange={v => setQrDurationMin(Number(v))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 minutes</SelectItem>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                        <SelectItem value="60">1 hour</SelectItem>
                        <SelectItem value="120">2 hours</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Class location (tap map to set)</label>
                      <Button type="button" size="sm" variant="outline" onClick={useMyLocation}>Use my location</Button>
                    </div>
                    <LocationPicker lat={qrLat} lng={qrLng} radius={qrRadius} onChange={(la, ln) => { setQrLat(la); setQrLng(ln); }} />
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium whitespace-nowrap">Radius (m)</label>
                      <Input type="number" min={10} max={5000} value={qrRadius}
                        onChange={e => setQrRadius(Math.max(10, Number(e.target.value) || 100))} />
                    </div>
                  </div>
                  <Button onClick={createSession} disabled={qrCreating || !qrCourseId || qrLat == null} className="w-full">
                    {qrCreating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <QrCode className="w-4 h-4 mr-2" />}
                    Start session
                  </Button>
                </div>
              ) : (() => {
                const scanUrl = `${window.location.origin}/scan?token=${qrSession.token}${rotatingCode ? `&c=${rotatingCode}` : ''}`;
                const remainingMs = new Date(qrSession.expires_at).getTime() - now;
                const remaining = Math.max(0, Math.floor(remainingMs / 1000));
                const mm = Math.floor(remaining / 60).toString().padStart(2, '0');
                const ss = (remaining % 60).toString().padStart(2, '0');
                return (
                  <div className="space-y-3 pt-2 text-center">
                    <div className="bg-white p-4 rounded-lg inline-block mx-auto">
                      <QRCodeCanvas value={scanUrl} size={240} includeMargin />
                    </div>
                    {rotatingCode && (
                      <p className="text-sm">Rotating code: <span className="font-mono font-bold tracking-widest">{rotatingCode}</span></p>
                    )}
                    <p className="text-2xl font-mono font-bold">{remainingMs <= 0 ? 'EXPIRED' : `${mm}:${ss}`}</p>
                    <p className="text-xs text-muted-foreground break-all">{scanUrl}</p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(scanUrl); toast.success('Link copied'); }}>
                        <Copy className="w-4 h-4 mr-1" /> Copy link
                      </Button>
                      <Button size="sm" variant="outline" onClick={endSession}>End session</Button>
                      {role === 'lecturer' && (
                        <Button size="sm" variant="destructive" onClick={endAndMarkAbsent} disabled={qrEnding}>
                          {qrEnding ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <XCircle className="w-4 h-4 mr-1" />}
                          End &amp; mark absent
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </DialogContent>
          </Dialog>
        )}
      </div>
    </DashboardLayout>
  );
};

export default StaffDashboard;
