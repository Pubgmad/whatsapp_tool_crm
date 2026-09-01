import { createContact } from "@/lib/actions";
export const dynamic = "force-dynamic";
export async function POST(request) { return createContact(request); }
