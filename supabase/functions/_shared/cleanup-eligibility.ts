export interface TenantDepartment {
  institutionId: string;
  departmentId: string;
}

export function departmentsEligibleForCleanup(
  activeConfiguredInstitutionIds: string[],
  successfulSyncInstitutionIds: Set<string>,
  tenantDepartments: TenantDepartment[],
): string[] {
  const eligibleInstitutions = new Set(
    activeConfiguredInstitutionIds.filter((institutionId) => successfulSyncInstitutionIds.has(institutionId)),
  );
  return [...new Set(
    tenantDepartments
      .filter((row) => eligibleInstitutions.has(row.institutionId))
      .map((row) => row.departmentId),
  )];
}