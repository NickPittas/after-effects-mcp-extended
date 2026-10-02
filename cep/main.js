(function () {
  "use strict";

  var previewMode = /(?:\?|&)preview=1(?:&|$)/.test(window.location.search);
  var cep = window.cep || { fs: { readFile: function () { return { err: 1 }; }, writeFile: function () { return { err: 0 }; }, makedir: function () { return { err: 0 }; }, stat: function () { return { err: 1 }; } } };
  var host = window.__adobe_cep__ || {
    getSystemPath: function () { return "C:/Users/Preview/Documents"; },
    evalScript: function (_script, callback) { callback("{}"); }
  };
  var state = null;
  var lastUpdatedAt = "";
  var followLatest = true;
  var toolsVisible = localStorage.getItem("aeMcpToolsVisible") === "true";
  var toastTimer = null;
  var lastCompanionLaunch = 0;
  var lastBridgeWakeRequest = 0;
  var bridgeHostReady = false;
  var bridgeHostError = "";
  var bridgeHostInitializing = false;
  var bridgeHostInitializeStartedAt = 0;
  var bridgeHostInitializeSequence = 0;
  var activeBridgeHostInitializeToken = 0;
  var bridgeHostEarliestEvalAt = Date.now() + 4000;
  var bridgeHostBusy = false;
  var bridgeHostCallStartedAt = 0;
  var activeBridgeCommandId = "";
  var bridgeHostCallSequence = 0;
  var activeBridgeHostCallToken = 0;
  var bridgeTakeover = false;
  var bridgeTakeoverSourceInstanceId = "";
  var bridgeEnabled = localStorage.getItem("aeMcpBridgeEnabled") !== "false";
  var bridgeLogEntries = [];
  var lastBridgeLogSignature = "";
  var bridgeInstanceId = "cep-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
  var lastCepHeartbeatWrite = 0;
  var bridgeRetryAfter = 0;
  var localSending = false;
  var modelDraft = false;
  var modelChangePending = null;
  var lastModelRender = "";
  var expandedToolGroups = {};

  var elements = {
    chatTab: document.getElementById("chatTab"),
    bridgeTab: document.getElementById("bridgeTab"),
    chatPanel: document.getElementById("chatPanel"),
    bridgePanel: document.getElementById("bridgePanel"),
    bridgeTabDot: document.getElementById("bridgeTabDot"),
    bridgeStatusText: document.getElementById("bridgeStatusText"),
    bridgeOwnerText: document.getElementById("bridgeOwnerText"),
    bridgeAutoRun: document.getElementById("bridgeAutoRun"),
    bridgeCheckButton: document.getElementById("bridgeCheckButton"),
    bridgeEngineText: document.getElementById("bridgeEngineText"),
    bridgeVersionText: document.getElementById("bridgeVersionText"),
    bridgeCommandPath: document.getElementById("bridgeCommandPath"),
    bridgeLog: document.getElementById("bridgeLog"),
    bridgeClearLog: document.getElementById("bridgeClearLog"),
    conversation: document.getElementById("conversation"),
    emptyState: document.getElementById("emptyState"),
    jumpLatest: document.getElementById("jumpLatest"),
    toolsToggle: document.getElementById("toolsToggle"),
    toolsCount: document.getElementById("toolsCount"),
    clearButton: document.getElementById("clearButton"),
    optionsButton: document.getElementById("optionsButton"),
    optionsPopover: document.getElementById("optionsPopover"),
    accountButton: document.getElementById("accountButton"),
    providerSelect: document.getElementById("providerSelect"),
    modelSelect: document.getElementById("modelSelect"),
    modelEffortSelect: document.getElementById("modelEffortSelect"),
    refreshModelsButton: document.getElementById("refreshModelsButton"),
    customModelRow: document.getElementById("customModelRow"),
    customModelInput: document.getElementById("customModelInput"),
    applyModelButton: document.getElementById("applyModelButton"),
    accountPopover: document.getElementById("accountPopover"),
    accountProvider: document.getElementById("accountProvider"),
    accountInitials: document.getElementById("accountInitials"),
    accountName: document.getElementById("accountName"),
    accountPlan: document.getElementById("accountPlan"),
    switchAccountButton: document.getElementById("switchAccountButton"),
    installProviderButton: document.getElementById("installProviderButton"),
    refreshProviderButton: document.getElementById("refreshProviderButton"),
    providerDocsButton: document.getElementById("providerDocsButton"),
    statusDot: document.getElementById("statusDot"),
    statusText: document.getElementById("statusText"),
    activityStrip: document.getElementById("activityStrip"),
    activityLabel: document.getElementById("activityLabel"),
    activityDetail: document.getElementById("activityDetail"),
    stopButton: document.getElementById("stopButton"),
    promptInput: document.getElementById("promptInput"),
    sendButton: document.getElementById("sendButton"),
    attachmentState: document.getElementById("attachmentState"),
    attachViewer: document.getElementById("attachViewer"),
    attachAeUi: document.getElementById("attachAeUi"),
    trustAeMcp: document.getElementById("trustAeMcp"),
    autonomousMode: document.getElementById("autonomousMode"),
    toast: document.getElementById("toast"),
    lightbox: document.getElementById("lightbox"),
    lightboxImage: document.getElementById("lightboxImage"),
    lightboxLabel: document.getElementById("lightboxLabel"),
    closeLightbox: document.getElementById("closeLightbox")
  };
  elements.emptyCopy = document.getElementById("emptyCopy");

  function normalizeSystemPath(value) {
    var result = decodeURIComponent(String(value || ""));
    result = result.replace(/^file:\/\//i, "");
    if (/^\/[A-Za-z]:/.test(result)) result = result.slice(1);
    return result.replace(/\\/g, "/");
  }

  var documentsPath = normalizeSystemPath(host.getSystemPath("myDocuments"));
  var extensionPath = normalizeSystemPath(host.getSystemPath("extension"));
  var chatPath = documentsPath + "/ae-mcp-bridge/codex-chat";
  var requestPath = chatPath + "/requests";
  var statePath = chatPath + "/state.json";
  var bridgeHeartbeatPath = documentsPath + "/ae-mcp-bridge/ae_bridge_status.json";
  var bridgeResultPath = documentsPath + "/ae-mcp-bridge/ae_mcp_result.json";

  function ensureFolder(folderPath) {
    var parts = folderPath.replace(/\\/g, "/").split("/");
    var current = /^[A-Za-z]:$/.test(parts[0]) ? parts.shift() + "/" : "";
    parts.forEach(function (part) {
      if (!part) return;
      current += (current && current.slice(-1) !== "/" ? "/" : "") + part;
      cep.fs.makedir(current);
    });
  }

  function queueRequest(action, data) {
    ensureFolder(requestPath);
    var request = data || {};
    request.id = Date.now() + "-" + Math.floor(Math.random() * 100000);
    request.action = action;
    var filePath = requestPath + "/" + request.id + ".json";
    var result = cep.fs.writeFile(filePath, JSON.stringify(request, null, 2));
    if (!result || result.err !== 0) throw new Error("Unable to send request to the CLI companion.");
  }

  function readBridgeHeartbeatRecord() {
    try {
      var result = cep.fs.readFile(bridgeHeartbeatPath);
      if (!result || result.err !== 0 || !result.data) return null;
      return JSON.parse(result.data);
    } catch (_) {
      return null;
    }
  }

  function bridgeHeartbeatAge(heartbeat) {
    try {
      heartbeat = heartbeat || readBridgeHeartbeatRecord();
      if (!heartbeat) return Infinity;
      var updatedAt = Number(heartbeat.updatedAt);
      if (!isFinite(updatedAt)) updatedAt = Date.parse(String(heartbeat.updatedAt || ""));
      return isFinite(updatedAt) ? Date.now() - updatedAt : Infinity;
    } catch (_) {
      return Infinity;
    }
  }

  function wakeBridgeIfStale(forceCheck) {
    if (previewMode) return;
    if (Date.now() < bridgeHostEarliestEvalAt) return;
    var age = bridgeHeartbeatAge();
    if (!forceCheck && age < 5000) return;
    if (Date.now() - lastBridgeWakeRequest < 5000) return;
    lastBridgeWakeRequest = Date.now();
    host.evalScript("aeMcpChatWakeBridge()", function () {});
  }

  function initializeBridgeHost(callback) {
    if (bridgeHostReady) { if (callback) callback(true); return; }
    if (Date.now() < bridgeHostEarliestEvalAt) return;
    if (bridgeHostInitializing) return;
    bridgeHostInitializing = true;
    bridgeHostInitializeStartedAt = Date.now();
    var initializeToken = ++bridgeHostInitializeSequence;
    activeBridgeHostInitializeToken = initializeToken;
    host.evalScript("aeMcpChatInitializeBridgeCore(" + JSON.stringify(extensionPath) + ")", function (rawResult) {
      if (activeBridgeHostInitializeToken !== initializeToken) return;
      bridgeHostInitializing = false;
      bridgeHostInitializeStartedAt = 0;
      activeBridgeHostInitializeToken = 0;
      var ready = false;
      try {
        var result = JSON.parse(String(rawResult || "{}"));
        ready = result.ok === true;
      } catch (_) {}
      bridgeHostReady = ready;
      bridgeHostError = ready ? "" : String(result && result.error || rawResult || "Bridge initialization failed");
      if (!ready) {
        if (/modal dialog/i.test(String(rawResult || ""))) bridgeHostEarliestEvalAt = Date.now() + 5000;
        bridgeRetryAfter = Date.now() + 3000;
      }
      if (callback) callback(ready);
    });
  }

  function writeCepBridgeHeartbeat(stateName, force) {
    if (!force && Date.now() - lastCepHeartbeatWrite < 700) return;
    lastCepHeartbeatWrite = Date.now();
    var heartbeat = {
      version: "1.10.11",
      state: stateName || (bridgeHostBusy ? "checking" : "ready"),
      autoRun: bridgeEnabled && stateName !== "closed",
      instanceId: bridgeInstanceId,
      taskId: "cep-watchdog",
      hostReady: bridgeHostReady,
      hostPhase: bridgeHostInitializing ? "initializing" : bridgeHostBusy ? "executing" : bridgeHostReady ? "ready" : "awaiting-initialization",
      lastError: bridgeHostError || null,
      lastCommand: activeBridgeCommandId || "",
      updatedAt: Date.now()
    };
    cep.fs.writeFile(bridgeHeartbeatPath, JSON.stringify(heartbeat));
  }

  function bridgeCommandRecord() {
    try {
      var commandPath = documentsPath + "/ae-mcp-bridge/ae_command.json";
      var result = cep.fs.readFile(commandPath);
      if (!result || result.err !== 0 || !result.data) return null;
      var command = JSON.parse(result.data);
      command.__path = commandPath;
      return command;
    } catch (_) {
      return null;
    }
  }

  function bridgeResultRecord() {
    try {
      var result = cep.fs.readFile(bridgeResultPath);
      if (!result || result.err !== 0 || !result.data) return null;
      return JSON.parse(result.data);
    } catch (_) {
      return null;
    }
  }

  function resetBridgeCommandForRetry(commandId, errorText) {
    var command = bridgeCommandRecord();
    if (!command || command.id !== commandId) return 1;
    var commandPath = command.__path;
    delete command.__path;
    if (command.status === "running") command.status = "pending";
    command.retryCount = Number(command.retryCount || 0) + 1;
    command.lastHostError = String(errorText || "Host evaluation was interrupted.");
    cep.fs.writeFile(commandPath, JSON.stringify(command, null, 2));
    return command.retryCount;
  }

  function retargetPendingBridgeCommand(command, targetInstanceId) {
    if (!command || command.status !== "pending") return command;
    // Do not truncate/rewrite a file AE may be reading on every watchdog tick.
    if (command.bridgeInstanceId === targetInstanceId) return command;
    if (
      command.bridgeInstanceId &&
      command.bridgeInstanceId !== targetInstanceId &&
      bridgeTakeoverSourceInstanceId &&
      command.bridgeInstanceId !== bridgeTakeoverSourceInstanceId
    ) return null;
    var commandPath = command.__path;
    delete command.__path;
    command.bridgeInstanceId = targetInstanceId;
    cep.fs.writeFile(commandPath, JSON.stringify(command, null, 2));
    command.__path = commandPath;
    return command;
  }

  function processPendingBridgeCommand(command) {
    if (!command || command.status !== "pending" || bridgeHostBusy || !bridgeHostReady || Date.now() < bridgeRetryAfter) return;
    var issuedAt = Date.parse(String(command.timestamp || ""));
    if (isFinite(issuedAt) && Date.now() - issuedAt > Number(command.timeoutMs || 30000)) {
      failBridgeCommand(command, "This request expired before After Effects could execute it. Send a fresh request; no edit was performed.");
      return;
    }
    bridgeHostBusy = true;
    bridgeHostCallStartedAt = Date.now();
    activeBridgeCommandId = command.id;
    var callToken = ++bridgeHostCallSequence;
    activeBridgeHostCallToken = callToken;
    writeCepBridgeHeartbeat("checking");
    var commandId = command.id;
    host.evalScript("aeMcpChatProcessBridgeCommand(" + JSON.stringify(bridgeInstanceId) + "," + JSON.stringify(commandId) + "," + JSON.stringify(extensionPath) + ")", function (rawResult) {
      if (activeBridgeHostCallToken !== callToken) return;
      bridgeHostBusy = false;
      bridgeHostCallStartedAt = 0;
      activeBridgeCommandId = "";
      activeBridgeHostCallToken = 0;
      var ok = false;
      try {
        var result = JSON.parse(String(rawResult || "{}"));
        ok = result.ok === true;
      } catch (_) {}
      if (!ok) {
        bridgeHostReady = false;
        bridgeHostError = String(result && result.error || rawResult || "Bridge command could not be completed");
        if (/modal dialog/i.test(String(rawResult || ""))) bridgeHostEarliestEvalAt = Date.now() + 5000;
        var retryCount = resetBridgeCommandForRetry(commandId, rawResult);
        bridgeRetryAfter = Date.now() + Math.min(15000, 1500 * Math.pow(2, Math.min(3, retryCount - 1)));
      }
      // The shared ExtendScript implementation writes its own heartbeat. Restore
      // CEP ownership immediately, not after the throttle/stale-owner timeout.
      if (ok) bridgeHostError = "";
      writeCepBridgeHeartbeat(ok ? "ready" : "error", true);
    });
  }

  function clearBridgeHostCall() {
    bridgeHostBusy = false;
    bridgeHostCallStartedAt = 0;
    activeBridgeCommandId = "";
    activeBridgeHostCallToken = 0;
  }

  function failBridgeCommand(command, message) {
    if (!command || !command.id) return;
    var commandPath = command.__path;
    delete command.__path;
    command.status = "error";
    command.statusUpdatedAt = Date.now();
    command.lastHostError = message;
    cep.fs.writeFile(commandPath, JSON.stringify(command, null, 2));
    cep.fs.writeFile(bridgeResultPath, JSON.stringify({
      status: "error",
      _commandId: command.id,
      _commandExecuted: command.command || null,
      message: message,
      _responseTimestamp: Date.now()
    }, null, 2));
  }

  function reconcileBridgeHostCall() {
    // Loading the full JSX core can exceed 3 seconds on a cold AE launch. Keep
    // the original callback valid rather than repeatedly discarding success.
    if (bridgeHostInitializing && Date.now() - bridgeHostInitializeStartedAt > 30000) {
      bridgeHostInitializing = false;
      bridgeHostInitializeStartedAt = 0;
      activeBridgeHostInitializeToken = 0;
      bridgeHostReady = false;
      bridgeHostError = "After Effects did not complete bridge initialization within 30 seconds.";
      bridgeRetryAfter = Date.now() + 1500;
    }
    if (!bridgeHostBusy || !activeBridgeCommandId) return;
    var command = bridgeCommandRecord();
    var result = bridgeResultRecord();
    var activeResultFinished = result && result._commandId === activeBridgeCommandId && result.status !== "waiting";
    var activeCommandFinished = command && command.id === activeBridgeCommandId && (command.status === "completed" || command.status === "error");
    if (activeCommandFinished || activeResultFinished) {
      clearBridgeHostCall();
      writeCepBridgeHeartbeat("ready");
      return;
    }
    if ((!command || command.id !== activeBridgeCommandId) && Date.now() - bridgeHostCallStartedAt > 3000) {
      clearBridgeHostCall();
      bridgeHostReady = false;
      bridgeRetryAfter = Date.now() + 1500;
      return;
    }
    // If AE never accepted evalScript, the command remains pending. A running
    // command is never retried here because it may legitimately take minutes.
    if (command && command.id === activeBridgeCommandId && command.status === "pending" && Date.now() - bridgeHostCallStartedAt > 3000) {
      var pendingCommandPath = command.__path;
      delete command.__path;
      command.retryCount = Number(command.retryCount || 0) + 1;
      command.lastHostError = "After Effects did not accept the CEP host call.";
      cep.fs.writeFile(pendingCommandPath, JSON.stringify(command, null, 2));
      var pendingRetryCount = command.retryCount;
      clearBridgeHostCall();
      bridgeHostReady = false;
      bridgeRetryAfter = Date.now() + Math.min(15000, 1500 * Math.pow(2, Math.min(3, pendingRetryCount - 1)));
      return;
    }
    if (command && command.id === activeBridgeCommandId && command.status === "running") {
      var commandTimeout = Math.max(1000, Number(command.timeoutMs || 30000));
      if (Date.now() - bridgeHostCallStartedAt > commandTimeout + 5000) {
        failBridgeCommand(command, "After Effects interrupted this command during a project or panel lifecycle transition. Retry the request.");
        clearBridgeHostCall();
        bridgeHostReady = false;
        bridgeRetryAfter = Date.now() + 1500;
      }
    }
  }

  // A healthy legacy panel remains primary for compatibility. Closing it no
  // longer closes this panel's bridge. Persisted closed/paused CEP heartbeats
  // from a previous AE session likewise cannot prevent a fresh panel starting.
  function maintainBridgeWatchdog() {
    if (previewMode) return;
    reconcileBridgeHostCall();
    var heartbeat = readBridgeHeartbeatRecord();
    var age = bridgeHeartbeatAge(heartbeat);
    var stateName = heartbeat ? String(heartbeat.state || "") : "";
    var fromCep = heartbeat && heartbeat.instanceId === bridgeInstanceId;
    var legacyActive = !fromCep && age < 2000 && stateName !== "closed";
    renderBridgePanel(heartbeat, legacyActive);
    if (legacyActive) {
      bridgeTakeover = false;
      bridgeTakeoverSourceInstanceId = "";
      return;
    }
    if (!fromCep && (age >= 5000 || stateName === "closed")) {
      bridgeTakeover = true;
      bridgeTakeoverSourceInstanceId = heartbeat && heartbeat.instanceId ? String(heartbeat.instanceId) : "";
    }
    if (!bridgeTakeover && !fromCep) return;
    if (!bridgeEnabled) { writeCepBridgeHeartbeat("paused"); return; }
    writeCepBridgeHeartbeat(bridgeHostBusy ? "checking" : bridgeHostError ? "error" : "ready");
    var pendingCommand = retargetPendingBridgeCommand(bridgeCommandRecord(), bridgeInstanceId);
    if (!pendingCommand || pendingCommand.status !== "pending" || Date.now() < bridgeRetryAfter || Date.now() < bridgeHostEarliestEvalAt) return;
    initializeBridgeHost(function (ready) {
      if (!ready) return;
      writeCepBridgeHeartbeat(bridgeHostBusy ? "checking" : "ready");
      processPendingBridgeCommand(pendingCommand);
    });
  }

  function selectPanelTab(tab) {
    var chat = tab === "chat";
    elements.chatPanel.hidden = !chat;
    elements.bridgePanel.hidden = chat;
    elements.chatTab.setAttribute("aria-selected", String(chat));
    elements.bridgeTab.setAttribute("aria-selected", String(!chat));
    elements.chatTab.setAttribute("tabindex", chat ? "0" : "-1");
    elements.bridgeTab.setAttribute("tabindex", chat ? "-1" : "0");
    // Only visibility changes: never dispose/recreate the conversation or timers.
    if (chat && followLatest) jumpToLatest(false);
  }

  function renderBridgePanel(heartbeat, legacyActive) {
    var name = !bridgeEnabled && !legacyActive ? "paused" : heartbeat && bridgeHeartbeatAge(heartbeat) < 5000 ? heartbeat.state : "starting";
    elements.bridgeStatusText.textContent = bridgeHostError && !legacyActive ? "Bridge error: " + bridgeHostError : name === "checking" ? "Executing command" : name === "ready" ? "Ready — auto-run is on" : name === "paused" ? "Paused — commands will wait" : name === "error" ? "Recovering after a bridge error" : "Starting integrated bridge…";
    if (!legacyActive && bridgeEnabled && !bridgeHostError && !bridgeHostReady) {
      elements.bridgeStatusText.textContent = bridgeHostInitializing ? "Initializing After Effects command engine…" : "Panel connected — command engine initializes on request";
    }
    elements.bridgeTabDot.className = "status-dot " + (name === "ready" ? "ready" : name === "checking" ? "busy" : name === "error" ? "error" : "");
    elements.bridgeOwnerText.textContent = legacyActive ? "The optional standalone bridge is active. Close that panel to use the controls here." : "Runs in this panel, including while the Chat tab is selected.";
    elements.bridgeAutoRun.checked = bridgeEnabled;
    elements.bridgeAutoRun.disabled = Boolean(legacyActive || bridgeHostBusy);
    elements.bridgeCheckButton.disabled = Boolean(legacyActive || !bridgeEnabled || bridgeHostBusy);
    elements.bridgeEngineText.textContent = legacyActive ? "Standalone ScriptUI" : "Integrated CEP";
    elements.bridgeVersionText.textContent = heartbeat && heartbeat.version || "1.10.11";
    elements.bridgeCommandPath.textContent = documentsPath + "/ae-mcp-bridge/ae_command.json";
    var command = bridgeCommandRecord();
    var result = bridgeResultRecord();
    if (!command) return;
    var signature = command.id + ":" + command.status + ":" + (result && result._commandId === command.id ? result.status : "");
    if (signature === lastBridgeLogSignature) return;
    lastBridgeLogSignature = signature;
    var args = command.args || {};
    var line = (args.operation || command.command || "Command") + "/" + (args.action || "") + " — " + command.status;
    if (result && result._commandId === command.id && result.status === "error") line += ": " + (result.message || result.error || "Unknown error");
    bridgeLogEntries.push(new Date().toLocaleTimeString() + "  " + line);
    if (bridgeLogEntries.length > 100) bridgeLogEntries.shift();
    var follow = elements.bridgeLog.scrollHeight - elements.bridgeLog.scrollTop - elements.bridgeLog.clientHeight < 40;
    elements.bridgeLog.textContent = bridgeLogEntries.join("\n");
    if (follow) elements.bridgeLog.scrollTop = elements.bridgeLog.scrollHeight;
  }

  function launchCompanionDirectly() {
    if (!cep.process || typeof cep.process.createProcess !== "function") return false;
    var extensionPath = normalizeSystemPath(host.getSystemPath("extension"));
    var userDataPath = normalizeSystemPath(host.getSystemPath("userData"));
    var candidates = [
      extensionPath + "/bin/after-effects-codex-chat.exe",
      userDataPath + "/AfterEffectsMCP/after-effects-codex-chat.exe",
      documentsPath + "/ae-mcp-bridge/bin/after-effects-codex-chat.exe"
    ];
    for (var index = 0; index < candidates.length; index++) {
      var stat = cep.fs.stat(candidates[index]);
      if (!stat || stat.err !== 0) continue;
      try {
        var result = cep.process.createProcess(candidates[index]);
        if (result && result.err === 0 && Number(result.data) > 0) return true;
      } catch (_) {}
    }
    return false;
  }

  function showToast(message, isError) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.className = "toast" + (isError ? " error" : "");
    elements.toast.hidden = false;
    toastTimer = setTimeout(function () { elements.toast.hidden = true; }, 3200);
  }

  function fileUrl(filePath) {
    var normalized = String(filePath || "").replace(/\\/g, "/");
    return encodeURI("file:///" + normalized.replace(/^\//, ""));
  }

  function initials(value) {
    var source = String(value || "?").split("@")[0].replace(/[^a-z0-9]+/gi, " ").trim();
    if (!source) return "?";
    var words = source.split(/\s+/);
    return (words[0].charAt(0) + (words.length > 1 ? words[words.length - 1].charAt(0) : words[0].charAt(1) || "")).toUpperCase();
  }

  function formatTimestamp(value) {
    try {
      return new Date(value).toLocaleString([], {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit"
      });
    }
    catch (_) { return ""; }
  }

  function appendRichText(container, text) {
    var value = String(text || "");
    var blocks = value.split(/```/);
    blocks.forEach(function (block, index) {
      if (index % 2 === 1) {
        var pre = document.createElement("pre");
        var code = document.createElement("code");
        code.textContent = block.replace(/^\w+\n/, "").replace(/\n$/, "");
        pre.appendChild(code);
        container.appendChild(pre);
        return;
      }
      var lines = block.split(/\r?\n/);
      var list = null;
      lines.forEach(function (line) {
        var bullet = line.match(/^\s*[-*]\s+(.+)/);
        if (bullet) {
          if (!list) { list = document.createElement("ul"); container.appendChild(list); }
          var item = document.createElement("li");
          item.textContent = bullet[1];
          list.appendChild(item);
        } else {
          list = null;
          if (!line && container.lastChild) return;
          var paragraph = document.createElement("p");
          paragraph.textContent = line || " ";
          container.appendChild(paragraph);
        }
      });
    });
  }

  function createAttachmentGrid(attachments) {
    var grid = document.createElement("div");
    grid.className = "attachment-grid";
    attachments.forEach(function (attachment) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "attachment-card";
      var image = document.createElement("img");
      image.src = fileUrl(attachment.path);
      image.alt = attachment.label || "Attachment";
      var label = document.createElement("span");
      label.textContent = attachment.label || (attachment.kind === "aeUi" ? "After Effects UI" : "Composition Viewer");
      card.appendChild(image);
      card.appendChild(label);
      card.addEventListener("click", function () {
        elements.lightboxImage.src = image.src;
        elements.lightboxLabel.textContent = label.textContent;
        elements.lightbox.hidden = false;
      });
      grid.appendChild(card);
    });
    return grid;
  }

  function createMessage(entry, isStreaming) {
    var row = document.createElement("article");
    row.className = "message-row " + entry.role;
    var stack = document.createElement("div");
    stack.className = "message-stack";
    var meta = document.createElement("div");
    meta.className = "message-meta";
    var role = document.createElement("span");
    role.className = "message-role";
    role.textContent = entry.role === "assistant" ? (entry.providerLabel || (state && state.providerName) || "Assistant") : entry.role === "user" ? "You" : "System";
    var time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTimestamp(entry.time);
    time.title = new Date(entry.time).toLocaleString();
    meta.appendChild(role);
    meta.appendChild(time);
    var bubble = document.createElement("div");
    bubble.className = "message-bubble";
    appendRichText(bubble, entry.text || (isStreaming ? "" : "…"));
    if (isStreaming) {
      var caret = document.createElement("span");
      caret.className = "stream-caret";
      bubble.appendChild(caret);
    }
    stack.appendChild(meta);
    stack.appendChild(bubble);
    if (entry.attachments && entry.attachments.length) stack.appendChild(createAttachmentGrid(entry.attachments));
    row.appendChild(stack);
    return row;
  }

  function createToolEvent(event) {
    var row = document.createElement("div");
    row.className = "tool-event " + event.kind + " " + event.status;
    var color = document.createElement("i");
    color.className = "tool-color";
    var copy = document.createElement("div");
    var title = document.createElement("strong");
    title.textContent = event.label || "Tool";
    var time = document.createElement("time");
    time.textContent = formatTimestamp(event.time);
    time.title = new Date(event.time).toLocaleString();
    var detail = document.createElement("small");
    detail.textContent = event.detail || "Working";
    detail.title = detail.textContent;
    copy.appendChild(title);
    copy.appendChild(time);
    copy.appendChild(detail);
    var status = document.createElement("span");
    status.className = "tool-state";
    status.textContent = event.status === "completed" ? "✓" : event.status === "failed" ? "!" : event.status === "cancelled" ? "■" : "•••";
    row.appendChild(color);
    row.appendChild(copy);
    row.appendChild(status);
    return row;
  }

  function createToolGroup(events) {
    var group = document.createElement("section");
    group.className = "tool-group";
    var groupId = events.map(function (event) { return event.id; }).join("|");
    var hasRunning = events.some(function (event) { return event.status === "running"; });
    var hasFailed = events.some(function (event) { return event.status === "failed"; });
    var hasCancelled = events.some(function (event) { return event.status === "cancelled"; });
    var expanded = hasRunning || hasFailed || expandedToolGroups[groupId] === true;

    var header = document.createElement("button");
    header.type = "button";
    header.className = "tool-group-header";
    header.setAttribute("aria-expanded", expanded ? "true" : "false");
    var chevron = document.createElement("span");
    chevron.className = "tool-group-chevron";
    chevron.textContent = expanded ? "−" : "+";
    var title = document.createElement("strong");
    title.textContent = events.length === 1 ? (events[0].label || "Tool") : "Tools · " + events.length + " actions";
    var time = document.createElement("time");
    time.textContent = formatTimestamp(events[0].time);
    var status = document.createElement("span");
    status.className = "tool-group-status " + (hasFailed ? "failed" : hasRunning ? "running" : hasCancelled ? "cancelled" : "completed");
    status.textContent = hasFailed ? "Failed" : hasRunning ? "Working" : hasCancelled ? "Stopped" : "Done";
    header.appendChild(chevron);
    header.appendChild(title);
    header.appendChild(time);
    header.appendChild(status);

    var body = document.createElement("div");
    body.className = "tool-group-body";
    body.hidden = !expanded;
    events.forEach(function (event) { body.appendChild(createToolEvent(event)); });
    header.addEventListener("click", function () {
      var willExpand = body.hidden;
      body.hidden = !willExpand;
      expandedToolGroups[groupId] = willExpand;
      header.setAttribute("aria-expanded", willExpand ? "true" : "false");
      chevron.textContent = willExpand ? "−" : "+";
    });
    group.appendChild(header);
    group.appendChild(body);
    return group;
  }

  function compareTimelineItems(a, b) {
    var aSequence = Number(a.value.sequence);
    var bSequence = Number(b.value.sequence);
    var aHasSequence = isFinite(aSequence) && aSequence > 0;
    var bHasSequence = isFinite(bSequence) && bSequence > 0;
    if (aHasSequence && bHasSequence && aSequence !== bSequence) return aSequence - bSequence;
    if (aHasSequence !== bHasSequence) return aHasSequence ? 1 : -1;
    var difference = new Date(a.time).getTime() - new Date(b.time).getTime();
    return difference || a.fallbackOrder - b.fallbackOrder;
  }

  function renderConversation() {
    if (!state) return;
    var transcript = state.transcript || [];
    var events = state.activityLog || [];
    var items = transcript.map(function (entry, index) {
      return { type: "message", time: entry.time, value: entry, index: index, fallbackOrder: index * 2 };
    });
    if (toolsVisible) {
      items = items.concat(events.map(function (event, index) { return { type: "tool", time: event.time, value: event, fallbackOrder: index * 2 + 1 }; }));
    }
    items.sort(compareTimelineItems);
    var previousBottomDistance = elements.conversation.scrollHeight - elements.conversation.scrollTop - elements.conversation.clientHeight;
    var fragment = document.createDocumentFragment();
    for (var itemIndex = 0; itemIndex < items.length; itemIndex++) {
      var item = items[itemIndex];
      if (item.type === "tool") {
        var toolEvents = [];
        while (itemIndex < items.length && items[itemIndex].type === "tool") {
          toolEvents.push(items[itemIndex].value);
          itemIndex++;
        }
        itemIndex--;
        fragment.appendChild(createToolGroup(toolEvents));
      } else {
        var streaming = state.busy && state.activity && state.activity.kind === "responding" && item.value.role === "assistant" && item.index === transcript.length - 1;
        fragment.appendChild(createMessage(item.value, streaming));
      }
    }
    elements.conversation.replaceChildren(fragment);
    elements.emptyState.hidden = items.length > 0;
    elements.toolsCount.textContent = String(events.length);
    if (followLatest || previousBottomDistance < 48) jumpToLatest(false);
    updateJumpButton();
  }

  function renderHeader() {
    if (!state) return;
    var busy = state.busy === true;
    var error = state.hostStatus === "error" || Boolean(state.error);
    elements.statusDot.className = "status-dot " + (error ? "error" : busy ? "busy" : state.cliStatus === "ready" ? "ready" : "");
    var providerName = state.providerName || "CLI assistant";
    elements.statusText.textContent = state.statusText || "CLI Chat";
    elements.sendButton.disabled = state.cliStatus !== "ready" || state.bridgeStatus !== "ready" || busy || localSending || Boolean(modelChangePending);
    elements.stopButton.disabled = !busy;
    elements.stopButton.title = "Stop " + providerName;
    elements.providerSelect.value = state.provider || "codex";
    elements.providerSelect.disabled = busy;
    var account = state.account;
    var label = account ? (account.email || account.label || account.type) : state.cliStatus === "missing" ? "Not installed" : "Not signed in";
    elements.accountInitials.textContent = account ? initials(label) : initials(providerName);
    elements.accountProvider.textContent = providerName + " account";
    elements.accountName.textContent = label;
    elements.accountPlan.textContent = (account && account.planType ? account.planType + " · " : "") + (state.cliVersion || "");
    elements.switchAccountButton.textContent = state.provider === "pi"
      ? (account ? "Configure providers" : "Configure provider")
      : (account ? "Switch account" : "Sign in");
    elements.switchAccountButton.hidden = state.cliStatus === "missing";
    elements.installProviderButton.hidden = state.cliStatus !== "missing";
    elements.installProviderButton.textContent = "Install " + providerName;
    elements.promptInput.placeholder = "Ask " + providerName + " to work in After Effects…";
    elements.emptyCopy.textContent = "Ask " + providerName + " to create, inspect, animate, or render.";
    renderModels();
  }

  function modelKey(choice) {
    return JSON.stringify([choice.provider || "", choice.model || ""]);
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderModels() {
    var choice = (state.modelChoices || {})[state.provider] || { model: null, provider: null, effort: null };
    var catalog = (state.modelCatalogs || {})[state.provider] || { models: [], efforts: [] };
    if (modelChangePending && JSON.stringify(choice) === JSON.stringify(modelChangePending)) modelChangePending = null;
    var signature = JSON.stringify([state.provider, catalog, choice, modelDraft]);
    if (signature !== lastModelRender) {
      lastModelRender = signature;
      var options = '<option value="">CLI default</option>';
      var matched = null;
      (catalog.models || []).forEach(function (model) {
        var key = modelKey({ model: model.id, provider: model.provider });
        options += '<option value="' + escapeHtml(key) + '">' + escapeHtml(model.label || model.id) + '</option>';
        if (key === modelKey(choice)) matched = model;
      });
      if (choice.model && !matched) options += '<option value="' + escapeHtml(modelKey(choice)) + '">' + escapeHtml((choice.provider ? choice.provider + ' / ' : '') + choice.model) + ' (saved)</option>';
      options += '<option value="__custom__">Custom model…</option>';
      elements.modelSelect.innerHTML = options;
      elements.modelSelect.value = modelDraft ? '__custom__' : choice.model ? modelKey(choice) : '';
      elements.customModelInput.placeholder = state.provider === 'pi' || state.provider === 'opencode' ? 'provider/model-id' : 'Model ID or CLI alias';
      var defaultModel = (catalog.models || []).filter(function (model) { return model.id === catalog.defaultModel; })[0];
      var efforts = (matched || (!choice.model && defaultModel) || {}).efforts || catalog.efforts || [];
      elements.modelEffortSelect.hidden = efforts.length === 0;
      elements.modelEffortSelect.innerHTML = '<option value="">Default reasoning</option>' + efforts.map(function (level) { return '<option value="' + escapeHtml(level) + '">' + escapeHtml(level) + '</option>'; }).join('');
      elements.modelEffortSelect.value = choice.effort || '';
    }
    elements.customModelRow.hidden = !modelDraft;
    var disabled = state.busy || Boolean(modelChangePending) || catalog.modelSupported === false || state.cliStatus !== 'ready';
    elements.modelSelect.disabled = disabled;
    elements.modelEffortSelect.disabled = disabled || catalog.status === 'loading';
    elements.customModelInput.disabled = disabled;
    elements.applyModelButton.disabled = disabled;
    elements.refreshModelsButton.disabled = catalog.status === 'loading' || state.cliStatus !== 'ready';
    elements.refreshModelsButton.textContent = catalog.status === 'loading' ? '…' : '↻';
    elements.modelSelect.title = catalog.status === 'loading' ? 'Loading available models…' : (catalog.message || 'Model choice is remembered separately for each CLI');
  }

  function saveModelChoice(choice) {
    modelDraft = false;
    modelChangePending = choice;
    queueRequest('setModel', { providerId: state.provider, modelChoice: choice });
    renderHeader();
    setTimeout(function () {
      if (modelChangePending === choice) {
        modelChangePending = null;
        lastModelRender = '';
        renderHeader();
        showToast((state && state.error) || 'Model setting was not confirmed. Refresh status and try again.', true);
      }
    }, 15000);
  }

  function renderActivity() {
    if (!state) return;
    var activity = state.activity || { kind: "idle", label: "Ready" };
    elements.activityStrip.dataset.kind = activity.kind || "idle";
    elements.activityStrip.dataset.busy = state.busy ? "true" : "false";
    elements.activityLabel.textContent = activity.label || "Ready";
    elements.activityDetail.textContent = activity.detail || (state.busy ? (state.providerName || "CLI assistant") + " is working" : "Waiting for a request");
  }

  function renderAttachmentState() {
    var chips = [];
    if (elements.attachViewer.checked) chips.push('<span class="attachment-chip active">Viewer</span>');
    if (elements.attachAeUi.checked) chips.push('<span class="attachment-chip active">AE UI</span>');
    if (elements.trustAeMcp.checked) chips.push('<span class="attachment-chip">AE trusted</span>');
    if (elements.autonomousMode.checked) chips.push('<span class="attachment-chip">Auto</span>');
    elements.attachmentState.innerHTML = chips.join("");
  }

  function renderState(nextState) {
    state = nextState;
    renderHeader();
    renderActivity();
    renderConversation();
  }

  function ensureCompanionAlive() {
    if (previewMode) return;
    var updated = state && state.updatedAt ? Date.parse(state.updatedAt) : 0;
    if (updated && Date.now() - updated < 6500) return;
    if (Date.now() - lastCompanionLaunch < 10000) return;
    lastCompanionLaunch = Date.now();
    if (!launchCompanionDirectly()) showToast("The CLI companion could not be started. Reinstall the extension to restore its companion executable.", true);
  }

  function readState() {
    var result = cep.fs.readFile(statePath);
    if (!result || result.err !== 0 || !result.data) {
      ensureCompanionAlive();
      return;
    }
    try {
      var nextState = JSON.parse(String(result.data).replace(/^\uFEFF/, ""));
      if (nextState.updatedAt !== lastUpdatedAt) {
        lastUpdatedAt = nextState.updatedAt;
        renderState(nextState);
      }
    } catch (_) {}
    ensureCompanionAlive();
  }

  function jumpToLatest(smooth) {
    followLatest = true;
    elements.conversation.scrollTo({ top: elements.conversation.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    updateJumpButton();
  }

  function updateJumpButton() {
    var distance = elements.conversation.scrollHeight - elements.conversation.scrollTop - elements.conversation.clientHeight;
    if (distance > 70) followLatest = false;
    else if (distance < 24) followLatest = true;
    elements.jumpLatest.hidden = followLatest;
  }

  function autoSizePrompt() {
    elements.promptInput.style.height = "auto";
    elements.promptInput.style.height = Math.min(132, Math.max(42, elements.promptInput.scrollHeight)) + "px";
  }

  async function sendPrompt() {
    var prompt = elements.promptInput.value.trim();
    if (!prompt || elements.sendButton.disabled || localSending) return;
    localSending = true;
    elements.sendButton.disabled = true;
    elements.statusText.textContent = "Preparing After Effects request…";
    try {
      queueRequest("send", {
        prompt: prompt,
        viewerRequested: elements.attachViewer.checked,
        attachAeUi: elements.attachAeUi.checked,
        trustAfterEffectsMcp: elements.trustAeMcp.checked,
        noApprovalPrompts: elements.autonomousMode.checked
      });
      elements.promptInput.value = "";
      autoSizePrompt();
      followLatest = true;
      setTimeout(function () {
        localSending = false;
        renderHeader();
      }, 800);
    } catch (error) {
      localSending = false;
      renderHeader();
      showToast(String(error), true);
    }
  }

  function togglePopover(target, other, trigger) {
    var willOpen = target.hidden;
    other.hidden = true;
    target.hidden = !willOpen;
    trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
  }

  elements.toolsToggle.setAttribute("aria-pressed", toolsVisible ? "true" : "false");
  elements.chatTab.addEventListener("click", function () { selectPanelTab("chat"); });
  elements.bridgeTab.addEventListener("click", function () { selectPanelTab("bridge"); });
  [elements.chatTab, elements.bridgeTab].forEach(function (tab) {
    tab.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      var next = tab === elements.chatTab ? elements.bridgeTab : elements.chatTab;
      next.click(); next.focus();
    });
  });
  elements.bridgeAutoRun.addEventListener("change", function () {
    bridgeEnabled = elements.bridgeAutoRun.checked;
    localStorage.setItem("aeMcpBridgeEnabled", String(bridgeEnabled));
    lastCepHeartbeatWrite = 0;
    maintainBridgeWatchdog();
    renderBridgePanel(readBridgeHeartbeatRecord(), false);
  });
  elements.bridgeCheckButton.addEventListener("click", maintainBridgeWatchdog);
  elements.bridgeClearLog.addEventListener("click", function () { bridgeLogEntries = []; elements.bridgeLog.textContent = "Waiting for commands."; });
  if (typeof window.addEventListener === "function") window.addEventListener("beforeunload", function () {
    var heartbeat = readBridgeHeartbeatRecord();
    if (heartbeat && heartbeat.instanceId === bridgeInstanceId) writeCepBridgeHeartbeat("closed", true);
  });
  elements.toolsToggle.addEventListener("click", function () {
    toolsVisible = !toolsVisible;
    localStorage.setItem("aeMcpToolsVisible", String(toolsVisible));
    elements.toolsToggle.setAttribute("aria-pressed", toolsVisible ? "true" : "false");
    renderConversation();
  });
  elements.clearButton.addEventListener("click", function () {
    // Never leave the harness editing while a confirmation dialog is open.
    elements.statusText.textContent = "Stopping and starting a new conversation...";
    queueRequest("clearTranscript", {});
  });
  elements.optionsButton.addEventListener("click", function (event) { event.stopPropagation(); togglePopover(elements.optionsPopover, elements.accountPopover, elements.optionsButton); });
  elements.accountButton.addEventListener("click", function (event) { event.stopPropagation(); togglePopover(elements.accountPopover, elements.optionsPopover, elements.accountButton); });
  elements.switchAccountButton.addEventListener("click", function () {
    var hasAccount = Boolean(state && state.account);
    if (hasAccount && state.provider !== "pi" && !confirm("Sign out and choose another " + (state.providerName || "CLI") + " account?")) return;
    queueRequest(hasAccount ? "relogin" : "login", {});
    elements.accountPopover.hidden = true;
  });
  elements.providerSelect.addEventListener("change", function () {
    modelDraft = false;
    modelChangePending = null;
    queueRequest("selectProvider", { providerId: elements.providerSelect.value });
    elements.providerSelect.disabled = true;
  });
  elements.modelSelect.addEventListener('change', function () {
    if (!state) return;
    if (elements.modelSelect.value === '__custom__') {
      modelDraft = true;
      elements.customModelRow.hidden = false;
      elements.customModelInput.focus();
      return;
    }
    var pair = elements.modelSelect.value ? JSON.parse(elements.modelSelect.value) : ['', ''];
    saveModelChoice({ model: pair[1] || null, provider: pair[0] || null, effort: null });
  });
  elements.applyModelButton.addEventListener('click', function () {
    var id = elements.customModelInput.value.trim();
    if (!id) return;
    var provider = null;
    if (state.provider === 'pi' || state.provider === 'opencode') {
      var separator = id.indexOf('/');
      if (separator < 1 || separator === id.length - 1) { showToast('Enter provider/model-id.', true); return; }
      provider = id.slice(0, separator);
      id = id.slice(separator + 1);
    }
    saveModelChoice({ model: id, provider: provider, effort: null });
  });
  elements.customModelInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); elements.applyModelButton.click(); }
  });
  elements.modelEffortSelect.addEventListener('change', function () {
    var choice = (state.modelChoices || {})[state.provider] || {};
    saveModelChoice({ model: choice.model || null, provider: choice.provider || null, effort: elements.modelEffortSelect.value || null });
  });
  elements.refreshModelsButton.addEventListener('click', function () { queueRequest('refreshModels', {}); });
  elements.installProviderButton.addEventListener("click", function () {
    queueRequest("installProvider", {});
    elements.accountPopover.hidden = true;
  });
  elements.refreshProviderButton.addEventListener("click", function () { queueRequest("status", {}); });
  elements.providerDocsButton.addEventListener("click", function () { queueRequest("openProviderDocs", {}); });
  [elements.attachViewer, elements.attachAeUi, elements.trustAeMcp, elements.autonomousMode].forEach(function (control) {
    var saved = localStorage.getItem("aeMcpOption-" + control.id);
    if (saved !== null) control.checked = saved === "true";
    control.addEventListener("change", function () {
      localStorage.setItem("aeMcpOption-" + control.id, String(control.checked));
      renderAttachmentState();
      if (control === elements.trustAeMcp || control === elements.autonomousMode) {
        queueRequest("updateSettings", { trustAfterEffectsMcp: elements.trustAeMcp.checked, noApprovalPrompts: elements.autonomousMode.checked });
      }
    });
  });
  elements.sendButton.addEventListener("click", sendPrompt);
  elements.stopButton.addEventListener("click", function () {
    elements.statusText.textContent = "Stopping " + ((state && state.providerName) || "CLI") + "...";
    elements.activityLabel.textContent = "Stopping";
    elements.activityDetail.textContent = "Interrupting the active turn";
    queueRequest("stop", {});
  });
  elements.promptInput.addEventListener("input", autoSizePrompt);
  elements.promptInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendPrompt(); }
  });
  elements.conversation.addEventListener("scroll", updateJumpButton);
  elements.jumpLatest.addEventListener("click", function () { jumpToLatest(true); });
  elements.closeLightbox.addEventListener("click", function () { elements.lightbox.hidden = true; });
  elements.lightbox.addEventListener("click", function (event) { if (event.target === elements.lightbox) elements.lightbox.hidden = true; });
  document.addEventListener("click", function () { elements.optionsPopover.hidden = true; elements.accountPopover.hidden = true; });
  elements.optionsPopover.addEventListener("click", function (event) { event.stopPropagation(); });
  elements.accountPopover.addEventListener("click", function (event) { event.stopPropagation(); });

  renderAttachmentState();
  autoSizePrompt();
  if (previewMode) {
    renderState({
      hostStatus: "ready",
      cliStatus: "ready",
      busy: true,
      statusText: "Using After Effects",
      account: { type: "chatgpt", email: "npittas@gmail.com", label: "npittas@gmail.com", planType: "plus" },
      activity: { kind: "afterEffects", label: "Using After Effects", detail: "Creating composition" },
      transcript: [
        { id: "p1", role: "user", text: "Create a new 1920×1080 composition at 25 fps and add a centered blue square.", time: new Date(Date.now() - 65000).toISOString() },
        { id: "p2", role: "assistant", text: "I’ll create the composition, add the shape layer, and verify its properties.", time: new Date(Date.now() - 60000).toISOString() },
        { id: "p3", role: "assistant", text: "The composition is ready:\n- 1920×1080\n- 25 fps\n- Blue square centered at [960, 540]", time: new Date().toISOString() }
      ],
      activityLog: [
        { id: "t1", kind: "afterEffects", label: "After Effects", detail: "create · composition · MCP Demo", status: "completed", time: new Date(Date.now() - 55000).toISOString() },
        { id: "t2", kind: "afterEffects", label: "After Effects", detail: "create · shape layer · Blue Square", status: "running", time: new Date(Date.now() - 3000).toISOString() }
      ]
    });
    return;
  }
  queueRequest("updateSettings", { trustAfterEffectsMcp: elements.trustAeMcp.checked, noApprovalPrompts: elements.autonomousMode.checked });
  ensureCompanionAlive();
  setTimeout(function () { try { queueRequest("status", {}); } catch (_) {} }, 450);
  if (typeof host.addEventListener === "function") {
    host.addEventListener("documentAfterActivate", function () {
      bridgeHostEarliestEvalAt = Math.max(bridgeHostEarliestEvalAt, Date.now() + 2500);
      setTimeout(function () { wakeBridgeIfStale(true); }, 2500);
    });
  }
  setInterval(maintainBridgeWatchdog, 250);
  setTimeout(maintainBridgeWatchdog, 800);
  setInterval(readState, 180);
  setTimeout(readState, 250);
}());
