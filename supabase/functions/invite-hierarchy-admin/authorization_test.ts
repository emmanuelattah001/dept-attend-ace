import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { mayInviteHierarchyAdmin } from '../_shared/hierarchy-authorization.ts';

Deno.test('platform super admins may invite scoped administrators', () => {
  assertEquals(mayInviteHierarchyAdmin({ roles: ['super_admin'], hierarchyRole: null, institutionId: null }, { role: 'institution_admin', institutionId: 'institution-a' }), true);
  assertEquals(mayInviteHierarchyAdmin({ roles: ['super_admin'], hierarchyRole: null, institutionId: null }, { role: 'faculty_admin', institutionId: 'institution-b' }), true);
});

Deno.test('institution admins may invite faculty administrators only in their own institution', () => {
  const caller = { roles: [], hierarchyRole: 'institution_admin', institutionId: 'institution-a' };
  assertEquals(mayInviteHierarchyAdmin(caller, { role: 'faculty_admin', institutionId: 'institution-a' }), true);
  assertEquals(mayInviteHierarchyAdmin(caller, { role: 'institution_admin', institutionId: 'institution-a' }), false);
  assertEquals(mayInviteHierarchyAdmin(caller, { role: 'faculty_admin', institutionId: 'institution-b' }), false);
});

Deno.test('faculty admins and ordinary department roles cannot invite hierarchy administrators', () => {
  assertEquals(mayInviteHierarchyAdmin({ roles: [], hierarchyRole: 'faculty_admin', institutionId: 'institution-a' }, { role: 'faculty_admin', institutionId: 'institution-a' }), false);
  assertEquals(mayInviteHierarchyAdmin({ roles: ['dept_admin'], hierarchyRole: null, institutionId: 'institution-a' }, { role: 'faculty_admin', institutionId: 'institution-a' }), false);
});