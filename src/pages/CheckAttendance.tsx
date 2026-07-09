import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CalendarCheck, CheckCircle, XCircle, Search, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface AttendanceRow {
  attendance_date: string;
  status: string;
  department_name: string;
}

const CheckAttendance = () => {
  const navigate = useNavigate();
  const [matricNo, setMatricNo] = useState('');
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [stats, setStats] = useState({ present: 0, absent: 0, total: 0, percentage: 0 });
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

 const handleSearch = async () => {
  const trimmed = matricNo.trim();

  if (!trimmed) {
    toast.error('Please enter your matric number');
    return;
  }

  setLoading(true);
  setSearched(true);

  // DB (recent) + Sheet (archive) + Progress (percentages)
  const [dbRes, sheetRes, progressRes] = await Promise.all([
    supabase.rpc('get_attendance_by_matric', { _matric_no: trimmed }),
    supabase.functions.invoke('sheets-sync', { body: { action: 'lookup_by_matric', matric_no: trimmed } }),
    supabase.functions.invoke('get-student-progress', { body: { matric_no: trimmed } }),
  ]);

  if (dbRes.error) console.log('DB ERROR:', dbRes.error);
  if (sheetRes.error) console.log('SHEET ERROR:', sheetRes.error);
  if (progressRes.error) console.log('PROGRESS ERROR:', progressRes.error);

  const dbRows: AttendanceRow[] = ((dbRes.data ?? []) as any[]).map(r => ({
    attendance_date: r.attendance_date,
    status: r.status,
    department_name: r.department_name ?? '',
  }));
  const sheetRows: AttendanceRow[] = ((sheetRes.data?.rows ?? []) as any[]).map((r: any) => ({
    attendance_date: r.date,
    status: r.status,
    department_name: r.department ?? '',
  }));
  const seen = new Set<string>();
  const merged: AttendanceRow[] = [];
  for (const r of [...dbRows, ...sheetRows]) {
    const k = `${r.attendance_date}|${r.status}|${r.department_name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(r);
  }
  merged.sort((a, b) => (b.attendance_date ?? '').localeCompare(a.attendance_date ?? ''));
  setRecords(merged);

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

  if (!merged.length) toast.message('No attendance records found for this matric number');
  setLoading(false);
};



  const { present, absent, percentage } = stats;

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

        <div className="text-center space-y-1">
          <h1 className="text-2xl font-heading font-bold">Check Your Attendance</h1>
          <p className="text-muted-foreground text-sm">Enter your matric number to view your attendance records</p>
        </div>

        <Card>
          <CardContent className="pt-6">
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
          </CardContent>
        </Card>

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

        {searched && records.length === 0 && !loading && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <p>No attendance records found for this matric number.</p>
              <p className="text-xs mt-1">Make sure your matric number is correct.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default CheckAttendance;
