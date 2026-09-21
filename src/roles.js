export const ROLES = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'visitor', label: 'Visitor' },
]

export function roleLabel(role) {
  if (role === 'employee') return 'Employee'
  return ROLES.find((item) => item.value === role)?.label || role
}
