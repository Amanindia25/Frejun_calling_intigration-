import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || "3001"}`;
const VIRTUAL_NUMBER = process.env.FREJUN_CALLER_NUMBER || "+918035742316";

async function sendDialerWebhook(payload: Record<string, unknown>) {
  try {
    const res = await axios.post(`${BASE_URL}/api/teler/status`, payload, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    console.log(`   📥 Server Response: ${res.status}`, res.data);
  } catch (err: any) {
    console.error(`   ❌ Delivery failed:`, err.response?.data || err.message);
  }
}

async function simulateDialerCallLifecycle() {
  const callId = process.argv[2] || `fj_call_${Date.now()}`;
  const callerNumber = process.argv[3] || "+918708050914"; // Aman Lead
  const callerName = "Aman Lead";

  console.log("==================================================================");
  console.log("📞 Simulating Official FreJun Dialer Inbound Call Lifecycle");
  console.log(`🆔 Call ID:        ${callId}`);
  console.log(`👤 Customer Lead:   ${callerNumber} (${callerName})`);
  console.log(`🏢 Virtual Number:  ${VIRTUAL_NUMBER}`);
  console.log("==================================================================\n");

  const startTime = new Date().toISOString();

  // Stage 1: Call started ringing -> "Inbound call initiated"
  console.log(`▶️ Stage 1: Call ringing ➔ call_status: "Inbound call initiated"...`);
  await sendDialerWebhook({
    event: "call.status",
    call_id: callId,
    start_time: startTime,
    call_creator: "info@maxpinetechnology.com",
    candidate_number: callerNumber,
    candidate_name: callerName,
    virtual_number: VIRTUAL_NUMBER,
    call_status: "Inbound call initiated",
    call_type: "inbound",
    org_identifier: "maxpine_tech",
  });

  // Delay 2.5 seconds
  await new Promise((r) => setTimeout(r, 2500));

  // Stage 2: Call answered -> "Call answered"
  const answerTime = new Date().toISOString();
  console.log(`\n▶️ Stage 2: Call picked up ➔ call_status: "Call answered"...`);
  await sendDialerWebhook({
    event: "call.status",
    call_id: callId,
    start_time: startTime,
    answer_time: answerTime,
    call_creator: "info@maxpinetechnology.com",
    candidate_number: callerNumber,
    candidate_name: callerName,
    virtual_number: VIRTUAL_NUMBER,
    call_status: "Call answered",
    call_type: "inbound",
    org_identifier: "maxpine_tech",
  });

  // Delay 3 seconds
  await new Promise((r) => setTimeout(r, 3000));

  // Stage 3: Call completed -> "Call completed"
  const endTime = new Date().toISOString();
  const durationMs = 35000; // 35 seconds in ms per FreJun Dialer docs
  console.log(`\n▶️ Stage 3: Call ended ➔ call_status: "Call completed" (${durationMs} ms)...`);
  await sendDialerWebhook({
    event: "call.status",
    call_id: callId,
    start_time: startTime,
    answer_time: answerTime,
    end_time: endTime,
    duration: durationMs,
    call_creator: "info@maxpinetechnology.com",
    candidate_number: callerNumber,
    candidate_name: callerName,
    virtual_number: VIRTUAL_NUMBER,
    call_status: "Call completed",
    call_type: "inbound",
    org_identifier: "maxpine_tech",
    metadata: {
      source: "frejun_dialer_webhook",
      recording_url: "https://api.frejun.com/recordings/test_sample_rec.mp3",
    },
  });

  console.log("\n==================================================================");
  console.log("✅ Simulation complete! Check CRM dashboard (GET /api/calls)");
  console.log("==================================================================\n");
}

simulateDialerCallLifecycle().catch((err) => {
  console.error(err);
  process.exit(1);
});
