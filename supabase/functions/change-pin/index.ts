import { createClient } from "npm:@supabase/supabase-js@2";
import { constantTimeEqual, hashPin } from "../_shared/pin-utils.js";

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

function response(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Content-Type": "application/json",
      "Vary": "Origin",
    },
  });
}

async function hash(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async request => {
  const origin = request.headers.get("Origin") ?? "";
  if (!allowedOrigins.includes(origin)) {
    return new Response("Origin not allowed.", { status: 403 });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
      },
    });
  }
  if (request.method !== "POST") {
    return response({ error: "Method not allowed." }, 405, origin);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > 1024) {
    return response({ error: "Invalid request." }, 400, origin);
  }

  let body: { currentPin?: unknown; newPin?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return response({ error: "Invalid request." }, 400, origin);
  }
  if (typeof body.currentPin !== "string" || !/^\d{4}$/.test(body.currentPin) ||
      typeof body.newPin !== "string" || !/^\d{4}$/.test(body.newPin) ||
      body.currentPin === body.newPin) {
    return response({ error: "Enter a valid current PIN and a different four-digit PIN." }, 400, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const coupleId = Deno.env.get("COUPLE_ID");
  const pinHashSecret = Deno.env.get("PIN_HASH_SECRET");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !coupleId || !pinHashSecret) {
    console.error("One or more change-pin secrets are missing.");
    return response({ error: "The PIN service is not configured." }, 500, origin);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.match(/^Bearer\s+\S+$/i)) {
    return response({ error: "Authentication is required." }, 401, origin);
  }
  const token = authorization.replace(/^Bearer\s+/i, "");
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    return response({ error: "Authentication failed." }, 401, origin);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: membership, error: membershipError } = await adminClient
    .from("memberships")
    .select("role")
    .eq("couple_id", coupleId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (membershipError) {
    console.error("Unable to verify couple membership:", membershipError.message);
    return response({ error: "Unable to verify account access." }, 503, origin);
  }
  if (membership?.role !== "admin" && membership?.role !== "partner") {
    return response({ error: "Account access is required." }, 403, origin);
  }

  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientIp = request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ?? forwardedIp ?? "unknown";
  const bucketHash = await hash(`${clientIp}:${userData.user.id}:change-pin:${serviceRoleKey}`);
  const { data: allowed, error: rateLimitError } = await adminClient.rpc(
    "consume_login_code_attempt",
    { p_bucket_hash: bucketHash },
  );
  if (rateLimitError) {
    console.error("Unable to check PIN-change rate limit:", rateLimitError.message);
    return response({ error: "The PIN service is temporarily unavailable." }, 503, origin);
  }
  if (!allowed) {
    return response({ error: "Too many attempts. Try again in 15 minutes." }, 429, origin);
  }

  const { data: pinRecord, error: pinReadError } = await adminClient
    .from("login_pins")
    .select("pin_hash")
    .eq("couple_id", coupleId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (pinReadError) {
    console.error("Unable to load the account PIN:", pinReadError.message);
    return response({ error: "The PIN service is temporarily unavailable." }, 503, origin);
  }

  if (pinRecord) {
    const currentPinHash = await hashPin(body.currentPin, pinHashSecret);
    if (!constantTimeEqual(currentPinHash, pinRecord.pin_hash)) {
      return response({ error: "The current PIN is incorrect." }, 401, origin);
    }
  } else {
    const legacyPin = membership.role === "admin"
      ? Deno.env.get("ADMIN_LOGIN_CODE")
      : Deno.env.get("PARTNER_LOGIN_CODE");
    if (!legacyPin || !/^\d{4}$/.test(legacyPin) || !constantTimeEqual(body.currentPin, legacyPin)) {
      return response({ error: "The current PIN is incorrect." }, 401, origin);
    }
  }

  const { error: updateError } = await adminClient
    .from("login_pins")
    .upsert({
      couple_id: coupleId,
      user_id: userData.user.id,
      pin_hash: await hashPin(body.newPin, pinHashSecret),
      updated_at: new Date().toISOString(),
    }, { onConflict: "couple_id,user_id" });
  if (updateError) {
    console.error("Unable to save the new account PIN:", updateError.message);
    return response({ error: "Unable to save the new PIN." }, 503, origin);
  }

  return response({ success: true }, 200, origin);
});
