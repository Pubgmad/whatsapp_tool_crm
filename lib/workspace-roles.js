export const WORKSPACE_MANAGER_ROLES = Object.freeze(['Owner', 'Manager']);

export function isWorkspaceManager(role) {
  return WORKSPACE_MANAGER_ROLES.includes(role);
}
