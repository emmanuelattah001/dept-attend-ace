export interface DepartmentCourse {
  id: string;
  name: string;
  code: string;
  department_id: string;
}

export type DepartmentAdminTab = "mark" | "history" | "students" | "logins";
