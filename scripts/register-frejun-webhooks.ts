import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

// Parse CLI flags if provided: --client-id <id> --client-secret <secret> --url <url>
const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return undefined;
}

const CLIENT_ID = getArg("--client-id") || process.env.FREJUN_CLIENT_ID || "";
const CLIENT_SECRET = getArg("--client-secret") || process.env.FREJUN_CLIENT_SECRET || "";
const API_KEY = process.env.FREJUN_API_KEY || "";
const PUBLIC_BASE_URL = getArg("--url") || process.env.PUBLIC_BASE_URL || "https://tawanna-roomier-nonhereditably.ngrok-free.dev";
const CALLBACK_URL = `${PUBLIC_BASE_URL.replace(/\/$/, "")}/api/teler/status`;

const BASE_URL = "https://api.frejun.com/api/v1/integrations";

interface WebhookItem {
  id: string | number;
  event: string;
  callback_url: string;
  is_active?: boolean;
}

async function registerDialerWebhooks() {
  console.log("==================================================================");
  console.log("📞 FreJun Dialer Webhook Configuration Tool");
  console.log("==================================================================");
  console.log(`🌐 Public Callback URL: ${CALLBACK_URL}`);
  console.log(`🆔 Client ID:           ${CLIENT_ID ? `${CLIENT_ID.substring(0, 8)}...` : "(not set)"}`);
  console.log(`🔒 Client Secret:       ${CLIENT_SECRET ? "****** (configured)" : "(not set)"}`);
  console.log("==================================================================\n");

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("⚠️  MISSING OAUTH CREDENTIALS (FREJUN_CLIENT_ID & FREJUN_CLIENT_SECRET)");
    console.log(`
👉 How to get your Client ID & Client Secret:
   1. In your FreJun Dashboard, navigate to: Settings ➔ Developer
   2. Under 'OAuth apps', click the green 'Create app' button (or open existing app)
   3. Enter:
      - App name: Maxpine CRM
      - Redirect URL: ${PUBLIC_BASE_URL}/api/oauth/callback
   4. Click 'Create'. FreJun will display your Client ID and Client Secret.
   5. Save them in your .env file:
      FREJUN_CLIENT_ID=<Your_Client_ID>
      FREJUN_CLIENT_SECRET=<Your_Client_Secret>
   
   OR re-run this script directly with:
      npm run register:webhooks -- --client-id <ID> --client-secret <SECRET>
`);

    if (API_KEY) {
      console.log("Attempting fallback with FREJUN_API_KEY...\n");
    } else {
      process.exit(1);
    }
  }

  // Header format per FreJun documentation:
  // Authorization: Bearer <Base64Encoded(ClientID:ClientSecret)>
  const authHeader = (CLIENT_ID && CLIENT_SECRET)
    ? `Bearer ${Buffer.from(`${CLIENT_ID.trim()}:${CLIENT_SECRET.trim()}`).toString("base64")}`
    : API_KEY.includes(".")
    ? `Api-Key ${API_KEY}`
    : `Bearer ${API_KEY}`;

  const headers = {
    "Authorization": authHeader,
    "Content-Type": "application/json",
  };

  // Step 1: List existing webhooks (Step 2 in FreJun Email)
  console.log("🔍 Step 1: Checking for existing webhooks (GET /integrations/webhooks/)...");
  let existingWebhooks: WebhookItem[] = [];

  try {
    const listRes = await axios.get(`${BASE_URL}/webhooks/`, { headers, timeout: 10000 });
    const rawData = listRes.data?.data || listRes.data?.results || listRes.data || [];
    existingWebhooks = Array.isArray(rawData) ? rawData : [];
    console.log(`✅ Found ${existingWebhooks.length} existing webhook subscription(s).`);

    for (const hook of existingWebhooks) {
      console.log(`   • ID: ${hook.id} | Event: [${hook.event}] | URL: ${hook.callback_url}`);
    }
  } catch (err: any) {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.response?.data?.detail || err.message;
    console.warn(`⚠️ Could not list existing webhooks (${status}): ${JSON.stringify(msg)}`);
    console.log("Proceeding to create webhook directly...\n");
  }

  // Step 2: Register or update `call.status` (Unified FreJun Dialer event)
  const targetEvents = ["call.status"];

  for (const eventName of targetEvents) {
    console.log(`\n📡 Processing event: [${eventName}]...`);

    const existing = existingWebhooks.find(
      (h) => h.event === eventName || h.event?.toLowerCase() === eventName.toLowerCase()
    );

    if (existing) {
      if (existing.callback_url === CALLBACK_URL) {
        console.log(`✅ Webhook for [${eventName}] is ALREADY configured and pointing to ${CALLBACK_URL}`);
        continue;
      }

      // Step 3b: Update existing webhook with new callback URL
      console.log(`🔄 Updating existing webhook ID ${existing.id} with callback URL: ${CALLBACK_URL}...`);
      try {
        const patchRes = await axios.patch(
          `${BASE_URL}/webhook/${existing.id}/`,
          {
            event: eventName,
            callback_url: CALLBACK_URL,
          },
          { headers, timeout: 10000 }
        );
        console.log(`✅ Successfully updated webhook ID ${existing.id}:`, patchRes.data);
      } catch (patchErr: any) {
        const status = patchErr.response?.status;
        const msg = patchErr.response?.data?.message || patchErr.response?.data?.detail || patchErr.message;
        console.error(`❌ Failed to update webhook ID ${existing.id} (${status}):`, msg);
      }
    } else {
      // Step 3a: Create new webhook
      console.log(`➕ Creating new webhook for [${eventName}] ➔ ${CALLBACK_URL}...`);
      try {
        const createRes = await axios.post(
          `${BASE_URL}/create-webhook/`,
          {
            event: eventName,
            callback_url: CALLBACK_URL,
          },
          { headers, timeout: 10000 }
        );
        const hookId = createRes.data?.id || createRes.data?.data?.id || JSON.stringify(createRes.data);
        console.log(`✅ Webhook created successfully! Webhook ID: ${hookId}`);
      } catch (createErr: any) {
        const status = createErr.response?.status;
        const msg = createErr.response?.data?.message || createErr.response?.data?.detail || createErr.message;
        console.error(`❌ Failed to create webhook (${status}):`, msg);
      }
    }
  }

  console.log("\n==================================================================");
  console.log("🎉 Webhook setup process completed!");
  console.log("Place a test call to +918035742316 to verify live deliveries in your CRM.");
  console.log("==================================================================\n");
}

registerDialerWebhooks().catch((err) => {
  console.error("Fatal error running webhook registration:", err);
  process.exit(1);
});
