import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Users } from 'lucide-react';

interface Course { id: string; name: string; code: string }
interface Person { user_id: string; name: string; email: string; role: string }
interface Assignment {
  id: string;
  course_id: string;
  user_id: string;
  staff_role: string;
}

const STAFF_ROLES = [
  { value: 'lecturer', label: 'Lecturer' },
  { value: 'course_rep', label: 'Course Rep' },
];

export function StaffAssignments({ courses }: { courses: Course[] }) {
  const { profile } = useAuth();
  const [people, setPeople] = useState<Person[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [courseId, setCourseId] = useState('');
  const [userId, setUserId] = useState('');
  const [staffRole, setStaffRole] = useState('lecturer');

  const load = async () => {
    if (!profile?.department_id) return;
    setLoading(true);
    try {
      const [profRes, assignRes] = await Promise.all([
        supabase.from('profiles').select('user_id, name, email').eq('department_id', profile.department_id),
        (supabase as any).from('course_staff').select('id, course_id, user_id, staff_role').eq('department_id', profile.department_id),
      ]);
      const profs = profRes.data ?? [];
      const ids = profs.map((p: any) => p.user_id);
      let roles: Record<string, string> = {};
      if (ids.length) {
        const { data: rolesData } = await supabase.from('user_roles').select('user_id, role').in('user_id', ids);
        (rolesData ?? []).forEach((r: any) => { roles[r.user_id] = r.role; });
      }
      setPeople(profs.map((p: any) => ({ ...p, role: roles[p.user_id] ?? 'unknown' })));
      setAssignments((assignRes.data ?? []) as Assignment[]);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load staff');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [profile?.department_id]);

  const assign = async () => {
    if (!courseId || !userId) { toast.error('Pick a course and a person'); return; }
    setSaving(true);
    try {
      const { error } = await (supabase as any).from('course_staff').insert({
        course_id: courseId,
        user_id: userId,
        staff_role: staffRole,
        department_id: profile?.department_id,
      });
      if (error) throw error;
      toast.success('Assigned');
      setUserId('');
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to assign');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    const { error } = await (supabase as any).from('course_staff').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    setAssignments(a => a.filter(x => x.id !== id));
    toast.success('Removed');
  };

  const courseLabel = (id: string) => {
    const c = courses.find(c => c.id === id);
    return c ? `${c.code} - ${c.name}` : '—';
  };
  const personLabel = (id: string) => people.find(p => p.user_id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Users className="w-5 h-5" /> Assign Staff & Course Reps</CardTitle>
          <p className="text-sm text-muted-foreground">Give lecturers and course reps access to specific courses.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-4 gap-3">
            <Select value={courseId} onValueChange={setCourseId}>
              <SelectTrigger><SelectValue placeholder="Course" /></SelectTrigger>
              <SelectContent>
                {courses.map(c => <SelectItem key={c.id} value={c.id}>{c.code} - {c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue placeholder="Person" /></SelectTrigger>
              <SelectContent>
                {people.map(p => (
                  <SelectItem key={p.user_id} value={p.user_id}>{p.name} · {p.role}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={staffRole} onValueChange={setStaffRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STAFF_ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={assign} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />} Assign
            </Button>
          </div>
          {people.length === 0 && !loading && (
            <p className="text-xs text-muted-foreground">
              No staff profiles in this department yet. Staff sign up on the login page with their email, then appear here.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Current Assignments</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? (
            <div className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : assignments.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">No assignments yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Course</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map(a => (
                  <TableRow key={a.id}>
                    <TableCell>{courseLabel(a.course_id)}</TableCell>
                    <TableCell>{personLabel(a.user_id)}</TableCell>
                    <TableCell><Badge variant="secondary">{a.staff_role.replace('_', ' ')}</Badge></TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => remove(a.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
