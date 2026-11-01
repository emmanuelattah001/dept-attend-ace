import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CalendarCheck, CheckCircle, XCircle, Search, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';

interface AttendanceRow {
  attendance_date: string;
  status: string;
  department_name: string;
}

interface LinkedStudent {
  id: string;
  matric_no: string | null;
  department_id: string;
}

async function getLinkedStudent(userId: string): Promise<{ student: LinkedStudent; institutionId: string | null }> {
  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('id, matric_no, department_id')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (studentError) throw studentError;
  if (!student) throw new Error('No student record is linked to this account.');

  const { data: department, error: departmentError } = await supabase
    .from('departments')
    .select('faculty_id')
    .eq('id', student.department_id)
    .maybeSingle();
  if (departmentError) throw departmentError;
  if (!department?.faculty_id) {
    return {
      student: { id: student.id, matric_no: student.matric_no, department_id: student.department_id },
      institutionId: null,
    };
  }

  const { data: faculty, error: facultyError } = await supabase
    .from('faculties')
    .select('institution_id')
    .eq('id', department.faculty_id)
    .maybeSingle();
  if (facultyError) throw facultyError;
  if (!faculty) {
    return {
      student: { id: student.id, matric_no: student.matric_no, department_id: student.department_id },
      institutionId: null,
    };
  }

  return {
    student: { id: student.id, matric_no: student.matric_no, department_id: student.department_id },
    institutionId: faculty.institution_id,
  };
}

const CheckAttendance = () => {
  const navigate = useNavigate();
  const { user, role, loading: authLoading, signOut } = useAuth();
  const [matricNo, setMatricNo] = useState('');
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [stats, setStats] = useState({ present: 0, absent: 0, total: 0, percentage: 0 });
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [archiveWarning, setArchiveWarning] = useState<string | null>(null);
  const [institutions, setInstitutions] = useState<{ id: string; name: string }[]>([]);
  const [institutionId, setInstitutionId] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await supabase.rpc('list_attendance_institutions');
      if (error) throw error;
      if (!active) return;

      const availableInstitutions = data ?? [];
      setInstitutions(availableInstitutions);
      if (!user) return;

      const { institutionId: linkedInstitutionId } = await getLinkedStudent(user.id);
      if (!active) return;
      if (linkedInstitutionId && !availableInstitutions.some((institution) => institution.id === linkedInstitutionId)) {
        throw new Error('Your student account is not linked to an active institution.');
      }
      setInstitutionId(linkedInstitutionId ?? '');
    })().catch((error: unknown) => {
      console.error('Unable to load the student institution:', error);
      if (active) {
        toast.error('Unable to load your institution', {
          description: error instanceof Error ? error.message : 'Please try again.',
        });
      }
    });
    return () => { active = false; };
  }, [user]);

  const handleSearch = async () => {
    const trimmed = matricNo.trim();

    if (!trimmed) {
      toast.error('Please enter your matric number');
      return;
    }
    if (!user) {
      toast.error('Sign in with your student account before searching.');
      return;
    }

    setLoading(true);
    setSearched(true);
    setSearchError(null);
    setArchiveWarning(null);
    setRecords([]);
    setStats({ present: 0, absent: 0, total: 0, percentage: 0 });

    try {
      const { student, institutionId: linkedInstitutionId } = await getLinkedStudent(user.id);
      if (!student.matric_no || student.matric_no.trim().toLowerCase() !== trimmed.toLowerCase()) {
        throw new Error('Enter the matric number linked to your student account.');
      }
      if (linkedInstitutionId && linkedInstitutionId !== institutionId) {
        throw new Error('Select the institution linked to your student account.');
      }

      const dbRows: AttendanceRow[] = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
          .from('attendance')
          .select('id, date, status, departments(name)')
          .eq('student_ref', student.id)
          .order('date', { ascending: false })
          .order('id', { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        dbRows.push(...(data ?? []).map((row) => ({
          attendance_date: row.date,
          status: row.status,
          department_name: row.departments?.name ?? '',
        })));
        if (!data || data.length < pageSize) break;
      }

      let sheetRows: AttendanceRow[] = [];
      let archiveError: string | null = null;
      if (linkedInstitutionId) {
        const sheetRes = await supabase.functions.invoke('sheets-sync', {
          body: { action: 'lookup_by_matric', matric_no: trimmed, institution_id: linkedInstitutionId },
        });
        sheetRows = (sheetRes.data?.rows ?? []).map((row) => ({
          attendance_date: row.date,
          status: row.status,
          department_name: row.department ?? '',
        }));
        archiveError = sheetRes.error?.message
          ?? (sheetRes.data?.ok === false ? sheetRes.data.error : null);
      } else {
        archiveError = 'Archived records are unavailable because your department is not linked to an institution.';
      }
      const merged = [...dbRows, ...sheetRows]
        .filter((row, index, rows) => rows.findIndex((candidate) =>
          candidate.attendance_date === row.attendance_date
          && candidate.status === row.status
          && candidate.department_name === row.department_name
        ) === index)
        .sort((a, b) => (b.attendance_date ?? '').localeCompare(a.attendance_date ?? ''));

      if (archiveError) {
        setArchiveWarning(linkedInstitutionId
          ? 'Some archived attendance data could not be loaded.'
          : archiveError);
        console.error('Archived attendance fetch failed:', archiveError);
      }
      if (!merged.length && archiveError) {
        setSearchError(linkedInstitutionId
          ? 'Could not load attendance records. Please try again.'
          : 'No recent attendance records were found. Archived records cannot be checked until your department is linked to an institution.');
        return;
      }

      setRecords(merged);
      const present = merged.filter((row) => row.status === 'present').length;
      const absent = merged.filter((row) => row.status === 'absent').length;
      const total = present + absent;
      const percentage = total ? Math.round((present / total) * 1000) / 10 : 0;
      setStats({ present, absent, total, percentage });
      if (!merged.length) toast.message('No attendance records found for this matric number');
    } catch (error) {
      console.error('Student attendance lookup failed:', error);
      const message = error instanceof Error ? error.message : 'Unable to search attendance.';
      setSearchError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };



  const { present, absent, percentage } = stats;
  const studentAccount = Boolean(user && role === 'student');

  const statusStyles: Record<string, string> = {
    present: 'bg-success text-success-foreground',
    absent: 'bg-destructive text-destructive-foreground',
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>

        {authLoading ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Checking your sign-in…</CardContent></Card>
        ) : !studentAccount ? (
          <Card>
            <CardContent className="space-y-4 py-8 text-center">
              <h1 className="text-2xl font-heading font-bold">Student sign-in required</h1>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                Attendance records are private. Sign in with the student account linked to your matric number to view your history.
              </p>
              <Button onClick={() => {
                void (async () => {
                  if (user) await signOut();
                  navigate('/login?next=%2Fcheck-attendance');
                })().catch((error) => {
                  console.error('Unable to switch to student sign-in:', error);
                  toast.error('Unable to sign out', { description: error instanceof Error ? error.message : 'Please try again.' });
                });
              }}>
                Sign in as a student
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-heading font-bold">Check Your Attendance</h1>
          <p className="text-muted-foreground text-sm">Enter the matric number linked to your student account to view your records</p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
              {institutionId ? (
                <Select value={institutionId} onValueChange={setInstitutionId}>
                  <SelectTrigger aria-label="Select institution"><SelectValue placeholder="Select your institution" /></SelectTrigger>
                  <SelectContent>
                    {institutions.map((institution) => (
                      <SelectItem key={institution.id} value={institution.id}>{institution.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Your department is not linked to an institution yet. Recent records connected to your student account can still be searched.
                </p>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
              <Input
                placeholder="AU25AC8017"
                value={matricNo}
                onChange={e => setMatricNo(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                maxLength={30}
              />
              <Button onClick={handleSearch} disabled={loading} className="w-full sm:w-auto">
                <Search className="w-4 h-4 mr-1" />
                {loading ? 'Searching...' : 'Search'}
              </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {archiveWarning && (
          <Card className="border-amber-500/30">
            <CardContent className="py-4 text-center text-sm text-muted-foreground">{archiveWarning}</CardContent>
          </Card>
        )}

        {searched && searchError && !loading && (
          <Card className="border-destructive/30">
            <CardContent className="py-10 text-center text-sm text-destructive">{searchError}</CardContent>
          </Card>
        )}

        {searched && records.length > 0 && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="pt-4 text-center">
                  <CalendarCheck className="w-6 h-6 mx-auto text-primary mb-1" />
                  <p className="text-xl font-bold">{percentage}%</p>
                  <p className="text-xs text-muted-foreground">Rate</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <CheckCircle className="w-6 h-6 mx-auto text-success mb-1" />
                  <p className="text-xl font-bold">{present}</p>
                  <p className="text-xs text-muted-foreground">Present</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <XCircle className="w-6 h-6 mx-auto text-destructive mb-1" />
                  <p className="text-xl font-bold">{absent}</p>
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
                        <TableHead>S/N</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {records.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{i + 1}</TableCell>
                          <TableCell>{r.attendance_date}</TableCell>
                          <TableCell>{r.department_name}</TableCell>
                          <TableCell>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusStyles[r.status] || 'bg-muted'}`}>
                              {r.status}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {searched && !searchError && records.length === 0 && !loading && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <p>No attendance records found for this matric number.</p>
              <p className="text-xs mt-1">Make sure your matric number is correct.</p>
            </CardContent>
          </Card>
        )}
          </>
        )}
      </div>
    </div>
  );
};

export default CheckAttendance;
