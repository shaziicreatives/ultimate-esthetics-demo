import {json} from "../../../_shared/google-drive.js";
import {backupClinicToDrive} from "../../../_shared/google-drive-backup.js";

const EXPECTED_TOKEN_SHA256 = "a352581f3d1d6cd6d7716a8bc1c369765cfbd83a9b5afffa94ab4f1c9cba24ed";

async function matchesToken(value) {
  if (!value) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (actual.length !== EXPECTED_TOKEN_SHA256.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ EXPECTED_TOKEN_SHA256.charCodeAt(i);
  return difference === 0;
}

export async function onRequestPost({request, env}) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ") || !(await matchesToken(authorization.slice(7).trim()))) {
    return json({error:"Unauthorized"},401);
  }
  try {
    const result = await backupClinicToDrive(env,"daily");
    return json(result, result.success ? 200 : 503);
  } catch (error) {
    return json({success:false,error:String(error?.message || "Scheduled backup failed")},503);
  }
}
