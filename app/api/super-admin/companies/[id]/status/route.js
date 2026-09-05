import { errorJson } from "../../../../../../lib/db";
import { updateCompanyStatus } from "../../../../../../lib/super-admin";

export async function PATCH(request, context) {
  try {
    return await updateCompanyStatus(request, context);
  } catch (error) {
    return errorJson(error);
  }
}
