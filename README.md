# Hashtagg CRM • FreJun One-Click Outbound Calling

A modular, object-oriented application built with **Node.js**, **Express.js**, and **TypeScript** implementing the official **[FreJun Teler Voice API](https://frejun.com/docs/teler/get-started/quickstart/)** for one-click outbound calling, call flow routing, HMAC-SHA256 webhook verification, and duplicate call protection.

---

## 🌟 Key Features

1. **One-Click Outbound Dialing (`POST /api/calls`):**
   - Initiates outbound calls using the configured FreJun caller number and destination phone number.
   - Enforces strict **ITU-T E.164** phone number formatting (`+91XXXXXXXXXX`).
   - Supports custom caller IDs, recording flags, and CRM metadata attachment.

2. **Official FreJun Call Flow Handshake (`POST /api/teler/flow`):**
   - Implements FreJun's required JSON Call Flow responses (must respond within 5 seconds with a single action object).
   - Configurable action types:
     - `play`: Streams an audio announcement/greeting and ends the call.
     - `dial`: Bridges the answered call to an agent phone for **two-way live audio**.
     - `stream`: Opens a bidirectional WebSocket for real-time AI audio streaming.
     - `hangup`: Terminates immediately.

3. **HMAC-SHA256 Signed Webhooks (`POST /api/teler/status`):**
   - Validates `X-Teler-Signature` and `X-Teler-Timestamp` headers using constant-time `crypto.timingSafeEqual`.
   - Replay attack protection with configurable timestamp tolerance window (default 300s).
   - Full support for the **2026-06-01 Webhook Event Envelope** (`evt_...`, `call.initiated`, `call.answered`, `call.completed`, `call.failed`).
   - Deduplicates incoming retries using event `id` to ensure idempotency.

4. **Duplicate Call Protection Guard:**
   - In-flight call debounce & cooldown timer per destination number (default 15 seconds) to prevent accidental double-clicks from CRM agents.
   - Idempotency key tracking (`idempotencyKey` or `X-Idempotency-Key`).

5. **Clean Object-Oriented & Modular Architecture:**
   - Separated into **Controllers**, **Services**, **Repositories**, **Middlewares**, **Config**, and **Types**.
   - `FreJunService` implements provider-agnostic `ITelephonyService`, isolating FreJun-specific logic and allowing future telephony providers (Twilio, Exotel) to be plugged in seamlessly.
   - `InMemoryCallRepository` implements `ICallRepository`, allowing easy swapping with PostgreSQL/Prisma or MongoDB in Hashtagg CRM.

6. **Interactive CRM Dialing UI:**
   - Premium glassmorphic dark interface with FreJun emerald brand styling.
   - Phone input with country code presets (+91, +1, +44, etc.) and quick-dial test contacts.
   - Live call state updates, duration timer, and real-time webhook event stream.

---

## 🏗️ Architecture & OOP Design

```
src/
├── config/
│   └── app.config.ts                    # Strongly typed config with validation
├── controllers/
│   ├── call.controller.ts               # Outbound call initiation, retrieval & listing
│   ├── webhook.controller.ts            # FreJun Call Flow & status callbacks
│   └── health.controller.ts             # System diagnostic check
├── middleware/
│   ├── duplicate-call.middleware.ts     # Anti-double dial cooldown guard
│   ├── error.middleware.ts              # Centralized error handler
│   ├── logger.middleware.ts             # Structured HTTP request logger
│   ├── raw-body.middleware.ts           # Captures raw bytes for HMAC verification
│   └── validation.middleware.ts         # Zod request validator
├── routes/
│   ├── call.routes.ts                   # /api/calls routes
│   └── webhook.routes.ts                # /api/teler/flow and /api/teler/status routes
├── services/
│   ├── interfaces/
│   │   ├── call.repository.interface.ts # Storage abstraction for CRM DB
│   │   ├── deduplication.service.interface.ts # Idempotency abstraction
│   │   └── telephony.service.interface.ts     # Telephony provider abstraction
│   ├── call.repository.ts               # In-memory call store and event logger
│   ├── deduplication.service.ts         # Cooldown and event deduplication
│   └── frejun.service.ts                # FreJun Teler API & SDK integration
├── types/
│   ├── api.types.ts                     # Standard API response envelopes
│   ├── frejun.types.ts                  # FreJun API payloads & webhook envelopes
│   └── telephony.types.ts               # CRM domain models (CallSession, CallState)
├── utils/
│   ├── logger.ts                        # Structured application logger
│   └── phone.utils.ts                   # E.164 normalization & validation
├── public/                              # Sleek CRM Dialing Interface
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── app.ts                               # Express Application setup & DI
└── server.ts                            # Server bootstrap & graceful shutdown
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js** v18+ (tested on Node v22)
- **npm** v9+
- Optional: **ngrok** (for receiving live webhooks from FreJun on localhost)

### 2. Setup Environment Variables
Clone or open the project folder, then copy the environment template:

```bash
cp .env.example .env
```

Edit `.env` with your FreJun credentials:

```ini
PORT=3000
NODE_ENV=development

# When testing live FreJun callbacks, set to your public HTTPS ngrok URL
PUBLIC_BASE_URL=http://localhost:3000

# Your FreJun Teler API Key (Leaves simulation mode enabled if placeholder)
FREJUN_API_KEY=YOUR_API_KEY

# Verified caller number on your FreJun account (E.164 format)
FREJUN_CALLER_NUMBER=+918000000000

# Webhook shared secret for HMAC-SHA256 signature verification
FREJUN_WEBHOOK_SECRET=your_webhook_secret_here

# Call Flow Action on answer: 'play' | 'dial' | 'stream' | 'hangup'
FREJUN_FLOW_ACTION=play
FREJUN_FLOW_MEDIA_URL=https://actions.google.com/sounds/v1/telephones/phone_calling.ogg
FREJUN_DIAL_BRIDGE_TARGET=+919876543210
```

> **Note:** If `FREJUN_API_KEY` is not provided or is set to `YOUR_API_KEY`, the application automatically operates in **Simulation / Mock Mode**. You can trigger calls and view realistic simulated flows without needing a live FreJun account balance!

### 3. Install Dependencies & Build

```bash
npm install
npm run build
```

### 4. Run Development Server

```bash
npm run dev
```

The server starts at `http://localhost:3000`. Open `http://localhost:3000` in your browser to access the **Hashtagg CRM Dialer UI**.

---

## 🌐 Public Tunneling for FreJun Callbacks (ngrok)

When making live phone calls via FreJun, Teler requires publicly accessible HTTPS endpoints for `flow_url` and `status_callback_url`.

1. Start an ngrok tunnel on port 3000:
   ```bash
   ngrok http 3000
   ```

2. Copy the forwarding HTTPS URL (e.g. `https://abc-123.ngrok-free.app`).

3. In `.env`, set:
   ```ini
   PUBLIC_BASE_URL=https://abc-123.ngrok-free.app
   ```

4. Restart your application. FreJun will now reach:
   - Call Flow: `https://abc-123.ngrok-free.app/api/teler/flow`
   - Status Webhooks: `https://abc-123.ngrok-free.app/api/teler/status`

---

## 📞 How Two-Way Audio Works in FreJun Teler

> **Important:** Initiating an outbound call alone does **not** provide two-way audio. When Teler dials a recipient and the recipient answers, Teler makes a `POST` request to your `flow_url` asking what action to execute.

To achieve two-way conversation between a customer and a CRM agent:
1. In `.env`, set `FREJUN_FLOW_ACTION=dial`.
2. Set `FREJUN_DIAL_BRIDGE_TARGET=+91<agent-phone-number>`.
3. When the customer answers, the flow endpoint returns:
   ```json
   {
     "action": "dial",
     "to": "+91XXXXXXXXXX"
   }
   ```
   Teler originates a secondary leg to the agent and bridges the audio bidirectionally!

---

## 📡 API Reference & Testing Examples

### 1. Initiate Outbound Call
**Endpoint:** `POST /api/calls`

```bash
curl -X POST http://localhost:3000/api/calls \
  -H "Content-Type: application/json" \
  -d '{
    "toNumber": "+919876543210",
    "record": true,
    "metadata": {
      "leadId": "lead_99210",
      "agentName": "Rahul Verma"
    }
  }'
```

**Response (`201 Created`):**
```json
{
  "success": true,
  "message": "Outbound call initiated successfully",
  "data": {
    "callId": "cs_01J7K8Z4B5N6Q7R8S9T0V1W2X3",
    "provider": "frejun",
    "fromNumber": "+918000000000",
    "toNumber": "+919876543210",
    "state": "initiated",
    "record": true,
    "createdAt": "2026-10-15T12:00:00.000Z",
    "metadata": {
      "leadId": "lead_99210",
      "agentName": "Rahul Verma"
    }
  }
}
```

---

### 2. Retrieve Call Session
**Endpoint:** `GET /api/calls/:id`

```bash
curl http://localhost:3000/api/calls/cs_01J7K8Z4B5N6Q7R8S9T0V1W2X3
```

---

### 3. List Recent Calls
**Endpoint:** `GET /api/calls?limit=10`

```bash
curl http://localhost:3000/api/calls
```

---

### 4. FreJun Call Flow Callback
**Endpoint:** `POST /api/teler/flow` (or `/flow`)

```bash
curl -X POST http://localhost:3000/api/teler/flow \
  -H "Content-Type: application/json" \
  -d '{
    "call_id": "cs_01J7K8Z4B5N6Q7R8S9T0V1W2X3",
    "account_id": "acc_01H8ZXK9M2P7Q3R4S5T6V7W8XY",
    "from_number": "+918000000000",
    "to_number": "+919876543210",
    "direction": "outbound"
  }'
```

**Response (`200 OK`):**
```json
{
  "action": "play",
  "media_url": "https://actions.google.com/sounds/v1/telephones/phone_calling.ogg"
}
```

---

### 5. FreJun Status Webhook (HMAC-SHA256 Signed)
**Endpoint:** `POST /api/teler/status` (or `/status`)

FreJun computes the signature as:
$$\text{HMAC-SHA256}(\text{secret}, \text{timestamp} + "." + \text{raw\_body})$$

```bash
curl -X POST http://localhost:3000/api/teler/status \
  -H "Content-Type: application/json" \
  -H "X-Teler-Timestamp: 1714201234" \
  -H "X-Teler-Signature: <computed_hmac_hex>" \
  -d '{
    "id": "evt_01H8ZXK9M2P7Q3R4S5T6V7W8XY",
    "type": "call.completed",
    "api_version": "2026-06-01",
    "occurred_at": "2026-10-15T12:05:00.000Z",
    "account_id": "acc_01H8ZXK9M2P7Q3R4S5T6V7W8XY",
    "call_id": "cs_01J7K8Z4B5N6Q7R8S9T0V1W2X3",
    "data": {
      "call_id": "cs_01J7K8Z4B5N6Q7R8S9T0V1W2X3",
      "from": "+918000000000",
      "to": "+919876543210",
      "direction": "outbound",
      "start_time": "2026-10-15T12:00:00.000Z",
      "answered_at": "2026-10-15T12:00:08.000Z",
      "ended_at": "2026-10-15T12:04:15.000Z",
      "duration_seconds": 247,
      "reason": "normal",
      "ended_by": "callee"
    }
  }'
```

---

## 🧪 Automated Testing

### Run Comprehensive API Test Suite:
Validates input validation, outbound calling, duplicate cooldown guard, call flow formatting, webhook HMAC signature verification, and deduplication:

```bash
npm run test:api
```

### Run Webhook Simulator:
Simulates a live FreJun call progression (`initiated` ➔ `answered` ➔ `completed`) with valid HMAC signatures to test the CRM dashboard in real time:

```bash
npm run test:webhook
```

---

## 💼 Hashtagg CRM Integration Guide

To integrate this module into the broader Hashtagg CRM system:

1. **Database Adapter:** Replace `InMemoryCallRepository` in `src/services/call.repository.ts` with a Prisma/TypeORM/Mongoose repository implementing `ICallRepository`.
2. **CRM Contact Linking:** When calling `POST /api/calls`, attach `metadata: { contactId, dealId, ownerId }`. These are retained on the session and mapped on webhook completion.
3. **Multi-Tenancy:** In `src/config/app.config.ts`, load credentials dynamically per CRM tenant/organization by inspecting the authenticated CRM user's account settings.
4. **Agent CTI Pop-up:** Subscribe your CRM frontend to `/api/calls/events` or a WebSocket event bus to pop open the customer's contact record the moment `call.answered` fires.
