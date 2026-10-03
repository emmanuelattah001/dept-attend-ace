import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BookOpen, Loader2, Plus } from "lucide-react";
import type { DepartmentCourse } from "./types";

interface CourseSelectorProps {
  courses: DepartmentCourse[];
  selectedCourse: string;
  onSelectCourse: (courseId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newCourse: { name: string; code: string };
  onNewCourseChange: (course: { name: string; code: string }) => void;
  onAddCourse: () => void;
  addingCourse: boolean;
}

export function CourseSelector({
  courses, selectedCourse, onSelectCourse, open, onOpenChange, newCourse,
  onNewCourseChange, onAddCourse, addingCourse,
}: CourseSelectorProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg"><BookOpen className="h-5 w-5" />Courses / Subjects</CardTitle>
            <p className="text-sm text-muted-foreground">Add courses like PHY 101, CHM 101 to mark attendance separately</p>
          </div>
          <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />Add Course</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add New Course</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <div><label className="text-sm font-medium">Course Code *</label><Input value={newCourse.code} onChange={(event) => onNewCourseChange({ ...newCourse, code: event.target.value })} placeholder="e.g., PHY 101, CHM 101" /></div>
                <div><label className="text-sm font-medium">Course Name *</label><Input value={newCourse.name} onChange={(event) => onNewCourseChange({ ...newCourse, name: event.target.value })} placeholder="e.g., General Physics, Organic Chemistry" /></div>
                <Button onClick={onAddCourse} disabled={addingCourse} className="w-full">
                  {addingCourse ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  {addingCourse ? "Adding..." : "Add Course"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Button variant={!selectedCourse ? "default" : "outline"} size="sm" onClick={() => onSelectCourse("")} className="mb-2">All Courses</Button>
          {courses.map((course) => <Button key={course.id} variant={selectedCourse === course.id ? "default" : "outline"} size="sm" onClick={() => onSelectCourse(course.id)} className="mb-2">{course.code}</Button>)}
          {courses.length === 0 && <p className="text-sm text-muted-foreground">No courses added yet. Click "Add Course" to create one.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
