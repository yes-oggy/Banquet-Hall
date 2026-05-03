const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function api(path, opts = {}) {
  const headers = { ...opts.headers };
  if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData))
    headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    credentials: "include",
    ...opts,
    headers,
    body:
      opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)
        ? JSON.stringify(opts.body)
        : opts.body,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || "Request failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function showPage(id) {
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${id}`));
  $$("[data-nav]").forEach((b) =>
    b.classList.toggle("active", b.dataset.navTarget === id)
  );
}

function navigate(id) {
  location.hash = id;
}

let state = {
  user: null,
};

async function refreshMe() {
  try {
    const { user } = await api("/api/me");
    state.user = user;
    $("#nav-auth")?.classList.add("hidden");
    $("#nav-user")?.classList.remove("hidden");
    $("#nav-user").textContent =
      user.role === "user"
        ? `Signed in · ${user.name}`
        : `Staff · ${user.name}`;
    $("#whoami").textContent = user.name;
    $("#btn-logout")?.classList.remove("hidden");
    $("#btn-my-dash")?.classList.toggle("hidden", user.role !== "user");
    $("#btn-staff-dash")?.classList.toggle(
      "hidden",
      !["admin", "coadmin"].includes(user.role)
    );
    $("#btn-login-nav")?.classList.toggle("hidden", !!user);
    $("#btn-register-nav")?.classList.toggle("hidden", !!user);
    $("#btn-admin-login-nav")?.classList.toggle("hidden", !!user);
    return user;
  } catch {
    state.user = null;
    $("#nav-auth")?.classList.remove("hidden");
    $("#nav-user")?.classList.add("hidden");
    $("#whoami").textContent = "";
    $("#btn-logout")?.classList.add("hidden");
    $("#btn-my-dash")?.classList.add("hidden");
    $("#btn-staff-dash")?.classList.add("hidden");
    $("#btn-login-nav")?.classList.remove("hidden");
    $("#btn-register-nav")?.classList.remove("hidden");
    $("#btn-admin-login-nav")?.classList.remove("hidden");
    return null;
  }
}

async function routeFromHash() {
  const h = (location.hash || "#home").slice(1) || "home";
  const u = state.user;

  if (["user", "admin"].includes(h) && !u) {
    showPage("login");
    return;
  }
  if (h === "user" && u && u.role !== "user") {
    showPage("admin");
    await renderAdmin();
    return;
  }
  if (h === "admin" && u && !["admin", "coadmin"].includes(u.role)) {
    showPage("user");
    await loadUserPage();
    return;
  }

  showPage(h);
  if (h === "home") await renderHome();
  if (h === "user") await loadUserPage();
  if (h === "admin") await renderAdmin();
}

async function loadUserPage() {
  if (!state.user) return;
  $("#prof-email").textContent = state.user.email;
  $("#prof-name").value = state.user.name;
  $("#prof-phone").value = state.user.phone;
  await renderUserDashboard();
}

async function renderHome() {
  const wrap = $("#halls-grid");
  if (!wrap.dataset.loaded) {
    wrap.innerHTML = `<p class="muted-small">Loading venues…</p>`;
    const { halls } = await api("/api/halls");
    wrap.dataset.loaded = "1";
    wrap.innerHTML = "";
    halls.forEach((hall) => {
      const div = document.createElement("article");
      div.className = "card-hall";
      div.innerHTML = `
        <img src="${escapeAttr(hall.image_url)}" alt="" loading="lazy" />
        <div class="body">
          <h3>${escapeHtml(hall.name)}</h3>
          <p class="muted">${escapeHtml(hall.description)}</p>
          <p class="muted-small">Up to ${hall.capacity} guests</p>
          <p class="price">From ₹${hall.base_price_per_day.toLocaleString("en-IN")} / day</p>
        </div>`;
      wrap.appendChild(div);
    });
  }
}

async function renderUserDashboard() {
  const list = $("#user-bookings");
  list.innerHTML = `<p class="muted-small">Loading…</p>`;
  try {
    const { bookings } = await api("/api/my/bookings");
    if (!bookings.length) {
      list.innerHTML = `<p class="muted-small">No bookings yet. Choose a hall and date below.</p>`;
    } else {
      list.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Hall</th><th>Guests</th><th>Discount</th><th>Total</th></tr></thead>
            <tbody>
              ${bookings
                .map(
                  (b) => `
                <tr>
                  <td>${escapeHtml(b.event_date)}</td>
                  <td>${escapeHtml(b.hall_name)}</td>
                  <td>${b.guest_count}</td>
                  <td>${b.discount_pct ? `${b.discount_pct}% (${escapeHtml(b.discount_label || "")})` : "—"}</td>
                  <td>₹${Number(b.final_price).toLocaleString("en-IN")}</td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>`;
    }
  } catch (e) {
    list.innerHTML = `<p class="msg msg-error">${escapeHtml(e.message)}</p>`;
  }

  const wrap = $("#book-halls");
  if (!wrap.dataset.bound) {
    wrap.dataset.bound = "1";
    const { halls } = await api("/api/halls");
    const today = new Date();
    const min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;

    halls.forEach((hall) => {
      const blk = document.createElement("div");
      blk.className = "panel";
      blk.style.maxWidth = "100%";
      blk.innerHTML = `
        <div style="display:flex;gap:1rem;align-items:flex-start;flex-wrap:wrap">
          <img src="${escapeAttr(hall.image_url)}" alt="" style="width:140px;height:90px;object-fit:cover;border-radius:12px" />
          <div style="flex:1;min-width:200px">
            <h3 style="font-family:var(--font-display);margin:0 0 .35rem">${escapeHtml(hall.name)}</h3>
            <p class="muted-small" style="margin:0 0 .75rem">${escapeHtml(hall.description)}</p>
            <label class="field" style="margin-bottom:.5rem"><span class="muted-small">Event date</span>
              <input type="date" min="${min}" data-hall-date="${hall.id}" />
            </label>
            <div class="quote-${hall.id} muted-small" style="margin-bottom:.75rem"></div>
            <button class="btn btn-primary btn-book" data-hall-id="${hall.id}">Reserve this hall</button>
          </div>
        </div>`;
      wrap.appendChild(blk);

      const dateInp = blk.querySelector(`[data-hall-date="${hall.id}"]`);
      const quoteEl = blk.querySelector(`.quote-${hall.id}`);
      const loadQuote = async () => {
        const d = dateInp.value;
        if (!d) {
          quoteEl.textContent = "";
          return;
        }
        try {
          const q = await api(`/api/halls/${hall.id}/quote?date=${encodeURIComponent(d)}`);
          quoteEl.innerHTML =
            `<strong>Pricing preview:</strong> base ₹${q.base_price.toLocaleString("en-IN")}` +
            (q.discount_pct > 0
              ? ` → <strong style="color:var(--gold)">${q.discount_pct}% off</strong> (${escapeHtml(
                  q.discount_label || "promo"
                )}) → <strong>₹${q.final_price.toLocaleString("en-IN")}</strong>`
              : ` → <strong>₹${q.final_price.toLocaleString("en-IN")}</strong>`);
        } catch (e) {
          quoteEl.textContent = e.message;
        }
      };
      dateInp.addEventListener("change", loadQuote);

      blk.querySelector(".btn-book").addEventListener("click", async () => {
        const d = dateInp.value;
        const guests = Number($("#book-guests")?.value) || 120;
        if (!d) {
          alert("Pick an event date first.");
          return;
        }
        try {
          await api("/api/my/bookings", {
            method: "POST",
            body: { hall_id: hall.id, event_date: d, guest_count: guests },
          });
          await renderUserDashboard();
          blk.querySelector(".btn-book").textContent = "Booked!";
          setTimeout(() => {
            blk.querySelector(".btn-book").textContent = "Reserve this hall";
          }, 2200);
        } catch (e) {
          alert(e.message);
        }
      });
    });
  }
}

async function renderAdmin() {
  const root = $("#admin-root");
  root.innerHTML = `<p class="muted-small">Loading admin…</p>`;
  try {
    const data = await api("/api/admin/overview");
    const activeSet = new Set(data.recentlyActiveUserIds || []);

    root.innerHTML = `
      <p class="muted-small" style="margin-bottom:1rem">
        Showing ${data.stats.recentlyActiveCount} guests/staff active in the last ~15 minutes (by site usage).
      </p>
      <div class="split split-2">
        <div class="panel" style="max-width:none">
          <h3 class="section-title" style="margin-top:0">Users</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th></th><th>Name</th><th>Role</th><th>Email</th><th>Phone</th><th>Bookings*</th></tr></thead>
              <tbody>
                ${data.users
                  .map((u) => {
                    const on = activeSet.has(u.id);
                    return `
                  <tr>
                    <td><span class="avatar-dot" style="background:${on ? "#22c55e" : "#d6d3d1"}"></span></td>
                    <td>${escapeHtml(u.name)}</td>
                    <td><span class="pill ${u.role === "user" ? "pill-user" : "pill-admin"}">${u.role}</span></td>
                    <td>${escapeHtml(u.email)}</td>
                    <td>${escapeHtml(u.phone)}</td>
                    <td>${data.bookings.filter((b) => b.user_id === u.id).length}</td>
                  </tr>`;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
          <p class="muted-small">*booking count snapshot for this dashboard load.</p>
        </div>
        <div>
          ${
            state.user?.role === "admin"
              ? `
          <div class="panel" style="max-width:none;margin-bottom:1rem">
            <h3 style="font-family:var(--font-display);margin:0 0 .75rem;font-size:1.5rem">Add co‑admin</h3>
            <div class="field"><label>Name</label><input id="ca-name" /></div>
            <div class="field"><label>Email</label><input id="ca-email" type="email" /></div>
            <div class="field"><label>Phone</label><input id="ca-phone" inputmode="numeric" /></div>
            <div class="field"><label>Temporary password</label><input id="ca-pass" type="password" /></div>
            <button class="btn btn-primary" id="ca-submit">Create co‑admin</button>
            <p id="ca-msg" class="muted-small" style="margin-top:.75rem"></p>
          </div>`
              : `<p class="muted-small panel" style="max-width:none">Co‑admins manage discounts and bookings. Only the lead admin can add co‑admins.</p>`
          }
          <div class="panel" style="max-width:none">
            <h3 style="font-family:var(--font-display);margin:0 0 .75rem;font-size:1.35rem">Add discount rule</h3>
            <div class="field"><label>Label</label><input id="disc-label" placeholder="Winter weddings" /></div>
            <div class="field"><label>Percent off</label><input id="disc-pct" type="number" min="1" max="90" value="10" /></div>
            <div class="field"><label>Type</label>
              <select id="disc-type">
                <option value="month_range">Month range</option>
                <option value="fixed_dates">Fixed dates</option>
              </select>
            </div>
            <div class="field"><label id="disc-json-label">JSON value</label>
              <textarea id="disc-json" spellcheck="false">{"startMonth":11,"endMonth":2}</textarea>
              <span class="muted-small">
                Months: wrap winter as Nov–Feb using <code>11</code> and <code>2</code>.
                Dates: use <code>{"dates":["2026-12-25"]}</code>.
              </span>
            </div>
            <button class="btn btn-primary" id="disc-submit">Save discount</button>
            <p id="disc-msg" class="muted-small" style="margin-top:.75rem"></p>
          </div>
        </div>
      </div>

      <h3 class="section-title">Bookings ledger</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>When</th><th>Guest</th><th>Hall</th><th>Date</th><th>Discount</th><th>Final</th></tr></thead>
          <tbody>
            ${data.bookings
              .map(
                (b) => `
              <tr>
                <td>${escapeHtml(String(b.created_at || "").slice(0, 16))}</td>
                <td>${escapeHtml(b.user_name)}<div class="muted-small">${escapeHtml(b.user_email)}</div></td>
                <td>${escapeHtml(b.hall_name)}</td>
                <td>${escapeHtml(b.event_date)}</td>
                <td>${b.discount_pct ? `${b.discount_pct}%` : "—"}</td>
                <td>₹${Number(b.final_price).toLocaleString("en-IN")}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>

      <h3 class="section-title">Discount rules</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Active</th><th>Label</th><th>%</th><th>Type</th><th>Toggle</th></tr></thead>
          <tbody>
            ${data.discounts
              .map((d) => {
                const on = !!d.active;
                return `
              <tr data-discount-id="${d.id}">
                <td>${on ? "Yes" : "No"}</td>
                <td>${escapeHtml(d.label)}</td>
                <td>${d.percent}</td>
                <td>${escapeHtml(d.rule_type)}</td>
                <td><button type="button" class="btn btn-ghost btn-sm disc-toggle">${on ? "Disable" : "Enable"}</button></td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>`;

    $("#disc-type").addEventListener("change", () => {
      const t = $("#disc-type").value;
      $("#disc-json").value =
        t === "month_range"
          ? '{"startMonth":6,"endMonth":8}'
          : '{"dates":["2026-12-31","2027-01-01"]}';
    });

    $("#disc-submit").addEventListener("click", async () => {
      $("#disc-msg").textContent = "";
      try {
        const label = $("#disc-label").value.trim();
        const percent = Number($("#disc-pct").value);
        const rule_type = $("#disc-type").value;
        let rule_value;
        try {
          rule_value = JSON.parse($("#disc-json").value);
        } catch {
          throw new Error("Invalid JSON");
        }
        await api("/api/admin/discounts", {
          method: "POST",
          body: { label, percent, rule_type, rule_value },
        });
        $("#disc-msg").textContent = "Saved.";
        await renderAdmin();
      } catch (e) {
        $("#disc-msg").textContent = e.message;
      }
    });

    $("#ca-submit")?.addEventListener("click", async () => {
      $("#ca-msg").textContent = "";
      try {
        await api("/api/admin/coadmins", {
          method: "POST",
          body: {
            name: $("#ca-name").value,
            email: $("#ca-email").value,
            phone: $("#ca-phone").value,
            password: $("#ca-pass").value,
          },
        });
        $("#ca-msg").textContent = "Co‑admin created.";
        await renderAdmin();
      } catch (e) {
        $("#ca-msg").textContent = e.message;
      }
    });

    root.querySelectorAll(".disc-toggle").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        const row = ev.target.closest("tr");
        const id = Number(row.dataset.discountId);
        const cur = ev.target.textContent === "Disable";
        try {
          await api(`/api/admin/discounts/${id}`, {
            method: "PATCH",
            body: { active: !cur },
          });
          await renderAdmin();
        } catch (e) {
          alert(e.message);
        }
      });
    });
  } catch (e) {
    root.innerHTML = `<p class="msg msg-error">${escapeHtml(e.message)}</p>`;
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
/** Attribute-safe for URLs and text (minimal escaping for src=/href=). */
function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}

async function bootstrap() {
  await refreshMe();
  await routeFromHash();

  $("#btn-register-nav")?.addEventListener("click", () => navigate("register"));
  $("#btn-login-nav")?.addEventListener("click", () => navigate("login"));
  $("#btn-admin-login-nav")?.addEventListener("click", () => navigate("admin-login"));

  $("#form-register").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#reg-msg").className = "msg hidden";
    try {
      const body = {
        name: $("#reg-name").value,
        email: $("#reg-email").value,
        phone: $("#reg-phone").value,
        password: $("#reg-pass").value,
      };
      await api("/api/auth/register", { method: "POST", body });
      await refreshMe();
      location.hash = "user";
      await routeFromHash();
    } catch (err) {
      $("#reg-msg").textContent = err.message;
      $("#reg-msg").className = "msg msg-error";
    }
  });

  $("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#login-msg").className = "msg hidden";
    try {
      const { user } = await api("/api/auth/login", {
        method: "POST",
        body: {
          email: $("#login-email").value,
          password: $("#login-pass").value,
        },
      });
      await refreshMe();
      location.hash = user.role === "user" ? "user" : "admin";
      await routeFromHash();
    } catch (err) {
      $("#login-msg").textContent = err.message;
      $("#login-msg").className = "msg msg-error";
    }
  });

  $("#form-admin-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#alogin-msg").className = "msg hidden";
    try {
      const { user } = await api("/api/auth/login", {
        method: "POST",
        body: {
          email: $("#alogin-email").value,
          password: $("#alogin-pass").value,
        },
      });
      await refreshMe();
      if (!["admin", "coadmin"].includes(user.role)) {
        await api("/api/auth/logout", { method: "POST" });
        await refreshMe();
        $("#alogin-msg").textContent = "This portal is only for authorised staff.";
        $("#alogin-msg").className = "msg msg-error";
        return;
      }
      location.hash = "admin";
      await routeFromHash();
    } catch (err) {
      $("#alogin-msg").textContent = err.message;
      $("#alogin-msg").className = "msg msg-error";
    }
  });

  $("#btn-logout")?.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    await refreshMe();
    location.hash = "home";
    await routeFromHash();
  });

  $("#form-profile").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#prof-msg").className = "msg hidden";
    try {
      const { user } = await api("/api/me", {
        method: "PATCH",
        body: {
          name: $("#prof-name").value,
          phone: $("#prof-phone").value,
        },
      });
      state.user = user;
      $("#whoami").textContent = user.name;
      $("#prof-msg").textContent = "Saved.";
      $("#prof-msg").className = "msg msg-success";
    } catch (err) {
      $("#prof-msg").textContent = err.message;
      $("#prof-msg").className = "msg msg-error";
    }
  });

  window.addEventListener("hashchange", () =>
    routeFromHash().catch(console.error)
  );
}


window.addEventListener("DOMContentLoaded", () => {
  bootstrap().catch(console.error);

  $$("[data-open]").forEach((el) => {
    el.addEventListener("click", () => navigate(el.dataset.open));
  });
});
