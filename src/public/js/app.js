// Hashtagg CRM Multi-Agent Dialer UI Logic
document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements - Dialer
  const phoneInput = document.getElementById("phone-input");
  const countryCodeSelect = document.getElementById("country-code");
  const candidateSelectorDropdown = document.getElementById("candidate-selector-dropdown");
  const agentSelectorDropdown = document.getElementById("agent-selector-dropdown");
  const callNowBtn = document.getElementById("call-now-btn");
  const btnSpinner = document.getElementById("btn-spinner");
  const btnPhoneIcon = document.getElementById("btn-phone-icon");
  const btnText = document.getElementById("btn-text");

  // DOM Elements - Active Agent Display
  const currentAgentName = document.getElementById("current-agent-name");
  const currentAgentRole = document.getElementById("current-agent-role");
  const currentAgentPhone = document.getElementById("current-agent-phone");
  const currentAgentEmail = document.getElementById("current-agent-email");
  const agentRingTarget = document.getElementById("agent-ring-target");

  // DOM Elements - Active Calls Multi-Monitor HUD
  const activeCallsSection = document.getElementById("active-calls-section");
  const activeCallsList = document.getElementById("active-calls-list");
  const activeCallsCountBadge = document.getElementById("active-calls-count-badge");
  const btnClearEndedCalls = document.getElementById("btn-clear-ended-calls");

  // Header & Status
  const headerLiveCallsBadge = document.getElementById("header-live-calls-badge");
  const headerLiveCallsCount = document.getElementById("header-live-calls-count");
  const systemStatusPill = document.getElementById("system-status-pill");
  const systemStatusDot = document.getElementById("system-status-dot");
  const systemStatusText = document.getElementById("system-status-text");
  const callerIdBadge = document.getElementById("caller-id-badge");

  // Tabs & Feeds
  const candidatesContainer = document.getElementById("candidates-container");
  const creatorsContainer = document.getElementById("creators-container");
  const historyFeed = document.getElementById("history-feed");
  const webhooksFeed = document.getElementById("webhooks-feed");
  const tabLiveCallsFeed = document.getElementById("tab-live-calls-feed");
  const tabLiveCallsCount = document.getElementById("tab-live-calls-count");
  const btnRefreshLiveCalls = document.getElementById("btn-refresh-live-calls");
  const candidateCountBadge = document.getElementById("candidate-count");
  const creatorCountBadge = document.getElementById("creator-count");
  const historyCountBadge = document.getElementById("history-count");
  const eventCountBadge = document.getElementById("event-count");
  const candidateSearchInput = document.getElementById("candidate-search-input");
  const btnRefreshHistory = document.getElementById("btn-refresh-history");
  const btnSeeAllCandidates = document.getElementById("btn-see-all-candidates");

  // Modals
  const candidateModal = document.getElementById("candidate-modal");
  const creatorModal = document.getElementById("creator-modal");
  const openCandidateModalBtn = document.getElementById("open-candidate-modal-btn");
  const openCreatorModalBtn = document.getElementById("open-creator-modal-btn");
  const btnQuickAddAgent = document.getElementById("btn-quick-add-agent");
  const btnQuickAddCandidate = document.getElementById("btn-quick-add-candidate");
  const closeCandidateModal = document.getElementById("close-candidate-modal");
  const cancelCandidateModal = document.getElementById("cancel-candidate-modal");
  const closeCreatorModal = document.getElementById("close-creator-modal");
  const cancelCreatorModal = document.getElementById("cancel-creator-modal");
  const addCandidateForm = document.getElementById("add-candidate-form");
  const addCreatorForm = document.getElementById("add-creator-form");
  const toastContainer = document.getElementById("toast-container");

  // Multi-Call Active State
  let activeCallsMap = new Map(); // callId -> CallSessionDto + runtime metadata
  let callTickInterval = null;
  let pollInterval = null;
  let isDialing = false;
  let inFlightDials = new Set(); // tracks in-flight numbers/stations for true concurrency
  let systemConfig = null;

  let creatorsList = [];
  let candidatesList = [];
  let activeCreator = null;
  let selectedCandidate = null;

  // Direct Assigned Pairs mapping (Agents <-> Leads)
  // Agents: Aman, Ritu
  // Leads: Aman Lead, Ananya
  const AGENT_CANDIDATE_PAIRS = {
    creator_aman: "cand_aman_lead",
    creator_ritu: "cand_ananya",
    // reverse:
    cand_aman_lead: "creator_aman",
    cand_ananya: "creator_ritu",
  };

  // Multi-Click Protection & Visual Click Wave Helpers
  const lockedButtonsSet = new Set();

  function createButtonRipple(e, btn) {
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const circle = document.createElement("span");
    const diameter = Math.max(rect.width, rect.height);
    const radius = diameter / 2;

    const x = e && e.clientX ? e.clientX - rect.left : rect.width / 2;
    const y = e && e.clientY ? e.clientY - rect.top : rect.height / 2;

    circle.style.width = circle.style.height = `${diameter}px`;
    circle.style.left = `${x - radius}px`;
    circle.style.top = `${y - radius}px`;
    circle.classList.add("btn-ripple-wave");

    const oldRipple = btn.querySelector(".btn-ripple-wave");
    if (oldRipple) oldRipple.remove();

    btn.appendChild(circle);
    setTimeout(() => circle.remove(), 600);
  }

  function lockButtonWithEffect(btn, customText = "Connecting...", e = null) {
    if (!btn) return () => {};

    if (lockedButtonsSet.has(btn) || btn.disabled || btn.classList.contains("btn-busy")) {
      // Button is already locked or in-flight! Ignore duplicate clicks immediately.
      return null;
    }

    createButtonRipple(e, btn);

    lockedButtonsSet.add(btn);
    btn.disabled = true;
    btn.classList.add("btn-click-effect", "btn-busy");

    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<span class="mini-spin-circle"></span><span>${customText}</span>`;

    let unlocked = false;
    return function unlock(cooldownMs = 2000) {
      if (unlocked) return;
      unlocked = true;
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.classList.remove("btn-click-effect", "btn-busy");
        btn.disabled = false;
        lockedButtonsSet.delete(btn);
      }, cooldownMs);
    };
  }

  // Initialize App
  initApp();

  async function initApp() {
    await fetchSystemHealth();
    await fetchCreators();
    await fetchCandidates();
    await fetchCallHistory();
    await fetchEvents();
    await syncActiveCalls();
    startPolling();
    startCallTickers();
    updateDialButtonText();
    bindEvents();
  }

  function bindEvents() {
    // Global Click Ripple & Feedback
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (
        btn.classList.contains("btn-station-dial") ||
        btn.classList.contains("btn-dial-all-master") ||
        btn.classList.contains("call-btn") ||
        btn.classList.contains("btn-dial-sm") ||
        btn.classList.contains("btn-mode-toggle") ||
        btn.classList.contains("btn-header-action")
      ) {
        createButtonRipple(e, btn);
      }
    });
    // Tab Switching
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchTab(btn.dataset.tab);
      });
    });

    if (btnSeeAllCandidates) {
      btnSeeAllCandidates.addEventListener("click", () => switchTab("tab-candidates"));
    }

    // Modal Triggers
    if (openCandidateModalBtn) openCandidateModalBtn.addEventListener("click", () => openModal(candidateModal));
    if (btnQuickAddCandidate) btnQuickAddCandidate.addEventListener("click", () => openModal(candidateModal));
    if (closeCandidateModal) closeCandidateModal.addEventListener("click", () => closeModal(candidateModal));
    if (cancelCandidateModal) cancelCandidateModal.addEventListener("click", () => closeModal(candidateModal));

    if (openCreatorModalBtn) openCreatorModalBtn.addEventListener("click", () => openModal(creatorModal));
    if (btnQuickAddAgent) btnQuickAddAgent.addEventListener("click", () => openModal(creatorModal));
    if (closeCreatorModal) closeCreatorModal.addEventListener("click", () => closeModal(creatorModal));
    if (cancelCreatorModal) cancelCreatorModal.addEventListener("click", () => closeModal(creatorModal));

    const headerStationsSummary = document.getElementById("header-stations-summary");
    if (headerStationsSummary) headerStationsSummary.addEventListener("click", () => switchTab("tab-creators"));

    // Agent Selector Dropdown in Dialer Card
    if (agentSelectorDropdown) {
      agentSelectorDropdown.addEventListener("change", async (e) => {
        const id = e.target.value;
        if (id) {
          await window.selectActiveAgent(id, true);
        }
      });
    }

    // Candidate Search
    if (candidateSearchInput) {
      candidateSearchInput.addEventListener("input", (e) => {
        renderCandidatesList(e.target.value);
      });
    }

    // Candidate Dropdown selection in Dialer
    if (candidateSelectorDropdown) {
      candidateSelectorDropdown.addEventListener("change", (e) => {
        const candId = e.target.value;
        if (!candId) {
          selectedCandidate = null;
          updateDialButtonText();
          return;
        }
        const cand = candidatesList.find((c) => c.id === candId);
        if (cand) {
          selectCandidateForDialing(cand, true);
        }
      });
    }

    // Update dial button text live when user edits phone number
    if (phoneInput) {
      phoneInput.addEventListener("input", updateDialButtonText);
    }
    if (countryCodeSelect) {
      countryCodeSelect.addEventListener("change", updateDialButtonText);
    }

    // Form Submissions
    if (addCandidateForm) addCandidateForm.addEventListener("submit", handleAddCandidate);
    if (addCreatorForm) addCreatorForm.addEventListener("submit", handleAddCreator);

    // Call Now Button
    if (callNowBtn) callNowBtn.addEventListener("click", () => handleCallInitiate());

    // Refresh history button
    if (btnRefreshHistory) {
      btnRefreshHistory.addEventListener("click", fetchCallHistory);
    }

    // Sync FreJun button
    const btnSyncFrejun = document.getElementById("btn-sync-frejun");
    if (btnSyncFrejun) {
      btnSyncFrejun.addEventListener("click", async () => {
        btnSyncFrejun.disabled = true;
        btnSyncFrejun.textContent = "Syncing...";
        showToast("Syncing calls and recordings from FreJun...", "info");
        try {
          await fetch("/api/calls/sync", { method: "POST" });
          await fetchCallHistory();
          await fetchEvents();
          await syncActiveCalls();
          showToast("FreJun calls synchronized successfully!", "success");
        } catch {
          showToast("Failed to sync calls", "error");
        } finally {
          btnSyncFrejun.disabled = false;
          btnSyncFrejun.textContent = "🔄 Sync FreJun";
        }
      });
    }

    // Clear finished calls button
    if (btnClearEndedCalls) {
      btnClearEndedCalls.addEventListener("click", () => window.clearEndedCalls());
    }

    // Refresh live calls button
    if (btnRefreshLiveCalls) {
      btnRefreshLiveCalls.addEventListener("click", () => syncActiveCalls());
    }

    // Close modals on backdrop click or ESC
    window.addEventListener("click", (e) => {
      if (e.target === candidateModal) closeModal(candidateModal);
      if (e.target === creatorModal) closeModal(creatorModal);
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeModal(candidateModal);
        closeModal(creatorModal);
      }
    });
  }

  function switchTab(tabId) {
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tabId);
    });
    document.querySelectorAll(".tab-pane").forEach((p) => {
      p.classList.toggle("active", p.id === tabId);
    });
  }

  function openModal(modal) {
    modal.classList.add("open");
  }

  function closeModal(modal) {
    modal.classList.remove("open");
  }

  // --- Creators Management ---

  async function fetchCreators() {
    try {
      const res = await fetch("/api/crm/creators");
      const result = await res.json();
      if (result.success && result.data) {
        creatorsList = result.data;
        creatorCountBadge.textContent = creatorsList.length;

        // Determine active creator
        const savedId = localStorage.getItem("hashtagg_active_creator_id");
        activeCreator =
          creatorsList.find((c) => c.id === savedId) ||
          creatorsList.find((c) => c.isDefault) ||
          creatorsList[0];

        renderActiveCreatorHUD();
        renderCreatorsList();
      }
    } catch (err) {
      console.error("Failed to fetch creators", err);
    }
  }

  function renderActiveCreatorHUD() {
    if (!activeCreator) return;

    localStorage.setItem("hashtagg_active_creator_id", activeCreator.id);
    if (currentAgentName) currentAgentName.textContent = activeCreator.name;
    if (currentAgentRole) currentAgentRole.textContent = activeCreator.role || "Calling Agent";
    if (currentAgentPhone) currentAgentPhone.textContent = `📞 ${activeCreator.phone}`;
    if (currentAgentEmail) currentAgentEmail.textContent = `✉️ ${activeCreator.email}`;
    if (agentRingTarget) agentRingTarget.textContent = activeCreator.phone;

    // Update Quick Agent Dropdown
    if (agentSelectorDropdown) {
      agentSelectorDropdown.innerHTML = creatorsList
        .map(
          (c) =>
            `<option value="${c.id}" ${c.id === activeCreator.id ? "selected" : ""}>🎧 ${escapeHtml(
              c.name
            )} (${c.phone})</option>`
        )
        .join("");
    }

    updateDialButtonText();
  }

  function renderCreatorsList() {
    if (!creatorsContainer) return;

    if (creatorsList.length === 0) {
      creatorsContainer.innerHTML = `<div class="empty-state"><p>No calling agents configured yet.</p></div>`;
      return;
    }

    creatorsContainer.innerHTML = creatorsList
      .map((c) => {
        const isActive = activeCreator && activeCreator.id === c.id;
        return `
        <div class="creator-card ${isActive ? "is-active-creator" : ""}" data-creator-id="${c.id}">
          <div class="card-left-group">
            <div class="card-avatar">🎧</div>
            <div class="card-info-wrap">
              <div class="card-header-line">
                <span class="card-title-strong">${escapeHtml(c.name)}</span>
                <span class="badge-tag">${escapeHtml(c.role || "Agent")}</span>
                ${isActive ? `<span class="badge-active-agent">Active Caller</span>` : ""}
              </div>
              <div class="card-subtext-line">
                <span>Phone: <code>${escapeHtml(c.phone)}</code></span>
                <span>Email: ${escapeHtml(c.email)}</span>
              </div>
            </div>
          </div>
          <div class="card-actions-right">
            ${
              !isActive
                ? `<button type="button" class="btn-make-active" onclick="window.selectActiveAgent('${c.id}')">Select Caller</button>`
                : `<span style="font-size: 0.75rem; color: var(--brand-green); font-weight: 600;">✓ In Use</span>`
            }
            <button type="button" class="btn-icon-danger" title="Delete Agent" onclick="window.deleteAgent('${c.id}')">🗑️</button>
          </div>
        </div>
      `;
      })
      .join("");
  }

  window.selectActiveAgent = async (id, autoTargetPair = false) => {
    try {
      const res = await fetch(`/api/crm/creators/${id}/activate`, { method: "POST" });
      const result = await res.json();
      if (result.success && result.data) {
        activeCreator = result.data;
        renderActiveCreatorHUD();
        renderCreatorsList();
        showToast(`Active caller switched to ${activeCreator.name}`, "success");

        // Automatically target paired candidate if configured
        if (autoTargetPair && AGENT_CANDIDATE_PAIRS[id]) {
          const pairedCandId = AGENT_CANDIDATE_PAIRS[id];
          const cand = candidatesList.find((c) => c.id === pairedCandId);
          if (cand) {
            selectCandidateForDialing(cand, false);
          }
        }
      }
    } catch {
      showToast("Failed to switch agent", "error");
    }
  };

  window.deleteAgent = async (id) => {
    if (!confirm("Are you sure you want to remove this calling agent?")) return;
    try {
      const res = await fetch(`/api/crm/creators/${id}`, { method: "DELETE" });
      const result = await res.json();
      if (result.success) {
        showToast("Agent removed", "success");
        await fetchCreators();
      }
    } catch {
      showToast("Failed to delete agent", "error");
    }
  };

  async function handleAddCreator(e) {
    e.preventDefault();
    const name = document.getElementById("creator-name-input").value.trim();
    const email = document.getElementById("creator-email-input").value.trim();
    const phone = document.getElementById("creator-phone-input").value.trim();
    const role = document.getElementById("creator-role-input").value.trim();
    const isDefault = document.getElementById("creator-default-check").checked;

    try {
      const res = await fetch("/api/crm/creators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, role, isDefault }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        showToast(result.error?.message || "Failed to add creator", "error");
        return;
      }

      showToast(`Agent '${name}' added successfully!`, "success");
      closeModal(creatorModal);
      addCreatorForm.reset();
      await fetchCreators();
    } catch {
      showToast("Network error creating agent", "error");
    }
  }

  // --- Candidates Management ---

  async function fetchCandidates() {
    try {
      const res = await fetch("/api/crm/candidates");
      const result = await res.json();
      if (result.success && result.data) {
        candidatesList = result.data;
        candidateCountBadge.textContent = candidatesList.length;
        renderCandidatesDropdown();
        renderCandidatesList();

        // Default select paired candidate for active agent if first load
        if (!selectedCandidate && activeCreator && AGENT_CANDIDATE_PAIRS[activeCreator.id]) {
          const pairedCand = candidatesList.find(
            (c) => c.id === AGENT_CANDIDATE_PAIRS[activeCreator.id]
          );
          if (pairedCand) {
            selectCandidateForDialing(pairedCand, false);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch candidates", err);
    }
  }

  function renderCandidatesDropdown() {
    if (!candidateSelectorDropdown) return;
    const currentVal = selectedCandidate?.id || candidateSelectorDropdown.value;
    candidateSelectorDropdown.innerHTML = `
      <option value="">-- Choose Existing CRM Candidate / Lead --</option>
      ${candidatesList
        .map(
          (c) =>
            `<option value="${c.id}" ${currentVal === c.id ? "selected" : ""}>👤 ${escapeHtml(
              c.name
            )} - ${escapeHtml(c.company || "Lead")} (${c.phone})</option>`
        )
        .join("")}
    `;
  }

  function selectCandidateForDialing(cand, autoSwitchAgent = false) {
    selectedCandidate = cand;
    candidateSelectorDropdown.value = cand.id;
    setPhoneInput(cand.phone);

    // If reverse pair exists and requested, switch agent too
    if (autoSwitchAgent && AGENT_CANDIDATE_PAIRS[cand.id]) {
      const agentId = AGENT_CANDIDATE_PAIRS[cand.id];
      if (activeCreator?.id !== agentId) {
        window.selectActiveAgent(agentId, false);
      }
    }
    updateDialButtonText();
    showToast(`Target set to ${cand.name} (${cand.phone})`, "info");
  }

  function setPhoneInput(phone) {
    if (phone.startsWith("+91")) {
      countryCodeSelect.value = "+91";
      phoneInput.value = phone.replace("+91", "");
    } else if (phone.startsWith("+1")) {
      countryCodeSelect.value = "+1";
      phoneInput.value = phone.replace("+1", "");
    } else {
      countryCodeSelect.value = "";
      phoneInput.value = phone;
    }
    phoneInput.focus();
  }

  function renderCandidatesList(searchQuery = "") {
    if (!candidatesContainer) return;

    let filtered = candidatesList;
    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = candidatesList.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          (c.company && c.company.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      candidatesContainer.innerHTML = `<div class="empty-state"><p>No candidates found matching your criteria.</p></div>`;
      return;
    }

    candidatesContainer.innerHTML = filtered
      .map((c) => {
        const isSelected = selectedCandidate && selectedCandidate.id === c.id;
        const lastCall = c.lastCalledAt ? formatRelativeTime(c.lastCalledAt) : "Never";

        // Determine strict assigned agent for this lead
        let assignedAgentName = "Agent";
        let assignedAgentPhone = "";
        let assignedCreatorId = "creator_aman";
        let buttonsHtml = "";

        if (c.id === "cand_aman_lead") {
          assignedAgentName = "Aman";
          assignedAgentPhone = "+91 83768 22509";
          assignedCreatorId = "creator_aman";
          buttonsHtml = `
            <button type="button" class="btn-dial-sm" onclick="window.dialPair('outbound', 'creator_aman', 'cand_aman_lead', this)" title="Aman calls Aman Lead (Outbound)">
              📞 Call Aman Lead (Aman ➔ Aman Lead)
            </button>
          `;
        } else if (c.id === "cand_ananya") {
          assignedAgentName = "Ritu";
          assignedAgentPhone = "+91 79032 34057";
          assignedCreatorId = "creator_ritu";
          buttonsHtml = `
            <button type="button" class="btn-dial-sm" onclick="window.dialPair('outbound', 'creator_ritu', 'cand_ananya', this)" title="Ritu calls Ananya (Outbound)">
              📞 Call Ananya (Ritu ➔ Ananya)
            </button>
          `;
        } else {
          buttonsHtml = `
            <button type="button" class="btn-dial-sm" onclick="window.instantDialCandidate('${c.id}', this)" title="Initiate single call with ${escapeHtml(c.name)}">
              📞 Call ${escapeHtml(c.name)}
            </button>
          `;
        }

        return `
        <div class="candidate-card ${isSelected ? "active-selected" : ""}" data-cand-id="${c.id}">
          <div class="card-left-group">
            <div class="card-avatar">👤</div>
            <div class="card-info-wrap">
              <div class="card-header-line">
                <span class="card-title-strong">${escapeHtml(c.name)}</span>
                <span class="badge-tag highlight" style="color:var(--brand-green); border-color:var(--border-accent);">Strictly Paired with ${assignedAgentName}</span>
                ${c.company ? `<span class="badge-tag">${escapeHtml(c.company)}</span>` : ""}
              </div>
              <div class="card-subtext-line">
                <span>Phone: <code>${escapeHtml(c.phone)}</code></span>
                <span>Assigned Agent: <strong>${assignedAgentName}</strong> (${assignedAgentPhone})</span>
                <span>Calls: ${c.totalCalls || 0}</span>
                <span>Last Called: ${lastCall}</span>
              </div>
            </div>
          </div>
          <div class="card-actions-right">
            ${buttonsHtml}
            <button type="button" class="btn-icon-danger" onclick="window.deleteCandidate('${c.id}')" title="Delete Candidate">
              🗑️
            </button>
          </div>
        </div>
      `;
      })
      .join("");
  }

  window.instantDialCandidate = async (candId, btnEl = null) => {
    const cand = candidatesList.find((c) => c.id === candId);
    if (!cand) return;

    // Strict Pairing Override: Aman Lead always called by Aman, Ananya always by Ritu
    if (candId === "cand_aman_lead") {
      return window.dialPair("outbound", "creator_aman", "cand_aman_lead", btnEl);
    } else if (candId === "cand_ananya") {
      return window.dialPair("outbound", "creator_ritu", "cand_ananya", btnEl);
    }

    const unlock = lockButtonWithEffect(btnEl, "Connecting...");
    if (!unlock) return;

    try {
      selectCandidateForDialing(cand, true);
      document.getElementById("dialer-section").scrollIntoView({ behavior: "smooth" });
      await handleCallInitiate();
    } finally {
      unlock(2000);
    }
  };

  // Direct Assigned Pair Dialing (Aman <-> Aman Lead, Ritu <-> Ananya)
  window.dialPair = async (direction, creatorId, candidateId, btnEl = null) => {
    // ENFORCE STRICT PAIRING INVARIANT:
    if (creatorId === "creator_aman" && candidateId !== "cand_aman_lead") {
      showToast("⛔ PROHIBITED: Aman cannot call Ananya. Aman is strictly paired with Aman Lead.", "error");
      return;
    }
    if (creatorId === "creator_ritu" && candidateId !== "cand_ananya") {
      showToast("⛔ PROHIBITED: Ritu cannot call Aman Lead. Ritu is strictly paired with Ananya.", "error");
      return;
    }

    const unlock = btnEl ? lockButtonWithEffect(btnEl, "Connecting...") : null;

    try {
      const agent = creatorsList.find((c) => c.id === creatorId);
      const candidate = candidatesList.find((c) => c.id === candidateId);
      if (!agent || !candidate) {
        showToast("Pair data not found", "error");
        return;
      }

      activeCreator = agent;
      localStorage.setItem("hashtagg_active_creator_id", activeCreator.id);
      renderActiveCreatorHUD();
      renderCreatorsList();
      selectCandidateForDialing(candidate, false);

      // CRM initiates Outbound calls: rings agent phone first, then bridges customer phone
      showToast(`📞 FreJun is calling ${agent.name} (${agent.phone}) first. Pick up call from +918035742316 to bridge ${candidate.name}!`, "info");
      await handleCallInitiate({
        toNumber: candidate.phone,
        creatorNumber: agent.phone,
        candidateId: candidate.id,
        creatorId: agent.id,
        userEmail: agent.email || "info@maxpinetechnology.com",
        metadata: {
          source: "crm_dialer_ui",
          callDirection: "outbound",
          agentName: agent.name,
          agentPhone: agent.phone,
          leadName: candidate.name,
          leadPhone: candidate.phone,
        },
      });
    } finally {
      if (unlock) unlock(2000);
    }
  };

  // Station Handlers (Station 1: Aman, Station 2: Ritu)
  window.dialStation = async (creatorId) => {
    const candidateId = AGENT_CANDIDATE_PAIRS[creatorId];
    const stationSuffix = creatorId.replace("creator_", "");
    const btn = document.getElementById(`btn-station-dial-${stationSuffix}`);

    // Prevent multiple clicks with ripple and button lock
    const unlock = lockButtonWithEffect(btn, "Connecting...");
    if (!unlock) return;

    try {
      await window.dialPair("outbound", creatorId, candidateId);
    } finally {
      unlock(2000);
    }
  };

  // Launch both Outbound Calls concurrently:
  // 1. Aman calls Aman Lead (Outbound)
  // 2. Ritu calls Ananya (Outbound)
  window.dialAllOutboundStations = async () => {
    const masterBtn = document.getElementById("btn-dial-all-pairs");
    const unlockMaster = lockButtonWithEffect(masterBtn, "Launching 2 Outbound Calls...");
    if (!unlockMaster) return;

    const stationButtons = [
      document.getElementById("btn-station-dial-aman"),
      document.getElementById("btn-station-dial-ritu"),
    ];
    const stationUnlocks = stationButtons.map((b) => lockButtonWithEffect(b, "Connecting..."));

    showToast("🚀 Initiating Outbound calls for Aman ➔ Aman Lead, Ritu ➔ Ananya...", "info");

    const calls = [
      window.dialPair("outbound", "creator_aman", "cand_aman_lead"),
      window.dialPair("outbound", "creator_ritu", "cand_ananya"),
    ];

    try {
      const results = await Promise.allSettled(calls);
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      showToast(`✅ Parallel Outbound batch complete: ${succeeded}/2 calls initiated!`, "success");
    } finally {
      unlockMaster(2500);
      stationUnlocks.forEach((u) => u && u(2000));
    }
  };

  // Backward compatibility aliases
  window.dialAllStations = window.dialAllOutboundStations;
  window.dialTriCallScenario = window.dialAllOutboundStations;

  // Alias
  window.dialAllStations = window.dialTriCallScenario;

  // Hang up specific station active call
  window.hangupStationCall = async (creatorId) => {
    const candidateId = AGENT_CANDIDATE_PAIRS[creatorId];
    for (const [callId, call] of activeCallsMap.entries()) {
      const isRunning = call.state === "initiated" || call.state === "ringing" || call.state === "answered";
      if (isRunning && (call.creatorId === creatorId || call.candidateId === candidateId)) {
        await window.endCall(callId);
        return;
      }
    }
    showToast("No active call found for this station", "info");
  };

  // Backward compatibility alias
  window.dialAssignedPair = (creatorId, candidateId) => window.dialPair("outbound", creatorId, candidateId);

  window.deleteCandidate = async (id) => {
    if (!confirm("Are you sure you want to remove this candidate?")) return;
    try {
      const res = await fetch(`/api/crm/candidates/${id}`, { method: "DELETE" });
      const result = await res.json();
      if (result.success) {
        showToast("Candidate removed", "success");
        await fetchCandidates();
      }
    } catch {
      showToast("Failed to delete candidate", "error");
    }
  };

  async function handleAddCandidate(e) {
    e.preventDefault();
    const name = document.getElementById("candidate-name-input").value.trim();
    const phone = document.getElementById("candidate-phone-input").value.trim();
    const company = document.getElementById("candidate-company-input").value.trim();
    const email = document.getElementById("candidate-email-input").value.trim();
    const rawTags = document.getElementById("candidate-tags-input").value.trim();
    const notes = document.getElementById("candidate-notes-input").value.trim();

    const tags = rawTags
      ? rawTags.split(",").map((t) => t.trim()).filter(Boolean)
      : ["Lead"];

    try {
      const res = await fetch("/api/crm/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, company, email, tags, notes }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        showToast(result.error?.message || "Failed to add candidate", "error");
        return;
      }

      showToast(`Candidate '${name}' saved!`, "success");
      closeModal(candidateModal);
      addCandidateForm.reset();
      await fetchCandidates();
    } catch {
      showToast("Network error creating candidate", "error");
    }
  }

  // --- Outbound Call Initiation ---

  async function handleCallInitiate(customPayload = null) {
    let payload;
    let callKey = "custom";
    let stationBtn = null;
    let originalBtnText = "";

    const isExplicitPayload =
      customPayload &&
      typeof customPayload === "object" &&
      !("target" in customPayload) &&
      !("preventDefault" in customPayload);

    if (isExplicitPayload) {
      payload = customPayload;
      callKey = payload.toNumber || payload.creatorId || "station";

      if (payload.creatorId === "creator_aman") stationBtn = document.getElementById("btn-station-dial-aman");
      else if (payload.creatorId === "creator_ritu") stationBtn = document.getElementById("btn-station-dial-ritu");
    } else {
      const rawNum = phoneInput.value.trim();
      if (!rawNum) {
        showToast("Please enter or select a phone number", "error");
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
      fullNumber = fullNumber.replace(/[\s\-\(\)]/g, "");

      if (!/^\+[1-9]\d{7,14}$/.test(fullNumber)) {
        showToast("Invalid number format. Must be E.164 (e.g. +919876543210)", "error");
        return;
      }

      callKey = fullNumber;

      // CRM initiates Outbound calls: Creator is the Agent, target is the Lead
      payload = {
        toNumber: fullNumber,
        candidateId: selectedCandidate ? selectedCandidate.id : undefined,
        creatorId: activeCreator ? activeCreator.id : undefined,
        userEmail: activeCreator ? activeCreator.email : undefined,
        creatorNumber: activeCreator ? activeCreator.phone : undefined,
        metadata: {
          source: "crm_dialer_ui",
          callDirection: "outbound",
          creator: activeCreator
            ? { id: activeCreator.id, name: activeCreator.name, phone: activeCreator.phone }
            : undefined,
          candidate: selectedCandidate
            ? { id: selectedCandidate.id, name: selectedCandidate.name }
            : undefined,
          clientTimestamp: new Date().toISOString(),
        },
      };
    }

    // STRICT CLIENT-SIDE PAIRING VALIDATION:
    // Pair 1: Aman (+918376822509) ⇄ Aman Lead (+918708050914)
    // Pair 2: Ritu (+917903234057) ⇄ Ananya (+918303831398)
    const cleanAgentPhone = (payload.creatorNumber || (activeCreator?.phone || "")).replace(/\D/g, "").slice(-10);
    const cleanDestPhone = (payload.toNumber || "").replace(/\D/g, "").slice(-10);

    // Aman will NEVER call Ananya
    if (
      (cleanAgentPhone === "8376822509" && cleanDestPhone === "8303831398") ||
      (cleanAgentPhone === "8303831398" && cleanDestPhone === "8376822509")
    ) {
      showToast("⛔ STRICT PAIRING RULE: Aman will NEVER call Ananya! Aman is paired exclusively with Aman Lead.", "error");
      return;
    }

    // Ritu will NEVER call Aman Lead
    if (
      (cleanAgentPhone === "7903234057" && cleanDestPhone === "8708050914") ||
      (cleanAgentPhone === "8708050914" && cleanDestPhone === "7903234057")
    ) {
      showToast("⛔ STRICT PAIRING RULE: Ritu will NEVER call Aman Lead! Ritu is paired exclusively with Ananya.", "error");
      return;
    }


    if (inFlightDials.has(callKey)) {
      showToast(`Dial already connecting for this destination. Please wait...`, "warning");
      return;
    }

    inFlightDials.add(callKey);

    let unlockCustom = null;
    if (stationBtn) {
      originalBtnText = stationBtn.textContent;
      stationBtn.disabled = true;
      stationBtn.textContent = "Connecting to FreJun...";
    } else {
      unlockCustom = lockButtonWithEffect(callNowBtn, "Connecting to FreJun...");
      if (!unlockCustom) {
        inFlightDials.delete(callKey);
        return;
      }
    }

    try {
      const response = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        const errorMsg = result.error?.message || "Failed to initiate call";
        showToast(errorMsg, response.status === 409 ? "warning" : "error");
        return;
      }

      const session = result.data;
      showToast(`Call initiated! (ID: ${session.callId})`, "success");

      // Add to multi-call active map immediately
      activeCallsMap.set(session.callId, {
        ...session,
        endedTimestamp: null,
      });

      renderActiveCalls();
      fetchCallHistory();
      fetchEvents();
      fetchCandidates(); // update call counts

      // Smooth scroll to active calls monitor
      if (activeCallsSection) {
        activeCallsSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } catch (err) {
      showToast("Network error initiating call. Check server logs.", "error");
      console.error(err);
    } finally {
      inFlightDials.delete(callKey);
      if (stationBtn) {
        stationBtn.disabled = false;
        stationBtn.textContent = originalBtnText;
      } else if (unlockCustom) {
        unlockCustom(2000);
      } else {
        setDialingState(false);
      }
      updateStationCardsState();
    }
  }

  function setDialingState(dialing) {
    isDialing = dialing;
    callNowBtn.disabled = dialing;
    if (dialing) {
      btnSpinner.style.display = "block";
      btnPhoneIcon.style.display = "none";
      btnText.textContent = "Connecting to FreJun...";
    } else {
      btnSpinner.style.display = "none";
      btnPhoneIcon.style.display = "block";
      updateDialButtonText();
    }
  }

  // Update Station Cards and Header status indicators in real time
  function updateStationCardsState() {
    const stations = [
      { id: "aman", creatorId: "creator_aman", candId: "cand_aman_lead", phone: "8376822509", candPhone: "8708050914", name: "Aman", candName: "Aman Lead" },
      { id: "ritu", creatorId: "creator_ritu", candId: "cand_ananya", phone: "7903234057", candPhone: "8303831398", name: "Ritu", candName: "Ananya" },
    ];

    stations.forEach((st) => {
      const cardEl = document.getElementById(`station-card-${st.id}`);
      const pillEl = document.getElementById(`station-status-pill-${st.id}`);
      const textEl = document.getElementById(`station-status-text-${st.id}`);
      const dialBtn = document.getElementById(`btn-station-dial-${st.id}`);
      const hangupBtn = document.getElementById(`btn-station-hangup-${st.id}`);
      const headerStatusEl = document.getElementById(`header-status-${st.id}`);

      let activeCall = null;
      for (const call of activeCallsMap.values()) {
        const isRunning = call.state === "initiated" || call.state === "ringing" || call.state === "answered";
        if (isRunning) {
          const matchCreator = call.creatorId === st.creatorId || call.fromNumber?.includes(st.phone) || call.toNumber?.includes(st.phone);
          const matchCandidate = call.candidateId === st.candId || call.toNumber?.includes(st.candPhone) || call.fromNumber?.includes(st.candPhone);
          if (matchCreator || matchCandidate) {
            activeCall = call;
            break;
          }
        }
      }

      if (activeCall) {
        const isInbound = activeCall.metadata?.callDirection === "inbound";
        if (cardEl) cardEl.classList.add("station-in-call");
        if (pillEl) {
          pillEl.className = `station-status-pill in-call ${isInbound ? "inbound" : ""}`;
        }
        if (textEl) {
          textEl.textContent = isInbound
            ? (activeCall.state === "answered" ? "Inbound Call 📥" : "Inbound Ringing 📥")
            : (activeCall.state === "answered" ? "In Call 📞" : "Connecting...");
        }
        if (dialBtn) {
          dialBtn.disabled = true;
          dialBtn.textContent = isInbound ? `📥 Inbound Active...` : `📞 Outbound Active...`;
        }
        if (hangupBtn) hangupBtn.style.display = "inline-flex";
        if (headerStatusEl) {
          headerStatusEl.textContent = isInbound ? "Inbound 📥" : "In Call 📞";
          headerStatusEl.style.color = isInbound ? "#38bdf8" : "#22c55e";
        }
      } else {
        if (cardEl) cardEl.classList.remove("station-in-call");
        if (pillEl) {
          pillEl.className = "station-status-pill ready";
        }
        if (textEl) textEl.textContent = "Idle (Ready)";
        if (dialBtn) {
          dialBtn.disabled = false;
          dialBtn.textContent = `📞 Single Call (${st.name} ➔ ${st.candName})`;
        }
        if (hangupBtn) hangupBtn.style.display = "none";
        if (headerStatusEl) {
          headerStatusEl.textContent = "Ready";
          headerStatusEl.style.color = "var(--brand-green)";
        }
      }
    });
  }

  function updateDialButtonText() {
    if (isDialing) return;
    const dest = phoneInput ? phoneInput.value.trim() : "";
    const prefix = countryCodeSelect ? countryCodeSelect.value : "";
    const candidateName = selectedCandidate ? selectedCandidate.name : "";
    const agentName = activeCreator ? activeCreator.name : "Agent";
    const agentPhone = activeCreator ? activeCreator.phone : "";

    const summaryCallerName = document.getElementById("summary-caller-name");
    const summaryReceiverName = document.getElementById("summary-receiver-name");
    const summaryDirectionBadge = document.getElementById("summary-direction-badge");

    let fullDestDisplay = dest ? `${prefix ? prefix + " " : ""}${dest}` : "Select Destination";
    if (candidateName && dest) {
      fullDestDisplay = `${candidateName} (${prefix ? prefix + " " : ""}${dest})`;
    } else if (candidateName) {
      fullDestDisplay = candidateName;
    }

    const cleanAgent = (agentPhone || "").replace(/\D/g, "").slice(-10);
    const cleanTarget = (dest || "").replace(/\D/g, "").slice(-10);

    let isViolation = false;
    let violationMsg = "";

    if (cleanAgent === "8376822509" && cleanTarget === "8303831398") {
      isViolation = true;
      violationMsg = "⛔ Blocked: Aman will NEVER call Ananya (Paired with Aman Lead)";
    } else if (cleanAgent === "7903234057" && cleanTarget === "8708050914") {
      isViolation = true;
      violationMsg = "⛔ Blocked: Ritu will NEVER call Aman Lead (Paired with Ananya)";
    }


    if (isViolation) {
      callNowBtn.disabled = true;
      callNowBtn.style.opacity = "0.6";
      btnText.innerHTML = `<span style="color: #f87171; font-weight: 700;">${violationMsg}</span>`;
      return;
    } else {
      callNowBtn.disabled = false;
      callNowBtn.style.opacity = "1";
    }

    if (summaryCallerName) summaryCallerName.textContent = `${agentName} (${agentPhone})`;
    if (summaryReceiverName) summaryReceiverName.textContent = fullDestDisplay;
    if (summaryDirectionBadge) {
      summaryDirectionBadge.textContent = "Outbound";
      summaryDirectionBadge.style.color = "var(--brand-green)";
    }

    if (!dest && !candidateName) {
      btnText.innerHTML = `<span>Select Candidate or Enter Phone Number</span>`;
    } else {
      btnText.innerHTML = `<span>Initiate Single Outbound Call: <strong>${escapeHtml(agentName)}</strong> ➔ <strong>${escapeHtml(fullDestDisplay)}</strong></span>`;
    }
  }

  // --- Multi-Call Active Monitor Rendering ---

  function renderActiveCalls() {
    const activeCalls = Array.from(activeCallsMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const activeRunningCount = activeCalls.filter(
      (c) => c.state === "initiated" || c.state === "ringing" || c.state === "answered"
    ).length;

    // Header Live Badge
    if (headerLiveCallsBadge) {
      if (activeRunningCount > 0) {
        headerLiveCallsBadge.style.display = "inline-flex";
        headerLiveCallsCount.textContent = `${activeRunningCount} ${activeRunningCount === 1 ? "Call" : "Calls"} Live`;
      } else {
        headerLiveCallsBadge.style.display = "none";
      }
    }

    // Section Header Pill
    if (activeCallsCountBadge) {
      activeCallsCountBadge.textContent = `${activeRunningCount} Active`;
    }

    // Tab Badge in right panel
    if (tabLiveCallsCount) {
      tabLiveCallsCount.textContent = activeRunningCount;
    }

    // Clear Finished Button
    const hasEndedCalls = activeCalls.some((c) => c.state === "completed" || c.state === "failed");
    if (btnClearEndedCalls) {
      btnClearEndedCalls.style.display = hasEndedCalls ? "block" : "none";
    }

    // Empty state handling
    if (activeCalls.length === 0) {
      const emptyHtml = `
        <div class="empty-active-state" id="empty-active-calls-msg">
          <span class="empty-active-icon">📡</span>
          <div class="empty-active-text">
            <strong>No live calls currently running</strong>
            <p>When calls are initiated, all live two-legged calls with real-time bridge state, timer, and caller details will appear right here.</p>
          </div>
        </div>
      `;
      if (activeCallsList) activeCallsList.innerHTML = emptyHtml;
      if (tabLiveCallsFeed) {
        tabLiveCallsFeed.innerHTML = `<div class="empty-state"><p>No active calls currently running.</p></div>`;
      }
      updateStationCardsState();
      return;
    }

    // Render list for Dialer HUD section
    if (activeCallsList) {
      activeCallsList.innerHTML = activeCalls
        .map((call) => generateCallCardHtml(call, false))
        .join("");
    }

    // Mirror list in Right Panel "Live Calls" Tab
    if (tabLiveCallsFeed) {
      tabLiveCallsFeed.innerHTML = activeCalls
        .map((call) => generateCallCardHtml(call, true))
        .join("");
    }
    updateStationCardsState();
  }

  function generateCallCardHtml(call, isTabMirror = false) {
    const isIncoming = call.metadata?.callDirection === "inbound";
    const dirClass = isIncoming ? "inbound" : "outbound";
    const dirLabel = isIncoming ? "📥 Inbound (Customer ➔ Agent)" : "📞 Outbound (Agent ➔ Lead)";

    const isRunning = call.state === "initiated" || call.state === "ringing" || call.state === "answered";
    const isAnswered = call.state === "answered";

    // Format State Badge
    let stateLabel = "Initiated";
    if (call.state === "ringing") stateLabel = "Ringing";
    else if (call.state === "answered") stateLabel = "In Call";
    else if (call.state === "completed") stateLabel = "Completed";
    else if (call.state === "failed") stateLabel = "Failed";

    // Format Names and Numbers
    let agentName = "Calling Agent";
    let agentPhone = call.fromNumber || "Agent Phone";
    let leadName = "CRM Candidate / Lead";
    let leadPhone = call.toNumber;

    if (isIncoming) {
      leadName = call.metadata?.candidate?.name || call.metadata?.callerName || call.metadata?.callerLead || "Customer Lead";
      leadPhone = call.metadata?.candidate?.phone || call.fromNumber || call.metadata?.callerPhone || "Customer Phone";
      agentName = call.metadata?.creator?.name || call.metadata?.receiverName || call.metadata?.targetAgent || (activeCreator?.name || "Agent");
      agentPhone = call.metadata?.creator?.phone || call.toNumber || (activeCreator?.phone || "Agent Phone");
    } else {
      if (call.metadata?.creator?.name) agentName = call.metadata.creator.name;
      else if (call.metadata?.agentName) agentName = call.metadata.agentName;
      else if (activeCreator?.name) agentName = activeCreator.name;

      if (call.metadata?.creator?.phone) agentPhone = call.metadata.creator.phone;
      else if (call.fromNumber) agentPhone = call.fromNumber;

      if (call.metadata?.candidate?.name) leadName = call.metadata.candidate.name;
      else if (call.metadata?.leadName) leadName = call.metadata.leadName;
      else {
        const foundCand = candidatesList.find((c) => c.phone === call.toNumber);
        if (foundCand) leadName = foundCand.name;
      }
    }

    // Format Timer
    let timerDisplay = "00:00";
    if (isAnswered) {
      const start = new Date(call.answeredAt || call.createdAt).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const secs = String(elapsed % 60).padStart(2, "0");
      timerDisplay = `${mins}:${secs}`;
    } else if (isRunning) {
      const start = new Date(call.createdAt).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const secs = String(elapsed % 60).padStart(2, "0");
      timerDisplay = `${mins}:${secs}`;
    } else if (call.state === "completed") {
      timerDisplay = `${call.durationSeconds !== undefined ? call.durationSeconds : 0}s`;
    } else {
      timerDisplay = "--:--";
    }

    const timerId = isTabMirror ? `tab-timer-${call.callId}` : `timer-${call.callId}`;

    // Flow explanation text
    let flowText = "";
    if (isIncoming) {
      flowText = `Inbound Call: Customer <strong>${escapeHtml(leadName)} (${escapeHtml(leadPhone)})</strong> called agent <strong>${escapeHtml(agentName)} (${escapeHtml(agentPhone)})</strong> directly. FreJun routed call to agent!`;
    } else {
      flowText = `Outbound Call: FreJun rings agent <strong>${escapeHtml(agentName)} (${escapeHtml(agentPhone)})</strong> first. When answered, customer <strong>${escapeHtml(leadName)} (${escapeHtml(leadPhone)})</strong> is bridged!`;
    }

    return `
      <div class="active-call-card state-${call.state}" id="${isTabMirror ? "tab-" : ""}call-card-${call.callId}" data-call-id="${call.callId}">
        <div class="active-call-header">
          <div class="call-badge-wrap">
            <span class="call-direction-pill ${dirClass}">${dirLabel}</span>
            <div class="call-state-badge state-${call.state}">
              <span class="status-dot ${isRunning ? "pulsing" : ""}"></span>
              <span>${stateLabel}</span>
            </div>
          </div>
          <div class="call-header-right">
            <div class="call-timer" id="${timerId}">${timerDisplay}</div>
            ${
              isRunning
                ? `<button type="button" class="btn-hangup-call" onclick="window.endCall('${call.callId}')" title="End this call">🔴 End Call</button>`
                : `<button type="button" class="btn-dismiss-call" onclick="window.dismissActiveCall('${call.callId}')" title="Dismiss from live view">✕</button>`
            }
          </div>
        </div>

        <div class="active-call-participants">
          <div class="participant-box">
            <span class="part-label">${isIncoming ? "👤 CALLER (CUSTOMER)" : "🎧 CALLER (AGENT)"}</span>
            <span class="part-name" title="${escapeHtml(isIncoming ? leadName : agentName)}">${escapeHtml(isIncoming ? leadName : agentName)}</span>
            <span class="part-phone"><code>${escapeHtml(isIncoming ? leadPhone : agentPhone)}</code></span>
          </div>
          <div class="participant-arrow">➔</div>
          <div class="participant-box">
            <span class="part-label">${isIncoming ? "🎧 RECEIVER (AGENT)" : "👤 RECEIVER (CUSTOMER)"}</span>
            <span class="part-name" title="${escapeHtml(isIncoming ? agentName : leadName)}">${escapeHtml(isIncoming ? agentName : leadName)}</span>
            <span class="part-phone"><code>${escapeHtml(isIncoming ? agentPhone : leadPhone)}</code></span>
          </div>
        </div>

        <div class="active-call-meta-bar">
          <div class="meta-col">
            <span class="meta-col-label">Call ID:</span>
            <span class="meta-col-val copyable" onclick="window.copyCallId('${call.callId}')" title="Click to copy Call ID">${escapeHtml(call.callId)} 📋</span>
          </div>
          <div class="meta-col">
            <span class="meta-col-label">Started:</span>
            <span class="meta-col-val">${formatTime(call.createdAt)}</span>
          </div>
          <div class="meta-col">
            <span class="meta-col-label">Platform:</span>
            <span class="meta-col-val">FreJun CRM</span>
          </div>
        </div>

        <div class="flow-explainer">
          <span class="flow-icon">ℹ️</span>
          <span class="flow-text">${flowText}</span>
        </div>
      </div>
    `;
  }

  // Real-time ticking timers for every active call
  function startCallTickers() {
    if (callTickInterval) clearInterval(callTickInterval);
    callTickInterval = setInterval(() => {
      activeCallsMap.forEach((call) => {
        if (call.state === "answered" || call.state === "initiated" || call.state === "ringing") {
          const timerEl = document.getElementById(`timer-${call.callId}`);
          const tabTimerEl = document.getElementById(`tab-timer-${call.callId}`);

          let elapsed = 0;
          if (call.state === "answered") {
            const start = new Date(call.answeredAt || call.createdAt).getTime();
            elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
          } else {
            const start = new Date(call.createdAt).getTime();
            elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
          }

          const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
          const secs = String(elapsed % 60).padStart(2, "0");
          const timeStr = `${mins}:${secs}`;

          if (timerEl) timerEl.textContent = timeStr;
          if (tabTimerEl) tabTimerEl.textContent = timeStr;
        }
      });
    }, 1000);
  }

  // Sync active calls from backend repository
  async function syncActiveCalls() {
    try {
      const res = await fetch("/api/calls?limit=50");
      const result = await res.json();
      if (!result.success || !result.data) return;

      const serverCalls = result.data;
      const now = Date.now();

      serverCalls.forEach((serverCall) => {
        const isActiveState =
          serverCall.state === "initiated" ||
          serverCall.state === "ringing" ||
          serverCall.state === "answered";

        if (activeCallsMap.has(serverCall.callId)) {
          const localCall = activeCallsMap.get(serverCall.callId);
          localCall.state = serverCall.state;
          localCall.answeredAt = serverCall.answeredAt || localCall.answeredAt;
          localCall.endedAt = serverCall.endedAt || localCall.endedAt;
          localCall.durationSeconds = serverCall.durationSeconds ?? localCall.durationSeconds;
          if (serverCall.state === "completed" || serverCall.state === "failed") {
            if (!localCall.endedTimestamp) {
              localCall.endedTimestamp = now;
            }
          }
        } else if (isActiveState) {
          activeCallsMap.set(serverCall.callId, {
            ...serverCall,
            endedTimestamp: null,
          });
        }
      });

      // Auto-prune calls ended more than 45 seconds ago
      for (const [callId, call] of activeCallsMap.entries()) {
        if (call.endedTimestamp && now - call.endedTimestamp > 45000) {
          activeCallsMap.delete(callId);
        }
      }

      renderActiveCalls();
    } catch (err) {
      console.warn("syncActiveCalls error", err);
    }
  }

  // Window Call Interaction Helpers
  window.copyCallId = (callId) => {
    if (callId) {
      navigator.clipboard.writeText(callId).then(() => {
        showToast(`Call ID copied: ${callId}`, "success");
      });
    }
  };

  window.dismissActiveCall = (callId) => {
    activeCallsMap.delete(callId);
    renderActiveCalls();
    showToast("Call dismissed from active list", "info");
  };

  window.clearEndedCalls = () => {
    let count = 0;
    for (const [id, c] of activeCallsMap.entries()) {
      if (c.state === "completed" || c.state === "failed") {
        activeCallsMap.delete(id);
        count++;
      }
    }
    renderActiveCalls();
    if (count > 0) {
      showToast(`Cleared ${count} finished ${count === 1 ? "call" : "calls"}`, "info");
    }
  };

  window.endCall = async (callId) => {
    try {
      showToast(`Ending call ${callId}...`, "info");
      const res = await fetch(`/api/calls/${callId}/hangup`, { method: "POST" });
      const result = await res.json();
      if (result.success && result.data) {
        showToast("Call ended successfully", "success");
        if (activeCallsMap.has(callId)) {
          const call = activeCallsMap.get(callId);
          call.state = "completed";
          call.endedAt = result.data.endedAt || new Date().toISOString();
          call.durationSeconds = result.data.durationSeconds || call.durationSeconds || 1;
          call.endedTimestamp = Date.now();
        }
        renderActiveCalls();
        fetchCallHistory();
        fetchEvents();
      } else {
        showToast(result.error?.message || "Failed to end call", "error");
      }
    } catch {
      showToast("Network error ending call", "error");
    }
  };

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
        systemStatusText.textContent = isLive ? "FreJun Live Connected" : "Simulation Mode";
        callerIdBadge.textContent = `Virtual Caller ID: ${systemConfig.configuredCallerNumber || "Default"}`;
      }
    } catch {
      systemStatusText.textContent = "Server Offline";
      systemStatusDot.style.background = "var(--color-danger)";
    }
  }

  async function fetchCallHistory() {
    try {
      const res = await fetch("/api/calls?limit=50");
      const result = await res.json();
      if (!result.success || !result.data) return;

      const calls = result.data;
      historyCountBadge.textContent = calls.length;

      if (calls.length === 0) {
        historyFeed.innerHTML = `<div class="empty-state"><p>No outbound calls logged yet.</p></div>`;
        return;
      }

      historyFeed.innerHTML = calls
        .map((c) => {
          const dur = c.durationSeconds !== undefined ? `${c.durationSeconds}s` : "0s";
          const isInbound = c.metadata?.callDirection === "inbound";
          const creatorInfo = c.metadata?.creator?.name || "Agent";
          const candidateInfo = c.metadata?.candidate?.name || "";

          let fromName = creatorInfo;
          let toName = candidateInfo ? `${candidateInfo} (${c.toNumber})` : c.toNumber;

          if (isInbound) {
            fromName = candidateInfo ? `${candidateInfo} (${c.fromNumber})` : (c.fromNumber || "Customer");
            toName = `${creatorInfo} (${c.toNumber})`;
          }

          const dirBadge = isInbound
            ? `<span class="badge-tag-inbound" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 1px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 700;">📥 INBOUND</span>`
            : `<span class="badge-tag-outbound" style="background: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); padding: 1px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 700;">📞 OUTBOUND</span>`;

          return `
          <div class="feed-item">
            <div class="feed-item-header">
              <div style="display: flex; align-items: center; gap: 6px;">
                ${dirBadge}
                <span class="feed-tag call-${c.state}">${c.state.toUpperCase()}</span>
              </div>
              <span class="feed-time">${formatTime(c.createdAt)}</span>
            </div>
            <div class="feed-body" style="flex-direction: column; align-items: flex-start; gap: 4px;">
              <div>
                <strong>${escapeHtml(fromName)}</strong> ➔ <strong>${escapeHtml(toName)}</strong>
              </div>
              <div style="font-size: 0.75rem; color: var(--text-dim); display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span>Call ID: <code class="code-pill">${escapeHtml(c.callId)}</code></span>
                <span>• Duration: ${dur}</span>
                ${c.recordingUrl ? `<span>• <a href="${escapeHtml(c.recordingUrl)}" target="_blank" style="color: var(--primary); text-decoration: underline; font-weight: 600;">📥 Recording</a></span>` : ""}
              </div>
              ${c.recordingUrl ? `
                <div style="margin-top: 6px; width: 100%;">
                  <audio controls src="${escapeHtml(c.recordingUrl)}" preload="none" style="height: 28px; width: 100%; outline: none; border-radius: 4px;"></audio>
                </div>
              ` : ""}
            </div>
          </div>
        `;
        })
        .join("");
    } catch (err) {
      console.error("Failed to fetch call history", err);
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
        webhooksFeed.innerHTML = `<div class="empty-state"><p>Waiting for FreJun webhook events...</p></div>`;
        return;
      }

      webhooksFeed.innerHTML = events
        .map((e) => {
          const type = e.eventType || "call.event";
          const typeClass = type.replace(".", "-");
          return `
          <div class="feed-item">
            <div class="feed-item-header">
              <span class="feed-tag ${typeClass}">${escapeHtml(type)}</span>
              <span class="feed-time">${formatTime(e.occurredAt)}</span>
            </div>
            <div class="feed-body">
              <span>Call: <code class="code-pill">${escapeHtml(e.callId || "N/A")}</code></span>
              <span style="font-size: 0.7rem; color: var(--text-dim);">${escapeHtml(e.eventId)}</span>
            </div>
          </div>
        `;
        })
        .join("");
    } catch (err) {
      console.error("Failed to fetch events", err);
    }
  }

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      await fetchCallHistory();
      await fetchEvents();
      await syncActiveCalls();
    }, 3500);
  }

  // --- Utilities ---

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span style="font-size: 1.1rem;">${type === "success" ? "✅" : type === "error" ? "❌" : "ℹ️"}</span>
      <span>${escapeHtml(message)}</span>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(20px)";
      toast.style.transition = "all 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function formatTime(isoString) {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return isoString;
    }
  }

  function formatRelativeTime(isoString) {
    if (!isoString) return "";
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1) return "Just now";
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      return `${Math.floor(hours / 24)}d ago`;
    } catch {
      return "";
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});
