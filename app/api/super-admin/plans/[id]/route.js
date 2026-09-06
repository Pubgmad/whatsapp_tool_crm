import { errorJson } from "../../../../../lib/db";
import { deleteSuperAdminPlan, updateSuperAdminPlan } from "../../../../../lib/super-admin";

export async function PUT(request, context) {
  try {
    return await updateSuperAdminPlan(request, context);
  } catch (error) {
    return errorJson(error);
  }
}

export async function DELETE(request, context) {
  try {
    return await deleteSuperAdminPlan(request, context);
  } catch (error) {
    return errorJson(error);
  }
}
