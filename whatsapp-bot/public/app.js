const $ = (sel) => document.querySelector(sel);
const loginView = $("#login-view");
const dashView = $("#dash-view");

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, { credentials: "same-origin", ...options });
  if (res.status === 401) {
    showLogin();
    throw new Error("Authentication required");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showLogin() {
  dashView.classList.add("hidden");
  loginView.classList.remove("hidden");
}
function showDash() {
  loginView.classList.add("hidden");
  dashView.classList.remove("hidden");
  refreshAll();
}

/* ------------------------------- auth ---------------------------------- */

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  $("#login-error").textContent = "";
  try {
    await api("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
    });
    e.target.reset();
    showDash();
  } catch (err) {
    $("#login-error").textContent = err.message;
  }
});

$("#logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  showLogin();
});

/* ------------------------------ rendering ------------------------------- */

const fmt = (iso) => (iso ? new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`).toLocaleString() : "—");

async function loadStatus() {
  const { whatsapp, config } = await api("/status");
  const badge = $("#conn-badge");
  badge.textContent = whatsapp.connection;
  badge.className = `badge ${whatsapp.connection === "open" ? "ok" : "bad"}`;
  $("#conn-detail").textContent =
    whatsapp.connection === "open"
      ? `Linked as ${whatsapp.me?.name || whatsapp.me?.id || "device"}`
      : whatsapp.lastError || "Waiting for connection…";
  $("#channel-detail").textContent = config.channelJid
    ? `Channel: ${config.channelJid}`
    : "No CHANNEL_JID configured — set it in .env";
  const wrap = $("#qr-wrap");
  if (whatsapp.qrDataUrl) {
    $("#qr").src = whatsapp.qrDataUrl;
    wrap.classList.remove("hidden");
  } else {
    wrap.classList.add("hidden");
  }
}

async function loadPosts() {
  const { posts } = await api("/posts");
  const tbody = $("#posts-table tbody");
  tbody.innerHTML = "";
  if (!posts.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">No posts yet.</td></tr>';
    return;
  }
  for (const p of posts) {
    const tr = document.createElement("tr");
    const schedule = p.mode === "recurring" ? p.cron_expr : p.mode === "once" ? fmt(p.scheduled_at) : "manual";
    tr.innerHTML = `
      <td>${escapeHtml(p.title || "(untitled)")}<div class="muted">${escapeHtml((p.caption || "").slice(0, 70))}</div></td>
      <td>${p.type}</td>
      <td>${escapeHtml(String(schedule))}<div class="muted">${escapeHtml(p.timezone || "")}</div></td>
      <td>${p.mode === "manual" ? "—" : fmt(p.next_run_at)}</td>
      <td>${p.status}${p.last_error ? `<div class="muted">${escapeHtml(p.last_error)}</div>` : ""}</td>`;
    const td = document.createElement("td");
    td.className = "row";
    td.append(
      button("Post now", "small", () => sendNow(p.id)),
      button("Edit", "small ghost", () => editPost(p)),
      button("Delete", "small ghost", () => removePost(p.id)),
    );
    tr.append(td);
    tbody.append(tr);
  }
}

async function loadHistory() {
  const { history } = await api("/history?limit=50");
  const tbody = $("#history-table tbody");
  tbody.innerHTML = history.length
    ? ""
    : '<tr><td colspan="4" class="muted">Nothing sent yet.</td></tr>';
  for (const h of history) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${fmt(h.finished_at || h.created_at)}</td>
      <td>${escapeHtml(h.title || `#${h.post_id}`)}</td>
      <td>${h.status}</td>
      <td class="muted">${escapeHtml(h.error || h.message_id || "")}</td>`;
    tbody.append(tr);
  }
}

function button(label, cls, onClick) {
  const b = document.createElement("button");
  b.textContent = label;
  b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/* -------------------------------- actions ------------------------------- */

async function sendNow(id) {
  try {
    await api(`/posts/${id}/send-now`, { method: "POST" });
    await Promise.all([loadPosts(), loadHistory()]);
  } catch (err) {
    alert(err.message);
  }
}

async function removePost(id) {
  if (!confirm("Delete this post?")) return;
  await api(`/posts/${id}`, { method: "DELETE" });
  await loadPosts();
}

const postForm = $("#post-form");

function editPost(p) {
  postForm.id.value = p.id;
  postForm.title.value = p.title || "";
  postForm.caption.value = p.caption || "";
  postForm.mode.value = p.mode;
  postForm.timezone.value = p.timezone || "";
  postForm.enabled.checked = p.enabled;
  postForm.scheduled_at.value = p.scheduled_at ? new Date(p.scheduled_at).toISOString().slice(0, 16) : "";
  postForm.cron_expr.value = p.cron_expr || "";
  $("#form-title").textContent = `Edit post #${p.id}`;
  syncMode();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  postForm.reset();
  postForm.id.value = "";
  $("#form-title").textContent = "New post";
  $("#form-error").textContent = "";
  syncMode();
}
$("#reset-form").addEventListener("click", resetForm);

function syncMode() {
  const mode = postForm.mode.value;
  $("#when-row").classList.toggle("hidden", mode !== "once");
  $("#cron-row").classList.toggle("hidden", mode !== "recurring");
}
$("#mode").addEventListener("change", syncMode);

postForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#form-error").textContent = "";
  const id = postForm.id.value;
  const body = new FormData();
  body.set("title", postForm.title.value);
  body.set("caption", postForm.caption.value);
  body.set("mode", postForm.mode.value);
  body.set("timezone", postForm.timezone.value || "UTC");
  body.set("enabled", postForm.enabled.checked ? "true" : "false");
  if (postForm.mode.value === "once" && postForm.scheduled_at.value) {
    body.set("scheduled_at", new Date(postForm.scheduled_at.value).toISOString());
  }
  if (postForm.mode.value === "recurring") body.set("cron_expr", postForm.cron_expr.value);
  if (postForm.media.files[0]) body.set("media", postForm.media.files[0]);

  try {
    await api(id ? `/posts/${id}` : "/posts", { method: id ? "PUT" : "POST", body });
    resetForm();
    await loadPosts();
  } catch (err) {
    $("#form-error").textContent = err.message;
  }
});

/* --------------------------------- boot -------------------------------- */

async function refreshAll() {
  await Promise.allSettled([loadStatus(), loadPosts(), loadHistory()]);
}

setInterval(() => {
  if (!dashView.classList.contains("hidden")) loadStatus().catch(() => {});
}, 5000);

(async function boot() {
  syncMode();
  try {
    await api("/me");
    showDash();
  } catch {
    showLogin();
  }
})();
