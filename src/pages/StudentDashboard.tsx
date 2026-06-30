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

interface AttendanceRecord {
  id: string;
  date: string;
  status: string;
  departments: { name: string } | null;
  courses?: { name: string; code: string | null } | null;
}

const StudentDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [stats, setStats] = useState({ present: 0, absent: 0 });
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetchAttendance = async () => {
      const { data: studentRow, error: studentError } = await supabase
        .from('students')
        .select('id, matric_no')
        .eq('auth_user_id', user.id)
        .maybeSingle();

      if (studentError) {
        console.error('Student lookup failed:', studentError);
      }

      const [dbRes, sheetRes] = await Promise.all([
        studentRow?.id
          ? supabase
              .from('attendance')
              .select('id, date, status, departments(name), courses(name, code)')
              .eq('student_ref', studentRow.id)
              .order('date', { ascending: false })
          : Promise.resolve({ data: [], error: null } as any),
        studentRow?.matric_no
          ? supabase.functions.invoke('sheets-sync', {
              body: { action: 'lookup_by_matric', matric_no: studentRow.matric_no },
            })
          : Promise.resolve({ data: { rows: [] }, error: null } as any),
      ]);

      const seen = new Set<string>();
      const merged: AttendanceRecord[] = [];
      const push = (id: string, date: string, status: string, deptName: string | null, course?: AttendanceRecord['courses']) => {
        const key = `${date}|${(status || '').toLowerCase()}|${course?.code ?? course?.name ?? ''}`;
        if (!date || seen.has(key)) return;
        seen.add(key);
        merged.push({ id, date, status, departments: deptName ? { name: deptName } : null, courses: course ?? null });
      };
      if (dbRes.error) {
        console.error('Attendance lookup failed:', dbRes.error);
      }
      for (const r of (dbRes.data ?? []) as any[]) push(r.id, r.date, r.status, r.departments?.name ?? null, r.courses ?? null);
      for (const r of (sheetRes.data?.rows ?? []) as any[]) push(`sheet-${r.date}-${r.status}`, r.date, r.status, null);
      merged.sort((a, b) => b.date.localeCompare(a.date));

      setRecords(merged);
      setStats({
        present: merged.filter(r => r.status?.toLowerCase() === 'present').length,
        absent: merged.filter(r => r.status?.toLowerCase() === 'absent').length,
      });
      setInitialLoading(false);
    };
    fetchAttendance();
  }, [user]);


  const total = stats.present + stats.absent;
  const percentage = total > 0 ? Math.round((stats.present / total) * 100) : 0;

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
          <div>
            <h2 className="text-2xl font-heading font-bold">My Attendance</h2>
            <p className="text-muted-foreground text-sm mt-1">View your attendance records</p>
          </div>
          <Button size="lg" onClick={() => navigate('/scan')}>
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
                      <TableCell>{r.departments?.name ?? '-'}</TableCell>
                      <TableCell>{r.courses ? `${r.courses.code ? r.courses.code + ' - ' : ''}${r.courses.name}` : '-'}</TableCell>
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
