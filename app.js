/* Clinic Queue System Web v1.4. Server-backed JSON persistence with browser cache fallback. */
(() => {
  "use strict";
  const KEY = "clinic_queue_data_v13",
    USERS_KEY = "clinic_queue_users_v13",
    SESSION_KEY = "clinic_queue_session_v13";
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const now = () => new Date(),
    pad = (n) => String(n).padStart(3, "0"),
    today = () => {
      const d = now();
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    },
    pad2 = (n) => String(n).padStart(2, "0"),
    timeNow = () =>
      now().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    dateTime = () => now().toLocaleString();
  const id = () =>
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const defaults = () => ({
    settings: {
      clinicName: "ABC Clinic",
      currency: "Rs",
      footer: "Please wait for your turn",
      timezone: "Asia/Karachi",
      ticketFormat: "CODE###",
      autoShift: "yes",
    },
    departments: [
      {
        id: "dep-g",
        code: "G",
        name: "General OPD",
        defaultPrice: 500,
        description: "General consultation",
        active: true,
      },
      {
        id: "dep-c",
        code: "C",
        name: "Consultant OPD",
        defaultPrice: 1500,
        description: "Consultant clinic",
        active: true,
      },
      {
        id: "dep-e",
        code: "E",
        name: "ENT OPD",
        defaultPrice: 800,
        description: "ENT clinic",
        active: true,
      },
    ],
    doctors: [
      {
        id: "doc-1",
        name: "Dr. Ahmed",
        specialization: "General Physician",
        departmentIds: ["dep-g"],
        defaultPrice: 500,
        roomNumber: "1",
        active: true,
      },
      {
        id: "doc-2",
        name: "Dr. Sara",
        specialization: "Consultant",
        departmentIds: ["dep-c"],
        defaultPrice: 1500,
        roomNumber: "2",
        active: true,
      },
    ],
    shifts: [
      {
        id: "shift-m",
        name: "Morning",
        startTime: "08:00",
        endTime: "14:00",
        active: true,
      },
      {
        id: "shift-e",
        name: "Evening",
        startTime: "14:00",
        endTime: "20:00",
        active: true,
      },
    ],
    counters: [
      {
        id: "counter-1",
        name: "Counter 01",
        location: "Main Reception",
        printerId: "",
        active: true,
      },
    ],
    printers: [
      {
        id: "printer-1",
        name: "Default Windows Printer",
        systemName: "",
        paperWidth: "80mm",
        active: true,
      },
    ],
    tickets: [],
    audit: [],
  });
  function loadData() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const d = JSON.parse(raw);
      return {
        ...defaults(),
        ...d,
        settings: { ...defaults().settings, ...(d.settings || {}) },
      };
    } catch (e) {
      return defaults();
    }
  }
  let data = loadData(),
    users = loadUsers(),
    currentUser = null,
    currentPage = "reception",
    editing = { type: null, id: null },
    previewTicket = null,
    restoreCandidate = null;
  function loadUsers() {
    try {
      const raw = localStorage.getItem(USERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch (e) {}
    const initial = [
      {
        id: "user-admin",
        username: "admin",
        password: "admin123",
        fullName: "Administrator",
        role: "ADMIN",
        active: true,
      },
    ];
    localStorage.setItem(USERS_KEY, JSON.stringify(initial));
    return initial;
  }
  let saveQueue = Promise.resolve();
  function saveData() {
    const snapshot = JSON.stringify(data);
    try {
      localStorage.setItem(KEY, snapshot);
    } catch (e) {}
    saveQueue = saveQueue.then(() =>
      fetch("/api/data", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: snapshot,
      }).catch((e) => console.warn("Permanent JSON save failed:", e)),
    );
    updateStorageUsage();
  }
  function saveUsers() {
    const snapshot = JSON.stringify(users);
    try {
      localStorage.setItem(USERS_KEY, snapshot);
    } catch (e) {}
    saveQueue = saveQueue.then(() =>
      fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: snapshot,
      }).catch((e) => console.warn("Users JSON save failed:", e)),
    );
    updateStorageUsage();
  }
  function audit(action, entity, details) {
    data.audit.unshift({
      id: id(),
      at: dateTime(),
      date: today(),
      user: currentUser?.username || "system",
      action,
      entity,
      details,
    });
    if (data.audit.length > 5000) data.audit.length = 5000;
    saveData();
  }
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add("hidden"), 3000);
  }
  function fmtMoney(n) {
    return `${data.settings.currency || "Rs"} ${Number(n || 0).toLocaleString()}`;
  }
  function activeRows(type) {
    return (data[type] || []).filter((x) => x.active !== false);
  }
  function nameBy(type, recordId, field = "name") {
    return (data[type] || []).find((x) => x.id === recordId)?.[field] || "";
  }
  function codeForDepartment(departmentId) {
    return nameBy("departments", departmentId, "code") || "Q";
  }
  function ticketNumberFor(departmentId, shiftId, date = today()) {
    const dep = data.departments.find((x) => x.id === departmentId);
    if (!dep) return "---";
    let max = 0;
    data.tickets.forEach((t) => {
      if (
        t.date === date &&
        t.departmentId === departmentId &&
        t.shiftId === shiftId
      ) {
        max = Math.max(max, Number(t.sequence) || 0);
      }
    });
    const n = pad(max + 1);
    return data.settings.ticketFormat === "CODE-###"
      ? `${dep.code}-${n}`
      : `${dep.code}${n}`;
  }
  function timeToMin(v) {
    if (!/^\d{2}:\d{2}$/.test(v || "")) return -1;
    const [h, m] = v.split(":").map(Number);
    return h * 60 + m;
  }
  function currentShift() {
    const active = activeRows("shifts");
    const mins = now().getHours() * 60 + now().getMinutes();
    return (
      active.find((s) => {
        let a = timeToMin(s.startTime),
          b = timeToMin(s.endTime);
        return (
          a >= 0 &&
          b >= 0 &&
          (a <= b ? mins >= a && mins < b : mins >= a || mins < b)
        );
      }) || active[0]
    );
  }
  function selectedShift() {
    if (data.settings.autoShift === "yes") {
      const s = currentShift();
      if (s) return s.id;
    }
    return $("ticketShift")?.value || activeRows("shifts")[0]?.id || "";
  }
  function setOptions(el, rows, valueFn, labelFn, placeholder) {
    if (!el) return;
    const old = el.value;
    el.innerHTML =
      (placeholder !== undefined
        ? `<option value="">${esc(placeholder)}</option>`
        : "") +
      rows
        .map(
          (r) =>
            `<option value="${esc(valueFn(r))}">${esc(labelFn(r))}</option>`,
        )
        .join("");
    if (rows.some((r) => String(valueFn(r)) === old)) el.value = old;
    else if (rows.length) el.value = valueFn(rows[0]);
  }
  function populateSelectors() {
    setOptions(
      $("ticketDepartment"),
      activeRows("departments"),
      (x) => x.id,
      (x) => `${x.code} — ${x.name}`,
    );
    setOptions(
      $("ticketShift"),
      activeRows("shifts"),
      (x) => x.id,
      (x) => `${x.name} (${x.startTime}–${x.endTime})`,
    );
    setOptions(
      $("ticketCounter"),
      activeRows("counters"),
      (x) => x.id,
      (x) => x.name,
    );
    setOptions(
      $("reportDepartment"),
      activeRows("departments"),
      (x) => x.id,
      (x) => x.name,
      "All departments",
    );
    refreshDoctors();
    refreshPrice();
    if (data.settings.autoShift === "yes" && currentShift())
      $("ticketShift").value = currentShift().id;
    updateNextTicket();
  }
  function refreshDoctors() {
    const depId = $("ticketDepartment")?.value;
    const rows = activeRows("doctors").filter(
      (d) =>
        !Array.isArray(d.departmentIds) ||
        d.departmentIds.length === 0 ||
        d.departmentIds.includes(depId),
    );
    setOptions(
      $("ticketDoctor"),
      rows,
      (x) => x.id,
      (x) => x.name,
      "No specific doctor",
    );
  }
  function refreshPrice() {
    const dep = data.departments.find(
      (d) => d.id === $("ticketDepartment")?.value,
    );
    const doc = data.doctors.find((d) => d.id === $("ticketDoctor")?.value);
    if ($("ticketPrice"))
      $("ticketPrice").value =
        doc && Number(doc.defaultPrice) >= 0
          ? doc.defaultPrice
          : (dep?.defaultPrice ?? 0);
  }
  function updateNextTicket() {
    if (!$("nextTicketNumber")) return;
    const dep = data.departments.find(
        (d) => d.id === $("ticketDepartment").value,
      ),
      shiftId = selectedShift(),
      shift = data.shifts.find((s) => s.id === shiftId),
      counter = data.counters.find((c) => c.id === $("ticketCounter").value);
    $("nextTicketNumber").textContent = dep
      ? ticketNumberFor(dep.id, shiftId)
      : "---";
    $("nextTicketDepartment").textContent = dep?.name || "Select department";
    $("nextTicketShift").textContent = shift
      ? `${shift.name} shift`
      : "No shift";
    $("nextTicketCounter").textContent = counter?.name || "No counter";
  }
  function renderShell() {
    if (!currentUser) {
      $("loginScreen").classList.remove("hidden");
      $("appShell").classList.add("hidden");
      return;
    }
    $("loginScreen").classList.add("hidden");
    $("appShell").classList.remove("hidden");
    $("sideClinicName").textContent = data.settings.clinicName;
    $("currentUserName").textContent = currentUser.fullName;
    $("currentUserRole").textContent = currentUser.role;
    $("userAvatar").textContent = (currentUser.fullName || currentUser.username)
      .slice(0, 1)
      .toUpperCase();
    document
      .querySelectorAll(".admin-only")
      .forEach((el) =>
        el.classList.toggle("hidden", currentUser.role !== "ADMIN"),
      );
    goPage(currentPage);
    populateSelectors();
    renderRecent();
    renderTickets();
    updateHeader();
  }
  function goPage(page) {
    if (
      [
        "departments",
        "doctors",
        "shifts",
        "counters",
        "printers",
        "users",
      ].includes(page) &&
      currentUser?.role !== "ADMIN"
    ) {
      toast("Administrator access required.");
      page = "reception";
    }
    currentPage = page;
    document
      .querySelectorAll(".page")
      .forEach((p) => p.classList.remove("active"));
    const target = $(`page-${page}`) || $("page-admin");
    target.classList.add("active");
    document
      .querySelectorAll(".nav-item")
      .forEach((b) => b.classList.toggle("active", b.dataset.page === page));
    const titles = {
      reception: ["FRONT DESK", "Reception"],
      tickets: ["RECORDS", "Ticket history"],
      departments: ["ADMINISTRATION", "Departments"],
      doctors: ["ADMINISTRATION", "Doctors"],
      shifts: ["ADMINISTRATION", "Shifts"],
      counters: ["ADMINISTRATION", "Counters"],
      printers: ["ADMINISTRATION", "Printers"],
      users: ["ADMINISTRATION", "Users & roles"],
      settings: ["ADMINISTRATION", "Clinic settings"],
      reports: ["ANALYTICS", "Reports & export"],
      audit: ["SECURITY", "Audit log"],
      backup: ["DATA MANAGEMENT", "Backup & restore"],
    };
    const [ey, title] = titles[page] || ["ADMINISTRATION", "Manage records"];
    $("pageEyebrow").textContent = ey;
    $("pageTitle").textContent = title;
    if (
      [
        "departments",
        "doctors",
        "shifts",
        "counters",
        "printers",
        "users",
      ].includes(page)
    )
      renderCrud(page);
    if (page === "settings") fillSettings();
    if (page === "reports") runReport();
    if (page === "audit") renderAudit();
    if (page === "backup") updateStorageUsage();
  }
  function updateHeader() {
    const d = now();
    $("todayClock").textContent =
      d.toLocaleDateString() +
      " · " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    $("todayDate").textContent = d.toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    $("issuedToday").textContent = data.tickets.filter(
      (t) => t.date === today() && t.status !== "VOID",
    ).length;
    $("revenueToday").textContent = fmtMoney(
      data.tickets
        .filter((t) => t.date === today() && t.status !== "VOID")
        .reduce((s, t) => s + Number(t.price || 0), 0),
    );
  }
  const configs = {
    departments: {
      title: "Departments",
      desc: "Manage clinic departments and their default fees.",
      fields: [
        ["code", "Code", "text", true],
        ["name", "Department name", "text", true],
        ["defaultPrice", "Default fee (PKR)", "number", true],
        ["description", "Description", "text", false],
        ["active", "Active", "checkbox", false],
      ],
      cols: [
        ["code", "Code"],
        ["name", "Department"],
        ["defaultPrice", "Fee"],
        ["description", "Description"],
        ["active", "Status"],
      ],
    },
    doctors: {
      title: "Doctors",
      desc: "Manage doctors and their department assignments.",
      fields: [
        ["name", "Doctor name", "text", true],
        ["specialization", "Specialization", "text", false],
        ["roomNumber", "Room number", "text", false],
        ["defaultPrice", "Default fee (PKR)", "number", true],
        ["departmentIds", "Departments", "multiselect", false],
        ["active", "Active", "checkbox", false],
      ],
      cols: [
        ["name", "Doctor"],
        ["specialization", "Specialization"],
        ["roomNumber", "Room"],
        ["departmentIds", "Departments"],
        ["defaultPrice", "Fee"],
        ["active", "Status"],
      ],
    },
    shifts: {
      title: "Shifts",
      desc: "Shift changes reset numbering automatically for each department.",
      fields: [
        ["name", "Shift name", "text", true],
        ["startTime", "Start time", "time", true],
        ["endTime", "End time", "time", true],
        ["active", "Active", "checkbox", false],
      ],
      cols: [
        ["name", "Shift"],
        ["startTime", "Starts"],
        ["endTime", "Ends"],
        ["active", "Status"],
      ],
    },
    counters: {
      title: "Counters",
      desc: "Manage reception counters and printer assignment.",
      fields: [
        ["name", "Counter name", "text", true],
        ["location", "Location", "text", false],
        ["printerId", "Assigned printer", "select-printer", false],
        ["active", "Active", "checkbox", false],
      ],
      cols: [
        ["name", "Counter"],
        ["location", "Location"],
        ["printerId", "Printer"],
        ["active", "Status"],
      ],
    },
    printers: {
      title: "Printers",
      desc: "Set up installed printer names for the browser print dialog.",
      fields: [
        ["name", "Display name", "text", true],
        ["systemName", "Windows/browser printer name", "text", false],
        ["paperWidth", "Paper width", "select-paper", true],
        ["active", "Active", "checkbox", false],
      ],
      cols: [
        ["name", "Printer"],
        ["systemName", "System printer"],
        ["paperWidth", "Paper"],
        ["active", "Status"],
      ],
    },
    users: {
      title: "Users & roles",
      desc: "User accounts are stored separately in the browser and can be exported to users.json.",
      fields: [
        ["username", "Username", "text", true],
        ["fullName", "Full name", "text", true],
        [
          "password",
          "Password (leave blank to keep existing)",
          "password",
          false,
        ],
        ["role", "Role", "select-role", true],
        ["active", "Active", "checkbox", false],
      ],
      cols: [
        ["username", "Username"],
        ["fullName", "Full name"],
        ["role", "Role"],
        ["active", "Status"],
      ],
    },
  };
  function displayValue(type, row, key) {
    let v = row[key];
    if (key === "active")
      return v === false
        ? '<span class="status VOID">Inactive</span>'
        : '<span class="status">Active</span>';
    if (type === "doctors" && key === "departmentIds")
      return (
        (v || [])
          .map((x) => nameBy("departments", x))
          .filter(Boolean)
          .join(", ") || "All departments"
      );
    if (type === "counters" && key === "printerId")
      return nameBy("printers", v) || "Not assigned";
    if (key === "defaultPrice") return fmtMoney(v);
    return esc(v ?? "—");
  }
  function renderCrud(type) {
    const cfg = configs[type];
    $("crudTitle").textContent = cfg.title;
    $("crudDescription").textContent = cfg.desc;
    $("addRecordBtn").textContent =
      `＋ Add ${type === "doctors" ? "doctor" : type.slice(0, -1)}`;
    $("userFileTools").classList.toggle("hidden", type !== "users");
    $("crudTableHead").innerHTML =
      `<tr>${cfg.cols.map((c) => `<th>${esc(c[1])}</th>`).join("")}<th>Actions</th></tr>`;
    const q = ($("crudSearch").value || "").toLowerCase();
    let rows = (type === "users" ? users : data[type]).filter((r) =>
      JSON.stringify(r).toLowerCase().includes(q),
    );
    $("crudCount").textContent = `${rows.length} record(s)`;
    $("crudTableBody").innerHTML =
      rows
        .map(
          (r) =>
            `<tr>${cfg.cols.map((c) => `<td>${displayValue(type, r, c[0])}</td>`).join("")}<td><div class="table-actions"><button data-edit="${esc(r.id)}">Edit</button><button data-toggle="${esc(r.id)}">${r.active === false ? "Activate" : "Deactivate"}</button>${type === "users" && r.username !== "admin" ? `<button data-delete-user="${esc(r.id)}">Delete</button>` : ""}</div></td></tr>`,
        )
        .join("") ||
      `<tr><td colspan="${cfg.cols.length + 1}" class="empty-state">No records found.</td></tr>`;
    $("crudTableBody")
      .querySelectorAll("[data-edit]")
      .forEach((b) => (b.onclick = () => openRecord(type, b.dataset.edit)));
    $("crudTableBody")
      .querySelectorAll("[data-toggle]")
      .forEach((b) => (b.onclick = () => toggleRecord(type, b.dataset.toggle)));
    $("crudTableBody")
      .querySelectorAll("[data-delete-user]")
      .forEach((b) => (b.onclick = () => deleteUser(b.dataset.deleteUser)));
  }
  function fieldControl(type, field, label, kind, required, value) {
    const val = value ?? (kind === "checkbox" ? true : "");
    const req = required ? "required" : "";
    if (kind === "checkbox")
      return `<label class="wide"><input name="${field}" type="checkbox" ${val ? "checked" : ""} style="width:auto;margin-right:8px">${esc(label)}</label>`;
    if (kind === "multiselect")
      return `<label class="wide">${esc(label)}<select name="${field}" multiple size="${Math.min(5, Math.max(2, activeRows("departments").length))}">${activeRows(
        "departments",
      )
        .map(
          (d) =>
            `<option value="${esc(d.id)}" ${(Array.isArray(val) ? val : []).includes(d.id) ? "selected" : ""}>${esc(d.name)}</option>`,
        )
        .join(
          "",
        )}</select><small class="muted">Use Ctrl to select multiple departments. Leave empty for all departments.</small></label>`;
    if (kind === "select-role")
      return `<label>${esc(label)}<select name="${field}" ${req}><option value="ADMIN" ${val === "ADMIN" ? "selected" : ""}>ADMIN</option><option value="SUPERVISOR" ${val === "SUPERVISOR" ? "selected" : ""}>SUPERVISOR</option><option value="RECEPTIONIST" ${!val || val === "RECEPTIONIST" ? "selected" : ""}>RECEPTIONIST</option></select></label>`;
    if (kind === "select-printer")
      return `<label>${esc(label)}<select name="${field}"><option value="">Not assigned</option>${activeRows(
        "printers",
      )
        .map(
          (p) =>
            `<option value="${esc(p.id)}" ${val === p.id ? "selected" : ""}>${esc(p.name)}</option>`,
        )
        .join("")}</select></label>`;
    if (kind === "select-paper")
      return `<label>${esc(label)}<select name="${field}" ${req}><option ${val === "58mm" ? "selected" : ""}>58mm</option><option ${!val || val === "80mm" ? "selected" : ""}>80mm</option><option ${val === "A4" ? "selected" : ""}>A4</option></select></label>`;
    const inputType =
      kind === "number"
        ? "number"
        : kind === "time"
          ? "time"
          : kind === "password"
            ? "password"
            : kind === "text"
              ? "text"
              : "text";
    const placeholder =
      field === "password" && editing.id
        ? "Leave blank to keep current password"
        : "";
    return `<label>${esc(label)}<input name="${field}" type="${inputType}" value="${kind === "password" ? "" : esc(val)}" ${req} ${kind === "number" ? 'min="0" step="1"' : ""} placeholder="${esc(placeholder)}"></label>`;
  }
  function openRecord(type, recordId = null) {
    editing = { type, id: recordId };
    const cfg = configs[type],
      rows = type === "users" ? users : data[type],
      row = rows.find((r) => r.id === recordId) || {};
    $("recordModalTitle").textContent =
      `${recordId ? "Edit" : "Add"} ${type === "users" ? "user" : type === "doctors" ? "doctor" : type.slice(0, -1)}`;
    $("recordFields").innerHTML = cfg.fields
      .map((f) => fieldControl(type, f[0], f[1], f[2], f[3], row[f[0]]))
      .join("");
    $("recordModal").classList.remove("hidden");
  }
  function closeRecord() {
    $("recordModal").classList.add("hidden");
    editing = { type: null, id: null };
  }
  function saveRecord(ev) {
    ev.preventDefault();
    const { type, id: rid } = editing;
    if (!type) return;
    const cfg = configs[type],
      fd = new FormData($("recordForm")),
      obj = {};
    for (const f of cfg.fields) {
      const [key, label, kind] = f;
      if (kind === "checkbox") obj[key] = $("recordForm").elements[key].checked;
      else if (kind === "multiselect")
        obj[key] = Array.from(
          $("recordForm").elements[key].selectedOptions,
        ).map((o) => o.value);
      else if (kind === "number") obj[key] = Number(fd.get(key) || 0);
      else obj[key] = String(fd.get(key) || "").trim();
    }
    if (type === "users") {
      obj.username = obj.username.toLowerCase();
      if (!/^[a-z0-9._-]{3,32}$/.test(obj.username)) {
        toast(
          "Username must be 3–32 characters: letters, numbers, dot, underscore or hyphen.",
        );
        return;
      }
      if (
        users.some(
          (u) => u.username.toLowerCase() === obj.username && u.id !== rid,
        )
      ) {
        toast("That username already exists.");
        return;
      }
      const existing = users.find((u) => u.id === rid);
      if (existing && !obj.password) delete obj.password;
      if (!existing && !obj.password) {
        toast("A password is required for a new user.");
        return;
      }
      if (obj.password && obj.password.length < 6) {
        toast("Use a password of at least 6 characters.");
        return;
      }
      if (existing && existing.username === "admin" && obj.role !== "ADMIN") {
        toast("The primary admin account must remain ADMIN.");
        return;
      }
      if (
        !obj.active &&
        existing &&
        existing.username === currentUser.username
      ) {
        toast("You cannot deactivate your own account.");
        return;
      }
      const final = { ...(existing || {}), ...obj, id: rid || idgen("user") };
      if (!obj.password) final.password = existing.password;
      users = existing
        ? users.map((u) => (u.id === rid ? final : u))
        : [...users, final];
      saveUsers();
      audit(
        existing ? "UPDATE_USER" : "CREATE_USER",
        final.username,
        `Role ${final.role}`,
      );
    } else {
      if (type === "departments") {
        obj.code = obj.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (!obj.code) {
          toast("Department code is required.");
          return;
        }
        if (data.departments.some((d) => d.code === obj.code && d.id !== rid)) {
          toast("Department code must be unique.");
          return;
        }
      }
      if (type === "shifts" && obj.startTime === obj.endTime) {
        toast("Shift start and end times cannot be identical.");
        return;
      }
      const existing = data[type].find((r) => r.id === rid);
      const final = {
        ...(existing || {}),
        ...obj,
        id: rid || idgen(type.slice(0, -1)),
        createdAt: existing?.createdAt || dateTime(),
        updatedAt: dateTime(),
      };
      data[type] = existing
        ? data[type].map((r) => (r.id === rid ? final : r))
        : [...data[type], final];
      saveData();
      audit(
        existing ? "UPDATE_RECORD" : "CREATE_RECORD",
        type,
        `${final.name || final.username || final.code || final.id}`,
      );
    }
    closeRecord();
    renderCrud(type);
    populateSelectors();
    renderRecent();
    toast("Record saved.");
  }
  function idgen(prefix) {
    return `${prefix}-${id()}`;
  }
  function toggleRecord(type, rid) {
    if (type === "users") {
      const u = users.find((x) => x.id === rid);
      if (!u) return;
      if (u.username === "admin") {
        toast("The primary admin account cannot be deactivated.");
        return;
      }
      if (u.username === currentUser.username) {
        toast("You cannot deactivate your own account.");
        return;
      }
      u.active = u.active === false;
      saveUsers();
      audit(
        u.active ? "ACTIVATE_USER" : "DEACTIVATE_USER",
        u.username,
        "Account status changed",
      );
    } else {
      const r = data[type].find((x) => x.id === rid);
      if (!r) return;
      r.active = r.active === false;
      saveData();
      audit(
        r.active ? "ACTIVATE_RECORD" : "DEACTIVATE_RECORD",
        type,
        r.name || r.code || rid,
      );
    }
    renderCrud(type);
    populateSelectors();
    toast("Record status updated.");
  }
  function deleteUser(rid) {
    const u = users.find((x) => x.id === rid);
    if (!u || u.username === "admin") return;
    if (u.username === currentUser.username) {
      toast("You cannot delete your own account.");
      return;
    }
    if (!confirm(`Permanently delete user ${u.username}?`)) return;
    users = users.filter((x) => x.id !== rid);
    saveUsers();
    audit("DELETE_USER", u.username, "User permanently deleted");
    renderCrud("users");
    toast("User deleted.");
  }
  function issueTicket(doPrint = true) {
    const dep = data.departments.find(
        (d) => d.id === $("ticketDepartment").value,
      ),
      shift = data.shifts.find((s) => s.id === selectedShift()),
      counter = data.counters.find((c) => c.id === $("ticketCounter").value),
      doctor = data.doctors.find((d) => d.id === $("ticketDoctor").value),
      price = Number($("ticketPrice").value);
    if (!dep || !shift || !counter || !Number.isFinite(price) || price < 0) {
      toast("Select a department, shift, counter and valid fee.");
      return null;
    }
    const sequence = Number(
        ticketNumberFor(dep.id, shift.id).match(/(\d{3})$/)?.[1] || 1,
      ),
      date = today(),
      t = {
        id: id(),
        number:
          data.settings.ticketFormat === "CODE-###"
            ? `${dep.code}-${pad(sequence)}`
            : `${dep.code}${pad(sequence)}`,
        sequence,
        date,
        time: now().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        departmentId: dep.id,
        department: dep.name,
        departmentCode: dep.code,
        doctorId: doctor?.id || "",
        doctor: doctor?.name || "",
        shiftId: shift.id,
        shift: shift.name,
        counterId: counter.id,
        counter: counter.name,
        price,
        reference: $("patientReference").value.trim(),
        status: "PRINTED",
        prints: 0,
        issuedBy: currentUser.username,
        createdAt: dateTime(),
      };
    data.tickets.push(t);
    audit(
      "ISSUE_TICKET",
      t.number,
      `${dep.name}; ${shift.name}; ${fmtMoney(price)}`,
    );
    $("patientReference").value = "";
    renderRecent();
    renderTickets();
    updateHeader();
    updateNextTicket();
    if (doPrint) printTicket(t);
    else showPreview(t);
    return t;
  }
  function receiptHTML(t) {
    return `<div><strong>${esc(data.settings.clinicName)}</strong><div style="font-size:10px;margin-top:4px">QUEUE TICKET</div><div class="receipt-number">${esc(t.number)}</div><strong>${esc(t.department || nameBy("departments", t.departmentId))}</strong><hr><div class="receipt-row"><span>Date</span><span>${esc(t.date)}</span></div><div class="receipt-row"><span>Time</span><span>${esc(t.time)}</span></div><div class="receipt-row"><span>Shift</span><span>${esc(t.shift || nameBy("shifts", t.shiftId))}</span></div><div class="receipt-row"><span>Counter</span><span>${esc(t.counter || nameBy("counters", t.counterId))}</span></div>${t.doctor ? `<div class="receipt-row"><span>Doctor</span><span>${esc(t.doctor)}</span></div>` : ""}${t.reference ? `<div class="receipt-row"><span>Reference</span><span>${esc(t.reference)}</span></div>` : ""}<div class="receipt-row" style="font-weight:bold"><span>Fee</span><span>${esc(fmtMoney(t.price))}</span></div><hr><div style="font-size:11px">${esc(data.settings.footer || "")}</div></div>`;
  }
  function showPreview(t) {
    previewTicket = t;
    $("ticketPreview").innerHTML = receiptHTML(t);
    $("previewModal").classList.remove("hidden");
  }
  function printTicket(t) {
    previewTicket = t;
    $("ticketPreview").innerHTML = receiptHTML(t);
    $("previewModal").classList.remove("hidden");
    $("printPreviewBtn").focus();
  }
  function actualPrint() {
    if (!previewTicket) return;
    const t = previewTicket;
    const printRoot = document.createElement("div");
    printRoot.id = "printRoot";
    printRoot.className = "receipt";
    printRoot.innerHTML = receiptHTML(t);
    document.body.appendChild(printRoot);
    const cleanup = () => {
      if (printRoot.isConnected) printRoot.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    t.prints = (t.prints || 0) + 1;
    if (t.prints > 1) t.status = "REPRINTED";
    audit(
      t.prints > 1 ? "REPRINT_TICKET" : "PRINT_TICKET",
      t.number,
      `Print count ${t.prints}`,
    );
    saveData();
    renderTickets();
    renderRecent();
    $("previewModal").classList.add("hidden");
    toast("Print dialog opened. Select your thermal printer.");
    setTimeout(cleanup, 3000);
  }
  function showPreviewForForm() {
    const dep = data.departments.find(
        (d) => d.id === $("ticketDepartment").value,
      ),
      shift = data.shifts.find((s) => s.id === selectedShift()),
      counter = data.counters.find((c) => c.id === $("ticketCounter").value),
      doctor = data.doctors.find((d) => d.id === $("ticketDoctor").value);
    if (!dep || !shift || !counter) {
      toast("Select department, shift and counter first.");
      return;
    }
    showPreview({
      number: ticketNumberFor(dep.id, shift.id),
      date: today(),
      time: now().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      department: dep.name,
      departmentId: dep.id,
      doctor: doctor?.name || "",
      shift: shift.name,
      counter: counter.name,
      price: Number($("ticketPrice").value || 0),
      reference: $("patientReference").value.trim(),
    });
  }
  function renderRecent() {
    const rows = data.tickets.slice(-8).reverse();
    $("recentTicketsBody").innerHTML =
      rows
        .map(
          (t) =>
            `<tr><td class="ticket-code">${esc(t.number)}</td><td>${esc(t.department || "")}</td><td>${esc(t.doctor || "—")}</td><td>${esc(t.shift || "")}</td><td>${esc(t.time || "")}</td><td>${esc(fmtMoney(t.price))}</td><td><span class="status ${t.status === "VOID" ? "VOID" : ""}">${esc(t.status)}</span></td><td><button class="btn light small-btn" data-open-ticket="${t.id}">View</button></td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="8" class="empty-state">No tickets issued yet.</td></tr>';
    $("recentTicketsBody")
      .querySelectorAll("[data-open-ticket]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            goPage("tickets");
            $("ticketSearch").value =
              data.tickets.find((t) => t.id === b.dataset.openTicket)?.number ||
              "";
            renderTickets();
          }),
      );
  }
  function renderTickets() {
    if (!$("ticketsTableBody")) return;
    const q = ($("ticketSearch").value || "").toLowerCase(),
      status = $("ticketStatusFilter").value,
      date = $("ticketDateFilter").value;
    const rows = data.tickets
      .slice()
      .reverse()
      .filter(
        (t) =>
          (!q || JSON.stringify(t).toLowerCase().includes(q)) &&
          (status === "ALL" || t.status === status) &&
          (!date || t.date === date),
      );
    $("ticketsTableBody").innerHTML =
      rows
        .map(
          (t) =>
            `<tr><td class="ticket-code">${esc(t.number)}</td><td>${esc(t.date)} ${esc(t.time)}</td><td>${esc(t.department)}</td><td>${esc(t.doctor || "—")}</td><td>${esc(t.shift)}</td><td>${esc(t.counter)}</td><td>${esc(fmtMoney(t.price))}</td><td><span class="status ${t.status === "VOID" ? "VOID" : ""}">${esc(t.status)}</span></td><td>${t.prints || 0}</td><td><div class="table-actions"><button data-reprint="${t.id}">Reprint</button>${t.status !== "VOID" ? `<button data-void="${t.id}">Void</button>` : ""}</div></td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="10" class="empty-state">No matching tickets.</td></tr>';
    $("ticketsTableBody")
      .querySelectorAll("[data-reprint]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            const t = data.tickets.find((x) => x.id === b.dataset.reprint);
            if (t) showPreview(t);
          }),
      );
    $("ticketsTableBody")
      .querySelectorAll("[data-void]")
      .forEach((b) => (b.onclick = () => voidTicket(b.dataset.void)));
  }
  function voidTicket(tid) {
    const t = data.tickets.find((x) => x.id === tid);
    if (!t || t.status === "VOID") return;
    if (!confirm(`Void ticket ${t.number}? The record will remain in history.`))
      return;
    t.status = "VOID";
    audit("VOID_TICKET", t.number, "Ticket voided");
    saveData();
    renderTickets();
    renderRecent();
    updateHeader();
    toast("Ticket voided.");
  }
  function csvEscape(v) {
    const s = String(v ?? "");
    return `"${s.replace(/"/g, '""')}"`;
  }
  function downloadText(filename, text, type = "text/plain;charset=utf-8") {
    const blob = new Blob([text], { type }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportTickets(rows = data.tickets, filename = "clinic-tickets.csv") {
    const cols = [
      "number",
      "date",
      "time",
      "department",
      "doctor",
      "shift",
      "counter",
      "price",
      "status",
      "prints",
      "reference",
      "issuedBy",
    ];
    const csv = [
      cols.join(","),
      ...rows.map((t) => cols.map((k) => csvEscape(t[k])).join(",")),
    ].join("\r\n");
    downloadText(filename, "\ufeff" + csv, "text/csv;charset=utf-8");
    audit(
      "EXPORT_TICKETS",
      "tickets",
      `${rows.length} ticket records exported`,
    );
  }
  function fillSettings() {
    const s = data.settings;
    $("settingClinicName").value = s.clinicName || "";
    $("settingCurrency").value = s.currency || "Rs";
    $("settingFooter").value = s.footer || "";
    $("settingTimezone").value = s.timezone || "Asia/Karachi";
    $("settingTicketFormat").value = s.ticketFormat || "CODE###";
    $("settingAutoShift").value = s.autoShift || "yes";
  }
  function saveSettings(ev) {
    ev.preventDefault();
    data.settings = {
      ...data.settings,
      clinicName: $("settingClinicName").value.trim(),
      currency: $("settingCurrency").value.trim(),
      footer: $("settingFooter").value.trim(),
      timezone: $("settingTimezone").value.trim(),
      ticketFormat: $("settingTicketFormat").value,
      autoShift: $("settingAutoShift").value,
    };
    saveData();
    audit("UPDATE_SETTINGS", "settings", "Clinic settings updated");
    $("sideClinicName").textContent = data.settings.clinicName;
    populateSelectors();
    toast("Settings saved.");
  }
  function runReport() {
    const from = $("reportFrom").value || "0000-01-01",
      to = $("reportTo").value || "9999-12-31",
      dep = $("reportDepartment").value;
    const rows = data.tickets.filter(
      (t) =>
        t.date >= from &&
        t.date <= to &&
        (dep === "ALL" || t.departmentId === dep),
    );
    const valid = rows.filter((t) => t.status !== "VOID"),
      voids = rows.filter((t) => t.status === "VOID");
    $("reportTicketCount").textContent = rows.length;
    $("reportValidCount").textContent = valid.length;
    $("reportVoidCount").textContent = voids.length;
    $("reportRevenue").textContent = fmtMoney(
      valid.reduce((s, t) => s + Number(t.price || 0), 0),
    );
    const groups = {};
    rows.forEach((t) => {
      const k = t.department || "Unknown";
      groups[k] ??= { count: 0, voids: 0, revenue: 0 };
      groups[k].count++;
      if (t.status === "VOID") groups[k].voids++;
      else groups[k].revenue += Number(t.price || 0);
    });
    $("reportTableBody").innerHTML =
      Object.entries(groups)
        .map(
          ([name, g]) =>
            `<tr><td>${esc(name)}</td><td>${g.count}</td><td>${g.voids}</td><td>${esc(fmtMoney(g.revenue))}</td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="4" class="empty-state">No tickets in this period.</td></tr>';
    return rows;
  }
  function renderAudit() {
    const q = ($("auditSearch").value || "").toLowerCase(),
      rows = data.audit.filter((a) =>
        JSON.stringify(a).toLowerCase().includes(q),
      );
    $("auditTableBody").innerHTML =
      rows
        .slice(0, 1000)
        .map(
          (a) =>
            `<tr><td>${esc(a.at)}</td><td>${esc(a.user)}</td><td>${esc(a.action)}</td><td>${esc(a.entity)}</td><td>${esc(a.details)}</td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="5" class="empty-state">No audit records.</td></tr>';
  }
  function updateStorageUsage() {
    const bytes =
      new Blob([JSON.stringify(data)]).size +
      new Blob([JSON.stringify(users)]).size;
    $("storageUsage").textContent =
      `${(bytes / 1024).toFixed(1)} KB used · ${data.tickets.length} tickets · ${users.length} users`;
  }
  function downloadBackup() {
    const backup = {
      format: "clinic-queue-backup-v1",
      exportedAt: dateTime(),
      data,
      users,
    };
    downloadText(
      `clinic-queue-backup-${today()}.json`,
      JSON.stringify(backup, null, 2),
      "application/json",
    );
    audit("BACKUP_EXPORT", "backup", "Full JSON backup downloaded");
  }
  function restoreBackup() {
    if (!restoreCandidate) return;
    const obj = restoreCandidate;
    if (
      !obj.data ||
      !Array.isArray(obj.data.tickets) ||
      !Array.isArray(obj.users) ||
      !obj.users.some((u) => u.username === "admin")
    ) {
      toast("Invalid backup file or missing admin user.");
      return;
    }
    if (
      !confirm(
        "Restore this backup? Current clinic data and users will be replaced.",
      )
    )
      return;
    data = {
      ...defaults(),
      ...obj.data,
      settings: { ...defaults().settings, ...obj.data.settings },
    };
    users = obj.users;
    saveData();
    saveUsers();
    audit("BACKUP_RESTORE", "backup", "Data restored from JSON backup");
    restoreCandidate = null;
    $("restoreFileInput").value = "";
    $("restoreBackupBtn").disabled = true;
    populateSelectors();
    renderShell();
    toast("Backup restored successfully.");
  }
  function exportUsers() {
    downloadText(
      `users-${today()}.json`,
      JSON.stringify(
        { format: "clinic-users-v1", exportedAt: dateTime(), users },
        null,
        2,
      ),
      "application/json",
    );
    audit("EXPORT_USERS", "users", "Separate users JSON exported");
  }
  function importUsers(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result),
          arr = Array.isArray(parsed) ? parsed : parsed.users;
        if (!Array.isArray(arr) || !arr.some((u) => u.username === "admin"))
          throw new Error(
            "The file must contain a user list with an admin account.",
          );
        if (!arr.every((u) => u.username && u.password && u.role))
          throw new Error("Each user must have username, password and role.");
        if (!confirm("Import replaces the current user list. Continue?"))
          return;
        users = arr.map((u) => ({
          ...u,
          id: u.id || idgen("user"),
          active: u.active !== false,
          role: ["ADMIN", "SUPERVISOR", "RECEPTIONIST"].includes(u.role)
            ? u.role
            : "RECEPTIONIST",
        }));
        saveUsers();
        audit("IMPORT_USERS", "users", `${users.length} users imported`);
        renderCrud("users");
        toast("Users imported.");
      } catch (e) {
        toast(`Import failed: ${e.message}`);
      }
    };
    reader.readAsText(file);
  }
  $("loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const username = $("loginUsername").value.trim().toLowerCase(),
      password = $("loginPassword").value;
    const u = users.find(
      (x) =>
        x.username.toLowerCase() === username &&
        x.password === password &&
        x.active !== false,
    );
    if (!u) {
      $("loginError").textContent =
        "Incorrect username or password, or account is inactive.";
      return;
    }
    currentUser = u;
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ userId: u.id, at: Date.now() }),
    );
    $("loginError").textContent = "";
    audit("LOGIN", "users", `${u.username} signed in`);
    renderShell();
  });
  $("logoutBtn").onclick = () => {
    if (currentUser)
      audit("LOGOUT", "users", `${currentUser.username} signed out`);
    currentUser = null;
    sessionStorage.removeItem(SESSION_KEY);
    renderShell();
  };
  document
    .querySelectorAll(".nav-item")
    .forEach((b) => b.addEventListener("click", () => goPage(b.dataset.page)));
  document
    .querySelectorAll("[data-go]")
    .forEach((b) => b.addEventListener("click", () => goPage(b.dataset.go)));
  document.querySelectorAll("[data-page]").forEach((b) => {
    if (b.classList.contains("nav-item")) return;
  });
  $("ticketDepartment").addEventListener("change", () => {
    refreshDoctors();
    refreshPrice();
    updateNextTicket();
  });
  $("ticketDoctor").addEventListener("change", refreshPrice);
  $("ticketShift").addEventListener("change", updateNextTicket);
  $("ticketCounter").addEventListener("change", updateNextTicket);
  $("ticketForm").addEventListener("submit", (e) => {
    e.preventDefault();
    issueTicket(true);
  });
  $("previewTicketBtn").onclick = showPreviewForForm;
  $("printPreviewBtn").onclick = actualPrint;
  $("closePreviewModal").onclick = $("cancelPreviewBtn").onclick = () =>
    $("previewModal").classList.add("hidden");
  $("closeRecordModal").onclick = $("cancelRecordBtn").onclick = closeRecord;
  $("recordForm").addEventListener("submit", saveRecord);
  $("addRecordBtn").onclick = () => openRecord(currentPage);
  $("crudSearch").addEventListener("input", () => {
    if (configs[currentPage]) renderCrud(currentPage);
  });
  $("ticketSearch").addEventListener("input", renderTickets);
  $("ticketStatusFilter").addEventListener("change", renderTickets);
  $("ticketDateFilter").addEventListener("change", renderTickets);
  $("clearTicketFilters").onclick = () => {
    $("ticketSearch").value = "";
    $("ticketStatusFilter").value = "ALL";
    $("ticketDateFilter").value = "";
    renderTickets();
  };
  $("ticketsExportBtn").onclick = $("downloadCsvAllBtn").onclick = () =>
    exportTickets();
  $("reportExportBtn").onclick = () =>
    exportTickets(runReport(), `clinic-report-${today()}.csv`);
  $("runReportBtn").onclick = runReport;
  $("saveSettingsBtn").onclick = () => saveSettings({ preventDefault() {} });
  $("settingsForm").addEventListener("submit", saveSettings);
  $("auditSearch").addEventListener("input", renderAudit);
  $("auditExportBtn").onclick = () => {
    const rows = data.audit;
    const keys = ["at", "user", "action", "entity", "details"];
    downloadText(
      `clinic-audit-${today()}.csv`,
      [
        keys.join(","),
        ...rows.map((r) => keys.map((k) => csvEscape(r[k])).join(",")),
      ].join("\r\n"),
      "text/csv;charset=utf-8",
    );
  };
  $("downloadBackupBtn").onclick = downloadBackup;
  $("restoreFileInput").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) {
      restoreCandidate = null;
      $("restoreBackupBtn").disabled = true;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        restoreCandidate = JSON.parse(reader.result);
        $("restoreBackupBtn").disabled = false;
      } catch {
        restoreCandidate = null;
        $("restoreBackupBtn").disabled = true;
        toast("That is not valid JSON.");
      }
    };
    reader.readAsText(f);
  });
  $("restoreBackupBtn").onclick = restoreBackup;
  $("exportUsersJsonBtn").onclick = exportUsers;
  $("importUsersJsonInput").addEventListener("change", (e) => {
    if (e.target.files[0]) importUsers(e.target.files[0]);
    e.target.value = "";
  });
  // Keep shift/day sequences derived from existing tickets: date + shift + department. Each combination starts at 001.
  async function init() {
    // Permanent JSON files on the local server are authoritative; localStorage is only a fallback cache.
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (r.ok) {
        const state = await r.json();
        if (state.data && Array.isArray(state.data.tickets)) {
          data = {
            ...defaults(),
            ...state.data,
            settings: {
              ...defaults().settings,
              ...(state.data.settings || {}),
            },
          };
          try {
            localStorage.setItem(KEY, JSON.stringify(data));
          } catch {}
        }
        if (Array.isArray(state.users) && state.users.length) {
          users = state.users;
          try {
            localStorage.setItem(USERS_KEY, JSON.stringify(users));
          } catch {}
        }
      }
    } catch (e) {
      console.warn(
        "Using browser cache because local JSON service is unavailable.",
        e,
      );
    }
    try {
      const sess = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (sess && Date.now() - sess.at < 12 * 60 * 60 * 1000) {
        currentUser =
          users.find((u) => u.id === sess.userId && u.active !== false) || null;
        if (currentUser)
          sessionStorage.setItem(
            SESSION_KEY,
            JSON.stringify({ ...sess, at: Date.now() }),
          );
      } else sessionStorage.removeItem(SESSION_KEY);
    } catch {}
    if (!$("reportFrom").value) $("reportFrom").value = today();
    if (!$("reportTo").value) $("reportTo").value = today();
    populateSelectors();
    renderShell();
    setInterval(() => {
      updateHeader();
      if (data.settings.autoShift === "yes" && currentUser) {
        const s = currentShift();
        if (s && $("ticketShift").value !== s.id) {
          $("ticketShift").value = s.id;
          updateNextTicket();
        }
      }
    }, 1000);
    // Ask the server to take an idle snapshot after 30 seconds; the server also backs up periodically.
    let idleTimer;
    const markActivity = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => fetch("/api/backup/idle", { method: "POST" }).catch(() => {}),
        30000,
      );
    };
    ["pointerdown", "keydown", "mousemove", "touchstart"].forEach((ev) =>
      document.addEventListener(ev, markActivity, { passive: true }),
    );
    markActivity();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        fetch("/api/backup/idle", { method: "POST", keepalive: true }).catch(
          () => {},
        );
      }
    });
  }
  init();
})();
