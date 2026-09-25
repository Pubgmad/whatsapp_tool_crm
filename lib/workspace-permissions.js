import { AppError } from "./db.js";

export function requireWorkspaceManager(account) {
  if (!["Owner", "Manager"].includes(account?.role)) {
    throw new AppError("Only workspace owners and managers can perform this action.", 403, "WORKSPACE_PERMISSION_REQUIRED");
  }
}
