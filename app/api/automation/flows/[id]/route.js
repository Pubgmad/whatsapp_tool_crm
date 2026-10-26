import { deleteAutomationFlow, patchAutomationFlow, saveAutomationFlow } from "@/lib/automation";
import { withWorkspaceFeature } from "@/lib/feature-controls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PUT = withWorkspaceFeature("automation", async (request, context) =>
  saveAutomationFlow(request, { params: await context.params })
);
export const PATCH = withWorkspaceFeature("automation", async (request, context) =>
  patchAutomationFlow(request, { params: await context.params })
);
export const DELETE = withWorkspaceFeature("automation", async (request, context) =>
  deleteAutomationFlow(request, { params: await context.params })
);
