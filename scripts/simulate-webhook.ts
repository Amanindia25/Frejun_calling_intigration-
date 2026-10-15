import crypto from "node:crypto";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const WEBHOOK_SECRET = process.env.FREJUN_WEBHOOK_SECRET || "test_webhook_secret";

async function sendWebhook(event: Record<string, unknown>) {
  const rawBody = Buffer.from(JSON.stringify(event));
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const msg = Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]);
  const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(msg).digest("hex");

  console.log(`📤 Dispatching signed webhook: [${event.type}] (ID: ${event.id})`);

  try {
    const res = await axios.post(`${BASE_URL}/api/teler/status`, event, {
      headers: {
        "Content-Type": "application/json",
        "X-Teler-Timestamp": timestamp,
        "X-Teler-Signature": signature,
        "X-Teler-Source": "live",
      },
    });
    console.log(`📥 Server Response: ${res.status}`, res.data);
  } catch (err: any) {
    console.error(`❌ Webhook delivery failed:`, err.response?.data || err.message);
  }
}

async function simulateCallLifecycle() {
  const callId = process.argv[2] || `cs_sim_${Date.now()}`;
  const toNumber = process.argv[3] || "+919876543210";
  const fromNumber = "+918000000000";

  console.log(`\nSimulating FreJun Teler lifecycle for Call ID: ${callId} to ${toNumber}\n`);

  // 1. call.initiated
  await sendWebhook({
    id: `evt_init_${Date.now()}`,
    type: "call.initiated",
    api_version: "2026-06-01",
    occurred_at: new Date().toISOString(),
    account_id: "acc_demo_hashtagg",
    voice_app_id: "va_demo_01",
    sip_trunk_id: null,
    call_id: callId,
    leg_id: `cl_prim_${Date.now()}`,
    data: {
      call_id: callId,
      from: fromNumber,
      to: toNumber,
      direction: "outbound",
      start_time: new Date().toISOString(),
    },
  });

  // Delay 2 seconds
  await new Promise((r) => setTimeout(r, 2000));

  // 2. call.answered
  await sendWebhook({
    id: `evt_ans_${Date.now()}`,
    type: "call.answered",
    api_version: "2026-06-01",
    occurred_at: new Date().toISOString(),
    account_id: "acc_demo_hashtagg",
    voice_app_id: "va_demo_01",
    sip_trunk_id: null,
    call_id: callId,
    leg_id: `cl_prim_${Date.now()}`,
    data: {
      call_id: callId,
      from: fromNumber,
      to: toNumber,
      direction: "outbound",
      start_time: new Date().toISOString(),
      answered_at: new Date().toISOString(),
    },
  });

  // Delay 3 seconds
  await new Promise((r) => setTimeout(r, 3000));

  // 3. call.completed
  await sendWebhook({
    id: `evt_comp_${Date.now()}`,
    type: "call.completed",
    api_version: "2026-06-01",
    occurred_at: new Date().toISOString(),
    account_id: "acc_demo_hashtagg",
    voice_app_id: "va_demo_01",
    sip_trunk_id: null,
    call_id: callId,
    leg_id: `cl_prim_${Date.now()}`,
    data: {
      call_id: callId,
      from: fromNumber,
      to: toNumber,
      direction: "outbound",
      start_time: new Date().toISOString(),
      answered_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_seconds: 45,
      reason: "normal",
      ended_by: "callee",
    },
  });

  console.log("\n🎉 Simulation complete! Check the UI dashboard to see the updated call status and event feed.\n");
}

simulateCallLifecycle();
