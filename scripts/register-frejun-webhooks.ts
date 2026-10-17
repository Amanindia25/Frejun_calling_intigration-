import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.FREJUN_API_KEY || "";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";
const CALLBACK_URL = `${PUBLIC_BASE_URL.replace(/\/$/, "")}/api/teler/status`;

// All supported webhook events from https://knowledge.frejun.com/supported-webhook-events
const SUPPORTED_EVENTS = [
  "call.status",
  "call.recording",
  "call.insights",
  "call.propertyChange.notes",
  "call.propertyChange.call_reason",
  "call.propertyChange.call_outcome",
];

async function registerWebhooks() {
  console.log("==================================================================");
  console.log("🚀 FreJun Webhook Registration Tool");
  console.log(`🌐 Public Callback URL: ${CALLBACK_URL}`);
  console.log(`🔑 Using API Key: ${API_KEY ? `${API_KEY.substring(0, 10)}...` : "(none)"}`);
  console.log("==================================================================\n");

  if (!API_KEY) {
    console.error("❌ FREJUN_API_KEY is not defined in .env");
    process.exit(1);
  }

  const endpoints = [
    "https://api.frejun.ai/api/v1/integrations/create-webhook/",
    "https://api.frejun.com/api/v1/integrations/create-webhook/",
  ];

  for (const event of SUPPORTED_EVENTS) {
    console.log(`📡 Registering webhook for event: [${event}]...`);
    let registered = false;

    for (const url of endpoints) {
      try {
        const res = await axios.post(
          url,
          {
            event,
            callback_url: CALLBACK_URL,
          },
          {
            headers: {
              "Content-Type": "application/json",
              "Authorization": API_KEY.includes(".") ? `Api-Key ${API_KEY}` : `Bearer ${API_KEY}`,
            },
            timeout: 8000,
          }
        );

        console.log(`   ✅ Success via ${url}: ID = ${res.data?.id || JSON.stringify(res.data)}`);
        registered = true;
        break;
      } catch (err: any) {
        const status = err.response?.status;
        const msg = err.response?.data?.message || err.response?.data?.detail || err.message;
        console.log(`   ⚠️ Endpoint ${url} returned (${status}): ${JSON.stringify(msg)}`);
      }
    }

    if (!registered) {
      console.log(`   ℹ️ Note: Webhooks can also be configured directly in your FreJun Voice App Dashboard.`);
    }
  }

  console.log("\n✨ Webhook registration run completed.");
}

registerWebhooks();
