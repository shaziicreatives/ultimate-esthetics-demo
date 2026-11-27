const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function hmacKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("AI Agent bridge secret is not configured.");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signClinicAssertion(claims, secret) {
  const key = await hmacKey(secret);
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signingInput = header + "." + payload;
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return signingInput + "." + toBase64Url(new Uint8Array(signature));
}

export async function verifyClinicAssertion(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts.some(part => !part)) throw new Error("Invalid clinic assertion.");
  const header = JSON.parse(decoder.decode(fromBase64Url(parts[0])));
  const claims = JSON.parse(decoder.decode(fromBase64Url(parts[1])));
  if (!header || header.alg !== "HS256" || header.typ !== "JWT") throw new Error("Unsupported clinic assertion.");
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(parts[2]), encoder.encode(parts[0] + "." + parts[1]));
  if (!valid) throw new Error("Invalid clinic assertion signature.");
  return claims;
}
