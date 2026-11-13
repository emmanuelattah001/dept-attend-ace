export interface HierarchyInviteCaller {
  roles: string[];
  hierarchyRole: string | null;
  institutionId: string | null;
}

export interface HierarchyInviteTarget {
  role: string;
  institutionId: string;
}

export function mayInviteHierarchyAdmin(caller: HierarchyInviteCaller, target: HierarchyInviteTarget): boolean {
  if (caller.roles.includes('super_admin')) return true;
  return caller.hierarchyRole === 'institution_admin' &&
    caller.institutionId === target.institutionId &&
    target.role === 'faculty_admin';
}