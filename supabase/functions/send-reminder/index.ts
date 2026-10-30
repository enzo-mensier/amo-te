import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return jsonResponse({ error: "Authentication is required." }, 401);
  }

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
    return jsonResponse({ error: "The reminder service is not configured." }, 500);
  }

  const token = authorization.replace(/^Bearer\s+/i, "");
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse({ error: "Authentication failed." }, 401);
  }

  const { data: membership, error: membershipError } = await userClient
    .from("memberships")
    .select("role")
    .eq("couple_id", coupleId)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (membershipError) {
    console.error("Unable to verify administrator membership:", membershipError.message);
    return jsonResponse({ error: "Unable to verify administrator access." }, 500);
  }
  if (membership?.role !== "admin") {
    return jsonResponse({ error: "Administrator access is required." }, 403);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: subscriptions, error: subscriptionsError } = await adminClient
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("couple_id", coupleId);

  if (subscriptionsError) {
    console.error("Unable to load push subscriptions:", subscriptionsError.message);
    return jsonResponse({ error: "Unable to load registered devices." }, 500);
  }
  if (!subscriptions?.length) {
    return jsonResponse({ error: "No devices have enabled notifications yet." }, 404);
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const payload = JSON.stringify({
    title: "Un petit rappel, nous deux",
    body: "Quand tu as un instant, viens déposer un souvenir dans notre capsule 💌",
    url: "/",
  });

  const results = await Promise.allSettled(subscriptions.map(async subscription => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload);
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
        return false;
      }
      throw error;
    }
  }));

  const sent = results.filter(result => result.status === "fulfilled" && result.value).length;
  const failed = results.length - sent;
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Push delivery failed:", result.reason);
    }
  }

  return jsonResponse({ sent, failed }, failed ? 502 : 200);
});
