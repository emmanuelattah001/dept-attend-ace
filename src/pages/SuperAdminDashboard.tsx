import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Building2, Users, CalendarCheck } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Department {
  id: string;
  name: string;
}

interface ProfileRow {
  id: string;
  user_id: string;
  name: string;
  email: string;
  department_id: string | null;
}

interface AttendanceRow {
  id: string;
  student_ref: string | null;
  department_id: string;
  date: string;
  status: string;
  students: { name: string } | null;
  departments: { name: string } | null;
}

const SuperAdminDashboard = () => {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [newDeptName, setNewDeptName] = useState('');
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [activeTab, setActiveTab] = useState<'departments' | 'users' | 'attendance'>('departments');
  const [filterDept, setFilterDept] = useState<string>('all');

  const fetchDepartments = async () => {
    const { data } = await supabase.from('departments').select('*').order('name');
    if (data) setDepartments(data as Department[]);
  };

  const fetchUsers = async () => {
    const { data } = await supabase.from('profiles').select('*').order('name');
    if (data) setUsers(data as ProfileRow[]);
  };

  const fetchAttendance = async () => {
    let query = (supabase as any)
      .from('attendance')
      .select('id, student_ref, department_id, date, status, students:student_ref(name), departments(name)')
      .order('date', { ascending: false })
      .limit(200);

    if (filterDept && filterDept !== 'all') {
      query = query.eq('department_id', filterDept);
    }

    const { data } = await query;
    if (data) setAttendance(data as unknown as AttendanceRow[]);
  };

  useEffect(() => {
    fetchDepartments();
    fetchUsers();
  }, []);

  useEffect(() => {
    fetchAttendance();
  }, [filterDept]);

  const createDepartment = async () => {
    if (!newDeptName.trim()) return;
    const { error } = await supabase.from('departments').insert({ name: newDeptName.trim() });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Department created');
      setNewDeptName('');
      fetchDepartments();
    }
  };

  const assignRole = async () => {
    if (!selectedUser || !selectedRole) return;
    const { error: delError } = await supabase.from('user_roles').delete().eq('user_id', selectedUser);
    if (delError) { toast.error(delError.message); return; }

    const { error } = await supabase.from('user_roles').insert({
      user_id: selectedUser,
      role: selectedRole as any,
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Role assigned');
    }
  };

  const assignDepartment = async () => {
    if (!selectedUser || !selectedDept) return;
    const { error } = await supabase
      .from('profiles')
      .update({ department_id: selectedDept })
      .eq('user_id', selectedUser);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Department assigned');
      fetchUsers();
    }
  };

  const statusStyles: Record<string, string> = {
    present: 'bg-success text-success-foreground',
    absent: 'bg-destructive text-destructive-foreground',
  };

  const tabs = [
    { key: 'departments' as const, label: 'Departments', icon: Building2 },
    { key: 'users' as const, label: 'Manage Users', icon: Users },
    { key: 'attendance' as const, label: 'All Attendance', icon: CalendarCheck },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-heading font-bold">Super Admin Dashboard</h2>
          <p className="text-muted-foreground text-sm mt-1">Manage departments, users, and view all attendance</p>
        </div>

        <div className="flex gap-2 border-b">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'departments' && (
          <Card>
            <CardHeader><CardTitle className="text-lg">Departments</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input placeholder="Department name" value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createDepartment()} />
                <Button onClick={createDepartment}><Plus className="w-4 h-4 mr-1" /> Add</Button>
              </div>
              <div className="space-y-2">
                {departments.map(dept => (
                  <div key={dept.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{dept.name}</span>
                  </div>
                ))}
                {departments.length === 0 && <p className="text-muted-foreground text-sm text-center py-4">No departments yet</p>}
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === 'users' && (
          <Card>
            <CardHeader><CardTitle className="text-lg">Assign Roles & Departments</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Select value={selectedUser} onValueChange={setSelectedUser}>
                  <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                  <SelectContent>
                    {users.map(u => <SelectItem key={u.user_id} value={u.user_id}>{u.name} ({u.email})</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={selectedRole} onValueChange={setSelectedRole}>
                  <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                    <SelectItem value="dept_admin">Dept Admin</SelectItem>
                    <SelectItem value="student">Student</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={assignRole} disabled={!selectedUser || !selectedRole}>Assign Role</Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Select value={selectedUser} onValueChange={setSelectedUser}>
                  <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                  <SelectContent>
                    {users.map(u => <SelectItem key={u.user_id} value={u.user_id}>{u.name} ({u.email})</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={selectedDept} onValueChange={setSelectedDept}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button onClick={assignDepartment} disabled={!selectedUser || !selectedDept}>Assign Department</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === 'attendance' && (
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="text-lg">Attendance Records</CardTitle>
                <Select value={filterDept} onValueChange={setFilterDept}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="Filter by department" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendance.map(a => (
                      <TableRow key={a.id}>
                        <TableCell>{a.students?.name ?? 'Unknown'}</TableCell>
                        <TableCell>{a.departments?.name ?? 'Unknown'}</TableCell>
                        <TableCell>{a.date}</TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusStyles[a.status] || 'bg-muted text-muted-foreground'}`}>
                            {a.status}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                    {attendance.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">No attendance records yet</TableCell>
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

export default SuperAdminDashboard;
