import { describe, expect, it } from 'vitest';
import { resolveHomeRole } from './home-routing';

describe('home dashboard role routing', () => {
  it('keeps a student in the student dashboard when the account also has a lecturer role', () => {
    expect(resolveHomeRole('lecturer', ['student', 'lecturer'], 'student')).toBe('student');
  });

  it('routes a lecturer login to the lecturer dashboard when that role is assigned', () => {
    expect(resolveHomeRole('dept_admin', ['dept_admin', 'lecturer'], 'lecturer')).toBe('lecturer');
  });

  it('keeps an administrator login on the administrator dashboard for accounts with multiple roles', () => {
    expect(resolveHomeRole('lecturer', ['dept_admin', 'lecturer'], 'admin')).toBe('dept_admin');
  });

  it('does not honor a requested dashboard role the account does not have', () => {
    expect(resolveHomeRole('student', ['student'], 'lecturer')).toBe('student');
  });

  it('preserves the normal role routing when no login preference is provided', () => {
    expect(resolveHomeRole('dept_admin', ['dept_admin', 'lecturer'], null)).toBe('dept_admin');
  });
});