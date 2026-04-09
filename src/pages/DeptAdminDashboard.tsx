import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { CalendarCheck, Save, History, Users, Plus, Upload } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Student {
  user_id: string;
  name: string;
  email: string;
  gender: string | null;
  matric_no: string | null;
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
  const [attendanceMap, setAttendanceMap] = useState<Record<string, 'present' | 'absent'>>({});
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'mark' | 'history' | 'students'>('mark');
  const [saving, setSaving] = useState(false);
  const [studentEdits, setStudentEdits] = useState<Record<string, Partial<Student>>>({});
  const [savingStudents, setSavingStudents] = useState(false);

  // Add student form
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newStudent, setNewStudent] = useState({ name: '', email: '', gender: '', matric_no: '' });
  const [addingStudent, setAddingStudent] = useState(false);

  // CSV import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!profile?.department_id) return;
    fetchStudents();
    fetchHistory();
  }, [profile?.department_id]);

  const fetchStudents = async () => {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, name, email, gender, matric_no')
      .eq('department_id', profile!.department_id!);

    if (!profiles) return;

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
    setAttendanceMap(prev => ({
      ...prev,
      [studentId]: prev[studentId] === 'absent' ? 'present' : 'absent',
    }));
  };

  const saveAttendance = async () => {
    if (!profile?.department_id || !profile?.user_id) return;
    setSaving(true);
    const entries = students.map(s => ({
      student_id: s.user_id,
      department_id: profile.department_id!,
      marked_by: profile.user_id,
      date,
      status: (attendanceMap[s.user_id] || 'present') as 'present' | 'absent',
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

  const updateStudentField = (userId: string, field: string, value: string) => {
    setStudentEdits(prev => ({
      ...prev,
      [userId]: { ...prev[userId], [field]: value },
    }));
  };

  const saveStudentDetails = async () => {
    setSavingStudents(true);
    const editEntries = Object.entries(studentEdits);
    if (editEntries.length === 0) {
      toast.info('No changes to save');
      setSavingStudents(false);
      return;
    }

    let hasError = false;
    for (const [userId, edits] of editEntries) {
      const { error } = await supabase
        .from('profiles')
        .update(edits as any)
        .eq('user_id', userId);
      if (error) {
        toast.error(`Failed to update student: ${error.message}`);
        hasError = true;
        break;
      }
    }

    if (!hasError) {
      toast.success('Student details saved');
      setStudentEdits({});
      fetchStudents();
    }
    setSavingStudents(false);
  };

  const addStudent = async () => {
    if (!newStudent.name.trim() || !newStudent.email.trim()) {
      toast.error('Name and email are required');
      return;
    }
    setAddingStudent(true);

    const { data, error } = await supabase.functions.invoke('create-student', {
      body: {
        students: [{
          name: newStudent.name.trim(),
          email: newStudent.email.trim(),
          gender: newStudent.gender || undefined,
          matric_no: newStudent.matric_no.trim() || undefined,
        }],
      },
    });

    if (error) {
      toast.error(error.message || 'Failed to add student');
    } else if (data?.success) {
      toast.success(`Student added (${data.created}/${data.total})`);
      setNewStudent({ name: '', email: '', gender: '', matric_no: '' });
      setShowAddDialog(false);
      fetchStudents();
    } else {
      toast.error(data?.error || 'Failed to add student');
    }
    setAddingStudent(false);
  };

  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        toast.error('CSV must have a header row and at least one data row');
        setImporting(false);
        return;
      }

      const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
      const nameIdx = headers.findIndex(h => h === 'name');
      const emailIdx = headers.findIndex(h => h === 'email');
      const genderIdx = headers.findIndex(h => h === 'gender');
      const matricIdx = headers.findIndex(h => h.includes('matric'));

      if (nameIdx === -1 || emailIdx === -1) {
        toast.error('CSV must have "name" and "email" columns');
        setImporting(false);
        return;
      }

      const students = lines.slice(1).map(line => {
        const cols = line.split(',').map(c => c.trim());
        return {
          name: cols[nameIdx] || '',
          email: cols[emailIdx] || '',
          gender: genderIdx >= 0 ? cols[genderIdx] : undefined,
          matric_no: matricIdx >= 0 ? cols[matricIdx] : undefined,
        };
      }).filter(s => s.name && s.email);

      if (students.length === 0) {
        toast.error('No valid students found in CSV');
        setImporting(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('create-student', {
        body: { students },
      });

      if (error) {
        toast.error(error.message || 'Import failed');
      } else if (data?.success) {
        toast.success(`Imported ${data.created} of ${data.total} students`);
        fetchStudents();
      } else {
        toast.error(data?.error || 'Import failed');
      }
    } catch (err: any) {
      toast.error('Failed to parse CSV file');
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
    setImporting(false);
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
  };

  const tabs = [
    { id: 'mark' as const, label: 'Mark Attendance', icon: CalendarCheck },
    { id: 'students' as const, label: 'Students', icon: Users },
    { id: 'history' as const, label: 'History', icon: History },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-heading font-bold">Department Admin</h2>
          <p className="text-muted-foreground text-sm mt-1">Manage students and attendance for your department</p>
        </div>

        <div className="flex gap-2 border-b">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </div>

        {/* Mark Attendance Tab */}
        {activeTab === 'mark' && (
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="text-lg">Mark Attendance</CardTitle>
                <div className="flex items-center gap-2">
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
                  <Button onClick={saveAttendance} disabled={saving || students.length === 0}>
                    <Save className="w-4 h-4 mr-1" /> Save
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {students.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No students in your department yet. Go to the Students tab to add some.</p>
              ) : (
                <div className="space-y-2">
                  {students.map(student => {
                    const status = attendanceMap[student.user_id] || 'present';
                    return (
                      <div key={student.user_id} className="flex items-center justify-between p-3 rounded-lg bg-muted">
                        <div>
                          <p className="font-medium">{student.name}</p>
                          <p className="text-xs text-muted-foreground">{student.matric_no || student.email}</p>
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

        {/* Students Tab */}
        {activeTab === 'students' && (
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="text-lg">Student Details</CardTitle>
                <div className="flex items-center gap-2">
                  {/* CSV Import */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleCSVImport}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importing}
                  >
                    <Upload className="w-4 h-4 mr-1" /> {importing ? 'Importing...' : 'Import CSV'}
                  </Button>

                  {/* Add Student Dialog */}
                  <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="w-4 h-4 mr-1" /> Add Student
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add New Student</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 pt-2">
                        <div>
                          <label className="text-sm font-medium">Name *</label>
                          <Input
                            value={newStudent.name}
                            onChange={e => setNewStudent(p => ({ ...p, name: e.target.value }))}
                            placeholder="Full name"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium">Email *</label>
                          <Input
                            type="email"
                            value={newStudent.email}
                            onChange={e => setNewStudent(p => ({ ...p, email: e.target.value }))}
                            placeholder="student@email.com"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium">Gender</label>
                          <Select
                            value={newStudent.gender}
                            onValueChange={v => setNewStudent(p => ({ ...p, gender: v }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select gender" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Male">Male</SelectItem>
                              <SelectItem value="Female">Female</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-sm font-medium">Matric No</label>
                          <Input
                            value={newStudent.matric_no}
                            onChange={e => setNewStudent(p => ({ ...p, matric_no: e.target.value }))}
                            placeholder="e.g. MAT/2024/001"
                          />
                        </div>
                        <Button onClick={addStudent} disabled={addingStudent} className="w-full">
                          {addingStudent ? 'Adding...' : 'Add Student'}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>

                  {Object.keys(studentEdits).length > 0 && (
                    <Button onClick={saveStudentDetails} disabled={savingStudents}>
                      <Save className="w-4 h-4 mr-1" /> Save Changes
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                CSV format: name, email, gender, matric_no (header row required)
              </p>
            </CardHeader>
            <CardContent>
              {students.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No students yet. Add them manually or import a CSV.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Gender</TableHead>
                        <TableHead>Matric No</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {students.map(student => {
                        const edits = studentEdits[student.user_id] || {};
                        return (
                          <TableRow key={student.user_id}>
                            <TableCell>
                              <Input
                                value={edits.name ?? student.name}
                                onChange={(e) => updateStudentField(student.user_id, 'name', e.target.value)}
                                className="min-w-[140px]"
                              />
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">{student.email}</TableCell>
                            <TableCell>
                              <Select
                                value={edits.gender ?? student.gender ?? ''}
                                onValueChange={(v) => updateStudentField(student.user_id, 'gender', v)}
                              >
                                <SelectTrigger className="w-[120px]">
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Male">Male</SelectItem>
                                  <SelectItem value="Female">Female</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input
                                value={edits.matric_no ?? student.matric_no ?? ''}
                                onChange={(e) => updateStudentField(student.user_id, 'matric_no', e.target.value)}
                                placeholder="e.g. MAT/2024/001"
                                className="min-w-[160px]"
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* History Tab */}
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
