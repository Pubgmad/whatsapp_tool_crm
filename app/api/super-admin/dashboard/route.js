import { errorJson } from "../../../../lib/db";
import { getSuperAdminDashboard } from "../../../../lib/super-admin";

export async function GET(request) {
  try {
    return await getSuperAdminDashboard(request);
  } catch (error) {
    return errorJson(error);
  }
}
