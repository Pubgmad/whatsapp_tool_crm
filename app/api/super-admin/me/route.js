import { errorJson } from "../../../../lib/db";
import { getSuperAdminMe } from "../../../../lib/super-admin";

export async function GET(request) {
  try {
    return await getSuperAdminMe(request);
  } catch (error) {
    return errorJson(error);
  }
}
