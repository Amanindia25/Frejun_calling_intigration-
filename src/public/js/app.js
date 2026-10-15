// Hashtagg CRM Dialer UI Logic
document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  const phoneInput = document.getElementById("phone-input");
  const countryCodeSelect = document.getElementById("country-code");
  const callNowBtn = document.getElementById("call-now-btn");
  const btnSpinner = document.getElementById("btn-spinner");
  const btnPhoneIcon = document.getElementById("btn-phone-icon");
  const btnText = document.getElementById("btn-text");

  const activeCallCard = document.getElementById("active-call-card");
  const callBadge = document.getElementById("call-badge");
  const badgeText = document.getElementById("badge-text");
  const badgeDot = document.getElementById("badge-dot");
  const callTimer = document.getElementById("call-timer");
  const metaToNumber = document.getElementById("meta-to-number");
  const metaCallId = document.getElementById("meta-call-id");
  const metaFlowAction = document.getElementById("meta-flow-action");
  const flowExplainerText = document.getElementById("flow-explainer-text");

  const systemStatusPill = document.getElementById("system-status-pill");
  const systemStatusDot = document.getElementById("system-status-dot");
  const systemStatusText = document.getElementById("system-status-text");
  const callerIdBadge = document.getElementById("caller-id-badge");

  const webhooksFeed = document.getElementById("webhooks-feed");
  const historyFeed = document.getElementById("history-feed");
  const eventCountBadge = document.getElementById("event-count");
  const historyCountBadge = document.getElementById("history-count");
  const toastContainer = document.getElementById("toast-container");

  // State
  let currentCallId = null;
  let callStartTime = null;
  let timerInterval = null;
  let pollInterval = null;
  let isDialing = false;
  let systemConfig = null;

  // Initialize
  fetchSystemHealth();
  fetchCallHistory();
  fetchEvents();
  startPolling();

  // Tab Switching
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));

      btn.classList.add("active");
      const targetPane = document.getElementById(btn.dataset.tab);
      if (targetPane) targetPane.classList.add("active");
    });
  });

  // Quick Dial Chips
  document.querySelectorAll(".chip-btn").forEach((chip) => {
    chip.addEventListener("click", () => {
      const num = chip.dataset.phone;
      if (num.startsWith("+91")) {
        countryCodeSelect.value = "+91";
        phoneInput.value = num.replace("+91", "");
      } else if (num.startsWith("+1")) {
        countryCodeSelect.value = "+1";
        phoneInput.value = num.replace("+1", "");
      } else {
        countryCodeSelect.value = "";
        phoneInput.value = num;
      }
      phoneInput.focus();
    });
  });

  // Copy Call ID to clipboard
  metaCallId.addEventListener("click", () => {
    if (currentCallId) {
      navigator.clipboard.writeText(currentCallId).then(() => {
        showToast("Call ID copied to clipboard", "success");
      });
    }
  });

  // Call Now Button
  callNowBtn.addEventListener("click", async () => {
    if (isDialing) return;

    const rawNum = phoneInput.value.trim();
    if (!rawNum) {
      showToast("Please enter a destination phone number", "error");
      phoneInput.focus();
      return;
    }

    const prefix = countryCodeSelect.value;
    let fullNumber = rawNum;
    if (prefix && !rawNum.startsWith("+")) {
      fullNumber = `${prefix}${rawNum.replace(/^0+/, "")}`;
    } else if (!rawNum.startsWith("+")) {
      fullNumber = `+${rawNum}`;
    }

    // Clean whitespace/dashes
    fullNumber = fullNumber.replace(/[\s\-\(\)]/g, "");

    // Basic format check
    if (!/^\+[1-9]\d{7,14}$/.test(fullNumber)) {
      showToast("Invalid number format. Must be E.164 (e.g. +919876543210)", "error");
      return;
    }

    setDialingState(true);

    try {
      const response = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toNumber: fullNumber,
          metadata: {
            source: "crm_dialer_ui",
            clientTimestamp: new Date().toISOString(),
          },
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        const errorMsg = result.error?.message || "Failed to initiate call";
        showToast(errorMsg, response.status === 409 ? "warning" : "error");
        setDialingState(false);
        return;
      }

      const session = result.data;
      currentCallId = session.callId;

      showToast(`Outbound call initiated! (ID: ${session.callId})`, "success");
      displayActiveCall(session);
      fetchCallHistory();
      fetchEvents();
    } catch (err) {
      showToast("Network error initiating call. Check server logs.", "error");
      console.error(err);
      setDialingState(false);
    }
  });

  function setDialingState(dialing) {
    isDialing = dialing;
    callNowBtn.disabled = dialing;
    if (dialing) {
      btnSpinner.style.display = "block";
      btnPhoneIcon.style.display = "none";
      btnText.textContent = "Connecting to Teler...";
    } else {
      btnSpinner.style.display = "none";
      btnPhoneIcon.style.display = "block";
      btnText.textContent = "Call Now";
    }
  }

  function displayActiveCall(session) {
    activeCallCard.style.display = "block";
    metaToNumber.textContent = session.toNumber;
    metaCallId.textContent = session.callId;
    metaFlowAction.textContent = systemConfig?.flowAction?.toUpperCase() || "PLAY";

    updateCallStateBadge(session.state);

    if (systemConfig?.flowAction === "dial") {
      flowExplainerText.innerHTML = `<strong>2-Way Audio Bridge Active:</strong> When callee answers, FreJun bridges to agent target (<code>${systemConfig.dialBridgeTarget || "configured number"}</code>).`;
    } else {
      flowExplainerText.innerHTML = `<strong>Announcement Flow Active:</strong> When callee answers, FreJun streams the configured audio announcement and completes the call.`;
    }

    resetCallTimer();
  }

  function updateCallStateBadge(state) {
    callBadge.className = `call-state-badge state-${state}`;
    badgeText.textContent = state.charAt(0).toUpperCase() + state.slice(1);

    if (state === "answered") {
      badgeDot.className = "status-dot pulsing";
      startCallTimer();
    } else if (state === "completed" || state === "failed") {
      badgeDot.className = "status-dot";
      stopCallTimer();
      setDialingState(false);
    } else {
      badgeDot.className = "status-dot pulsing";
    }
  }

  function startCallTimer() {
    if (timerInterval) return;
    callStartTime = Date.now();
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const secs = String(elapsed % 60).padStart(2, "0");
      callTimer.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  function stopCallTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function resetCallTimer() {
    stopCallTimer();
    callTimer.textContent = "00:00";
  }

  async function fetchSystemHealth() {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      if (data.success) {
        systemConfig = data.data;
        const isLive = systemConfig.mode === "live_mode";
        systemStatusDot.style.background = isLive ? "var(--brand-green)" : "var(--color-warning)";
        systemStatusDot.style.boxShadow = isLive
          ? "0 0 8px var(--brand-green)"
          : "0 0 8px var(--color-warning)";
        systemStatusText.textContent = isLive ? "FreJun Live API Connected" : "Simulation Mode (Test Key)";
        callerIdBadge.textContent = `Caller ID: ${systemConfig.configuredCallerNumber || "Default"}`;
      }
    } catch {
      systemStatusText.textContent = "Server Offline";
      systemStatusDot.style.background = "var(--color-danger)";
    }
  }

  async function fetchCallHistory() {
    try {
      const res = await fetch("/api/calls?limit=25");
      const result = await res.json();
      if (!result.success || !result.data) return;

      const calls = result.data;
      historyCountBadge.textContent = calls.length;

      if (calls.length === 0) {
        historyFeed.innerHTML = `<div class="empty-state"><p>No outbound calls made yet.</p></div>`;
        return;
      }

      historyFeed.innerHTML = calls
        .map(
          (c) => `
        <div class="feed-item">
          <div class="feed-item-header">
            <span class="call-state-badge state-${c.state}">${c.state}</span>
            <span class="feed-time">${formatDate(c.createdAt)}</span>
          </div>
          <div class="feed-body">
            <div>
              <strong>${c.toNumber}</strong>
              <small style="color: var(--text-dim); margin-left: 6px;">(${c.provider})</small>
            </div>
            <div class="code-pill">${c.callId}</div>
          </div>
          ${c.durationSeconds ? `<div style="font-size: 0.72rem; color: var(--text-dim);">Duration: ${c.durationSeconds}s ${c.reason ? `• Reason: ${c.reason}` : ""}</div>` : ""}
        </div>
      `
        )
        .join("");

      // Update active call card if matching currentCallId
      if (currentCallId) {
        const active = calls.find((c) => c.callId === currentCallId);
        if (active) {
          updateCallStateBadge(active.state);
        }
      }
    } catch (e) {
      console.error("Error loading call history", e);
    }
  }

  async function fetchEvents() {
    try {
      const res = await fetch("/api/calls/events?limit=30");
      const result = await res.json();
      if (!result.success || !result.data) return;

      const events = result.data;
      eventCountBadge.textContent = events.length;

      if (events.length === 0) {
        webhooksFeed.innerHTML = `
          <div class="empty-state">
            <p>Waiting for FreJun Teler webhook callbacks...</p>
            <p style="font-size: 0.75rem; margin-top: 4px;">Webhooks (<code>call.initiated</code>, <code>call.answered</code>, <code>call.completed</code>) will appear here in real time.</p>
          </div>
        `;
        return;
      }

      webhooksFeed.innerHTML = events
        .map((ev) => {
          const tagClass = ev.eventType.replace(".", "-");
          return `
          <div class="feed-item">
            <div class="feed-item-header">
              <span class="feed-tag ${tagClass}">${ev.eventType}</span>
              <span class="feed-time">${formatDate(ev.occurredAt)}</span>
            </div>
            <div class="feed-body">
              <span>Call: <code class="code-pill">${ev.callId || "n/a"}</code></span>
              <small style="font-size: 0.72rem; color: var(--text-dim);">${ev.eventId}</small>
            </div>
            ${renderEventDetails(ev.data)}
          </div>
        `;
        })
        .join("");
    } catch (e) {
      console.error("Error loading webhook events", e);
    }
  }

  function renderEventDetails(data) {
    if (!data) return "";
    const items = [];
    if (data.from) items.push(`From: ${data.from}`);
    if (data.to) items.push(`To: ${data.to}`);
    if (data.duration_seconds !== undefined) items.push(`Duration: ${data.duration_seconds}s`);
    if (data.reason) items.push(`Reason: ${data.reason}`);
    if (data.ended_by) items.push(`Ended By: ${data.ended_by}`);

    if (items.length === 0) return "";
    return `<div style="font-size: 0.72rem; color: var(--text-muted); line-height: 1.4;">${items.join(" • ")}</div>`;
  }

  function startPolling() {
    pollInterval = setInterval(() => {
      fetchCallHistory();
      fetchEvents();
    }, 2500);
  }

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(20px)";
      toast.style.transition = "all 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  }

  function formatDate(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return iso;
    }
  }
});
