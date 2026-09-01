import { getState } from "@/lib/actions";
export const dynamic = "force-dynamic";
export async function GET() { return getState(); }
