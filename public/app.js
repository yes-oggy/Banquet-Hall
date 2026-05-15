const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(message, type = "success") {
  const root = $("#toast-root");
  if (!root) return;
  const el = document.createElement("div");
  el.className = `toast toast-${type === "error" ? "error" : "success"}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.2s";
    setTimeout(() => el.remove(), 220);
  }, 3800);
}

function closeMobileNav() {
  $("#nav-menu")?.classList.remove("open");
  const t = $("#nav-toggle");
  if (t) t.setAttribute("aria-expanded", "false");
}

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
  closeMobileNav();
  location.hash = id;
}

let state = {
  user: null,
};

async function refreshMe() {
  const prevId = state.user?.id;
  const prevRole = state.user?.role;
  try {
    const { user } = await api("/api/me");
    state.user = user;
    if (prevId !== user.id || prevRole !== user.role) {
      delete $("#halls-grid")?.dataset.loaded;
    }
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
    if (state.user) delete $("#halls-grid")?.dataset.loaded;
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

async function renderPromos() {
  const strip = $("#promos-strip");
  if (!strip) return;
  try {
    const { promotions } = await api("/api/promotions");
    if (!promotions.length) {
      strip.classList.add("hidden");
      return;
    }
    strip.classList.remove("hidden");
    strip.innerHTML =
      `<span class="muted-small" style="width:100%;margin-bottom:.15rem">Active offers</span>` +
      promotions
        .map(
          (p) =>
            `<span class="promo-chip"><strong>${p.percent}%</strong> ${escapeHtml(p.label)}${
              p.summary ? ` <span class="muted-small">· ${escapeHtml(p.summary)}</span>` : ""
            }</span>`
        )
        .join("");
  } catch {
    strip.classList.add("hidden");
  }
}

async function renderHome() {
  await renderPromos();
  const wrap = $("#halls-grid");
  if (!wrap.dataset.loaded) {
    wrap.innerHTML = `<p class="muted-small">Loading venues…</p>`;
    const { halls } = await api("/api/halls");
    wrap.dataset.loaded = "1";
    wrap.innerHTML = "";
    const signedIn = state.user?.role === "user";
    halls.forEach((hall) => {
      const div = document.createElement("article");
      div.className = "card-hall";
      div.innerHTML = `
        <img src="${escapeAttr(hall.image_url)}" alt="${escapeAttr(hall.name)}" loading="lazy" />
        <div class="body">
          <h3>${escapeHtml(hall.name)}</h3>
          <p class="muted">${escapeHtml(hall.description)}</p>
          <p class="muted-small">Up to ${hall.capacity} guests</p>
          <p class="price">From ₹${hall.base_price_per_day.toLocaleString("en-IN")} / day</p>
          <div class="card-actions">
            ${
              signedIn
                ? `<button type="button" class="btn btn-primary btn-sm" data-open="user">Book this hall</button>`
                : `<button type="button" class="btn btn-ghost btn-sm" data-open="register">Sign up to book</button>`
            }
          </div>
        </div>`;
      wrap.appendChild(div);
      $$("[data-open]", div).forEach((el) => {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          navigate(el.dataset.open);
        });
      });
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
            <thead><tr><th>Date</th><th>Hall</th><th>Guests</th><th>Discount</th><th>Total</th><th></th></tr></thead>
            <tbody>
              ${bookings
                .map((b) => {
                  const today = new Date();
                  const min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
                  const canCancel = b.event_date >= min;
                  return `
                <tr data-booking-id="${b.id}">
                  <td>${escapeHtml(b.event_date)}</td>
                  <td>${escapeHtml(b.hall_name)}</td>
                  <td>${b.guest_count}</td>
                  <td>${b.discount_pct ? `${b.discount_pct}% (${escapeHtml(b.discount_label || "")})` : "—"}</td>
                  <td>₹${Number(b.final_price).toLocaleString("en-IN")}</td>
                  <td>${
                    canCancel
                      ? `<button type="button" class="btn btn-ghost btn-sm btn-cancel-booking">Cancel</button>`
                      : ""
                  }</td>
                </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>`;
    }
    list.querySelectorAll(".btn-cancel-booking").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.closest("tr")?.dataset.bookingId);
        if (!id || !confirm("Cancel this booking? The date will become available again.")) return;
        try {
          await api(`/api/my/bookings/${id}`, { method: "DELETE" });
          toast("Booking cancelled.");
          await renderUserDashboard();
        } catch (e) {
          toast(e.message, "error");
        }
      });
    });
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
          toast("Pick an event date first.", "error");
          return;
        }
        try {
          await api("/api/my/bookings", {
            method: "POST",
            body: { hall_id: hall.id, event_date: d, guest_count: guests },
          });
          await renderUserDashboard();
          toast("Hall reserved successfully.");
          blk.querySelector(".btn-book").textContent = "Booked!";
          setTimeout(() => {
            blk.querySelector(".btn-book").textContent = "Reserve this hall";
          }, 2200);
        } catch (e) {
          toast(e.message, "error");
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
      <div class="stat-grid">
        <div class="stat-card"><div class="value">${data.stats.userCount}</div><div class="label">Guests</div></div>
        <div class="stat-card"><div class="value">${data.stats.bookingCount}</div><div class="label">Bookings</div></div>
        <div class="stat-card"><div class="value">${data.stats.staffCount}</div><div class="label">Staff</div></div>
        <div class="stat-card"><div class="value">${data.stats.recentlyActiveCount}</div><div class="label">Active now</div></div>
      </div>
      <p class="muted-small" style="margin-bottom:1rem">
        “Active now” = signed in within the last ~15 minutes.
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
          <div class="panel" style="max-width:none;margin-bottom:1rem">
            <h3 style="font-family:var(--font-display);margin:0 0 .75rem;font-size:1.2rem">Change my password</h3>
            <form id="form-change-password-staff">
              <div class="field"><label>Current password</label><input id="cp-current-staff" type="password" required /></div>
              <div class="field"><label>New password</label><input id="cp-new-staff" type="password" required /></div>
              <button class="btn btn-ghost" type="submit">Update password</button>
              <p id="cp-msg-staff" class="muted-small" style="margin-top:.75rem"></p>
            </form>
          </div>
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

    $("#form-change-password-staff")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      $("#cp-msg-staff").textContent = "";
      try {
        await api("/api/me/change-password", {
          method: "POST",
          body: {
            current_password: $("#cp-current-staff").value,
            new_password: $("#cp-new-staff").value,
          },
        });
        $("#cp-msg-staff").textContent = "Password updated.";
        $("#cp-current-staff").value = "";
        $("#cp-new-staff").value = "";
      } catch (e) {
        $("#cp-msg-staff").textContent = e.message;
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
          toast(e.message, "error");
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

  $("#nav-toggle")?.addEventListener("click", () => {
    const menu = $("#nav-menu");
    const toggle = $("#nav-toggle");
    const open = menu?.classList.toggle("open");
    toggle?.setAttribute("aria-expanded", open ? "true" : "false");
  });

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

  $("#form-change-password-user")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#cp-msg-user").className = "msg hidden";
    try {
      await api("/api/me/change-password", {
        method: "POST",
        body: {
          current_password: $("#cp-current-user").value,
          new_password: $("#cp-new-user").value,
        },
      });
      $("#cp-msg-user").textContent = "Password changed successfully.";
      $("#cp-msg-user").className = "msg msg-success";
      $("#cp-current-user").value = "";
      $("#cp-new-user").value = "";
    } catch (err) {
      $("#cp-msg-user").textContent = err.message;
      $("#cp-msg-user").className = "msg msg-error";
    }
  });

  $("#form-forgot-password")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#forgot-msg").className = "msg hidden";
    try {
      const out = await api("/api/auth/forgot-password", {
        method: "POST",
        body: {
          email: $("#fp-email").value,
          phone: $("#fp-phone").value,
        },
      });
      $("#fp-token").value = out.reset_token || "";
      $("#forgot-msg").textContent =
        "Reset token generated. Copy it now and submit new password below.";
      $("#forgot-msg").className = "msg msg-success";
    } catch (err) {
      $("#forgot-msg").textContent = err.message;
      $("#forgot-msg").className = "msg msg-error";
    }
  });

  $("#form-reset-password")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#forgot-msg").className = "msg hidden";
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: {
          token: $("#fp-token").value,
          new_password: $("#fp-new-pass").value,
        },
      });
      $("#forgot-msg").textContent =
        "Password reset done. You can sign in with your new password.";
      $("#forgot-msg").className = "msg msg-success";
      $("#fp-new-pass").value = "";
    } catch (err) {
      $("#forgot-msg").textContent = err.message;
      $("#forgot-msg").className = "msg msg-error";
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
