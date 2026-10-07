import { requireSession } from './auth.js';
import { errorJson, json } from './db.js';
import { requireWorkspaceManager } from './workspace-permissions.js';

export function privateCachedJson(data, maxAgeSeconds = 60) {
  const response = json(data);
  response.headers.set('Cache-Control', `private, max-age=${maxAgeSeconds}`);
  return response;
}

export function workspaceRoute(handler, { manager = false, cacheSeconds = 0 } = {}) {
  return async (request, context) => {
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
