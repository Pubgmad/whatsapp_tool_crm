import { AppError } from './db.js';
import { isWorkspaceManager } from './workspace-roles.js';

export function requireWorkspaceManager(account) {
  if (!isWorkspaceManager(account?.role)) {
    throw new AppError('Only workspace owners and managers can perform this action.', 403, 'WORKSPACE_PERMISSION_REQUIRED');
  }
}
