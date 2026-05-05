import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Building2, Users, CalendarCheck, Download, UserCog } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import LoadingScreen from '@/components/LoadingScreen';

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
  department?: string; // For display
  role?: string; // For display
}

interface AttendanceRow {
  id: string;
  student_ref: string | null;
  department_id: string;
  date: string;
  status: string;
  students: { name: string; matric_no: string | null; gender: string | null } | null;
  departments: { name: string } | null;
}

interface UserRole {
  user_id: string;
  role: string;
}

const SuperAdminDashboard = () => {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [newDeptName, setNewDeptName] = useState('');
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [activeTab, setActiveTab] = useState<'departments' | 'users' | 'attendance'>('departments');
  const [filterDept, setFilterDept] = useState<string>('all');
  const [filterDate, setFilterDate] = useState<string>('');
  const [initialLoading, setInitialLoading] = useState(true);

  const fetchDepartments = async () => {
    const { data } = await supabase.from('departments').select('*').order('name');
    if (data) setDepartments(data as Department[]);
  };

  const fetchUsers = async () => {
    const { data: profiles } = await supabase.from('profiles').select('*').order('name');
    
    if (profiles) {
      // Fetch roles for all users
      const { data: roles } = await supabase.from('user_roles').select('user_id, role');
      
      const rolesMap = new Map();
      if (roles) {
        roles.forEach(role => {
          rolesMap.set(role.user_id, role.role);
        });
      }
      
      // Create a map for department names
      const deptMap = new Map();
      departments.forEach(dept => {
        deptMap.set(dept.id, dept.name);
      });
      
      // Add department name and role to each user
      const usersWithDetails = profiles.map(profile => ({
        ...profile,
        department: profile.department_id ? deptMap.get(profile.department_id) || 'Not Assigned' : 'Not Assigned',
        role: rolesMap.get(profile.user_id) || 'No Role'
      }));
      
      setUsers(usersWithDetails as ProfileRow[]);
    }
  };

  const fetchUserRoles = async () => {
    const { data } = await supabase.from('user_roles').select('user_id, role');
    if (data) setUserRoles(data);
  };

  const fetchAttendance = async () => {
    let query = (supabase as any)
      .from('attendance')
      .select('id, student_ref, department_id, date, status, students:student_ref(name, matric_no, gender), departments(name)')
      .order('date', { ascending: false })
      .limit(500);

    if (filterDept && filterDept !== 'all') {
      query = query.eq('department_id', filterDept);
    }
    if (filterDate) {
      query = query.eq('date', filterDate);
    }

    const { data } = await query;
    if (data) setAttendance(data as unknown as AttendanceRow[]);
  };

  useEffect(() => {
    Promise.all([fetchDepartments(), fetchUserRoles()])
      .then(() => fetchUsers())
      .finally(() => setInitialLoading(false));
  }, []);

  useEffect(() => {
    fetchAttendance();
  }, [filterDept, filterDate]);

  // Refresh users when departments change (for department names)
  useEffect(() => {
    if (!initialLoading) {
      fetchUsers();
    }
  }, [departments]);

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
      fetchUserRoles();
      fetchUsers();
      setSelectedUser('');
      setSelectedRole('');
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
      setSelectedUser('');
      setSelectedDept('');
    }
  };

  const exportAttendanceCSV = () => {
    if (attendance.length === 0) {
      toast.error('No records to export');
      return;
    }
    const headers = ['S/N', 'Name', 'Gender', 'Matric No', 'Department', 'Date', 'Status'];
    const rows = attendance.map((a, i) => [
      String(i + 1),
      a.students?.name ?? 'Unknown',
      a.students?.gender ?? '',
      a.students?.matric_no ?? '',
      a.departments?.name ?? 'Unknown',
      a.date,
      a.status,
    ].map(c => `"${String(c).replace(/"/g, '""')}"`).join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const deptLabel = filterDept !== 'all' ? departments.find(d => d.id === filterDept)?.name || 'dept' : 'all';
    a.download = `attendance_${deptLabel}_${filterDate || 'all-dates'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  // Summary stats
  const presentCount = attendance.filter(a => a.status === 'present').length;
  const absentCount = attendance.filter(a => a.status === 'absent').length;

  const statusStyles: Record<string, string> = {
    present: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    absent: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  };

  const tabs = [
    { key: 'departments' as const, label: 'Departments', icon: Building2 },
    { key: 'users' as const, label: 'Manage Users', icon: Users },
    { key: 'attendance' as const, label: 'All Attendance', icon: CalendarCheck },
  ];

  if (initialLoading) {
    return <LoadingScreen message="Loading dashboard..." />;
  }

  // Get user display text with department info
  const getUserDisplayText = (user: ProfileRow) => {
    const roleText = user.role && user.role !== 'No Role' ? ` (${user.role})` : '';
    const deptText = user.department && user.department !== 'Not Assigned' ? ` - ${user.department}` : '';
    return `${user.name} (${user.email})${roleText}${deptText}`;
  };

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
          <div className="space-y-6">
            {/* User Assignment Cards */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Assign Roles & Departments</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Role Assignment */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Assign Role</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <Select value={selectedUser} onValueChange={setSelectedUser}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select user">
                          {selectedUser && users.find(u => u.user_id === selectedUser) && 
                            getUserDisplayText(users.find(u => u.user_id === selectedUser)!)
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {users.map(u => (
                          <SelectItem key={u.user_id} value={u.user_id}>
                            {getUserDisplayText(u)}
                          </SelectItem>
                        ))}
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
                    <Button onClick={assignRole} disabled={!selectedUser || !selectedRole}>
                      Assign Role
                    </Button>
                    <div className="text-sm text-muted-foreground flex items-center">
                      <UserCog className="w-4 h-4 mr-1" />
                      Current role will be replaced
                    </div>
                  </div>
                </div>

                {/* Department Assignment */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Assign Department</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <Select value={selectedUser} onValueChange={setSelectedUser}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select user">
                          {selectedUser && users.find(u => u.user_id === selectedUser) && 
                            getUserDisplayText(users.find(u => u.user_id === selectedUser)!)
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {users.map(u => (
                          <SelectItem key={u.user_id} value={u.user_id}>
                            {getUserDisplayText(u)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={selectedDept} onValueChange={setSelectedDept}>
                      <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                      <SelectContent>
                        {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button onClick={assignDepartment} disabled={!selectedUser || !selectedDept}>
                      Assign Department
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Users List Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">All Users with Assignments</CardTitle>
                <p className="text-sm text-muted-foreground">View all users and their current role and department assignments</p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Department</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((user, index) => (
                        <TableRow key={user.user_id}>
                          <TableCell className="font-medium">{index + 1}</TableCell>
                          <TableCell>{user.name}</TableCell>
                          <TableCell>{user.email}</TableCell>
                          <TableCell>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              user.role === 'super_admin' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' :
                              user.role === 'dept_admin' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                              user.role === 'student' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                              'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                            }`}>
                              {user.role || 'Not Assigned'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              user.department && user.department !== 'Not Assigned'
                                ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200'
                                : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                            }`}>
                              {user.department || 'Not Assigned'}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                      {users.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground">
                            No users found
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'attendance' && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-2xl font-bold">{attendance.length}</p>
                  <p className="text-xs text-muted-foreground">Total Records</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{presentCount}</p>
                  <p className="text-xs text-muted-foreground">Present</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-2xl font-bold text-red-600">{absentCount}</p>
                  <p className="text-xs text-muted-foreground">Absent</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <CardTitle className="text-lg">Attendance Records</CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select value={filterDept} onValueChange={setFilterDept}>
                      <SelectTrigger className="w-[180px]"><SelectValue placeholder="Filter department" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Departments</SelectItem>
                        {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input
                      type="date"
                      value={filterDate}
                      onChange={e => setFilterDate(e.target.value)}
                      className="w-[160px]"
                      placeholder="Filter by date"
                    />
                    {filterDate && (
                      <Button variant="ghost" size="sm" onClick={() => setFilterDate('')}>Clear date</Button>
                    )}
                    <Button variant="outline" onClick={exportAttendanceCSV} disabled={attendance.length === 0}>
                      <Download className="w-4 h-4 mr-1" /> Export CSV
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">S/N</TableHead>
                        <TableHead>Student</TableHead>
                        <TableHead>Gender</TableHead>
                        <TableHead>Matric No</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attendance.map((a, idx) => (
                        <TableRow key={a.id}>
                          <TableCell className="text-center font-medium">{idx + 1}</TableCell>
                          <TableCell className="font-medium">{a.students?.name ?? 'Unknown'}</TableCell>
                          <TableCell>{a.students?.gender ? a.students.gender.charAt(0) : ''}</TableCell>
                          <TableCell>{a.students?.matric_no ?? ''}</TableCell>
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
                          <TableCell colSpan={7} className="text-center text-muted-foreground">No attendance records found</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default SuperAdminDashboard;
