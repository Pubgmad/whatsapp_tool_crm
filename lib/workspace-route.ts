import type { NextRequest } from 'next/server';
import { requireSession } from './auth.js';
import { errorJson, json } from './db.js';
import { requireWorkspaceManager } from './workspace-permissions.js';

type WorkspaceSession = Awaited<ReturnType<typeof requireSession>>;

type RouteContext = { params?: Promise<Record<string, string>> };

type WorkspaceHandler = (
  request: NextRequest | Request,
  session: WorkspaceSession,
  context: RouteContext
) => Promise<unknown>;

export function privateCachedJson(data: unknown, maxAgeSeconds = 60) {
  const response = json(data);
  response.headers.set('Cache-Control', `private, max-age=${maxAgeSeconds}`);
  return response;
}

export function workspaceRoute(
  handler: WorkspaceHandler,
  { manager = false, cacheSeconds = 0 }: { manager?: boolean; cacheSeconds?: number } = {}
) {
  return async (request: NextRequest | Request, context: RouteContext = {}) => {
    try {
      const session = await requireSession(request);
      if (manager) requireWorkspaceManager(session);
      const payload = await handler(request, session, context);
      if (cacheSeconds > 0) return privateCachedJson(payload, cacheSeconds);
      return json(payload);
    } catch (error) {
      return errorJson(error);
    }
  };
}
