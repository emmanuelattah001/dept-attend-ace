import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { CalendarCheck, Save, History } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Student {
  user_id: string;
  name: string;
  email: string;
}

interface AttendanceEntry {
  student_id: string;
  status: 'present' | 'absent' | 'late';
}

interface AttendanceRecord {
  id: string;
  student_id: string;
  date: string;
  status: string;
  profiles: { name: string } | null;
}

const DeptAdminDashboard = () => {
  const { profile } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, 'present' | 'absent' | 'late'>>({});
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'mark' | 'history'>('mark');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile?.department_id) return;
    fetchStudents();
    fetchHistory();
  }, [profile?.department_id]);

  const fetchStudents = async () => {
    // Get students in this department by joining with user_roles
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, name, email')
      .eq('department_id', profile!.department_id!);

    if (!profiles) return;

    // Filter to only students
    const { data: roles } = await supabase
      .from('user_roles')
      .select('user_id, role')
      .in('user_id', profiles.map(p => p.user_id));

    const studentIds = new Set(
      (roles ?? []).filter(r => r.role === 'student').map(r => r.user_id)
    );

    setStudents(profiles.filter(p => studentIds.has(p.user_id)) as Student[]);
  };

  const fetchHistory = async () => {
    const { data } = await supabase
      .from('attendance')
      .select('*, profiles:student_id(name)')
      .eq('department_id', profile!.department_id!)
      .order('date', { ascending: false })
      .limit(200);
    if (data) setHistory(data as unknown as AttendanceRecord[]);
  };

  const toggleStatus = (studentId: string) => {
    setAttendanceMap(prev => {
      const current = prev[studentId];
      const next = current === 'present' ? 'absent' : current === 'absent' ? 'late' : 'present';
      return { ...prev, [studentId]: next };
    });
  };

  const saveAttendance = async () => {
    if (!profile?.department_id || !profile?.user_id) return;
    setSaving(true);
    const entries: any[] = students.map(s => ({
      student_id: s.user_id,
      department_id: profile.department_id,
      marked_by: profile.user_id,
      date,
      status: attendanceMap[s.user_id] || 'present',
    }));

    const { error } = await supabase.from('attendance').upsert(entries, {
      onConflict: 'student_id,date',
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Attendance saved');
      fetchHistory();
    }
    setSaving(false);
  };

  if (!profile?.department_id) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md">
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground">You haven't been assigned to a department yet. Please contact a super admin.</p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const statusStyles: Record<string, string> = {
    present: 'bg-success text-success-foreground',
    absent: 'bg-destructive text-destructive-foreground',
    late: 'bg-warning text-warning-foreground',
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-heading font-bold">Department Admin</h2>
          <p className="text-muted-foreground text-sm mt-1">Mark and view attendance for your department</p>
        </div>

        <div className="flex gap-2 border-b">
          <button
            onClick={() => setActiveTab('mark')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'mark' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <CalendarCheck className="w-4 h-4" /> Mark Attendance
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'history' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <History className="w-4 h-4" /> History
          </button>
        </div>

        {activeTab === 'mark' && (
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="text-lg">Mark Attendance</CardTitle>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-auto"
                  />
                  <Button onClick={saveAttendance} disabled={saving || students.length === 0}>
                    <Save className="w-4 h-4 mr-1" /> Save
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {students.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No students in your department yet</p>
              ) : (
                <div className="space-y-2">
                  {students.map(student => {
                    const status = attendanceMap[student.user_id] || 'present';
                    return (
                      <div key={student.user_id} className="flex items-center justify-between p-3 rounded-lg bg-muted">
                        <div>
                          <p className="font-medium">{student.name}</p>
                          <p className="text-xs text-muted-foreground">{student.email}</p>
                        </div>
                        <button
                          onClick={() => toggleStatus(student.user_id)}
                          className={`px-4 py-1.5 rounded-full text-xs font-semibold capitalize transition-colors ${statusStyles[status]}`}
                        >
                          {status}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'history' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Attendance History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map(r => (
                      <TableRow key={r.id}>
                        <TableCell>{r.profiles?.name ?? 'Unknown'}</TableCell>
                        <TableCell>{r.date}</TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusStyles[r.status] || 'bg-muted'}`}>
                            {r.status}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                    {history.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground">No records yet</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
};

export default DeptAdminDashboard;
