import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CalendarCheck, CheckCircle, XCircle, Clock } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface AttendanceRecord {
  id: string;
  date: string;
  status: string;
  departments: { name: string } | null;
}

const StudentDashboard = () => {
  const { user } = useAuth();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [stats, setStats] = useState({ present: 0, absent: 0, late: 0 });

  useEffect(() => {
    if (!user) return;
    const fetchAttendance = async () => {
      const { data } = await supabase
        .from('attendance')
        .select('*, departments(name)')
        .eq('student_id', user.id)
        .order('date', { ascending: false });
      if (data) {
        const typed = data as unknown as AttendanceRecord[];
        setRecords(typed);
        setStats({
          present: typed.filter(r => r.status === 'present').length,
          absent: typed.filter(r => r.status === 'absent').length,
          late: typed.filter(r => r.status === 'late').length,
        });
      }
    };
    fetchAttendance();
  }, [user]);

  const total = stats.present + stats.absent + stats.late;
  const percentage = total > 0 ? Math.round((stats.present / total) * 100) : 0;

  const statusStyles: Record<string, string> = {
    present: 'bg-success text-success-foreground',
    absent: 'bg-destructive text-destructive-foreground',
    late: 'bg-warning text-warning-foreground',
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-heading font-bold">My Attendance</h2>
          <p className="text-muted-foreground text-sm mt-1">View your attendance records</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
          <Card>
            <CardContent className="pt-6 text-center">
              <Clock className="w-8 h-8 mx-auto text-warning mb-2" />
              <p className="text-2xl font-bold">{stats.late}</p>
              <p className="text-xs text-muted-foreground">Late</p>
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
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>{r.date}</TableCell>
                      <TableCell>{r.departments?.name ?? '-'}</TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusStyles[r.status] || 'bg-muted'}`}>
                          {r.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {records.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground">
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
