import crypto from "node:crypto";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || "3001"}`;
const WEBHOOK_SECRET = process.env.FREJUN_WEBHOOK_SECRET || "test_webhook_secret";

async function runTests() {
  console.log("\n=======================================================");
  console.log("🧪 HASHTAGG CRM • FREJUN INTEGRATION AUTOMATED TEST SUITE");
  console.log(`🌐 Target: ${BASE_URL}`);
  console.log("=======================================================\n");

  let passed = 0;
  let failed = 0;

  async function assertTest(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ FAIL: ${name}`);
      if (err.response) {
        console.error(`   Status: ${err.response.status}`);
        console.error(`   Response:`, err.response.data);
      } else {
        console.error(`   Error: ${err.message}`);
      }
      failed++;
    }
  }

  // Test 1: Health Check
  await assertTest("Health check endpoint returns 200 OK", async () => {
    const res = await axios.get(`${BASE_URL}/api/health`);
    if (res.status !== 200 || !res.data.success) {
      throw new Error("Health check failed");
    }
  });

  // Test 2: Validation on invalid phone number
  await assertTest("POST /api/calls rejects invalid phone number with 400 Bad Request", async () => {
    try {
      await axios.post(`${BASE_URL}/api/calls`, {
        toNumber: "invalid-phone",
      });
      throw new Error("Expected request to fail with 400");
    } catch (err: any) {
      if (err.response?.status !== 400) {
        throw new Error(`Expected status 400 but got ${err.response?.status}`);
      }
      if (err.response?.data?.error?.code !== "VALIDATION_ERROR") {
        throw new Error("Expected VALIDATION_ERROR code");
      }
    }
  });

  // Test 3: Outbound call initiation
  let activeCallId = "";
  const testDestination = "+919876543210";
  await assertTest("POST /api/calls initiates outbound call with 201 Created", async () => {
    const res = await axios.post(`${BASE_URL}/api/calls`, {
      toNumber: testDestination,
      idempotencyKey: `test_idem_${Date.now()}`,
      metadata: { leadId: "lead_12345" },
    });

    if (res.status !== 201 || !res.data.success) {
      throw new Error("Call initiation failed");
    }

    activeCallId = res.data.data.callId;
    if (!activeCallId) {
      throw new Error("Expected callId in response");
    }
  });

  // Test 4: Duplicate Call Protection Guard
  await assertTest("Duplicate call to same number within cooldown is blocked with 409 Conflict", async () => {
    try {
      await axios.post(`${BASE_URL}/api/calls`, {
        toNumber: testDestination,
      });
      throw new Error("Expected duplicate call to be blocked with 409");
    } catch (err: any) {
      if (err.response?.status !== 409) {
        throw new Error(`Expected status 409 but got ${err.response?.status}`);
      }
      if (err.response?.data?.error?.code !== "DUPLICATE_CALL_PREVENTED") {
        throw new Error("Expected DUPLICATE_CALL_PREVENTED error code");
      }
    }
  });

  // Test 5: Call Flow Handshake Endpoint
  await assertTest("POST /api/teler/flow returns valid FreJun Call Flow JSON", async () => {
    const flowPayload = {
      call_id: activeCallId,
      account_id: "acc_test_123",
      from_number: "+918000000000",
      to_number: testDestination,
      direction: "outbound",
    };

    const res = await axios.post(`${BASE_URL}/api/teler/flow`, flowPayload);
    if (res.status !== 200) {
      throw new Error(`Expected status 200, got ${res.status}`);
    }

    const flowAction = res.data.action;
    if (!["play", "dial", "stream", "hangup"].includes(flowAction)) {
      throw new Error(`Unexpected Call Flow action: ${flowAction}`);
    }
  });

  // Test 6: Status Webhook with HMAC-SHA256 signature verification
  const testEventId = `evt_test_${Date.now()}`;
  await assertTest("POST /api/teler/status accepts valid signed webhook", async () => {
    const webhookBody = {
      id: testEventId,
      type: "call.answered",
      api_version: "2026-06-01",
      occurred_at: new Date().toISOString(),
      account_id: "acc_test_123",
      voice_app_id: "va_test_123",
      sip_trunk_id: null,
      call_id: activeCallId,
      leg_id: "cl_test_123",
      data: {
        call_id: activeCallId,
        from: "+918000000000",
        to: testDestination,
        direction: "outbound",
        start_time: new Date().toISOString(),
        answered_at: new Date().toISOString(),
      },
    };

    const rawBodyBuffer = Buffer.from(JSON.stringify(webhookBody));
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const msg = Buffer.concat([Buffer.from(`${timestamp}.`), rawBodyBuffer]);
    const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(msg).digest("hex");

    const res = await axios.post(`${BASE_URL}/api/teler/status`, webhookBody, {
      headers: {
        "Content-Type": "application/json",
        "X-Teler-Timestamp": timestamp,
        "X-Teler-Signature": signature,
        "X-Teler-Source": "live",
      },
    });

    if (res.status !== 200) {
      throw new Error(`Expected status 200, got ${res.status}`);
    }
  });

  // Test 7: Webhook Deduplication (Idempotency on event.id)
  await assertTest("Duplicate webhook event delivery is acknowledged idempotently (200 OK)", async () => {
    const webhookBody = {
      id: testEventId, // same ID
      type: "call.answered",
      api_version: "2026-06-01",
      occurred_at: new Date().toISOString(),
      account_id: "acc_test_123",
      voice_app_id: "va_test_123",
      sip_trunk_id: null,
      call_id: activeCallId,
      leg_id: "cl_test_123",
      data: {
        call_id: activeCallId,
      },
    };

    const rawBodyBuffer = Buffer.from(JSON.stringify(webhookBody));
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const msg = Buffer.concat([Buffer.from(`${timestamp}.`), rawBodyBuffer]);
    const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(msg).digest("hex");

    const res = await axios.post(`${BASE_URL}/api/teler/status`, webhookBody, {
      headers: {
        "Content-Type": "application/json",
        "X-Teler-Timestamp": timestamp,
        "X-Teler-Signature": signature,
      },
    });

    if (res.status !== 200 || res.data.duplicate !== true) {
      throw new Error("Expected idempotent duplicate acknowledgment");
    }
  });

  // Test 8: Tampered signature rejection
  await assertTest("Webhook with invalid HMAC signature is rejected with 401 Unauthorized", async () => {
    try {
      const webhookBody = {
        id: `evt_fake_${Date.now()}`,
        type: "call.failed",
      };

      await axios.post(`${BASE_URL}/api/teler/status`, webhookBody, {
        headers: {
          "Content-Type": "application/json",
          "X-Teler-Timestamp": Math.floor(Date.now() / 1000).toString(),
          "X-Teler-Signature": "bad_hex_signature_deadbeef1234567890abcdef1234567890abcdef1234567890",
        },
      });
      throw new Error("Expected request to fail with 401");
    } catch (err: any) {
      if (err.response?.status !== 401) {
        throw new Error(`Expected status 401, got ${err.response?.status}`);
      }
    }
  });

  // Test 9: Call Retrieval & Event Queries
  await assertTest("GET /api/calls and GET /api/calls/events return stored telephony records", async () => {
    const callsRes = await axios.get(`${BASE_URL}/api/calls`);
    if (!callsRes.data.data.find((c: any) => c.callId === activeCallId)) {
      throw new Error("Active call not found in calls list");
    }

    const eventsRes = await axios.get(`${BASE_URL}/api/calls/events?callId=${activeCallId}`);
    if (!eventsRes.data.data.find((e: any) => e.eventId === testEventId)) {
      throw new Error("Webhook event not found in event list");
    }
  });

  console.log("\n=======================================================");
  console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution threw error:", err);
  process.exit(1);
});
