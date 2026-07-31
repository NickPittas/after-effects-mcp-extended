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
  var localSending = false;

  var elements = {
    conversation: document.getElementById("conversation"),
    emptyState: document.getElementById("emptyState"),
    jumpLatest: document.getElementById("jumpLatest"),
    toolsToggle: document.getElementById("toolsToggle"),
    toolsCount: document.getElementById("toolsCount"),
    clearButton: document.getElementById("clearButton"),
    optionsButton: document.getElementById("optionsButton"),
    optionsPopover: document.getElementById("optionsPopover"),
    accountButton: document.getElementById("accountButton"),
    accountPopover: document.getElementById("accountPopover"),
    accountInitials: document.getElementById("accountInitials"),
    accountName: document.getElementById("accountName"),
    accountPlan: document.getElementById("accountPlan"),
    switchAccountButton: document.getElementById("switchAccountButton"),
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
    autonomousMode: document.getElementById("autonomousMode"),
    toast: document.getElementById("toast"),
    lightbox: document.getElementById("lightbox"),
    lightboxImage: document.getElementById("lightboxImage"),
    lightboxLabel: document.getElementById("lightboxLabel"),
    closeLightbox: document.getElementById("closeLightbox")
  };

  function normalizeSystemPath(value) {
    var result = decodeURIComponent(String(value || ""));
    result = result.replace(/^file:\/\//i, "");
    if (/^\/[A-Za-z]:/.test(result)) result = result.slice(1);
    return result.replace(/\\/g, "/");
  }

  var documentsPath = normalizeSystemPath(host.getSystemPath("myDocuments"));
  var chatPath = documentsPath + "/ae-mcp-bridge/codex-chat";
  var requestPath = chatPath + "/requests";
  var statePath = chatPath + "/state.json";

  function evalHost(script, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error("After Effects did not respond to the panel request."));
      }, timeoutMs || 5000);
      try {
        host.evalScript(script, function (result) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        });
      } catch (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  }

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
    if (!result || result.err !== 0) throw new Error("Unable to send request to the Codex companion.");
  }

  function quoteForExtendScript(value) {
    return '"' + String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n") + '"';
  }

  function captureViewerAttachment() {
    ensureFolder(chatPath + "/attachments");
    var outputPath = chatPath + "/attachments/viewer-cep-" + Date.now() + ".png";
    return evalHost("aeMcpChatCaptureViewer(" + quoteForExtendScript(outputPath) + ")", 15000).then(function (responseText) {
      var response = {};
      try { response = JSON.parse(responseText || "{}"); } catch (_) {}
      if (response.ok === false) return { path: null, error: response.error || "After Effects could not capture the Viewer." };
      // Windows can expose the completed PNG a fraction after AE returns. The
      // companion performs the reliable filesystem wait before reading it.
      return { path: response.path || outputPath, error: null };
    }).catch(function (error) {
      return { path: null, error: "Viewer capture was unavailable: " + String(error) };
    });
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

  function formatTime(value) {
    try { return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
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
    role.textContent = entry.role === "assistant" ? "Codex" : entry.role === "user" ? "You" : "System";
    var time = document.createElement("span");
    time.textContent = formatTime(entry.time);
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
    var detail = document.createElement("small");
    detail.textContent = event.detail || "Working";
    detail.title = detail.textContent;
    copy.appendChild(title);
    copy.appendChild(detail);
    var status = document.createElement("span");
    status.className = "tool-state";
    status.textContent = event.status === "completed" ? "✓" : event.status === "failed" ? "!" : "•••";
    row.appendChild(color);
    row.appendChild(copy);
    row.appendChild(status);
    return row;
  }

  function renderConversation() {
    if (!state) return;
    var transcript = state.transcript || [];
    var events = state.activityLog || [];
    var items = transcript.map(function (entry, index) {
      return { type: "message", time: entry.time, value: entry, index: index };
    });
    if (toolsVisible) {
      items = items.concat(events.map(function (event) { return { type: "tool", time: event.time, value: event }; }));
      items.sort(function (a, b) { return new Date(a.time).getTime() - new Date(b.time).getTime(); });
    }
    var previousBottomDistance = elements.conversation.scrollHeight - elements.conversation.scrollTop - elements.conversation.clientHeight;
    var fragment = document.createDocumentFragment();
    items.forEach(function (item) {
      if (item.type === "tool") fragment.appendChild(createToolEvent(item.value));
      else {
        var streaming = state.busy && item.value.role === "assistant" && item.index === transcript.length - 1;
        fragment.appendChild(createMessage(item.value, streaming));
      }
    });
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
    elements.statusText.textContent = state.statusText || "Codex Chat";
    elements.sendButton.disabled = state.cliStatus !== "ready" || busy || localSending;
    elements.stopButton.disabled = !busy;
    var account = state.account;
    var label = account ? (account.email || account.label || account.type) : "Not signed in";
    elements.accountInitials.textContent = initials(label);
    elements.accountName.textContent = label;
    elements.accountPlan.textContent = account && account.planType ? account.planType : "";
    elements.switchAccountButton.textContent = account ? "Switch account" : "Sign in";
  }

  function renderActivity() {
    if (!state) return;
    var activity = state.activity || { kind: "idle", label: "Ready" };
    elements.activityStrip.dataset.kind = activity.kind || "idle";
    elements.activityStrip.dataset.busy = state.busy ? "true" : "false";
    elements.activityLabel.textContent = activity.label || "Ready";
    elements.activityDetail.textContent = activity.detail || (state.busy ? "Codex is working" : "Waiting for a request");
  }

  function renderAttachmentState() {
    var chips = [];
    if (elements.attachViewer.checked) chips.push('<span class="attachment-chip active">Viewer</span>');
    if (elements.attachAeUi.checked) chips.push('<span class="attachment-chip active">AE UI</span>');
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
    evalHost("aeMcpChatStartCompanion()");
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
    elements.statusText.textContent = "Collecting After Effects context…";
    try {
      var context = {};
      try {
        var contextText = await evalHost("aeMcpChatGetContext()", 3500);
        context = JSON.parse(contextText || "{}");
      } catch (contextError) {
        context = { unavailable: String(contextError) };
        showToast("AE context was unavailable. Sending the prompt without it.", true);
      }
      var viewerPath = null;
      var viewerError = null;
      if (elements.attachViewer.checked) {
        var viewerResult = await captureViewerAttachment();
        viewerPath = viewerResult.path;
        viewerError = viewerResult.error;
        if (viewerError) showToast(viewerError + " Sending without the viewer image.", true);
      }
      queueRequest("send", {
        prompt: prompt,
        context: context,
        viewerPath: viewerPath,
        viewerRequested: elements.attachViewer.checked,
        viewerError: viewerError,
        attachAeUi: elements.attachAeUi.checked,
        trustAfterEffectsMcp: elements.autonomousMode.checked,
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
  elements.toolsToggle.addEventListener("click", function () {
    toolsVisible = !toolsVisible;
    localStorage.setItem("aeMcpToolsVisible", String(toolsVisible));
    elements.toolsToggle.setAttribute("aria-pressed", toolsVisible ? "true" : "false");
    renderConversation();
  });
  elements.clearButton.addEventListener("click", function () {
    if (!confirm("Clear the visible Codex conversation and tool history?")) return;
    queueRequest("clearTranscript", {});
  });
  elements.optionsButton.addEventListener("click", function (event) { event.stopPropagation(); togglePopover(elements.optionsPopover, elements.accountPopover, elements.optionsButton); });
  elements.accountButton.addEventListener("click", function (event) { event.stopPropagation(); togglePopover(elements.accountPopover, elements.optionsPopover, elements.accountButton); });
  elements.switchAccountButton.addEventListener("click", function () {
    var hasAccount = Boolean(state && state.account);
    if (hasAccount && !confirm("Sign out and choose another Codex account?")) return;
    queueRequest(hasAccount ? "relogin" : "login", {});
    elements.accountPopover.hidden = true;
  });
  [elements.attachViewer, elements.attachAeUi, elements.autonomousMode].forEach(function (control) {
    var saved = localStorage.getItem("aeMcpOption-" + control.id);
    if (control === elements.autonomousMode) {
      // Automatic execution is the safe default for this local, AE-scoped MCP.
      // The user can still disable it explicitly for the current panel session.
      control.checked = true;
      localStorage.setItem("aeMcpOption-" + control.id, "true");
    } else if (saved !== null) control.checked = saved === "true";
    control.addEventListener("change", function () {
      localStorage.setItem("aeMcpOption-" + control.id, String(control.checked));
      renderAttachmentState();
      if (control === elements.autonomousMode) {
        queueRequest("updateSettings", { trustAfterEffectsMcp: control.checked, noApprovalPrompts: control.checked });
      }
    });
  });
  elements.sendButton.addEventListener("click", sendPrompt);
  elements.stopButton.addEventListener("click", function () {
    elements.statusText.textContent = "Stopping Codex...";
    elements.activityLabel.textContent = "Stopping";
    elements.activityDetail.textContent = "Interrupting the active turn";
    queueRequest("stop", {});
    lastCompanionLaunch = Date.now();
    evalHost("aeMcpChatStartCompanion()");
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
  queueRequest("updateSettings", { trustAfterEffectsMcp: true, noApprovalPrompts: true });
  evalHost("aeMcpChatStartCompanion()").then(function () { setTimeout(function () { try { queueRequest("status", {}); } catch (_) {} }, 450); });
  setInterval(readState, 180);
  setTimeout(readState, 250);
}());
