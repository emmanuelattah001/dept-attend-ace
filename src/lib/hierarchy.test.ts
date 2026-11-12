import { describe, expect, it } from 'vitest';
import { hierarchyPermissions, type HierarchyScope } from './hierarchy';

describe('hierarchy boundaries', () => {
  const institution: HierarchyScope = { role: 'institution_admin', institution_id: 'university-a', faculty_id: null };
  const faculty: HierarchyScope = { role: 'faculty_admin', institution_id: 'university-a', faculty_id: 'science' };
  it('institution administrators cannot create institutions or assign broader administrators', () => {
    expect(hierarchyPermissions(false, institution, 'university-a').manageInstitutions).toBe(false);
    expect(hierarchyPermissions(false, institution, 'university-a').assignAdministrators).toBe(false);
  });
  it('institution administrators manage only their own institution', () => {
    expect(hierarchyPermissions(false, institution, 'university-a').manageDepartments).toBe(true);
    expect(hierarchyPermissions(false, institution, 'university-b').manageDepartments).toBe(false);
  });
  it('faculty administrators view only their assigned faculty', () => {
    expect(hierarchyPermissions(false, faculty, 'university-a', 'science').viewFaculty).toBe(true);
    expect(hierarchyPermissions(false, faculty, 'university-a', 'arts').viewFaculty).toBe(false);
    expect(hierarchyPermissions(false, faculty, 'university-b', 'science').viewFaculty).toBe(false);
    expect(hierarchyPermissions(false, faculty, 'university-a', 'science').manageDepartments).toBe(false);
  });
  it('suspended institutions disable scoped administration', () => {
    expect(hierarchyPermissions(false, institution, 'university-a', 'science', false).manageFaculties).toBe(false);
  });
  it('platform super admins manage the hierarchy', () => {
    expect(hierarchyPermissions(true, null, 'university-b').manageInstitutions).toBe(true);
    expect(hierarchyPermissions(true, null, 'university-b').assignAdministrators).toBe(true);
  });
  it('academic periods are visible within scope and editable only by institution or platform admins', () => {
    expect(hierarchyPermissions(false, faculty, 'university-a').viewAcademicPeriods).toBe(true);
    expect(hierarchyPermissions(false, faculty, 'university-a').manageAcademicPeriods).toBe(false);
    expect(hierarchyPermissions(false, institution, 'university-a').manageAcademicPeriods).toBe(true);
    expect(hierarchyPermissions(false, institution, 'university-b').viewAcademicPeriods).toBe(false);
  });
  it('institution administrators may invite only faculty administrators in their own institution', () => {
    expect(hierarchyPermissions(false, institution, 'university-a').inviteFacultyAdmins).toBe(true);
    expect(hierarchyPermissions(false, institution, 'university-a').inviteInstitutionAdmins).toBe(false);
    expect(hierarchyPermissions(false, institution, 'university-b').inviteFacultyAdmins).toBe(false);
  });
});