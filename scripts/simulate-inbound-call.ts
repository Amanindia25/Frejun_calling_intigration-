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

  console.log(`📤 Dispatching signed inbound webhook: [${event.type}] (ID: ${event.id})`);

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

async function simulateInboundCall() {
  const callId = `cs_inbound_${Date.now()}`;
  // Customer Aman Lead calls Agent Aman
  const fromCustomer = "+918935926120"; // Aman Lead (Customer)
  const toAgent = "+918376822509";       // Aman (Agent)

  console.log(`\n======================================================`);
  console.log(`📲 Simulating INBOUND Call: Customer Aman Lead (${fromCustomer}) ➔ Agent Aman (${toAgent})`);
  console.log(`======================================================\n`);

  // 1. Inbound Call arrives (call.initiated)
  await sendWebhook({
    id: `evt_inbound_init_${Date.now()}`,
    type: "call.initiated",
    api_version: "2026-06-01",
    occurred_at: new Date().toISOString(),
    account_id: "acc_demo_hashtagg",
    call_id: callId,
    data: {
      call_id: callId,
      from: fromCustomer,
      to: toAgent,
      direction: "inbound",
      start_time: new Date().toISOString(),
    },
  });

  // Verify via API
  const res = await axios.get(`${BASE_URL}/api/calls`);
  const found = res.data.data.find((c: any) => c.callId === callId);
  console.log("\n🔍 Verification from /api/calls:");
  console.log("Call ID:", found?.callId);
  console.log("Direction:", found?.metadata?.callDirection);
  console.log("Caller:", found?.metadata?.callerName, found?.fromNumber);
  console.log("Receiver:", found?.metadata?.receiverName, found?.toNumber);
  console.log("Note:", found?.metadata?.note);
}

simulateInboundCall();
