export const WORKSPACE_MANAGER_ROLES = Object.freeze(['Owner', 'Manager'] as const);

export type WorkspaceRole = 'Owner' | 'Manager' | 'Agent' | string;

export function isWorkspaceManager(role: WorkspaceRole | undefined | null): boolean {
  return WORKSPACE_MANAGER_ROLES.includes(role as 'Owner' | 'Manager');
}
