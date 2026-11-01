export type HierarchyRole = 'institution_admin' | 'faculty_admin';

export interface HierarchyScope {
  role: HierarchyRole;
  institution_id: string;
  faculty_id: string | null;
}

export function hierarchyPermissions(platformAdmin: boolean, scope: HierarchyScope | null, institutionId: string, facultyId?: string, active = true) {
  const institutionMatch = active && scope?.institution_id === institutionId;
  return {
    manageInstitutions: platformAdmin,
    manageFaculties: platformAdmin || (institutionMatch && scope?.role === 'institution_admin'),
    manageDepartments: platformAdmin || (institutionMatch && scope?.role === 'institution_admin'),
    viewFaculty: platformAdmin || (institutionMatch && (scope?.role === 'institution_admin' || scope?.faculty_id === facultyId)),
    assignAdministrators: platformAdmin,
  };
}