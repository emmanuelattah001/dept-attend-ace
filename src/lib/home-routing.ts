import type { AppRole } from '@/hooks/useAuth';

export type HomeRolePreference = 'student' | 'lecturer' | 'admin';

export function resolveHomeRole(
  currentRole: AppRole | null,
  assignedRoles: readonly AppRole[],
  preference: HomeRolePreference | null,
): AppRole | null {
  if (preference === 'admin') {
    const adminRoles: AppRole[] = ['super_admin', 'dept_admin', 'hod', 'course_rep'];
    return adminRoles.find((candidate) => assignedRoles.includes(candidate)) ?? currentRole;
  }
  if (preference && assignedRoles.includes(preference)) return preference;
  return currentRole;
}