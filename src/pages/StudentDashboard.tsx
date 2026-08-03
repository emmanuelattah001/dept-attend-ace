import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { CalendarCheck, CheckCircle, XCircle, QrCode } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import LoadingScreen from '@/components/LoadingScreen';
import FaceEnrollment from '@/components/FaceEnrollment';


interface AttendanceRecord {
  id: string;
  date: string;
  status: string;
  department: string | null;
  course: string | null;
}

const StudentDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [stats, setStats] = useState({ present: 0, absent: 0, total: 0, percentage: 0 });
  const [faceEnrolledAt, setFaceEnrolledAt] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);


  useEffect(() => {
    if (!user) return;
    const fetchAttendance = async () => {
      const { data: studentRow, error: studentError } = await supabase
        .from('students')
        .select('id, matric_no, face_enrolled_at')
        .eq('auth_user_id', user.id)
        .maybeSingle();

      if (studentError) console.error('Student lookup failed:', studentError);
      const matric = studentRow?.matric_no;
      const studentId = studentRow?.id;
      setFaceEnrolledAt((studentRow as any)?.face_enrolled_at ?? null);


      // Query DB directly (source of truth for recent records) + Sheet (archive) in parallel.
      const [dbRes, sheetRes, progressRes] = await Promise.all([
        studentId
          ? supabase
              .from('attendance')
              .select('id, date, status, departments(name), courses(code, name)')
              .eq('student_ref', studentId)
              .order('date', { ascending: false })
          : Promise.resolve({ data: [], error: null } as any),
        matric
          ? supabase.functions.invoke('sheets-sync', {
              body: { action: 'lookup_by_matric', matric_no: matric },
            })
          : Promise.resolve({ data: { rows: [] }, error: null } as any),
        matric
          ? supabase.functions.invoke('get-student-progress', {
              body: { matric_no: matric },
            })
          : Promise.resolve({ data: { rows: [] }, error: null } as any),
      ]);

      if (dbRes.error) console.error('DB attendance fetch failed:', dbRes.error);

      const dbRows: AttendanceRecord[] = ((dbRes.data ?? []) as any[]).map((r) => ({
        id: r.id,
        date: r.date,
        status: r.status,
        department: r.departments?.name ?? null,
        course: r.courses ? `${r.courses.code}${r.courses.name ? ' - ' + r.courses.name : ''}` : null,
      }));

      const sheetRows: AttendanceRecord[] = ((sheetRes.data?.rows ?? []) as any[]).map((r, i) => ({
        id: r.attendance_id ?? `sheet-${i}`,
        date: r.date,
        status: r.status,
        department: r.department ?? null,
        course: r.course_code ? `${r.course_code}${r.course_name ? ' - ' + r.course_name : ''}` : (r.course_name ?? null),
      }));

      // Merge, dedupe by date|course|status
      const seen = new Set<string>();
      const merged: AttendanceRecord[] = [];
      for (const r of [...dbRows, ...sheetRows]) {
        const k = `${r.date}|${r.course ?? ''}|${r.status}`;
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(r);
      }
      merged.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
      setRecords(merged);

      // Stats: prefer Sheet Progress (archive), else compute from merged records.
      const progRows: any[] = progressRes.data?.rows ?? [];
      let present = progRows.reduce((s, r) => s + (r.total_present ?? 0), 0);
      let absent = progRows.reduce((s, r) => s + (r.total_absent ?? 0), 0);
      let total = progRows.reduce((s, r) => s + (r.total_classes ?? 0), 0);
      if (total === 0 && merged.length > 0) {
        present = merged.filter(r => r.status === 'present').length;
        absent = merged.filter(r => r.status === 'absent').length;
        total = present + absent;
      }
      const percentage = total ? Math.round((present / total) * 1000) / 10 : 0;
      setStats({ present, absent, total, percentage });
      setInitialLoading(false);
    };
    fetchAttendance();
  }, [user]);



  const percentage = stats.percentage;

  const statusStyles: Record<string, string> = {
    present: 'bg-success text-success-foreground',
    absent: 'bg-destructive text-destructive-foreground',
  };

  if (initialLoading) {
    return <LoadingScreen message="Loading attendance..." />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-heading font-bold">My Attendance</h2>
            <p className="text-muted-foreground text-sm mt-1">View your attendance records</p>
          </div>
          <Button size="lg" onClick={() => navigate('/scan')} className="w-full sm:w-auto">
            <QrCode className="w-5 h-5 mr-2" /> Scan QR to Mark Attendance
          </Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6 text-center">
              <CalendarCheck className="w-8 h-8 mx-auto text-primary mb-2" />
              <p className="text-2xl font-bold">{percentage}%</p>
              <p className="text-xs text-muted-foreground">Attendance Rate</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <CheckCircle className="w-8 h-8 mx-auto text-success mb-2" />
              <p className="text-2xl font-bold">{stats.present}</p>
              <p className="text-xs text-muted-foreground">Present</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <XCircle className="w-8 h-8 mx-auto text-destructive mb-2" />
              <p className="text-2xl font-bold">{stats.absent}</p>
              <p className="text-xs text-muted-foreground">Absent</p>
            </CardContent>
          </Card>
        </div>

        <FaceEnrollment enrolledAt={faceEnrolledAt} onEnrolled={setFaceEnrolledAt} />


        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Attendance History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>{r.date}</TableCell>
                      <TableCell>{r.department ?? '-'}</TableCell>
                      <TableCell>{r.course ?? '-'}</TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusStyles[r.status] || 'bg-muted'}`}>
                          {r.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {records.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No attendance records yet
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default StudentDashboard;
