import { errorJson } from "../../../../lib/db";
import { createSuperAdminPlan, getSuperAdminPlans } from "../../../../lib/super-admin";

export async function GET(request) {
  try {
    return await getSuperAdminPlans(request);
  } catch (error) {
    return errorJson(error);
  }
}

export async function POST(request) {
  try {
    return await createSuperAdminPlan(request);
  } catch (error) {
    return errorJson(error);
  }
}
