import { errorJson, json } from "../../../../lib/db";
import { loginSuperAdmin, superSessionCookie } from "../../../../lib/super-admin";

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await loginSuperAdmin(body);
    return json({ admin: result.admin }, 200, { "Set-Cookie": superSessionCookie(result.token) });
  } catch (error) {
    return errorJson(error);
  }
}
