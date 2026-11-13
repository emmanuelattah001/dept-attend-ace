import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { departmentsEligibleForCleanup } from '../_shared/cleanup-eligibility.ts';

Deno.test('cleanup includes only departments whose active institution archive synced successfully', () => {
  const eligible = departmentsEligibleForCleanup(
    ['institution-a', 'institution-b'],
    new Set(['institution-a']),
    [
      { institutionId: 'institution-a', departmentId: 'department-a' },
      { institutionId: 'institution-b', departmentId: 'department-b' },
    ],
  );
  assertEquals(eligible, ['department-a']);
});

Deno.test('cleanup retains all attendance when no configured archive sync succeeded', () => {
  const eligible = departmentsEligibleForCleanup(
    ['institution-a'],
    new Set(),
    [{ institutionId: 'institution-a', departmentId: 'department-a' }],
  );
  assertEquals(eligible, []);
});