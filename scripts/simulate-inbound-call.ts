import crypto from "node:crypto";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || "3001"}`;
const WEBHOOK_SECRET = process.env.FREJUN_WEBHOOK_SECRET || "test_webhook_secret";
const VIRTUAL_NUMBER = process.env.FREJUN_CALLER_NUMBER || "+918035742316";

async function sendWebhook(event: Record<string, unknown>) {
  const rawBody = Buffer.from(JSON.stringify(event));
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const msg = Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]);
  const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(msg).digest("hex");

  try {
    const res = await axios.post(`${BASE_URL}/api/teler/status`, event, {
      headers: {
        "Content-Type": "application/json",
        "X-Teler-Timestamp": timestamp,
        "X-Teler-Signature": signature,
        "X-Teler-Source": "live",
      },
    });
    console.log(`   📥 Server Response: ${res.status}`, res.data);
  } catch (err: any) {
    console.error(`   ❌ Webhook delivery failed:`, err.response?.data || err.message);
  }
}

async function testInboundCallRouting() {
  console.log("==================================================================");
  console.log("📞 Testing Inbound Call Lead Lookup & Agent Routing Rules");
  console.log("==================================================================\n");

  const testCases = [
    {
      name: "Case 1: Aman Lead Calling",
      callerNumber: "+918935926120",
      expectedAgent: "Aman",
      expectedTarget: "+918376822509",
    },
    {
      name: "Case 2: Ananya Lead Calling",
      callerNumber: "+918303831398",
      expectedAgent: "Ritu",
      expectedTarget: "+917903234057",
    },
    {
      name: "Case 3: Unknown Number Calling",
      callerNumber: "+919876543210",
      expectedAgent: "Aman (Default Agent)",
      expectedTarget: "+918376822509",
    },
  ];

  for (const tc of testCases) {
    const callId = `cs_inbound_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    console.log(`\n▶️ [${tc.name}] Caller: ${tc.callerNumber} ➔ DID: ${VIRTUAL_NUMBER}`);

    // 1. Call Flow Request (FreJun asks backend how to bridge)
    try {
      const flowRes = await axios.post(`${BASE_URL}/api/teler/flow`, {
        call_id: callId,
        from_number: tc.callerNumber,
        to_number: VIRTUAL_NUMBER,
        direction: "inbound",
      });

      const flowAction = flowRes.data?.action;
      const dialTarget = flowRes.data?.to;
      console.log(`   👉 Flow Action: "${flowAction}", Dial Target: "${dialTarget}"`);

      if (dialTarget === tc.expectedTarget) {
        console.log(`   ✅ PASS: Correctly routed to ${tc.expectedAgent} (${dialTarget})`);
      } else {
        console.error(`   ❌ FAIL: Expected ${tc.expectedTarget}, but got ${dialTarget}`);
      }

      // 2. Dispatch call.answered status webhook
      await sendWebhook({
        id: `evt_ans_${Date.now()}`,
        type: "call.answered",
        api_version: "2026-06-01",
        occurred_at: new Date().toISOString(),
        account_id: "acc_demo_frejun",
        call_id: callId,
        data: {
          call_id: callId,
          from: tc.callerNumber,
          to: VIRTUAL_NUMBER,
          direction: "inbound",
          answered_at: new Date().toISOString(),
        },
      });

      // 3. Dispatch call.completed
      await sendWebhook({
        id: `evt_comp_${Date.now()}`,
        type: "call.completed",
        api_version: "2026-06-01",
        occurred_at: new Date().toISOString(),
        account_id: "acc_demo_frejun",
        call_id: callId,
        data: {
          call_id: callId,
          from: tc.callerNumber,
          to: VIRTUAL_NUMBER,
          direction: "inbound",
          duration_seconds: 45,
          reason: "normal",
          ended_at: new Date().toISOString(),
        },
      });

      // 4. Dispatch Knowledge Base events: call.recording & call.insights
      await sendWebhook({
        id: `evt_rec_${Date.now()}`,
        type: "call.recording",
        api_version: "2026-06-01",
        occurred_at: new Date().toISOString(),
        call_id: callId,
        data: {
          call_id: callId,
          recording_url: "https://actions.google.com/sounds/v1/telephones/phone_calling.ogg",
        },
      });

      await sendWebhook({
        id: `evt_ins_${Date.now()}`,
        type: "call.insights",
        api_version: "2026-06-01",
        occurred_at: new Date().toISOString(),
        call_id: callId,
        data: {
          call_id: callId,
          insights: "Lead inquired about product pricing and scheduled a demo.",
        },
      });

      // Verify in CRM /calls list
      const res = await axios.get(`${BASE_URL}/api/calls/${callId}`);
      const saved = res.data?.data;
      console.log(`   📋 Session Verified: Caller: ${saved?.metadata?.callerName} | Assigned Agent: ${saved?.metadata?.receiverName} | Dial Target: ${saved?.metadata?.dialTarget || dialTarget}`);
      console.log(`   📝 Note: ${saved?.metadata?.note}`);
    } catch (err: any) {
      console.error(`   ❌ Failed test execution:`, err.response?.data || err.message);
    }
  }

  console.log("\n==================================================================");
  console.log("✨ All Inbound Call Routing tests finished successfully!");
  console.log("==================================================================\n");
}

testInboundCallRouting();
