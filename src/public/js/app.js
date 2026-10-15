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
  const headerActiveAgentPill = document.getElementById("header-active-agent-pill");
  const headerActiveAgentName = document.getElementById("header-active-agent-name");
  const currentAgentName = document.getElementById("current-agent-name");
  const currentAgentRole = document.getElementById("current-agent-role");
  const currentAgentPhone = document.getElementById("current-agent-phone");
  const currentAgentEmail = document.getElementById("current-agent-email");
  const agentRingTarget = document.getElementById("agent-ring-target");

  // DOM Elements - Call HUD
  const activeCallCard = document.getElementById("active-call-card");
  const callBadge = document.getElementById("call-badge");
  const badgeText = document.getElementById("badge-text");
  const badgeDot = document.getElementById("badge-dot");
  const callTimer = document.getElementById("call-timer");
  const metaAgentNumber = document.getElementById("meta-agent-number");
  const metaToNumber = document.getElementById("meta-to-number");
  const metaCallId = document.getElementById("meta-call-id");
  const metaFlowAction = document.getElementById("meta-flow-action");
  const flowExplainerText = document.getElementById("flow-explainer-text");

  // Header & Status
  const systemStatusPill = document.getElementById("system-status-pill");
  const systemStatusDot = document.getElementById("system-status-dot");
  const systemStatusText = document.getElementById("system-status-text");
  const callerIdBadge = document.getElementById("caller-id-badge");

  // Tabs & Feeds
  const candidatesContainer = document.getElementById("candidates-container");
  const creatorsContainer = document.getElementById("creators-container");
  const historyFeed = document.getElementById("history-feed");
  const webhooksFeed = document.getElementById("webhooks-feed");
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

  // State
  let currentCallId = null;
  let callStartTime = null;
  let timerInterval = null;
  let pollInterval = null;
  let isDialing = false;
  let systemConfig = null;

  let creatorsList = [];
  let candidatesList = [];
  let activeCreator = null;
  let selectedCandidate = null;

  // Direct Assigned Pairs mapping (Agents <-> Leads)
  // Agents: Ritik, Aman, Ritu
  // Leads: Priya, Ayush, Ananya
  const AGENT_CANDIDATE_PAIRS = {
    creator_ritik: "cand_priya",
    creator_aman: "cand_ayush",
    creator_ritu: "cand_ananya",
    // reverse:
    cand_priya: "creator_ritik",
    cand_ayush: "creator_aman",
    cand_ananya: "creator_ritu",
  };

  let currentCallDirection = "outbound"; // "outbound" or "inbound"

  // Initialize App
  initApp();

  async function initApp() {
    await fetchSystemHealth();
    await fetchCreators();
    await fetchCandidates();
    await fetchCallHistory();
    await fetchEvents();
    startPolling();
    bindEvents();
  }

  function bindEvents() {
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
    openCandidateModalBtn.addEventListener("click", () => openModal(candidateModal));
    btnQuickAddCandidate.addEventListener("click", () => openModal(candidateModal));
    closeCandidateModal.addEventListener("click", () => closeModal(candidateModal));
    cancelCandidateModal.addEventListener("click", () => closeModal(candidateModal));

    openCreatorModalBtn.addEventListener("click", () => openModal(creatorModal));
    btnQuickAddAgent.addEventListener("click", () => openModal(creatorModal));
    closeCreatorModal.addEventListener("click", () => closeModal(creatorModal));
    cancelCreatorModal.addEventListener("click", () => closeModal(creatorModal));

    headerActiveAgentPill.addEventListener("click", () => switchTab("tab-creators"));

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
    candidateSelectorDropdown.addEventListener("change", (e) => {
      const candId = e.target.value;
      if (!candId) {
        selectedCandidate = null;
        return;
      }
      const cand = candidatesList.find((c) => c.id === candId);
      if (cand) {
        selectCandidateForDialing(cand, true);
      }
    });

    // Form Submissions
    addCandidateForm.addEventListener("submit", handleAddCandidate);
    addCreatorForm.addEventListener("submit", handleAddCreator);

    // Call Now Button
    callNowBtn.addEventListener("click", handleCallInitiate);

    // Refresh history button
    if (btnRefreshHistory) {
      btnRefreshHistory.addEventListener("click", fetchCallHistory);
    }

    // Copy Call ID to clipboard
    metaCallId.addEventListener("click", () => {
      if (currentCallId) {
        navigator.clipboard.writeText(currentCallId).then(() => {
          showToast("Call ID copied to clipboard", "success");
        });
      }
    });

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
    headerActiveAgentName.textContent = `${activeCreator.name} (${activeCreator.phone})`;
    currentAgentName.textContent = activeCreator.name;
    currentAgentRole.textContent = activeCreator.role || "Calling Agent";
    currentAgentPhone.textContent = `📞 ${activeCreator.phone}`;
    currentAgentEmail.textContent = `✉️ ${activeCreator.email}`;
    agentRingTarget.textContent = activeCreator.phone;

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

        // Default select Ritik for Priya if first load
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
        return `
        <div class="candidate-card ${isSelected ? "active-selected" : ""}" data-cand-id="${c.id}">
          <div class="card-left-group">
            <div class="card-avatar">👤</div>
            <div class="card-info-wrap">
              <div class="card-header-line">
                <span class="card-title-strong">${escapeHtml(c.name)}</span>
                ${c.company ? `<span class="badge-tag">${escapeHtml(c.company)}</span>` : ""}
                ${(c.tags || [])
                  .map((t) => `<span class="badge-tag highlight">${escapeHtml(t)}</span>`)
                  .join("")}
              </div>
              <div class="card-subtext-line">
                <span>Phone: <code>${escapeHtml(c.phone)}</code></span>
                <span>Calls: ${c.totalCalls || 0}</span>
                <span>Last Called: ${lastCall}</span>
              </div>
            </div>
          </div>
          <div class="card-actions-right">
            <button type="button" class="btn-dial-sm" onclick="window.instantDialCandidate('${c.id}')" title="Call this candidate now">
              ⚡ Call
            </button>
            <button type="button" class="btn-icon-danger" onclick="window.deleteCandidate('${c.id}')" title="Delete Candidate">
              🗑️
            </button>
          </div>
        </div>
      `;
      })
      .join("");
  }

  window.instantDialCandidate = (candId) => {
    const cand = candidatesList.find((c) => c.id === candId);
    if (!cand) return;
    selectCandidateForDialing(cand, true);
    document.getElementById("dialer-section").scrollIntoView({ behavior: "smooth" });
    handleCallInitiate();
  };

  // Direct Assigned Pair Dialing (Ritik <-> Priya, Aman <-> Ayush, Ritu <-> Ananya)
  window.dialPair = async (direction, creatorId, candidateId) => {
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

    // Ensure dialer is unblocked for pair actions
    isDialing = false;
    setDialingState(false);

    if (direction === "inbound") {
      // Inbound: Lead calls Agent -> Creator is the Lead (rings lead first, bridges to agent)
      showToast(`Initiating Inbound Call: ${candidate.name} (Lead) ➔ ${agent.name} (Agent)`, "info");
      document.getElementById("dialer-section").scrollIntoView({ behavior: "smooth" });
      await handleCallInitiate({
        toNumber: agent.phone,
        creatorNumber: candidate.phone,
        candidateId: candidate.id,
        creatorId: agent.id,
        userEmail: agent.email || "info@maxpinetechnology.com",
        metadata: {
          callDirection: "inbound",
          callerLead: candidate.name,
          callerPhone: candidate.phone,
          targetAgent: agent.name,
          targetPhone: agent.phone,
        },
      });
    } else {
      // Outbound: Agent calls Lead -> Creator is the Agent (rings agent first, bridges to lead)
      showToast(`Initiating Outbound Call: ${agent.name} (Agent) ➔ ${candidate.name} (Lead)`, "info");
      document.getElementById("dialer-section").scrollIntoView({ behavior: "smooth" });
      await handleCallInitiate({
        toNumber: candidate.phone,
        creatorNumber: agent.phone,
        candidateId: candidate.id,
        creatorId: agent.id,
        userEmail: agent.email || "info@maxpinetechnology.com",
        metadata: {
          callDirection: "outbound",
          agentName: agent.name,
          agentPhone: agent.phone,
          leadName: candidate.name,
          leadPhone: candidate.phone,
        },
      });
    }
  };

  // Backward compatibility alias
  window.dialAssignedPair = (creatorId, candidateId) => window.dialPair("outbound", creatorId, candidateId);

  window.setCallDirection = (dir) => {
    currentCallDirection = dir;
    const btnOut = document.getElementById("btn-mode-outbound");
    const btnIn = document.getElementById("btn-mode-inbound");
    const destLabel = document.getElementById("destination-field-label");
    const noteText = document.getElementById("agent-bridge-note-text");

    if (dir === "inbound") {
      btnOut.classList.remove("active");
      btnIn.classList.add("active", "inbound-active");
      if (destLabel) destLabel.textContent = "Incoming Caller (Lead Phone)";
      if (noteText && activeCreator) {
        noteText.innerHTML = `ℹ️ Inbound call: FreJun rings <strong>lead phone</strong> first. When answered, bridges to agent (<strong>${activeCreator.name} - ${activeCreator.phone}</strong>)!`;
      }
      btnText.textContent = "Simulate Inbound Call";
    } else {
      btnIn.classList.remove("active", "inbound-active");
      btnOut.classList.add("active");
      if (destLabel) destLabel.textContent = "Destination / Candidate (Receiver)";
      if (noteText && activeCreator) {
        noteText.innerHTML = `ℹ️ Outbound call: FreJun rings <strong>agent phone</strong> (<strong>${activeCreator.phone}</strong>) first. When answered, customer is bridged!`;
      }
      btnText.textContent = "Initiate Call";
    }
  };

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
    if (isDialing) return;

    let payload;
    if (customPayload) {
      payload = customPayload;
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

      if (currentCallDirection === "inbound") {
        // Inbound: Creator is the Lead (entered phone or selected candidate), target is active Agent
        payload = {
          toNumber: activeCreator ? activeCreator.phone : fullNumber,
          creatorNumber: fullNumber,
          candidateId: selectedCandidate ? selectedCandidate.id : undefined,
          creatorId: activeCreator ? activeCreator.id : undefined,
          userEmail: activeCreator ? activeCreator.email : undefined,
          metadata: {
            source: "crm_dialer_ui",
            callDirection: "inbound",
            callerLead: selectedCandidate ? selectedCandidate.name : "Incoming Lead",
            callerPhone: fullNumber,
            targetAgent: activeCreator ? activeCreator.name : "Agent",
            targetPhone: activeCreator?.phone,
            clientTimestamp: new Date().toISOString(),
          },
        };
      } else {
        // Outbound: Creator is the Agent, target is the Lead
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
    }

    setDialingState(true);

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
        setDialingState(false);
        return;
      }

      const session = result.data;
      currentCallId = session.callId;

      showToast(`Call initiated! (ID: ${session.callId})`, "success");
      displayActiveCall(session);
      fetchCallHistory();
      fetchEvents();
      fetchCandidates(); // update call counts
    } catch (err) {
      showToast("Network error initiating call. Check server logs.", "error");
      console.error(err);
    } finally {
      setDialingState(false);
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
      btnText.textContent = currentCallDirection === "inbound" ? "Simulate Inbound Call" : "Initiate Call";
    }
  }

  function displayActiveCall(session) {
    activeCallCard.style.display = "block";
    metaAgentNumber.textContent = session.fromNumber || activeCreator?.phone || "Agent";
    metaToNumber.textContent = session.toNumber;
    metaCallId.textContent = session.callId;
    metaFlowAction.textContent = "FreJun CRM";

    updateCallStateBadge(session.state);

    const isIncoming = session.metadata?.callDirection === "inbound";
    if (isIncoming) {
      flowExplainerText.innerHTML = `<strong>Inbound Call Active:</strong> FreJun is dialing lead <strong>${
        session.metadata.callerLead || "Lead"
      } (${session.fromNumber || session.creatorNumber})</strong>. When answered, agent <strong>${
        session.metadata.targetAgent || "Agent"
      } (${session.toNumber})</strong> will receive the incoming call!`;
    } else {
      flowExplainerText.innerHTML = `<strong>Outbound Call Active:</strong> FreJun is dialing agent <strong>${
        session.fromNumber || activeCreator?.phone
      }</strong>. When answered, candidate <strong>${session.toNumber}</strong> is bridged!`;
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
          const creatorInfo = c.metadata?.creator?.name || "Agent";
          const candidateInfo = c.metadata?.candidate?.name || "";
          return `
          <div class="feed-item">
            <div class="feed-item-header">
              <span class="feed-tag call-${c.state}">${c.state.toUpperCase()}</span>
              <span class="feed-time">${formatTime(c.createdAt)}</span>
            </div>
            <div class="feed-body" style="flex-direction: column; align-items: flex-start; gap: 4px;">
              <div>
                <strong>${escapeHtml(creatorInfo)}</strong> ➔ <strong>${escapeHtml(
            candidateInfo ? `${candidateInfo} (${c.toNumber})` : c.toNumber
          )}</strong>
              </div>
              <div style="font-size: 0.75rem; color: var(--text-dim);">
                Call ID: <code class="code-pill">${escapeHtml(c.callId)}</code> • Duration: ${dur}
              </div>
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
      if (currentCallId) {
        try {
          const res = await fetch(`/api/calls/${currentCallId}`);
          const result = await res.json();
          if (result.success && result.data) {
            updateCallStateBadge(result.data.state);
          }
        } catch {
          // silent
        }
      }
    }, 4000);
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
