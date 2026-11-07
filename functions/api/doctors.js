import { json } from "./admin/_auth.js";
export async function onRequestGet({ env }) {
  if (!env.DB) return json({ success: false, error: "D1 database binding DB is missing." }, 503);
  try {
    const result = await env.DB.prepare("SELECT DISTINCT doctor FROM appointments WHERE doctor IS NOT NULL AND doctor != '' ORDER BY doctor").all();
    const doctors = (result.results || []).map((row, index) => ({ id: row.doctor, name: row.doctor, is_active: 1 }));
    return json({ success: true, doctors });
  } catch (error) {
    return json({ success: false, error: "Could not load doctors." }, 500);
  }
}
