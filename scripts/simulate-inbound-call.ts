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
  // Customer Aman Lead calls Virtual Number / Agent Aman
  const fromCustomer = "+918935926120"; // Aman Lead (Customer)
  const virtualNumber = "+918035742316"; // FreJun Virtual DID Number

  console.log(`\n======================================================`);
  console.log(`📲 Simulating INBOUND Call: Customer Aman Lead (${fromCustomer}) ➔ FreJun DID (${virtualNumber})`);
  console.log(`======================================================\n`);

  // 1. FreJun asks backend Call Flow: How to route and bridge this incoming call?
  console.log(`📡 Step 1: FreJun requests Call Flow instruction (POST /api/teler/flow)...`);
  try {
    const flowRes = await axios.post(`${BASE_URL}/api/teler/flow`, {
      call_id: callId,
      from_number: fromCustomer,
      to_number: virtualNumber,
      direction: "inbound",
    });
    console.log(`✅ FreJun Call Flow Bridging Instruction Returned:`, flowRes.data);
  } catch (err: any) {
    console.error(`❌ Call flow failed:`, err.response?.data || err.message);
  }

  // 2. Inbound Call arrives and rings the agent (call.initiated)
  console.log(`\n🔔 Step 2: FreJun triggers webhook [call.initiated]...`);
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
      to: virtualNumber,
      direction: "inbound",
      start_time: new Date().toISOString(),
    },
  });

  // 3. Agent picks up the phone (call.answered)
  console.log(`\n🎧 Step 3: Agent picks up phone -> Webhook [call.answered]...`);
  await sendWebhook({
    id: `evt_inbound_ans_${Date.now()}`,
    type: "call.answered",
    api_version: "2026-06-01",
    occurred_at: new Date().toISOString(),
    account_id: "acc_demo_hashtagg",
    call_id: callId,
    data: {
      call_id: callId,
      from: fromCustomer,
      to: virtualNumber,
      direction: "inbound",
      answered_at: new Date().toISOString(),
    },
  });

  // Verify via API
  const res = await axios.get(`${BASE_URL}/api/calls`);
  const found = res.data.data.find((c: any) => c.callId === callId);
  console.log("\n🔍 Verification from /api/calls:");
  console.log("Call ID:", found?.callId);
  console.log("State:", found?.state);
  console.log("Direction:", found?.metadata?.callDirection);
  console.log("Caller:", found?.metadata?.callerName, found?.fromNumber);
  console.log("Receiver (Bridged Agent):", found?.metadata?.receiverName, found?.toNumber);
  console.log("Flow Action:", found?.flowAction);
  console.log("Note:", found?.metadata?.note);
  console.log("\n✨ Inbound Call successfully bridged to Agent!\n");
}

simulateInboundCall();
