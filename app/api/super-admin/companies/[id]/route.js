import { errorJson } from "../../../../../lib/db";
import { getSuperAdminCompany } from "../../../../../lib/super-admin";

export async function GET(request, context) {
  try {
    return await getSuperAdminCompany(request, context);
  } catch (error) {
    return errorJson(error);
  }
}
