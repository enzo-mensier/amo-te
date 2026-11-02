import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

function jsonResponse(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Origin": origin,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async request => {
  const origin = request.headers.get("Origin") ?? "";
  if (!allowedOrigins.includes(origin)) {
    return new Response("Origin not allowed.", { status: 403 });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: { ...corsHeaders, "Access-Control-Allow-Origin": origin },
    });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, origin);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > 4096) {
    return jsonResponse({ error: "Invalid request." }, 400, origin);
  }

  let body: { title?: unknown; body?: unknown; url?: unknown; recipients?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400, origin);
  }

  if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 60 ||
      typeof body.body !== "string" || !body.body.trim() || body.body.trim().length > 240 ||
      typeof body.url !== "string" || body.url.length > 1024 ||
      !body.url.startsWith("/") || body.url.startsWith("//") || body.url.includes("\\") ||
      /[\u0000-\u001f]/.test(body.url) ||
      !Array.isArray(body.recipients) || !body.recipients.length ||
      body.recipients.some(profile => profile !== "admin" && profile !== "partner")) {
    return jsonResponse({ error: "Invalid notification details." }, 400, origin);
  }

  let destination: URL;
  try {
    destination = new URL(body.url, "https://amo-te.invalid");
  } catch {
    return jsonResponse({ error: "Invalid notification link." }, 400, origin);
  }
  if (destination.origin !== "https://amo-te.invalid") {
    return jsonResponse({ error: "Notification links must stay inside the capsule." }, 400, origin);
  }

  const recipients = [...new Set(body.recipients)];
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  const coupleId = Deno.env.get("COUPLE_ID");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !vapidPublicKey ||
      !vapidPrivateKey || !vapidSubject || !coupleId) {
    console.error("One or more send-reminder secrets are missing.");
    return jsonResponse({ error: "The reminder service is not configured." }, 500, origin);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return jsonResponse({ error: "Authentication is required." }, 401, origin);
  }

  const token = authorization.replace(/^Bearer\s+/i, "");
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse({ error: "Authentication failed." }, 401, origin);
  }

  const { data: membership, error: membershipError } = await userClient
    .from("memberships")
    .select("role")
    .eq("couple_id", coupleId)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (membershipError) {
    console.error("Unable to verify administrator membership:", membershipError.message);
    return jsonResponse({ error: "Unable to verify administrator access." }, 500, origin);
  }
  if (membership?.role !== "admin") {
    return jsonResponse({ error: "Administrator access is required." }, 403, origin);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: members, error: membersError } = await adminClient
    .from("memberships")
    .select("user_id, role, display_name")
    .eq("couple_id", coupleId)
    .in("role", recipients);
  if (membersError) {
    console.error("Unable to load notification recipients:", membersError.message);
    return jsonResponse({ error: "Unable to load notification recipients." }, 500, origin);
  }
  if (!members || members.length !== recipients.length) {
    console.error("A requested notification role is not configured for this couple.");
    return jsonResponse({ error: "A notification recipient is not configured." }, 500, origin);
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const results = await Promise.all(members.map(async recipient => {
    const { data: subscriptions, error: subscriptionsError } = await adminClient
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("couple_id", coupleId)
      .eq("user_id", recipient.user_id);
    if (subscriptionsError) {
      console.error(`Unable to load devices for ${recipient.role}:`, subscriptionsError.message);
      return {
        profile: recipient.role,
        display_name: recipient.display_name,
        deviceCount: 0,
        sent: 0,
        failed: 1,
      };
    }

    const devices = await Promise.allSettled((subscriptions || []).map(async subscription => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, JSON.stringify({
          title: body.title!.trim(),
          body: body.body!.trim(),
          url: body.url,
        }), { TTL: 86400, urgency: "normal" });
        return true;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          const { error: deleteError } = await adminClient
            .from("push_subscriptions")
            .delete()
            .eq("id", subscription.id);
          if (deleteError) {
            console.error("Unable to remove expired push subscription:", deleteError.message);
          }
        }
        console.error(`Push delivery failed for ${recipient.role}:`, error);
        return false;
      }
    }));
    return {
      profile: recipient.role,
      display_name: recipient.display_name,
      deviceCount: subscriptions?.length || 0,
      sent: devices.filter(result => result.status === "fulfilled" && result.value).length,
      failed: devices.filter(result => result.status === "rejected" ||
        (result.status === "fulfilled" && !result.value)).length,
    };
  }));
  const totals = results.reduce((summary, result) => ({
    sent: summary.sent + result.sent,
    failed: summary.failed + result.failed,
  }), { sent: 0, failed: 0 });

  return jsonResponse({ ...totals, results }, 200, origin);
});
