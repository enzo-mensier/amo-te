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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const coupleId = Deno.env.get("COUPLE_ID");
  const adminUserId = Deno.env.get("ADMIN_USER_ID");
  const partnerUserId = Deno.env.get("PARTNER_USER_ID");
    const pinHashSecret = Deno.env.get("PIN_HASH_SECRET");
  const adminCode = Deno.env.get("ADMIN_LOGIN_CODE");
  const partnerCode = Deno.env.get("PARTNER_LOGIN_CODE");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !coupleId ||
      !adminUserId || !partnerUserId || !pinHashSecret) {
    console.error("One or more login-with-code secrets are missing.");
    return response({ error: "The login service is not configured." }, 500, origin);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > 1024) {
    return response({ error: "Invalid request." }, 400, origin);
  }

  let body: { profile?: unknown; code?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return response({ error: "Invalid request." }, 400, origin);
  }

  if ((body.profile !== "admin" && body.profile !== "partner") ||
      typeof body.code !== "string" || !/^\d{4}$/.test(body.code)) {
    return response({ error: "Invalid code or profile." }, 400, origin);
  }

  const profile = body.profile;
  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientIp = request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ?? forwardedIp ?? "unknown";
  const bucketHash = await hash(`${clientIp}:${profile}:${serviceRoleKey}`);
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: allowed, error: rateLimitError } = await adminClient.rpc(
    "consume_login_code_attempt",
    { p_bucket_hash: bucketHash },
  );
  if (rateLimitError) {
    console.error("Unable to check login-code rate limit:", rateLimitError.message);
    return response({ error: "The login service is temporarily unavailable." }, 503, origin);
  }
  if (!allowed) {
    return response({ error: "Too many attempts. Try again in 15 minutes." }, 429, origin);
  }

  const userId = profile === "admin" ? adminUserId : partnerUserId;
  const expectedRole = profile;
  const { data: pinRecord, error: pinReadError } = await adminClient
    .from("login_pins")
    .select("pin_hash")
    .eq("couple_id", coupleId)
    .eq("user_id", userId)
    .maybeSingle();
  if (pinReadError) {
    console.error("Unable to load the login PIN:", pinReadError.message);
    return response({ error: "The login service is temporarily unavailable." }, 503, origin);
  }

  const submittedPinHash = await hashPin(body.code, pinHashSecret);
  if (pinRecord) {
    if (!constantTimeEqual(submittedPinHash, pinRecord.pin_hash)) {
      return response({ error: "Invalid code or profile." }, 401, origin);
    }
  } else {
    const legacyCode = profile === "admin" ? adminCode : partnerCode;
    if (!legacyCode || !/^\d{4}$/.test(legacyCode) || !constantTimeEqual(body.code, legacyCode)) {
      return response({ error: "Invalid code or profile." }, 401, origin);
    }
    const { error: pinSaveError } = await adminClient
      .from("login_pins")
      .upsert({ couple_id: coupleId, user_id: userId, pin_hash: submittedPinHash }, {
        onConflict: "couple_id,user_id",
      });
    if (pinSaveError) {
      console.error("Unable to migrate the login PIN:", pinSaveError.message);
      return response({ error: "The login service is temporarily unavailable." }, 503, origin);
    }
  }

  const [{ data: userResult, error: userError }, { data: membership, error: membershipError }] =
    await Promise.all([
      adminClient.auth.admin.getUserById(userId),
      adminClient
        .from("memberships")
        .select("role")
        .eq("couple_id", coupleId)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

  if (userError || !userResult.user?.email) {
    console.error("Unable to find the login-code user:", userError?.message ?? "No email address.");
    return response({ error: "The login service is not configured correctly." }, 500, origin);
  }
  if (membershipError || membership?.role !== expectedRole) {
    console.error("The configured login-code user does not match the couple role.");
    return response({ error: "The login service is not configured correctly." }, 500, origin);
  }

  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email: userResult.user.email,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error("Unable to create a login session:", linkError?.message ?? "No token was returned.");
    return response({ error: "Unable to start a session." }, 500, origin);
  }

  const publicClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: sessionData, error: sessionError } = await publicClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (sessionError || !sessionData.session) {
    console.error("Unable to exchange the login link for a session:", sessionError?.message);
    return response({ error: "Unable to start a session." }, 500, origin);
  }

  return response({
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
  }, 200, origin);
});
