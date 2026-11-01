import { useCallback, useEffect, useState } from "react";
import { BookOpen, Loader2, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { DepartmentCourse } from "@/components/dept-admin/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type StaffRole = "lecturer" | "course_rep";
type DepartmentProfile = { user_id: string; name: string; email: string };
type Assignment = {
  id: string;
  user_id: string;
  course_id: string;
  staff_role: string;
};

export function CourseStaffManager({
  departmentId,
  courses,
}: {
  departmentId: string;
  courses: DepartmentCourse[];
}) {
  const [profiles, setProfiles] = useState<DepartmentProfile[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [userId, setUserId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [staffRole, setStaffRole] = useState<StaffRole>("lecturer");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [profileResult, assignmentResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("user_id, name, email")
        .eq("department_id", departmentId)
        .order("name"),
      supabase
        .from("course_staff")
        .select("id, user_id, course_id, staff_role")
        .eq("department_id", departmentId)
        .order("created_at", { ascending: false }),
    ]);

    const fetchError = profileResult.error ?? assignmentResult.error;
    if (fetchError) {
      setError(fetchError.message);
    } else {
      setProfiles(profileResult.data ?? []);
      setAssignments(assignmentResult.data ?? []);
    }
    setLoading(false);
  }, [departmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateAssignment = async (
    targetUserId: string,
    targetCourseId: string,
    targetRole: StaffRole,
    assigned: boolean,
  ) => {
    setBusy(true);
    try {
      const { error: assignmentError } = await supabase.rpc(
        "set_course_staff_assignment",
        {
          _user_id: targetUserId,
          _course_id: targetCourseId,
          _staff_role: targetRole,
          _assigned: assigned,
        },
      );
      if (assignmentError) throw assignmentError;
      toast.success(assigned ? "Course staff assigned." : "Course staff removed.");
      await load();
    } catch (assignmentFailure) {
      toast.error(
        assignmentFailure instanceof Error
          ? assignmentFailure.message
          : "Unable to update course staff.",
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (!userId || !courseId) return;
    void updateAssignment(userId, courseId, staffRole, true);
  };

  const profileFor = (id: string) => profiles.find((profile) => profile.user_id === id);
  const courseFor = (id: string) => courses.find((course) => course.id === id);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-heading font-semibold">Course staff assignments</h2>
        <p className="text-sm text-muted-foreground">
          Department administrators can assign registered department users as lecturers or course reps.
          Assignment also grants only the matching staff role.
        </p>
      </div>

      {error && <div role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</div>}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4" />Assign a course</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger aria-label="Select department user"><SelectValue placeholder="Select registered user" /></SelectTrigger>
            <SelectContent>
              {profiles.map((profile) => (
                <SelectItem key={profile.user_id} value={profile.user_id}>
                  {profile.name} · {profile.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={courseId} onValueChange={setCourseId}>
            <SelectTrigger aria-label="Select course"><SelectValue placeholder="Select course" /></SelectTrigger>
            <SelectContent>
              {courses.map((course) => (
                <SelectItem key={course.id} value={course.id}>{course.code} · {course.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={staffRole} onValueChange={(value) => setStaffRole(value as StaffRole)}>
            <SelectTrigger aria-label="Select course staff role"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="lecturer">Lecturer</SelectItem>
              <SelectItem value="course_rep">Course rep</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={submit} disabled={busy || loading || !userId || !courseId}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Assign
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Current assignments</CardTitle>
          <Button variant="outline" size="icon" aria-label="Refresh assignments" onClick={() => void load()} disabled={loading || busy}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading assignments…</div>
          ) : assignments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No course staff assigned yet.</p>
          ) : (
            <div className="divide-y">
              {assignments.map((assignment) => {
                const profile = profileFor(assignment.user_id);
                const course = courseFor(assignment.course_id);
                return (
                  <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex items-start gap-3">
                      <BookOpen className="mt-1 h-4 w-4 text-primary" />
                      <div>
                        <p className="font-medium">{profile?.name ?? "Department user"}</p>
                        <p className="text-sm text-muted-foreground">{course ? `${course.code} · ${course.name}` : "Department course"} · {assignment.staff_role === "lecturer" ? "Lecturer" : "Course rep"}</p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void updateAssignment(assignment.user_id, assignment.course_id, assignment.staff_role as StaffRole, false)}
                      disabled={busy}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />Remove
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
