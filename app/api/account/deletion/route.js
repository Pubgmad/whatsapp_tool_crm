import { errorJson, json } from '@/lib/db';
import { manageWorkspaceDeletion } from '@/lib/retention';
async function handle(request) { try { return json(await manageWorkspaceDeletion(request)); } catch (error) { return errorJson(error); } }
export async function POST(request) { return handle(request); }
export async function DELETE(request) { return handle(request); }
