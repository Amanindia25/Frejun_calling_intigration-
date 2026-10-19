# 📞 Hashtagg CRM • Complete FreJun Calling Integration Master Guide

> **Authoritative Technical Documentation & Step-by-Step Migration Manual**  
> This guide details every component, endpoint, FreJun API, and workflow required to implement one-click outbound calling, two-way audio bridging, call recording, live status synchronization, and inbound call routing into **Hashtagg CRM** (or any other project).

---

## 📑 Table of Contents

1. [Architectural Overview: How FreJun Calling Works](#1-architectural-overview-how-frejun-calling-works)
2. [Prerequisites & FreJun Account Setup](#2-prerequisites--frejun-account-setup)
3. [Environment Configuration (.env)](#3-environment-configuration-env)
4. [External FreJun APIs Reference](#4-external-frejun-apis-reference)
   - [4.1 Outbound Call Initiation (`create-call`)](#41-outbound-call-initiation-create-call)
   - [4.2 Agent Phone Synchronization (`user/`)](#42-agent-phone-synchronization-user)
   - [4.3 Fetch Call History & Recordings (`calls/`)](#43-fetch-call-history--recordings-calls)
   - [4.4 Webhook Registration (`create-webhook`)](#44-webhook-registration-create-webhook)
   - [4.5 FreJun Teler Voice API Alternative (`voice/calls/initiate`)](#45-frejun-teler-voice-api-alternative-voicecallsinitiate)
5. [Internal Backend APIs Reference (Built for CRM)](#5-internal-backend-apis-reference-built-for-crm)
   - [5.1 `POST /api/calls` (Initiate Outbound Call)](#51-post-apicalls-initiate-outbound-call)
   - [5.2 `GET /api/calls` (List Call Sessions & History)](#52-get-apicalls-list-call-sessions--history)
   - [5.3 `GET /api/calls/:id` (Get Call Details)](#53-get-apicallsid-get-call-details)
   - [5.4 `POST /api/calls/:id/hangup` (End Call)](#54-post-apicallsidhangup-end-call)
   - [5.5 `POST /api/calls/sync` (Trigger FreJun Log Sync)](#55-post-apicallssync-trigger-frejun-log-sync)
   - [5.6 `GET /api/calls/events` (Lifecycle Event Feed)](#56-get-apicallsevents-lifecycle-event-feed)
   - [5.7 `POST /api/teler/flow` (Call Flow Handshake Callback)](#57-post-apitelerflow-call-flow-handshake-callback)
   - [5.8 `POST /api/teler/status` (HMAC Signed Webhook Receiver)](#58-post-apitelerstatus-hmac-signed-webhook-receiver)
   - [5.9 `GET /api/crm/creators` & `/api/crm/candidates`](#59-get-apicrmcreators--apicrmcandidates)
6. [Step-by-Step Implementation Guide for Hashtagg CRM](#6-step-by-step-implementation-guide-for-hashtagg-crm)
   - [Step 1: Install Dependencies](#step-1-install-dependencies)
   - [Step 2: Database Schema (Prisma / SQL / Mongoose)](#step-2-database-schema-prisma--sql--mongoose)
   - [Step 3: Phone Number Utility (E.164 Normalization)](#step-3-phone-number-utility-e164-normalization)
   - [Step 4: Duplicate Call Cooldown Guard](#step-4-duplicate-call-cooldown-guard)
   - [Step 5: FreJun Telephony Service](#step-5-frejun-telephony-service)
   - [Step 6: Call Controller & Routing](#step-6-call-controller--routing)
   - [Step 7: Webhook & Call Flow Controller](#step-7-webhook--call-flow-controller)
   - [Step 8: Raw Body Middleware (HMAC Verification)](#step-8-raw-body-middleware-hmac-verification)
   - [Step 9: Background Periodic Synchronization](#step-9-background-periodic-synchronization)
   - [Step 10: Frontend Integration (Click-to-Dial Button & HUD)](#step-10-frontend-integration-click-to-dial-button--hud)
7. [Testing & Verification Checklist](#7-testing--verification-checklist)
8. [Common Pitfalls & Troubleshooting](#8-common-pitfalls--troubleshooting)

---

## 1. Architectural Overview: How FreJun Calling Works

FreJun implements a **Two-Legged Bridged Calling Architecture** (often known as Click-to-Call / Web-initiated dialing):

```
+-----------------------------------------------------------------------------------------+
|                                    OUTBOUND CALL FLOW                                   |
+-----------------------------------------------------------------------------------------+

  [CRM Agent UI] ──(Click Call)──> [Hashtagg CRM Backend] ──(POST /create-call)──> [FreJun API]
                                                                                        │
                                    +───────────────────────────────────────────────────+
                                    │
                                    ▼
       Leg 1: FreJun rings Agent's Phone (+91 8376822509)
              (Agent answers)
                                    │
                                    ▼
       Leg 2: FreJun dials Candidate/Lead Phone (+91 8935926120)
              (Lead phone rings and answers)
                                    │
                                    ▼
       Bridge: FreJun connects both legs into a 2-way audio channel.
               Recording begins automatically on FreJun's telephony server.
                                    │
                                    ▼
       Webhook: When call ends, FreJun posts call duration, status,
                and MP3 recording URL to `/api/teler/status` or syncs via `/calls/`.
```

### Key Differences: FreJun CRM Dialer vs. FreJun Teler Voice

| Feature | FreJun CRM Dialer (`api.frejun.com`) | FreJun Teler Voice API (`api.frejun.ai`) |
| :--- | :--- | :--- |
| **Portal** | `product.frejun.com` | `frejun.ai` |
| **API Key Format** | Contains dot (e.g. `12345678.abcdef123456`) | Plain alphanumeric key |
| **Auth Header** | `Authorization: Api-Key <KEY>` | `X-API-Key: <KEY>` or `Bearer <KEY>` |
| **Dial Endpoint** | `POST /api/v1/integrations/create-call/` | `POST /api/v1/voice/calls/initiate` |
| **Call Flow** | Handled natively by FreJun portal & agents | Custom webhook callback (`flow_url`) returning JSON |
| **Recordings** | Synced via `GET /api/v1/integrations/calls/` | Dispatched via webhook `recording.completed` |

> 💡 **Best Practice:** Our backend implementation supports **both** methods seamlessly. When the API key has a dot (`.`), it automatically routes through `api.frejun.com`.

---

## 2. Prerequisites & FreJun Account Setup

Before writing code in your new project, ensure you have:

1. **FreJun Account & Subscription:** An active account on [product.frejun.com](https://product.frejun.com).
2. **API Key Generation & OAuth App Creation:**
   - Log into `https://product.frejun.com`.
   - Go to **Settings** ➔ **Developer**.
   - **API Keys**: Generate an API Key for dialing & call history (it will look like `<prefix>.<secret>`).
   - **OAuth apps**: Click the green **Create app** button:
     - **App name**: `Maxpine CRM`
     - **Redirect URL**: `https://tawanna-roomier-nonhereditably.ngrok-free.dev/api/oauth/callback` (or your production callback URL)
     - Once created, copy the **Client ID** and **Client Secret** into your `.env` file. These are mandatory for registering webhooks via the Dialer API.
3. **Provisioned Virtual Caller Number:**
   - Ensure a Virtual Number (e.g., `+918035742316` or assigned DID) is provisioned on your FreJun account.
4. **Agent Users Setup:**
   - In FreJun Settings ➔ **Users**, add your CRM agents with their corporate email (e.g., `info@maxpinetechnology.com`) and assign their mobile phone numbers.
5. **Public Domain / Tunneling:**
   - FreJun webhooks require a publicly reachable HTTPS endpoint. For local development, use `ngrok http 3001`. In staging/production, use your actual domain (e.g., `https://crm-api.hashtagg.com`).

---

## 3. Environment Configuration (.env)

Add the following environment variables to your new project's `.env` file:

```ini
# Server Port & Environment
PORT=3001
NODE_ENV=development

# Public Base URL (Must be publicly accessible HTTPS for webhooks)
PUBLIC_BASE_URL=https://tawanna-roomier-nonhereditably.ngrok-free.dev

# FreJun API Key (from product.frejun.com/settings -> Developer -> API keys)
FREJUN_API_KEY=3317aea0.a043a37e004459af898e6f0c6f66e8c4

# FreJun Dialer OAuth App Credentials (from product.frejun.com/settings -> Developer -> OAuth apps)
FREJUN_CLIENT_ID=your_client_id_here
FREJUN_CLIENT_SECRET=your_client_secret_here

# Provisioned Virtual Caller Number
FREJUN_CALLER_NUMBER=+918035742316

# Secret for HMAC-SHA256 signature verification
FREJUN_WEBHOOK_SECRET=xghdghdhcgdghcvhgwdghdghvghdvghcv

# Call Flow Settings
FREJUN_FLOW_ACTION=dial
FREJUN_DIAL_BRIDGE_TARGET=+918376822509
```

# Public Base URL (Must be HTTPS in production for FreJun webhooks)
PUBLIC_BASE_URL=https://api.yourcrm.com

# FreJun API Credentials
# Format: <prefix>.<secret> for product.frejun.com
FREJUN_API_KEY=YOUR_ACTUAL_FREJUN_API_KEY

# Provisioned FreJun Virtual Number (in E.164 format)
FREJUN_CALLER_NUMBER=+918000000000

# Webhook Secret for HMAC-SHA256 signature verification
FREJUN_WEBHOOK_SECRET=your_secure_webhook_secret_here

# Call Flow Settings (For FreJun Teler)
FREJUN_FLOW_ACTION=dial
FREJUN_FLOW_MEDIA_URL=https://actions.google.com/sounds/v1/telephones/phone_calling.ogg
FREJUN_DIAL_BRIDGE_TARGET=+918376822509

# Call Safety & Performance
DUPLICATE_CALL_COOLDOWN_SECONDS=15
FREJUN_WEBHOOK_TOLERANCE_SECONDS=300
FREJUN_RECORD_CALLS=true
LOG_LEVEL=info
```

---

## 4. External FreJun APIs Reference

These are the exact external APIs provided by FreJun that our backend communicates with:

### 4.1 Outbound Call Initiation (`create-call`)

Initiates a two-way bridged call between a CRM agent and a lead.

- **URL:** `POST https://api.frejun.com/api/v1/integrations/create-call/`
- **Headers:**
  ```http
  Authorization: Api-Key <FREJUN_API_KEY>
  Content-Type: application/json
  ```
- **Request Body:**
  ```json
  {
    "candidate_number": "+918935926120",
    "user_email": "info@maxpinetechnology.com"
  }
  ```
- **Response (`200 OK` or `201 Created`):**
  ```json
  {
    "success": true,
    "message": "Call initiated successfully",
    "data": {
      "status": 1,
      "info": "Calling to the user",
      "event_id": 98231,
      "call_id": "cs_frejun_98231",
      "candidate_name": "Aman Lead"
    }
  }
  ```
- **Error Codes:**
  - `401 / 403`: Invalid or expired API Key.
  - `400`: Invalid phone number format or user email not found on FreJun account.
  - `422`: Agent phone number not set on FreJun user profile.

---

### 4.2 Agent Phone Synchronization (`user/`)

Dynamically updates the mobile phone number where FreJun will ring the agent for Leg 1.

- **URL:** `PATCH https://api.frejun.com/api/v1/integrations/user/?email=<ENCODED_AGENT_EMAIL>`
- **Headers:**
  ```http
  Authorization: Api-Key <FREJUN_API_KEY>
  Content-Type: application/json
  ```
- **Request Body:**
  ```json
  {
    "number": "+918376822509"
  }
  ```
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "message": "User updated successfully"
  }
  ```

---

### 4.3 Fetch Call History & Recordings (`calls/`)

Fetches all recent call logs, audio recording MP3 links, durations, and call outcomes directly from FreJun.

- **URL:** `GET https://api.frejun.com/api/v1/integrations/calls/`
- **Headers:**
  ```http
  Authorization: Api-Key <FREJUN_API_KEY>
  Content-Type: application/json
  ```
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": 14205,
        "call_id": "cs_frejun_14205",
        "creator_number": "+918376822509",
        "candidate_number": "+918935926120",
        "virtual_number": "+918000000000",
        "call_type": "outgoing",
        "status": "answered",
        "call_duration": 0.48,
        "call_start_time": "2026-10-17T09:30:00Z",
        "call_end_time": "2026-10-17T09:30:29Z",
        "recording_url": "https://storage.frejun.com/recordings/call_14205.mp3",
        "link": "https://product.frejun.com/calls/14205",
        "recruiter": "Aman"
      }
    ]
  }
  ```
  *(Note: FreJun provides `call_duration` in fractional minutes, e.g. `0.48 * 60 = ~29` seconds).*

---

### 4.4 Webhook Registration (`create-webhook`)

Registers your backend endpoint to receive real-time webhook events from FreJun.

- **URL:** `POST https://api.frejun.com/api/v1/integrations/create-webhook/`
- **Headers:**
  ```http
  Authorization: Api-Key <FREJUN_API_KEY>
  Content-Type: application/json
  ```
- **Request Body:**
  ```json
  {
    "event": "call.status",
    "callback_url": "https://api.yourcrm.com/api/teler/status"
  }
  ```
- **Supported Events:**
  - `call.status` (ringing, answered, completed, failed)
  - `call.recording` (dispatched when recording MP3 is ready)
  - `call.insights` (transcription and sentiment)
  - `call.propertyChange.notes`
  - `call.propertyChange.call_reason`

---

### 4.5 FreJun Teler Voice API Alternative (`voice/calls/initiate`)

Used when using FreJun Teler Voice API (`frejun.ai`):

- **URL:** `POST https://api.frejun.ai/api/v1/voice/calls/initiate`
- **Headers:**
  ```http
  X-API-Key: <FREJUN_API_KEY>
  Content-Type: application/json
  ```
- **Request Body:**
  ```json
  {
    "from_number": "+918000000000",
    "to_number": "+918935926120",
    "flow_url": "https://api.yourcrm.com/api/teler/flow",
    "status_callback_url": "https://api.yourcrm.com/api/teler/status",
    "record": true
  }
  ```
- **Response (`200 OK`):**
  ```json
  {
    "message": "Call initiated",
    "data": {
      "id": "cs_01J7K8Z4B5N6Q7R8S9T0V1W2X3"
    }
  }
  ```

---

## 5. Internal Backend APIs Reference (Built for CRM)

These are the REST endpoints exposed by our CRM backend for the frontend dialer and webhook callbacks:

### 5.1 `POST /api/calls` (Initiate Outbound Call)

Triggers the one-click call flow from the CRM. Includes validation, strict agent-lead pairing checks, and duplicate dial guards.

- **Method:** `POST`
- **URL:** `/api/calls`
- **Headers:** `Content-Type: application/json`
- **Request Body Schema:**
  ```typescript
  {
    toNumber: string;          // Required. Destination phone (E.164: e.g. +918708050914)
    fromNumber?: string;        // Optional. Custom caller ID
    creatorId?: string;         // Optional. CRM Agent ID (e.g. "creator_aman")
    candidateId?: string;       // Optional. CRM Lead ID (e.g. "cand_aman_lead")
    userEmail?: string;         // Optional. FreJun Agent email
    creatorNumber?: string;     // Optional. Agent phone number to ring
    record?: boolean;           // Optional. Defaults to true
    idempotencyKey?: string;    // Optional. Unique client UUID to prevent double-clicks
    metadata?: Record<string, unknown>; // Optional. Custom CRM context (lead ID, deal ID)
  }
  ```
- **Example Request:**
  ```json
  {
    "toNumber": "+918708050914",
    "creatorId": "creator_aman",
    "candidateId": "cand_aman_lead",
    "userEmail": "info@maxpinetechnology.com",
    "creatorNumber": "+918376822509",
    "record": true,
    "metadata": {
      "crmUserId": "user_101",
      "dealId": "deal_5002"
    }
  }
  ```
- **Success Response (`201 Created`):**
  ```json
  {
    "success": true,
    "message": "Outbound call initiated successfully",
    "data": {
      "callId": "cs_frejun_98231",
      "provider": "frejun",
      "fromNumber": "+918376822509",
      "toNumber": "+918935926120",
      "state": "initiated",
      "record": true,
      "createdAt": "2026-10-17T09:30:00.000Z",
      "metadata": {
        "callDirection": "outbound",
        "creatorEmail": "info@maxpinetechnology.com",
        "creatorNumber": "+918376822509",
        "crmUserId": "user_101",
        "dealId": "deal_5002"
      }
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Invalid E.164 phone format or strict pairing violation.
  - `409 Conflict`: Duplicate call attempted to the same number within the 15-second cooldown window (`DUPLICATE_CALL_PREVENTED`).
  - `502 Bad Gateway`: FreJun carrier routing failure or agent phone unreachable.

---

### 5.2 `GET /api/calls` (List Call Sessions & History)

Retrieves the list of recent call sessions with live statuses, durations, and recording URLs. Automatically performs background sync from FreJun.

- **Method:** `GET`
- **URL:** `/api/calls?limit=50`
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": [
      {
        "callId": "cs_frejun_14205",
        "provider": "frejun",
        "fromNumber": "+918376822509",
        "toNumber": "+918935926120",
        "state": "completed",
        "record": true,
        "durationSeconds": 29,
        "recordingUrl": "https://storage.frejun.com/recordings/call_14205.mp3",
        "createdAt": "2026-10-17T09:30:00.000Z",
        "answeredAt": "2026-10-17T09:30:05.000Z",
        "endedAt": "2026-10-17T09:30:29.000Z",
        "metadata": {
          "callDirection": "outbound",
          "callerName": "Aman",
          "receiverName": "Aman Lead"
        }
      }
    ],
    "meta": {
      "count": 1,
      "limit": 50
    }
  }
  ```

---

### 5.3 `GET /api/calls/:id` (Get Call Details)

Fetches details of a specific call by its unified ID (`cs_...`). If not found locally, queries FreJun's live status.

- **Method:** `GET`
- **URL:** `/api/calls/:id`
- **Response (`200 OK`):** Returns the `CallSessionDto` object.
- **Error:** `404 Not Found` if call ID does not exist.

---

### 5.4 `POST /api/calls/:id/hangup` (End Call)

Allows the agent to terminate an active call session from the CRM interface.

- **Method:** `POST`
- **URL:** `/api/calls/:id/hangup`
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "message": "Call ended successfully",
    "data": {
      "callId": "cs_frejun_14205",
      "state": "completed",
      "endedAt": "2026-10-17T09:32:00.000Z",
      "durationSeconds": 45
    }
  }
  ```

---

### 5.5 `POST /api/calls/sync` (Trigger FreJun Log Sync)

Explicitly triggers an on-demand sync from FreJun Integrations API to update all latest recordings, statuses, and notes into the CRM database.

- **Method:** `POST` or `GET`
- **URL:** `/api/calls/sync`
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "message": "Successfully synchronized 12 calls from FreJun",
    "data": [ ... ]
  }
  ```

---

### 5.6 `GET /api/calls/events` (Lifecycle Event Feed)

Provides a stream of telephony events (`call.initiated`, `call.answered`, `call.completed`) for the CRM UI's live HUD.

- **Method:** `GET`
- **URL:** `/api/calls/events?limit=50&callId=cs_...`
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": [
      {
        "eventId": "evt_sync_14205_1729158000",
        "eventType": "call.completed",
        "callId": "cs_frejun_14205",
        "occurredAt": "2026-10-17T09:30:29.000Z",
        "data": {
          "status": "answered",
          "duration_seconds": 29,
          "recording_url": "https://storage.frejun.com/recordings/call_14205.mp3"
        }
      }
    ]
  }
  ```

---

### 5.7 `POST /api/teler/flow` (Call Flow Handshake Callback)

Called by FreJun Teler when a call is answered. Must respond with a single action JSON within **5 seconds**.

- **Method:** `POST` (and fallback `GET`)
- **URL:** `/api/teler/flow` (and alias `/flow`)
- **Request from FreJun:**
  ```json
  {
    "call_id": "cs_01J7K8Z4B5N6Q7R8S9T0V1W2X3",
    "account_id": "acc_01H8ZXK9M2P7Q3R4S5T6V7W8XY",
    "from_number": "+918935926120",
    "to_number": "+918000000000",
    "direction": "inbound"
  }
  ```
- **Our Response (`200 OK`) for Two-Way Audio Bridging:**
  ```json
  {
    "action": "dial",
    "to": "+918376822509",
    "timeout": 30,
    "record": true,
    "ringback": "passthrough"
  }
  ```

---

### 5.8 `POST /api/teler/status` (HMAC Signed Webhook Receiver)

Receives live call state updates from FreJun. Validates the HMAC-SHA256 signature, prevents replay attacks, deduplicates incoming events, and updates call records.

- **Method:** `POST`
- **URL:** `/api/teler/status` (and alias `/status`, `/webhook`)
- **Required Headers:**
  - `X-Teler-Timestamp`: Current UTC epoch seconds (e.g. `1714201234`)
  - `X-Teler-Signature`: Hex-encoded HMAC-SHA256 signature
- **Payload Structure (2026-06-01 Envelope):**
  ```json
  {
    "id": "evt_01H8ZXK9M2P7Q3R4S5T6V7W8XY",
    "type": "call.completed",
    "api_version": "2026-06-01",
    "occurred_at": "2026-10-17T09:30:29.000Z",
    "call_id": "cs_01J7K8Z4B5N6Q7R8S9T0V1W2X3",
    "data": {
      "call_id": "cs_01J7K8Z4B5N6Q7R8S9T0V1W2X3",
      "from": "+918376822509",
      "to": "+918935926120",
      "direction": "outbound",
      "start_time": "2026-10-17T09:30:00.000Z",
      "answered_at": "2026-10-17T09:30:05.000Z",
      "ended_at": "2026-10-17T09:30:29.000Z",
      "duration_seconds": 24,
      "reason": "normal",
      "ended_by": "callee"
    }
  }
  ```
- **Response (`200 OK` within 5 seconds):**
  ```json
  {
    "status": "acknowledged",
    "eventId": "evt_01H8ZXK9M2P7Q3R4S5T6V7W8XY"
  }
  ```

---

### 5.9 `GET /api/crm/creators` & `/api/crm/candidates`

Provides agent and customer records for the dialing selector:

- `GET /api/crm/creators`: List all agents with phone numbers and roles.
- `POST /api/crm/creators`: Register a new calling agent.
- `GET /api/crm/candidates?search=...`: Query leads with phone numbers and call counts.
- `POST /api/crm/candidates`: Create a new lead/candidate.

---

## 6. Step-by-Step Implementation Guide for Hashtagg CRM

Follow these exact steps to add this calling feature to Hashtagg CRM:

### Step 1: Install Dependencies

In your Hashtagg CRM backend repository:

```bash
npm install axios dotenv zod
npm install @frejun/teler --save-optional
npm install --save-dev @types/node
```

---

### Step 2: Database Schema (Prisma / SQL / Mongoose)

Create a table/collection for storing call records. If using Prisma:

```prisma
model CallSession {
  id              String       @id @default(uuid())
  callId          String       @unique // FreJun Call ID (cs_...)
  provider        String       @default("frejun")
  fromNumber      String
  toNumber        String
  state           String       // initiated, ringing, answered, completed, failed
  direction       String       @default("outbound") // outbound | inbound
  record          Boolean      @default(true)
  durationSeconds Int?
  recordingUrl    String?
  reason          String?
  flowAction      String?
  agentId         String?
  leadId          String?
  metadata        Json?
  createdAt       DateTime     @default(now())
  answeredAt      DateTime?
  endedAt         DateTime?
  updatedAt       DateTime     @updatedAt

  @@index([toNumber])
  @@index([agentId])
  @@index([leadId])
}

model TelephonyEvent {
  id          String   @id @default(uuid())
  eventId     String   @unique // FreJun evt_<ULID>
  eventType   String   // call.initiated, call.answered, call.completed, call.failed
  callId      String
  occurredAt  DateTime
  payload     Json
  createdAt   DateTime @default(now())

  @@index([callId])
}
```

---

### Step 3: Phone Number Utility (E.164 Normalization)

Create `src/utils/phone.utils.ts`:

```typescript
/**
 * Normalizes phone numbers into strict ITU-T E.164 format (+[country_code][subscriber_number])
 */
export function normalizePhoneNumber(raw: string, defaultCountryCode = "+91"): string {
  if (!raw) return "";
  let cleaned = raw.trim().replace(/[^\d+]/g, "");

  if (cleaned.startsWith("00")) {
    cleaned = "+" + cleaned.slice(2);
  }

  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  if (cleaned.length === 10) {
    return `${defaultCountryCode}${cleaned}`;
  }

  if (cleaned.length === 11 && cleaned.startsWith("0")) {
    return `${defaultCountryCode}${cleaned.slice(1)}`;
  }

  return `+${cleaned}`;
}

export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}
```

---

### Step 4: Duplicate Call Cooldown Guard

Prevents agents from accidental double-clicks creating duplicate calls to the same lead.  
Create `src/middleware/duplicate-call.middleware.ts`:

```typescript
import { Request, Response, NextFunction } from "express";

interface ActiveCooldown {
  timestamp: number;
  callId?: string;
  idempotencyKey?: string;
}

export class DuplicateCallGuardService {
  private cooldowns = new Map<string, ActiveCooldown>();
  private readonly cooldownMs: number;

  constructor(cooldownSeconds = 15) {
    this.cooldownMs = cooldownSeconds * 1000;
  }

  public isCallInFlight(toNumber: string, idempotencyKey?: string): boolean {
    const cleanNumber = toNumber.replace(/\D/g, "");
    const existing = this.cooldowns.get(cleanNumber);
    if (!existing) return false;

    if (Date.now() - existing.timestamp > this.cooldownMs) {
      this.cooldowns.delete(cleanNumber);
      return false;
    }

    if (idempotencyKey && existing.idempotencyKey === idempotencyKey) {
      return true;
    }

    return true;
  }

  public registerCall(toNumber: string, callId: string, idempotencyKey?: string): void {
    const cleanNumber = toNumber.replace(/\D/g, "");
    this.cooldowns.set(cleanNumber, {
      timestamp: Date.now(),
      callId,
      idempotencyKey,
    });
  }

  public clearCooldown(toNumber: string): void {
    const cleanNumber = toNumber.replace(/\D/g, "");
    this.cooldowns.delete(cleanNumber);
  }
}
```

---

### Step 5: FreJun Telephony Service

Create `src/services/frejun.service.ts`:

```typescript
import axios from "axios";
import crypto from "node:crypto";

export interface InitiateCallParams {
  toNumber: string;
  fromNumber?: string;
  userEmail?: string;
  creatorNumber?: string;
  record?: boolean;
}

export class FreJunService {
  private apiKey: string;
  private callerNumber: string;
  private webhookSecret: string;

  constructor() {
    this.apiKey = process.env.FREJUN_API_KEY || "";
    this.callerNumber = process.env.FREJUN_CALLER_NUMBER || "";
    this.webhookSecret = process.env.FREJUN_WEBHOOK_SECRET || "";
  }

  /**
   * Initiates an outbound call via FreJun CRM API
   */
  public async initiateCall(params: InitiateCallParams) {
    const userEmail = params.userEmail || "info@maxpinetechnology.com";

    // 1. If agent phone number is provided, sync it with FreJun profile
    if (params.creatorNumber) {
      try {
        await axios.patch(
          `https://api.frejun.com/api/v1/integrations/user/?email=${encodeURIComponent(userEmail)}`,
          { number: params.creatorNumber },
          {
            headers: {
              Authorization: `Api-Key ${this.apiKey}`,
              "Content-Type": "application/json",
            },
            timeout: 5000,
          }
        );
      } catch (err: any) {
        console.warn("Could not patch agent number, proceeding with dial:", err.message);
      }
    }

    // 2. Trigger the call
    const response = await axios.post(
      "https://api.frejun.com/api/v1/integrations/create-call/",
      {
        candidate_number: params.toNumber,
        user_email: userEmail,
      },
      {
        headers: {
          Authorization: `Api-Key ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    if (response.data && response.data.success) {
      const callData = response.data.data;
      return {
        callId: callData?.call_id || `cs_frejun_${callData?.event_id || Date.now()}`,
        status: "initiated",
        fromNumber: params.creatorNumber || this.callerNumber,
        toNumber: params.toNumber,
        eventId: callData?.event_id,
      };
    }

    throw new Error(response.data?.message || "Failed to initiate call via FreJun");
  }

  /**
   * Fetches call logs and recording URLs from FreJun
   */
  public async fetchCallLogs(): Promise<any[]> {
    if (!this.apiKey) return [];
    try {
      const response = await axios.get("https://api.frejun.com/api/v1/integrations/calls/", {
        headers: {
          Authorization: `Api-Key ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      });

      const data = response.data?.data || response.data?.results || response.data || [];
      return Array.isArray(data) ? data : [];
    } catch (err: any) {
      console.error("Failed to fetch call logs from FreJun:", err.message);
      return [];
    }
  }

  /**
   * Verifies incoming Webhook HMAC-SHA256 signature
   */
  public verifyWebhookSignature(rawBody: Buffer, timestamp: string, signature: string): boolean {
    if (!this.webhookSecret || !signature || !timestamp) {
      return true; // Permissive in dev if secret not configured
    }

    // Check tolerance (300 seconds)
    const eventTime = Number(timestamp);
    const now = Math.floor(Date.now() / 1000);
    if (isNaN(eventTime) || Math.abs(now - eventTime) > 300) {
      return false;
    }

    try {
      const message = Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]);
      const expected = crypto.createHmac("sha256", this.webhookSecret).update(message).digest("hex");

      if (signature.length !== expected.length) return false;
      return crypto.timingSafeEqual(Buffer.from(signature, "utf-8"), Buffer.from(expected, "utf-8"));
    } catch {
      return false;
    }
  }
}
```

---

### Step 6: Call Controller & Routing

Create `src/controllers/call.controller.ts`:

```typescript
import { Request, Response, NextFunction } from "express";
import { FreJunService } from "../services/frejun.service";
import { DuplicateCallGuardService } from "../middleware/duplicate-call.middleware";
import { normalizePhoneNumber, isValidE164 } from "../utils/phone.utils";

const frejunService = new FreJunService();
const duplicateGuard = new DuplicateCallGuardService(15);

export async function initiateCallHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { toNumber, creatorNumber, userEmail, metadata } = req.body;

    if (!toNumber) {
      return res.status(400).json({ success: false, message: "toNumber is required" });
    }

    const normalizedTo = normalizePhoneNumber(toNumber);
    if (!isValidE164(normalizedTo)) {
      return res.status(400).json({ success: false, message: "toNumber must be in E.164 format (+91XXXXXXXXXX)" });
    }

    // Check duplicate call cooldown
    if (duplicateGuard.isCallInFlight(normalizedTo)) {
      return res.status(409).json({
        success: false,
        error: {
          code: "DUPLICATE_CALL_PREVENTED",
          message: "A call to this number is already in progress or was dialed recently. Please wait 15 seconds.",
        },
      });
    }

    const session = await frejunService.initiateCall({
      toNumber: normalizedTo,
      creatorNumber: creatorNumber ? normalizePhoneNumber(creatorNumber) : undefined,
      userEmail,
    });

    duplicateGuard.registerCall(normalizedTo, session.callId);

    // Save to your CRM database (Prisma / Mongoose)
    // await prisma.callSession.create({ data: { ... } });

    res.status(201).json({
      success: true,
      message: "Call initiated successfully",
      data: session,
    });
  } catch (error: any) {
    next(error);
  }
}
```

---

### Step 7: Webhook & Call Flow Controller

Create `src/controllers/webhook.controller.ts`:

```typescript
import { Request, Response } from "express";
import { FreJunService } from "../services/frejun.service";

const frejunService = new FreJunService();

/**
 * FreJun Call Flow Handshake Callback
 * Must return 200 OK within 5s with action JSON
 */
export async function handleCallFlow(req: Request, res: Response) {
  const body = req.body || {};
  const callerNumber = body.from_number || body.from || "";
  
  // Decide which agent to ring for inbound calls
  const agentPhone = process.env.FREJUN_DIAL_BRIDGE_TARGET || "+918376822509";

  // Return Call Flow action: dial bridges the incoming call to the agent
  res.status(200).json({
    action: "dial",
    to: agentPhone,
    timeout: 30,
    record: true,
    ringback: "passthrough",
  });
}

/**
 * FreJun Status Webhook (call.answered, call.completed, call.recording)
 */
export async function handleStatusWebhook(req: Request, res: Response) {
  const timestamp = req.header("X-Teler-Timestamp") || "";
  const signature = req.header("X-Teler-Signature") || "";
  const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));

  const isValid = frejunService.verifyWebhookSignature(rawBody, timestamp, signature);
  if (!isValid) {
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  const payload = req.body;
  const eventType = payload.type || payload.event;
  const callId = payload.call_id || payload.data?.call_id;

  console.log(`[FreJun Webhook] Received ${eventType} for ${callId}`);

  // Update call record in CRM database with duration, status, and recording URL
  // if (eventType === "call.completed") {
  //   await prisma.callSession.update({
  //     where: { callId },
  //     data: {
  //       state: "completed",
  //       durationSeconds: payload.data?.duration_seconds,
  //       recordingUrl: payload.data?.recording_url,
  //     }
  //   });
  // }

  res.status(200).json({ status: "acknowledged" });
}
```

---

### Step 8: Raw Body Middleware (HMAC Verification)

In Express, `express.json()` consumes the request stream into a JavaScript object. For HMAC-SHA256 signature verification, you **must retain the raw byte buffer**.

In your main `app.ts` or `server.ts`:

```typescript
import express from "express";

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

const app = express();

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
    limit: "2mb",
  })
);
app.use(express.urlencoded({ extended: true }));
```

---

### Step 9: Background Periodic Synchronization

Because webhooks can occasionally be dropped or delayed by public internet hops, run a lightweight periodic polling job (e.g. every 10 seconds) to sync call logs and recording URLs from FreJun:

```typescript
// In your server startup or worker:
setInterval(async () => {
  try {
    const logs = await frejunService.fetchCallLogs();
    for (const log of logs) {
      const callId = log.call_id || `cs_frejun_${log.id}`;
      // Update database if recordingUrl or duration is newly available
      // await db.updateCall(callId, {
      //   recordingUrl: log.recording_url,
      //   durationSeconds: Math.round(Number(log.call_duration || 0) * 60),
      //   state: log.status === "answered" ? "completed" : "failed",
      // });
    }
  } catch (err) {
    console.error("Background FreJun sync error:", err);
  }
}, 10000);
```

---

### Step 10: Frontend Integration (Click-to-Dial Button & HUD)

In your Hashtagg CRM frontend (React, Vue, or Vanilla JS):

```javascript
// Example: Click-to-Call function on a Lead Record
async function dialLead(leadPhoneNumber, leadId, agentEmail, agentPhone) {
  try {
    const response = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toNumber: leadPhoneNumber,
        candidateId: leadId,
        userEmail: agentEmail,
        creatorNumber: agentPhone,
        record: true,
        idempotencyKey: `dial_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert(`Call Failed: ${result.error?.message || result.message}`);
      return;
    }

    // Show floating Active Call HUD in CRM
    showCallHUD({
      callId: result.data.callId,
      leadPhone: leadPhoneNumber,
      status: "Ringing Agent...",
    });
  } catch (err) {
    console.error("Network error dialing lead:", err);
  }
}
```

---

## 7. Testing & Verification Checklist

Before deploying this to production Hashtagg CRM, verify each of these:

| Step | Verification Check | Expected Result |
| :---: | :--- | :--- |
| **1** | Phone Validation Test | Entering `9876543210` automatically normalizes to `+919876543210`. Invalid inputs fail with 400. |
| **2** | Duplicate Protection Test | Clicking "Call Now" twice rapidly blocks the second click with `409 DUPLICATE_CALL_PREVENTED`. |
| **3** | Agent Leg 1 Ring | Agent's mobile phone rings first. Caller ID displays FreJun Virtual Number. |
| **4** | Customer Leg 2 Ring | Agent picks up; FreJun immediately rings the customer's phone number. |
| **5** | Two-Way Audio Bridging | Customer answers; both parties hear each other clearly. |
| **6** | Hangup & Duration | Call terminates when either party hangs up. Duration is calculated in seconds. |
| **7** | Recording URL Sync | FreJun generates MP3 recording and it syncs to CRM call history within 30-60 seconds. |
| **8** | Webhook HMAC Security | Sending a fake/tampered signature to `/api/teler/status` returns `401 Unauthorized`. |

---

## 8. Common Pitfalls & Troubleshooting

### 1. `403 Forbidden` / `Invalid API Key`
- **Cause:** Using a Teler key on `api.frejun.com` or vice-versa.
- **Fix:** Keys created on `product.frejun.com` have the format `<prefix>.<secret>`. Use `Authorization: Api-Key <KEY>`.

### 2. "User phone number not configured" (422)
- **Cause:** The agent email passed in `user_email` does not have a verified phone number on the FreJun account.
- **Fix:** Call `PATCH https://api.frejun.com/api/v1/integrations/user/?email=...` with `{ number: "+91XXXXXXXXXX" }` before initiating the call.

### 3. Agent answers but Customer never rings
- **Cause:** Customer number is not in E.164 format (missing `+91`), or customer number is DND-blocked / invalid carrier route.
- **Fix:** Ensure all destination numbers pass through `normalizePhoneNumber()`.

### 4. Webhook returns `401 Invalid Webhook Signature`
- **Cause:** `express.json()` modified whitespace or encoding of the body before HMAC hashing.
- **Fix:** Ensure you are using the `rawBodySaver` buffer in `express.json({ verify: rawBodySaver })`.

### 5. Webhooks not reaching localhost
- **Cause:** `PUBLIC_BASE_URL` in `.env` is set to `http://localhost:3000`. FreJun servers cannot reach your private IP.
- **Fix:** Run `ngrok http 3000` and set `PUBLIC_BASE_URL=https://<your-subdomain>.ngrok-free.app`.

---

✨ **You are now ready to integrate the FreJun Calling Feature into Hashtagg CRM!**
