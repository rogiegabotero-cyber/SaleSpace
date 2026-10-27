export const ROLES = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'visitor', label: 'Visitor' },
]

// Visitors only get the client panel; the employee workspace is off limits. Managers have the
// same workspace access as employees.
export function isClientOnlyRole(role) {
  return role === 'visitor'
}

// Who can post announcements in the workspace: managers, and the admins above them.
export function canPostAnnouncements(role) {
  return role === 'manager' || role === 'admin' || role === 'super_admin'
}

export function roleLabel(role) {
  if (role === 'employee') return 'Employee'
  return ROLES.find((item) => item.value === role)?.label || role
}

// Who can set the team's daily call quota: managers, and the admins above them.
export const canSetCallQuota = canPostAnnouncements
