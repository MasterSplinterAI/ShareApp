import type { BrandConfig } from "@rhule/support-shared";

/**
 * Self-contained drop-in embed page for the multi-tenant hosted platform.
 *
 * Businesses embed with one line:
 *
 *   <iframe src="https://<host>/support/embed?tenant=<tenantId>"
 *     width="420" height="560" frameborder="0"></iframe>
 *
 * The page is served by the router (GET /embed) and:
 *  - loads the tenant's brand via GET /config (tenant resolved from `?tenant=` / `x-tenant-id`),
 *  - implements the public contact gate (POST /leads), then support chat (POST /chat),
 *  - renders the KB help tab from GET /help/articles.
 *
 * The iframe is same-origin (hosted under the same mount path), so no CORS
 * is needed. All in-iframe API calls carry the tenant (query param on GETs,
 * `x-tenant-id` header on POSTs) so the server's resolveTenant hook routes
 * every call to the right tenant's data.
 */
export function buildEmbedPage(brand: BrandConfig): string {
  const accent = brand.accentColor || "#4f8cff";
  const agentName = brand.supportAgentName || "Support";
  const brandName = brand.name;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${brandName} Support</title>
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f7f8fa; color: #1c1e26; }
  .app { display: flex; flex-direction: column; height: 100%; }
  header { background: #fff; border-bottom: 1px solid #e6e8ee; padding: 12px 16px; display: flex; align-items: center; gap: 10px; }
  header .logo { width: 32px; height: 32px; border-radius: 6px; object-fit: contain; }
  header .title { font-weight: 600; font-size: 14px; }
  header .sub { color: #6b7280; font-size: 12px; }
  .tabs { display: flex; background: #fff; border-bottom: 1px solid #e6e8ee; }
  .tab { flex: 1; text-align: center; padding: 10px 8px; font-size: 13px; font-weight: 600; color: #6b7280; border-bottom: 2px solid transparent; cursor: pointer; user-select: none; }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .panel { flex: 1; overflow-y: auto; padding: 16px; }
  .msg { display: flex; margin-bottom: 10px; }
  .msg.user { justify-content: flex-end; }
  .bubble { max-width: 78%; padding: 8px 12px; border-radius: 12px; font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  .msg.user .bubble { background: var(--accent); color: #fff; border-bottom-right-radius: 4px; }
  .msg.agent .bubble { background: #fff; border: 1px solid #e6e8ee; border-bottom-left-radius: 4px; }
  .composer { display: flex; gap: 8px; padding: 10px 12px; background: #fff; border-top: 1px solid #e6e8ee; }
  .composer input { flex: 1; border: 1px solid #d7dae2; border-radius: 8px; padding: 9px 12px; font-size: 13px; outline: none; }
  .composer input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
  .composer button { background: var(--accent); color: #fff; border: 0; border-radius: 8px; padding: 0 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .composer button:disabled { opacity: .55; cursor: default; }
  .contact { background: #fff; border: 1px solid #e6e8ee; border-radius: 10px; padding: 14px; margin-bottom: 12px; }
  .contact h4 { margin: 0 0 8px; font-size: 13px; }
  .contact input { width: 100%; margin-bottom: 8px; padding: 8px 10px; border: 1px solid #d7dae2; border-radius: 8px; font-size: 13px; }
  .contact label { font-size: 12px; color: #6b7280; }
  .help-item { background: #fff; border: 1px solid #e6e8ee; border-radius: 10px; margin-bottom: 8px; overflow: hidden; }
  .help-item .h { padding: 12px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .help-item .body { display: none; padding: 0 14px 12px; font-size: 13px; color: #3c4150; white-space: pre-wrap; line-height: 1.5; }
  .help-item.open .body { display: block; }
  .empty { color: #8a91a0; font-size: 13px; text-align: center; padding: 24px 0; }
</style>
</head>
<body>
<div class="app">
  <header>
    ${brand.logoUrl ? `<img class="logo" src="${brand.logoUrl}" alt="">` : ""}
    <div>
      <div class="title">${brandName}</div>
      <div class="sub">${agentName}</div>
    </div>
  </header>
  <div class="tabs">
    <div class="tab active" data-tab="chat">Support</div>
    <div class="tab" data-tab="help">Help</div>
  </div>
  <div class="panel" id="panel-chat"></div>
  <div class="panel" id="panel-help" style="display:none"></div>
  <div class="composer" id="composer">
    <input id="chat-input" type="text" placeholder="Ask ${agentName} anything..." autocomplete="off">
    <button id="chat-send">Send</button>
  </div>
</div>
<script>
(function () {
  var tenant = new URLSearchParams(location.search).get("tenant");
  var base = location.pathname.replace(/\\/embed$/, "") || "/";

  // Every in-iframe API call carries the tenant: ?tenant= on GETs,
  // x-tenant-id header on POSTs. The server's resolveTenant hook routes
  // each call to that tenant's brand + data.
  function qs(path) {
    if (!tenant) return base + path;
    return base + path + (path.indexOf("?") >= 0 ? "&" : "?") + "tenant=" + encodeURIComponent(tenant);
  }
  function post(path, body) {
    var headers = { "Content-Type": "application/json" };
    if (tenant) headers["x-tenant-id"] = tenant;
    return fetch(base + path, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && j.error) || ("HTTP " + r.status);
        return j;
      });
    });
  }

  var chatPanel = document.getElementById("panel-chat");
  var helpPanel = document.getElementById("panel-help");
  var input = document.getElementById("chat-input");
  var sendBtn = document.getElementById("chat-send");

  function addMsg(who, text) {
    var div = document.createElement("div");
    div.className = "msg " + who;
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    div.appendChild(bubble);
    chatPanel.appendChild(div);
    chatPanel.scrollTop = chatPanel.scrollHeight;
  }

  // ── Public contact gate (lead) ────────────────────────────────
  var leadId = localStorage.getItem("sk_embed_lead");

  function ensureLead(cb) {
    if (leadId) return cb();
    var wrap = document.createElement("div");
    wrap.className = "contact";
    wrap.innerHTML =
      "<h4>Quick contact</h4>" +
      "<input id=\"c-name\" type=\"text\" placeholder=\"Your name\"><br>" +
      "<input id=\"c-email\" type=\"email\" placeholder=\"Your email\"><br>" +
      "<label><input id=\"c-optin\" type=\"checkbox\" style=\"width:auto\"> Email me about updates</label>";
    chatPanel.prepend(wrap);
    var btn = document.createElement("button");
    btn.textContent = "Continue";
    btn.style.cssText = "margin-top:8px;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer";
    btn.onclick = function () {
      var name = document.getElementById("c-name").value.trim();
      var email = document.getElementById("c-email").value.trim();
      var optin = document.getElementById("c-optin").checked;
      if (!name || !email) { alert("Name and email are required."); return; }
      post("/leads", { name: name, email: email, marketingOptIn: optin, source: "embed_widget" })
        .then(function (j) {
          leadId = j.leadId;
          localStorage.setItem("sk_embed_lead", leadId);
          wrap.remove();
          cb();
        })
        .catch(function (e) { alert(e.message); });
    };
    wrap.appendChild(btn);
  }

  function send() {
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    sendBtn.disabled = true;
    ensureLead(function () {
      addMsg("user", text);
      post("/chat", { message: text, leadId: leadId })
        .then(function (j) {
          addMsg("agent", j.reply || "(no reply)");
          sendBtn.disabled = false;
        })
        .catch(function (e) {
          addMsg("agent", "⚠ " + e.message);
          sendBtn.disabled = false;
        });
    });
  }
  sendBtn.onclick = send;
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });

  // ── Tabs ───────────────────────────────────────────────────────
  var tabs = document.querySelectorAll(".tab");
  tabs.forEach(function (t) {
    t.onclick = function () {
      tabs.forEach(function (x) { x.classList.remove("active"); });
      t.classList.add("active");
      var isChat = t.dataset.tab === "chat";
      chatPanel.style.display = isChat ? "block" : "none";
      helpPanel.style.display = isChat ? "none" : "block";
      if (!isChat) loadHelp();
    };
  });

  // ── KB help tab ────────────────────────────────────────────────
  var helpLoaded = false;
  function loadHelp() {
    if (helpLoaded) return;
    helpLoaded = true;
    fetch(qs("/help/articles"))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var list = (j && j.articles) || [];
        if (!list.length) {
          helpPanel.innerHTML = '<div class="empty">No help articles yet.</div>';
          return;
        }
        list.forEach(function (a) {
          var item = document.createElement("div");
          item.className = "help-item";
          item.innerHTML = '<div class="h"></div><div class="body"></div>';
          item.querySelector(".h").textContent = a.title;
          item.querySelector(".body").textContent = a.body;
          item.querySelector(".h").onclick = function () { item.classList.toggle("open"); };
          helpPanel.appendChild(item);
        });
      })
      .catch(function () {
        helpPanel.innerHTML = '<div class="empty">Could not load help articles.</div>';
      });
  }
})();
</script>
</body>
</html>`;
}
