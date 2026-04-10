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
import { CalendarCheck, Download, History, Users, Plus, Upload, Save, Trash2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import * as XLSX from "xlsx";

interface Student {
  id: string;
  name: string;
  gender: string | null;
  matric_no: string | null;
  department_id: string;
}

interface AttendanceRecord {
  id: string;
  student_ref: string;
  date: string;
  status: string;
  students: { name: string } | null;
}

const DeptAdminDashboard = () => {
  const { profile, user } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [departmentName, setDepartmentName] = useState<string>('');
  const [dateColumns, setDateColumns] = useState<string[]>([new Date().toISOString().split('T')[0]]);
  const [grid, setGrid] = useState<Record<string, Record<string, 'P' | 'A' | ''>>>({});
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'mark' | 'history' | 'students'>('mark');
  const [studentEdits, setStudentEdits] = useState<Record<string, Partial<Student>>>({});
  const [savingStudents, setSavingStudents] = useState(false);
  const [savingAttendance, setSavingAttendance] = useState(false);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newStudent, setNewStudent] = useState({ name: '', gender: '', matric_no: '' });
  const [addingStudent, setAddingStudent] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!profile?.department_id) return;
    fetchStudents();
    fetchHistory();
    fetchDepartmentName();
    fetchAttendanceGrid();
  }, [profile?.department_id]);

  const fetchDepartmentName = async () => {
    const { data } = await supabase
      .from('departments')
      .select('name')
      .eq('id', profile!.department_id!)
      .single();
    if (data) setDepartmentName(data.name);
  };

  const fetchStudents = async () => {
    const { data } = await (supabase as any)
      .from('students')
      .select('id, name, gender, matric_no, department_id')
      .eq('department_id', profile!.department_id!)
      .order('name');
    if (data) setStudents(data as Student[]);
  };

  const fetchHistory = async () => {
    const { data } = await (supabase as any)
      .from('attendance')
      .select('id, student_ref, date, status, students:student_ref(name)')
      .eq('department_id', profile!.department_id!)
      .order('date', { ascending: false })
      .limit(200);
    if (data) setHistory(data as AttendanceRecord[]);
  };

  const addDateColumn = () => {
    const newDate = new Date().toISOString().split('T')[0];
    if (!dateColumns.includes(newDate)) {
      setDateColumns(prev => [...prev, newDate]);
    } else {
      let d = new Date();
      while (dateColumns.includes(d.toISOString().split('T')[0])) {
        d.setDate(d.getDate() + 1);
      }
      setDateColumns(prev => [...prev, d.toISOString().split('T')[0]]);
    }
  };

  const updateDateColumn = (index: number, value: string) => {
    setDateColumns(prev => prev.map((d, i) => i === index ? value : d));
  };

  const removeDateColumn = (index: number) => {
    if (dateColumns.length <= 1) return;
    const dateToRemove = dateColumns[index];
    setDateColumns(prev => prev.filter((_, i) => i !== index));
    setGrid(prev => {
      const next = { ...prev };
      for (const sid of Object.keys(next)) {
        const { [dateToRemove]: _, ...rest } = next[sid];
        next[sid] = rest;
      }
      return next;
    });
  };

  const toggleCell = (studentId: string, date: string) => {
    setGrid(prev => {
      const current = prev[studentId]?.[date] || '';
      const next = current === '' ? 'P' : current === 'P' ? 'A' : '';
      return {
        ...prev,
        [studentId]: { ...prev[studentId], [date]: next },
      };
    });
  };

  const saveAttendance = async () => {
    if (!profile?.department_id || !user?.id) return;

    const rows: any[] = [];
    for (const student of students) {
      for (const date of dateColumns) {
        const val = grid[student.id]?.[date];
        if (val === 'P' || val === 'A') {
          rows.push({
            student_ref: student.id,
            department_id: profile.department_id,
            marked_by: user.id,
            date,
            status: val === 'P' ? 'present' : 'absent',
          });
        }
      }
    }

    if (rows.length === 0) {
      toast.error('No attendance marked to save');
      return;
    }

    setSavingAttendance(true);
    const { error } = await (supabase as any)
    .from('attendance')
    .upsert(rows, {
    onConflict: 'student_ref,date'
  });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`Saved ${rows.length} attendance records`);
      await fetchAttendanceGrid();
      fetchHistory();
    }
    setSavingAttendance(false);
  };

  const fetchAttendanceGrid = async () => {
  if (!profile?.department_id) return;

  const { data } = await supabase
    .from('attendance')
    .select('student_ref, date, status')
    .eq('department_id', profile.department_id);

  if (!data) return;

  const newGrid: any = {};

  data.forEach((r: any) => {
    const val = r.status === 'present' ? 'P' : 'A';

    if (!newGrid[r.student_ref]) newGrid[r.student_ref] = {};
    newGrid[r.student_ref][r.date] = val;
  });

  setGrid(newGrid);
};

  const exportCSV = () => {
    if (students.length === 0) {
      toast.error('No students to export');
      return;
    }

    const headers = ['S/N', 'Name', 'Gender', 'Matric No', 'Department', ...dateColumns];
    const rows = students.map((s, i) => {
      const cells = [
        String(i + 1),
        s.name,
        s.gender || '',
        s.matric_no || '',
        departmentName,
        ...dateColumns.map(d => grid[s.id]?.[d] || ''),
      ];
      return cells.map(c => `"${c.replace(/"/g, '""')}"`).join(',');
    });

    const csv =  "\uFEFF" + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance_${departmentName}_${dateColumns[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const exportExcel = () => {
  if (students.length === 0) {
    toast.error('No students to export');
    return;
  }

  const data = students.map((s, i) => {
    const row: any = {
      "S/N": i + 1,
      "Name": s.name,
      "Gender": s.gender || '',
      "Matric No": s.matric_no || '',
      "Department": departmentName,
    };

    dateColumns.forEach(d => {
      const value = grid[s.id]?.[d] || '';

      // optional: make it readable in Excel
      row[d] = value === 'P' ? 'Present' : value === 'A' ? 'Absent' : '';
    });

    return row;
  });

  const worksheet = XLSX.utils.json_to_sheet(data);

  // ✅ AUTO COLUMN WIDTH FIX
  const cols = Object.keys(data[0]).map(key => ({
    wch: Math.max(
      key.length,
      ...data.map(row => String(row[key] || '').length)
    ) + 2
  }));

  worksheet['!cols'] = cols;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance");

  XLSX.writeFile(workbook, `attendance_${departmentName}.xlsx`);

  toast.success('Excel exported');
};

  const updateStudentField = (id: string, field: string, value: string) => {
    setStudentEdits(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
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
    for (const [id, edits] of editEntries) {
      const { error } = await (supabase as any).from('students').update(edits).eq('id', id);
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
    if (!newStudent.name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!profile?.department_id) return;
    setAddingStudent(true);

    const { error } = await (supabase as any).from('students').insert({
      name: newStudent.name.trim(),
      gender: newStudent.gender || null,
      matric_no: newStudent.matric_no.trim() || null,
      department_id: profile.department_id,
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Student added');
      setNewStudent({ name: '', gender: '', matric_no: '' });
      setShowAddDialog(false);
      fetchStudents();
    }
    setAddingStudent(false);
  };

  const deleteStudent = async (id: string, name: string) => {
    if (!confirm(`Delete student "${name}"? This cannot be undone.`)) return;
    const { error } = await (supabase as any).from('students').delete().eq('id', id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Student deleted');
      fetchStudents();
    }
  };

  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile?.department_id) return;

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
      const genderIdx = headers.findIndex(h => h === 'gender');
      const matricIdx = headers.findIndex(h => h.includes('matric'));

      if (nameIdx === -1) {
        toast.error('CSV must have a "name" column');
        setImporting(false);
        return;
      }

      const csvRows = lines.slice(1).map(line => {
        const cols = line.split(',').map(c => c.trim());
        return {
          name: cols[nameIdx] || '',
          gender: genderIdx >= 0 ? cols[genderIdx] || null : null,
          matric_no: matricIdx >= 0 ? cols[matricIdx] || null : null,
          department_id: profile.department_id!,
        };
      }).filter(s => s.name);

      if (csvRows.length === 0) {
        toast.error('No valid students found in CSV');
        setImporting(false);
        return;
      }

      const { error } = await (supabase as any).from('students').insert(csvRows);
      if (error) {
        toast.error(error.message);
      } else {
        toast.success(`Imported ${csvRows.length} students`);
        fetchStudents();
      }
    } catch {
      toast.error('Failed to parse CSV file');
    }

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

  const cellStyles: Record<string, string> = {
    P: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    A: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    '': 'bg-muted text-muted-foreground',
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
          <p className="text-muted-foreground text-sm mt-1">
            Department: <span className="font-semibold text-foreground">{departmentName || 'Loading...'}</span>
          </p>
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

        {activeTab === 'mark' && (
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">Mark Attendance</CardTitle>
                  <p className="text-sm text-muted-foreground mt-0.5">Department: {departmentName}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={addDateColumn}>
                    <Plus className="w-4 h-4 mr-1" /> Add Date
                  </Button>
                  <Button variant="outline" onClick={exportCSV} disabled={students.length === 0}>
                    <Download className="w-4 h-4 mr-1" /> Export CSV
                  </Button>
                  <Button variant="outline" onClick={exportExcel}>
                  <Download className="w-4 h-4 mr-1" /> Excel
                  </Button>
                  <Button onClick={saveAttendance} disabled={savingAttendance || students.length === 0}>
                    <Save className="w-4 h-4 mr-1" /> {savingAttendance ? 'Saving...' : 'Save Attendance'}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Click a cell to toggle: empty → P (Present) → A (Absent) → empty</p>
            </CardHeader>
            <CardContent>
              {students.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No students yet. Go to the Students tab to add some.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12 text-center">S/N</TableHead>
                        <TableHead className="min-w-[150px]">Name</TableHead>
                        <TableHead className="w-16 text-center">Gender</TableHead>
                        <TableHead className="min-w-[130px]">Matric No</TableHead>
                        <TableHead className="min-w-[120px]">Department</TableHead>
                        {dateColumns.map((date, i) => (
                          <TableHead key={i} className="text-center min-w-[110px]">
                            <div className="flex flex-col items-center gap-1">
                              <Input
                                type="date"
                                value={date}
                                onChange={e => updateDateColumn(i, e.target.value)}
                                className="h-7 text-xs w-[120px] px-1"
                              />
                              {dateColumns.length > 1 && (
                                <button onClick={() => removeDateColumn(i)} className="text-[10px] text-destructive hover:underline">
                                  remove
                                </button>
                              )}
                            </div>
                          </TableHead>
                        ))}
                        <TableHead className="w-20 text-center">Remark</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {students.map((student, idx) => (
                        <TableRow key={student.id}>
                          <TableCell className="text-center font-medium">{idx + 1}</TableCell>
                          <TableCell className="font-medium">{student.name}</TableCell>
                          <TableCell className="text-center text-sm">{student.gender ? student.gender.charAt(0) : ''}</TableCell>
                          <TableCell className="text-sm">{student.matric_no || ''}</TableCell>
                          <TableCell className="text-sm">{departmentName}</TableCell>
                          {dateColumns.map((date, i) => {
                            const val = grid[student.id]?.[date] || '';
                            return (
                              <TableCell key={i} className="text-center p-1">
                                <button
                                  onClick={() => toggleCell(student.id, date)}
                                  className={`w-full h-8 rounded text-xs font-bold transition-colors ${cellStyles[val]}`}
                                >
                                  {val || '—'}
                                </button>
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-center text-sm text-muted-foreground">—</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'students' && (
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="text-lg">Student Details</CardTitle>
                <div className="flex items-center gap-2">
                  <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCSVImport} className="hidden" />
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                    <Upload className="w-4 h-4 mr-1" /> {importing ? 'Importing...' : 'Import CSV'}
                  </Button>
                  <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                    <DialogTrigger asChild>
                      <Button><Plus className="w-4 h-4 mr-1" /> Add Student</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Add New Student</DialogTitle></DialogHeader>
                      <div className="space-y-4 pt-2">
                        <div>
                          <label className="text-sm font-medium">Name *</label>
                          <Input value={newStudent.name} onChange={e => setNewStudent(p => ({ ...p, name: e.target.value }))} placeholder="Full name" />
                        </div>
                        <div>
                          <label className="text-sm font-medium">Gender</label>
                          <Select value={newStudent.gender} onValueChange={v => setNewStudent(p => ({ ...p, gender: v }))}>
                            <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Male">Male</SelectItem>
                              <SelectItem value="Female">Female</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-sm font-medium">Matric No</label>
                          <Input value={newStudent.matric_no} onChange={e => setNewStudent(p => ({ ...p, matric_no: e.target.value }))} placeholder="e.g. MAT/2024/001" />
                        </div>
                        <Button onClick={addStudent} disabled={addingStudent} className="w-full">
                          {addingStudent ? 'Adding...' : 'Add Student'}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                  {Object.keys(studentEdits).length > 0 && (
                    <Button onClick={saveStudentDetails} disabled={savingStudents}>
                      Save Changes
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">CSV format: name, gender, matric_no (header row required)</p>
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
                        <TableHead>Gender</TableHead>
                        <TableHead>Matric No</TableHead>
                        <TableHead className="w-16">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {students.map(student => {
                        const edits = studentEdits[student.id] || {};
                        return (
                          <TableRow key={student.id}>
                            <TableCell>
                              <Input value={edits.name ?? student.name} onChange={(e) => updateStudentField(student.id, 'name', e.target.value)} className="min-w-[140px]" />
                            </TableCell>
                            <TableCell>
                              <Select value={edits.gender ?? student.gender ?? ''} onValueChange={(v) => updateStudentField(student.id, 'gender', v)}>
                                <SelectTrigger className="w-[120px]"><SelectValue placeholder="Select" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Male">Male</SelectItem>
                                  <SelectItem value="Female">Female</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input value={edits.matric_no ?? student.matric_no ?? ''} onChange={(e) => updateStudentField(student.id, 'matric_no', e.target.value)} placeholder="e.g. MAT/2024/001" className="min-w-[160px]" />
                            </TableCell>
                            <TableCell>
                              <Button variant="ghost" size="icon" onClick={() => deleteStudent(student.id, student.name)} className="text-destructive hover:text-destructive">
                                <Trash2 className="w-4 h-4" />
                              </Button>
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

        {activeTab === 'history' && (
          <Card>
            <CardHeader><CardTitle className="text-lg">Attendance History</CardTitle></CardHeader>
            <CardContent>
              <div className="mb-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                  {students.map(student => {
                    const month = new Date().toISOString().slice(0, 7);

                    const records = history.filter(
                      r => r.student_ref === student.id && r.date.startsWith(month)
                    );

                    const total = records.length;
                    const present = records.filter(r => r.status === 'present').length;
                    const percent = total ? ((present / total) * 100).toFixed(1) : '0.0';

                    return (
                      <div
                        key={student.id}
                        className="p-3 rounded-lg border bg-muted/30"
                      >
                        <p className="font-medium text-sm">{student.name}</p>

                        <p className="text-xs text-muted-foreground">
                          Present: {present} / {total}
                        </p>

                        <p
                          className={`text-sm font-bold ${
                            Number(percent) >= 75
                              ? 'text-green-600'
                              : 'text-red-500'
                          }`}
                        >
                          {percent}%
                        </p>
                      </div>
                    );
                  })}
                </div>
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
                        <TableCell>{r.students?.name ?? 'Unknown'}</TableCell>
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
