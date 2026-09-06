import { errorJson } from "../../../../lib/db";
import { getSuperAdminSettings, saveSuperAdminSetting } from "../../../../lib/super-admin";

export async function GET(request) {
  try {
    return await getSuperAdminSettings(request);
  } catch (error) {
    return errorJson(error);
  }
}

export async function POST(request) {
  try {
    return await saveSuperAdminSetting(request);
  } catch (error) {
    return errorJson(error);
  }
}
