(() => {
    "use strict";
    const DB_KEY = "clinicQueueWeb.v12";
    const $ = (id) => document.getElementById(id);
    const todayISO = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const nowTime = () => new Date().toLocaleTimeString([], {
        hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const stamp = () => new Date().toISOString();
    const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const escapeHTML = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c],);
    const money = (n) => `${state.settings.currency || "Rs"} ${Number(n || 0).toLocaleString("en-PK", {maximumFractionDigits: 2})}`;
    const defaults = () => ({
        settings: {
            clinicName: "ABC Clinic",
            currency: "Rs",
            footer: "Please wait for your turn",
            timezone: "Asia/Karachi",
            ticketFormat: "CODE###",
            autoShift: "yes",
        }, departments: [{
            id: uid(),
            code: "G",
            name: "General OPD",
            defaultPrice: 500,
            description: "General outpatient department",
            displayOrder: 1,
            active: true,
        }, {
            id: uid(),
            code: "C",
            name: "Consultant OPD",
            defaultPrice: 1500,
            description: "Consultant clinic",
            displayOrder: 2,
            active: true,
        }, {
            id: uid(),
            code: "E",
            name: "ENT OPD",
            defaultPrice: 800,
            description: "Ear, nose and throat",
            displayOrder: 3,
            active: true,
        },], doctors: [{
            id: uid(),
            name: "Dr. Ahmed",
            specialization: "General Physician",
            roomNumber: "1",
            departmentIds: [],
            defaultPrice: "",
            active: true,
        },], shifts: [{
            id: uid(), name: "Morning", startTime: "08:00", endTime: "14:00", active: true, displayOrder: 1,
        }, {
            id: uid(), name: "Evening", startTime: "14:00", endTime: "20:00", active: true, displayOrder: 2,
        },], counters: [{
            id: uid(), counterNumber: "01", name: "Main Reception", location: "Reception", printerId: "", active: true,
        },], printers: [{
            id: uid(),
            name: "Default Windows Printer",
            systemPrinterName: "",
            connectionType: "Windows printer",
            paperWidth: "80mm",
            active: true,
        },], users: [{
            id: uid(), username: "admin", password: "admin123", fullName: "Administrator", role: "ADMIN", active: true,
        },], tickets: [], audit: [], sequences: {},
    });
    let state, currentUser = null, currentPage = "reception", crudType = "departments", editingId = null,
        pendingRestore = null, previewTicketData = null;
    const crudConfig = {
        departments: {
            title: "Departments",
            desc: "Manage OPD departments and default ticket fees.",
            fields: [["code", "Department code", "text", true], ["name", "Department name", "text", true], ["defaultPrice", "Default fee (PKR)", "number", true], ["description", "Description", "text", false], ["displayOrder", "Display order", "number", false], ["active", "Active", "checkbox", false],],
            columns: [["code", "Code"], ["name", "Department"], ["defaultPrice", "Default fee"], ["description", "Description"], ["active", "Status"],],
        }, doctors: {
            title: "Doctors",
            desc: "Manage doctors and assign them to one or more departments.",
            fields: [["name", "Doctor name", "text", true], ["specialization", "Specialization", "text", false], ["roomNumber", "Room / room number", "text", false], ["departmentIds", "Assigned departments", "multiselect", false], ["defaultPrice", "Optional doctor-specific fee", "number", false], ["active", "Active", "checkbox", false],],
            columns: [["name", "Doctor"], ["specialization", "Specialization"], ["roomNumber", "Room"], ["departmentNames", "Departments"], ["active", "Status"],],
        }, shifts: {
            title: "Shifts",
            desc: "Configure shift times. Ticket sequences reset separately for each shift.",
            fields: [["name", "Shift name", "text", true], ["startTime", "Start time", "time", true], ["endTime", "End time", "time", true], ["displayOrder", "Display order", "number", false], ["active", "Active", "checkbox", false],],
            columns: [["name", "Shift"], ["startTime", "Starts"], ["endTime", "Ends"], ["displayOrder", "Order"], ["active", "Status"],],
        }, counters: {
            title: "Counters",
            desc: "Manage reception counters and their assigned printer.",
            fields: [["counterNumber", "Counter number", "text", true], ["name", "Counter name", "text", true], ["location", "Location", "text", false], ["printerId", "Assigned printer", "selectPrinters", false], ["active", "Active", "checkbox", false],],
            columns: [["counterNumber", "Number"], ["name", "Counter"], ["location", "Location"], ["printerName", "Printer"], ["active", "Status"],],
        }, printers: {
            title: "Printers",
            desc: "Configure the printer label and Windows printer name. Printing uses the browser print dialog.",
            fields: [["name", "Printer label", "text", true], ["systemPrinterName", "Windows printer name", "text", false], ["connectionType", "Connection type", "selectConnection", true], ["paperWidth", "Paper width", "selectPaper", true], ["active", "Active", "checkbox", false],],
            columns: [["name", "Label"], ["systemPrinterName", "Windows printer"], ["connectionType", "Connection"], ["paperWidth", "Paper"], ["active", "Status"],],
        }, users: {
            title: "Users & roles",
            desc: "Create and deactivate users. Local browser authentication is suitable for a single-device prototype only.",
            fields: [["username", "Username", "text", true], ["password", "Password (enter to change)", "password", false], ["fullName", "Full name", "text", true], ["role", "Role", "selectRole", true], ["active", "Active", "checkbox", false],],
            columns: [["username", "Username"], ["fullName", "Full name"], ["role", "Role"], ["active", "Status"],],
        },
    };

    function freshState() {
        return defaults();
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(DB_KEY);
            if (!raw) return freshState();
            const x = JSON.parse(raw);
            const d = freshState();
            return {
                ...d, ...x,
                settings: {...d.settings, ...x.settings},
                sequences: x.sequences || {},
                audit: x.audit || [],
                tickets: x.tickets || [],
            };
        } catch (e) {
            return freshState();
        }
    }

    state = loadState();

    function save() {
        try {
            localStorage.setItem(DB_KEY, JSON.stringify(state));
            updateStorageUsage();
        } catch (e) {
            toast("Could not save data. Browser storage may be full. Download a backup.", true,);
        }
    }

    function audit(action, entity, details) {
        state.audit.unshift({
            id: uid(), dateTime: stamp(), user: currentUser?.username || "system", action, entity, details,
        });
        if (state.audit.length > 5000) state.audit.length = 5000;
        save();
    }

    function toast(message, error = false) {
        const t = $("toast");
        t.textContent = message;
        t.classList.toggle("error-toast", error);
        t.classList.remove("hidden");
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => t.classList.add("hidden"), 3600);
    }

    function activeRows(type) {
        return (state[type] || []).filter((x) => x.active !== false);
    }

    function roleIsAdmin() {
        return currentUser && currentUser.role === "ADMIN";
    }

    function login(username, password) {
        return state.users.find((u) => u.username.toLowerCase() === username.toLowerCase() && u.password === password && u.active !== false,);
    }

    $("loginForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const u = login($("loginUsername").value.trim(), $("loginPassword").value);
        if (!u) {
            $("loginError").textContent = "Invalid username or password, or account is inactive.";
            return;
        }
        currentUser = u;
        $("loginError").textContent = "";
        $("loginScreen").classList.add("hidden");
        $("appShell").classList.remove("hidden");
        $("currentUserName").textContent = u.fullName || u.username;
        $("currentUserRole").textContent = u.role;
        $("userAvatar").textContent = (u.fullName || u.username)
            .slice(0, 1)
            .toUpperCase();
        document
            .querySelectorAll(".admin-only")
            .forEach((el) => el.classList.toggle("hidden", !roleIsAdmin()));
        audit("LOGIN", "User", `Signed in as ${u.username}`);
        renderAll();
        goPage("reception");
    });
    $("logoutBtn").addEventListener("click", () => {
        audit("LOGOUT", "User", `Signed out ${currentUser.username}`);
        currentUser = null;
        $("appShell").classList.add("hidden");
        $("loginScreen").classList.remove("hidden");
        $("loginPassword").value = "";
    });

    function goPage(page) {
        if (["departments", "doctors", "shifts", "counters", "printers", "users", "settings", "reports", "audit", "backup",].includes(page) && !roleIsAdmin()) {
            toast("Administrator access required.", true);
            return;
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
            reception: "Reception",
            tickets: "Ticket history",
            departments: "Departments",
            doctors: "Doctors",
            shifts: "Shifts",
            counters: "Counters",
            printers: "Printers",
            users: "Users & roles",
            settings: "Clinic settings",
            reports: "Reports & export",
            audit: "Audit log",
            backup: "Backup & restore",
        };
        $("pageTitle").textContent = titles[page] || "Administration";
        $("pageEyebrow").textContent = page === "reception" ? "FRONT DESK" : page === "tickets" ? "QUEUE RECORDS" : "ADMINISTRATION";
        if (crudConfig[page]) {
            crudType = page;
            renderCrud();
        }
        if (page === "tickets") renderTickets();
        if (page === "settings") fillSettings();
        if (page === "reports") runReport();
        if (page === "audit") renderAudit();
        if (page === "backup") updateStorageUsage();
    }

    document
        .querySelectorAll("[data-page]")
        .forEach((b) => b.addEventListener("click", () => goPage(b.dataset.page)));
    document
        .querySelectorAll("[data-go]")
        .forEach((b) => b.addEventListener("click", () => goPage(b.dataset.go)));

    function shiftNow() {
        const t = new Date();
        const now = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
        return (activeRows("shifts").find((s) => s.startTime <= s.endTime ? now >= s.startTime && now < s.endTime : now >= s.startTime || now < s.endTime,) || null);
    }

    function selectedDepartment() {
        return state.departments.find((d) => d.id === $("ticketDepartment").value);
    }

    function populateSelect(el, rows, valueFn, labelFn, placeholder) {
        const old = el.value;
        el.innerHTML = "";
        if (placeholder !== undefined) {
            const o = document.createElement("option");
            o.value = "";
            o.textContent = placeholder;
            el.append(o);
        }
        rows.forEach((r) => {
            const o = document.createElement("option");
            o.value = valueFn(r);
            o.textContent = labelFn(r);
            el.append(o);
        });
        if (rows.some((r) => valueFn(r) === old)) el.value = old;
    }

    function renderReceptionOptions() {
        populateSelect($("ticketDepartment"), activeRows("departments").sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0),), (x) => x.id, (x) => `${x.code} — ${x.name}`, "Select department",);
        populateSelect($("ticketShift"), activeRows("shifts").sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0),), (x) => x.id, (x) => `${x.name} (${x.startTime}–${x.endTime})`, "Select shift",);
        populateSelect($("ticketCounter"), activeRows("counters"), (x) => x.id, (x) => `${x.counterNumber} — ${x.name}`, "Select counter",);
        const current = shiftNow();
        if (state.settings.autoShift === "yes" && current) $("ticketShift").value = current.id;
        renderDoctorsForDepartment();
        updatePriceFromDepartment();
        updateNextTicket();
    }

    function renderDoctorsForDepartment() {
        const dep = selectedDepartment();
        const rows = activeRows("doctors").filter((d) => !Array.isArray(d.departmentIds) || !d.departmentIds.length || d.departmentIds.includes(dep?.id),);
        populateSelect($("ticketDoctor"), rows, (x) => x.id, (x) => x.name, "No specific doctor",);
    }

    function updatePriceFromDepartment() {
        const d = selectedDepartment(), doc = state.doctors.find((x) => x.id === $("ticketDoctor").value);
        $("ticketPrice").value = doc && doc.defaultPrice !== "" && doc.defaultPrice != null ? doc.defaultPrice : (d?.defaultPrice ?? 0);
        $("nextTicketDepartment").textContent = d?.name || "Select department";
    }

    function sequenceKey(depId, shiftId, date = todayISO()) {
        return `${date}|${shiftId}|${depId}`;
    }

    function nextNumber(depId, shiftId, date = todayISO()) {
        const dep = state.departments.find((x) => x.id === depId);
        if (!dep || !shiftId) return "—";
        const n = (state.sequences[sequenceKey(depId, shiftId, date)] || 0) + 1;
        return formatTicket(dep.code, n);
    }

    function formatTicket(code, n) {
        const digits = String(n).padStart(3, "0");
        return state.settings.ticketFormat === "CODE-###" ? `${code}-${digits}` : `${code}${digits}`;
    }

    function updateNextTicket() {
        const dep = selectedDepartment(), shift = state.shifts.find((x) => x.id === $("ticketShift").value),
            counter = state.counters.find((x) => x.id === $("ticketCounter").value);
        $("nextTicketNumber").textContent = nextNumber(dep?.id, shift?.id);
        $("nextTicketShift").textContent = shift?.name || "No shift selected";
        $("nextTicketCounter").textContent = counter ? `${counter.counterNumber} · ${counter.name}` : "No counter selected";
        $("nextTicketDepartment").textContent = dep?.name || "Select department";
    }

    $("ticketDepartment").addEventListener("change", () => {
        renderDoctorsForDepartment();
        updatePriceFromDepartment();
        updateNextTicket();
    });
    $("ticketDoctor").addEventListener("change", updatePriceFromDepartment);
    $("ticketShift").addEventListener("change", updateNextTicket);
    $("ticketCounter").addEventListener("change", updateNextTicket);

    function buildTicketData() {
        const dep = selectedDepartment(), doctor = state.doctors.find((x) => x.id === $("ticketDoctor").value),
            shift = state.shifts.find((x) => x.id === $("ticketShift").value),
            counter = state.counters.find((x) => x.id === $("ticketCounter").value);
        if (!dep || !shift || !counter) throw new Error("Select a department, shift and counter.");
        const price = Number($("ticketPrice").value);
        if (!Number.isFinite(price) || price < 0) throw new Error("Enter a valid fee.");
        const date = todayISO(), key = sequenceKey(dep.id, shift.id, date), seq = (state.sequences[key] || 0) + 1;
        return {
            id: uid(),
            ticketNumber: formatTicket(dep.code, seq),
            sequenceNumber: seq,
            date,
            time: new Date().toLocaleTimeString([], {
                hour: "2-digit", minute: "2-digit",
            }),
            dateTime: stamp(),
            departmentId: dep.id,
            departmentCode: dep.code,
            departmentName: dep.name,
            doctorId: doctor?.id || "",
            doctorName: doctor?.name || "",
            shiftId: shift.id,
            shiftName: shift.name,
            counterId: counter.id,
            counterName: `${counter.counterNumber} — ${counter.name}`,
            userId: currentUser.id,
            username: currentUser.username,
            price,
            status: "PRINTED",
            printCount: 0,
            patientReference: $("patientReference").value.trim(),
        };
    }

    $("ticketForm").addEventListener("submit", (e) => {
        e.preventDefault();
        try {
            const t = buildTicketData();
            const key = sequenceKey(t.departmentId, t.shiftId, t.date);
            state.sequences[key] = t.sequenceNumber;
            state.tickets.unshift(t);
            audit("ISSUE_TICKET", "Ticket", `${t.ticketNumber} · ${t.departmentName} · ${money(t.price)}`,);
            save();
            previewTicketData = t;
            showTicketPreview(t, true);
            renderAll();
            toast(`Ticket ${t.ticketNumber} issued.`);
        } catch (err) {
            toast(err.message, true);
        }
    });
    $("previewTicketBtn").addEventListener("click", () => {
        try {
            const t = buildTicketData();
            showTicketPreview(t, false);
        } catch (err) {
            toast(err.message, true);
        }
    });

    function receiptHTML(t) {
        const clinic = escapeHTML(state.settings.clinicName || "Clinic");
        return `<div class="receipt-clinic">${clinic}</div><div class="receipt-label">QUEUE TICKET</div><div class="receipt-number">${escapeHTML(t.ticketNumber)}</div><div class="receipt-line"></div><div class="receipt-row"><span>Department</span><strong>${escapeHTML(t.departmentName)}</strong></div>${t.doctorName ? `<div class="receipt-row"><span>Doctor</span><strong>${escapeHTML(t.doctorName)}</strong></div>` : ""}<div class="receipt-row"><span>Date</span><strong>${escapeHTML(t.date)}</strong></div><div class="receipt-row"><span>Time</span><strong>${escapeHTML(t.time)}</strong></div><div class="receipt-row"><span>Shift</span><strong>${escapeHTML(t.shiftName)}</strong></div><div class="receipt-row"><span>Counter</span><strong>${escapeHTML(t.counterName)}</strong></div>${t.patientReference ? `<div class="receipt-row"><span>Reference</span><strong>${escapeHTML(t.patientReference)}</strong></div>` : ""}<div class="receipt-line"></div><div class="receipt-row"><strong>Fee</strong><strong>${escapeHTML(money(t.price))}</strong></div><div class="receipt-footer">${escapeHTML(state.settings.footer || "Please wait for your turn")}</div>`;
    }

    function showTicketPreview(t, autoPrint) {
        previewTicketData = t;
        $("ticketPreview").innerHTML = receiptHTML(t);
        $("previewModal").classList.remove("hidden");
        if (autoPrint) {
            setTimeout(() => printTicket(t), 200);
        }
    }

    function closePreview() {
        $("previewModal").classList.add("hidden");
    }

    $("closePreviewModal").addEventListener("click", closePreview);
    $("cancelPreviewBtn").addEventListener("click", closePreview);
    $("printPreviewBtn").addEventListener("click", () => {
        if (previewTicketData) printTicket(previewTicketData);
    });

    function printTicket(t) {
        const old = document.getElementById("printRoot");
        if (old) old.remove();
        const root = document.createElement("div");
        root.id = "printRoot";
        root.innerHTML = receiptHTML(t);
        document.body.append(root);
        document.body.classList.add("printing-ticket");
        const win = window.open("", "_blank", "width=420,height=650");
        if (win) {
            win.document.write(`<!doctype html><html><head><title>${escapeHTML(t.ticketNumber)}</title><style>body{font-family:Arial,sans-serif;width:72mm;margin:0 auto;padding:3mm;color:#000}.receipt{text-align:center}.receipt-clinic{font-size:16px;font-weight:bold}.receipt-label{font-size:11px;margin-top:5px}.receipt-number{font-size:40px;font-weight:900;margin:13px 0}.receipt-line{border-top:1px dashed #555;margin:12px 0}.receipt-row{display:flex;justify-content:space-between;gap:8px;font-size:11px;text-align:left;margin:7px 0}.receipt-footer{font-size:10px;margin-top:14px;text-align:center}@page{size:80mm auto;margin:2mm}</style></head><body><div class="receipt">${receiptHTML(t)}</div><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),400)};<\/script></body></html>`,);
            win.document.close();
        } else {
            window.print();
        }
        const saved = state.tickets.find((x) => x.id === t.id);
        if (saved) {
            saved.printCount = (saved.printCount || 0) + 1;
            if (saved.printCount > 1 && saved.status !== "VOID") saved.status = "REPRINTED";
            audit(saved.printCount > 1 ? "REPRINT_TICKET" : "PRINT_TICKET", "Ticket", `${t.ticketNumber}, print count ${saved.printCount}`,);
            save();
            renderTicketTables();
        }
        toast(`Print dialog opened for ${t.ticketNumber}.`);
    }

    function renderAll() {
        renderReceptionOptions();
        renderRecentTickets();
        renderTickets();
        renderReportDepartmentOptions();
        updateStats();
        fillSettings();
        renderCrud();
        renderAudit();
        updateStorageUsage();
        $("todayDate").textContent = new Date().toLocaleDateString(undefined, {
            weekday: "short", month: "short", day: "numeric", year: "numeric",
        });
    }

    function updateStats() {
        const today = state.tickets.filter((t) => t.date === todayISO());
        $("issuedToday").textContent = today.length;
        $("revenueToday").textContent = money(today
            .filter((t) => t.status !== "VOID")
            .reduce((a, t) => a + Number(t.price || 0), 0),);
        $("todayClock").textContent = new Date().toLocaleString([], {
            weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
        });
    }

    function deptName(t) {
        return (t.departmentName || state.departments.find((d) => d.id === t.departmentId)?.name || "—");
    }

    function statusHTML(s) {
        return `<span class="status ${escapeHTML(s)}">${escapeHTML(s)}</span>`;
    }

    function renderRecentTickets() {
        const rows = state.tickets.slice(0, 7);
        $("recentTicketsBody").innerHTML = rows.length ? rows
            .map((t) => `<tr><td><span class="ticket-code">${escapeHTML(t.ticketNumber)}</span></td><td>${escapeHTML(deptName(t))}</td><td>${escapeHTML(t.doctorName || "—")}</td><td>${escapeHTML(t.shiftName || "—")}</td><td>${escapeHTML(t.time || "—")}</td><td>${escapeHTML(money(t.price))}</td><td>${statusHTML(t.status)}</td><td><button class="mini-btn" data-reprint="${t.id}">Reprint</button></td></tr>`,)
            .join("") : '<tr><td colspan="8" class="empty-state">No tickets have been issued yet.</td></tr>';
        bindTicketActions($("recentTicketsBody"));
    }

    function renderTickets() {
        if (!$("ticketsTableBody")) return;
        const q = ($("ticketSearch")?.value || "").toLowerCase(), status = $("ticketStatusFilter")?.value || "ALL",
            date = $("ticketDateFilter")?.value || "";
        let rows = state.tickets.filter((t) => (!q || [t.ticketNumber, deptName(t), t.doctorName, t.patientReference, t.username,]
            .join(" ")
            .toLowerCase()
            .includes(q)) && (status === "ALL" || t.status === status) && (!date || t.date === date),);
        $("ticketsTableBody").innerHTML = rows.length ? rows
            .map((t) => `<tr><td><span class="ticket-code">${escapeHTML(t.ticketNumber)}</span></td><td>${escapeHTML(t.date)}<br><span class="muted">${escapeHTML(t.time)}</span></td><td>${escapeHTML(deptName(t))}</td><td>${escapeHTML(t.doctorName || "—")}</td><td>${escapeHTML(t.shiftName || "—")}</td><td>${escapeHTML(t.counterName || "—")}</td><td>${escapeHTML(money(t.price))}</td><td>${statusHTML(t.status)}</td><td>${t.printCount || 0}</td><td><div class="table-actions"><button class="mini-btn" data-reprint="${t.id}">Reprint</button>${t.status !== "VOID" ? `<button class="mini-btn danger" data-void="${t.id}">Void</button>` : ""}</div></td></tr>`,)
            .join("") : '<tr><td colspan="10" class="empty-state">No tickets match these filters.</td></tr>';
        bindTicketActions($("ticketsTableBody"));
    }

    function renderTicketTables() {
        renderRecentTickets();
        renderTickets();
        updateStats();
    }

    function bindTicketActions(root) {
        root.querySelectorAll("[data-reprint]").forEach((b) => b.addEventListener("click", () => {
            const t = state.tickets.find((x) => x.id === b.dataset.reprint);
            if (t) showTicketPreview(t, false);
        }),);
        root.querySelectorAll("[data-void]").forEach((b) => b.addEventListener("click", () => {
            const t = state.tickets.find((x) => x.id === b.dataset.void);
            if (!t) return;
            if (!confirm(`Void ticket ${t.ticketNumber}? This action cannot be undone.`,)) return;
            t.status = "VOID";
            t.voidedAt = stamp();
            t.voidedBy = currentUser.username;
            audit("VOID_TICKET", "Ticket", `Voided ${t.ticketNumber}`);
            save();
            renderTicketTables();
            toast(`Ticket ${t.ticketNumber} voided.`);
        }),);
    }

    ["ticketSearch", "ticketStatusFilter", "ticketDateFilter"].forEach((id) => $(id).addEventListener("input", renderTickets),);
    $("clearTicketFilters").addEventListener("click", () => {
        $("ticketSearch").value = "";
        $("ticketStatusFilter").value = "ALL";
        $("ticketDateFilter").value = "";
        renderTickets();
    });
    $("ticketsExportBtn").addEventListener("click", () => exportTickets(filteredTickets(), "clinic-tickets.csv"),);

    function filteredTickets() {
        const q = ($("ticketSearch")?.value || "").toLowerCase(), status = $("ticketStatusFilter")?.value || "ALL",
            date = $("ticketDateFilter")?.value || "";
        return state.tickets.filter((t) => (!q || [t.ticketNumber, deptName(t), t.doctorName, t.patientReference]
            .join(" ")
            .toLowerCase()
            .includes(q)) && (status === "ALL" || t.status === status) && (!date || t.date === date),);
    }

    function csvCell(v) {
        const s = String(v ?? "");
        return `"${s.replace(/"/g, '""')}"`;
    }

    function downloadText(filename, text, type = "text/plain;charset=utf-8") {
        const blob = new Blob([text], {type}), url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportTickets(rows, filename = "clinic-tickets.csv") {
        const cols = [["ticketNumber", "Ticket"], ["date", "Date"], ["time", "Time"], ["departmentName", "Department"], ["doctorName", "Doctor"], ["shiftName", "Shift"], ["counterName", "Counter"], ["price", "Fee"], ["status", "Status"], ["printCount", "Print count"], ["patientReference", "Patient reference"], ["username", "Issued by"],];
        const csv = [cols.map((x) => csvCell(x[1])).join(","), ...rows.map((t) => cols
            .map(([k]) => csvCell(k === "departmentName" ? deptName(t) : t[k]))
            .join(","),),].join("\r\n");
        downloadText(filename, csv, "text/csv;charset=utf-8");
        audit("EXPORT_CSV", "Ticket", `Exported ${rows.length} ticket records`);
    }

    function allRows(type) {
        return state[type] || [];
    }

    function renderCrud() {
        if (!crudConfig[crudType]) return;
        const cfg = crudConfig[crudType];
        $("crudTitle").textContent = cfg.title;
        $("crudDescription").textContent = cfg.desc;
        $("crudSearch").value = "";
        $("crudTableHead").innerHTML = `<tr>${cfg.columns.map((c) => `<th>${escapeHTML(c[1])}</th>`).join("")}<th>Actions</th></tr>`;
        drawCrudRows();
    }

    function displayValue(type, row, key) {
        if (key === "active") return row.active === false ? '<span class="status VOID">INACTIVE</span>' : '<span class="status PRINTED">ACTIVE</span>';
        if (key === "departmentNames") return ((row.departmentIds || [])
                .map((id) => state.departments.find((d) => d.id === id)?.name)
                .filter(Boolean)
                .join(", ") || "All / none");
        if (key === "printerName") return state.printers.find((p) => p.id === row.printerId)?.name || "—";
        if (key === "defaultPrice") return row.defaultPrice === "" || row.defaultPrice == null ? "—" : escapeHTML(money(row.defaultPrice));
        return escapeHTML(row[key] ?? "—");
    }

    function drawCrudRows() {
        const cfg = crudConfig[crudType], q = $("crudSearch").value.toLowerCase();
        let rows = allRows(crudType).filter((r) => JSON.stringify({...r, password: undefined})
            .toLowerCase()
            .includes(q),);
        $("crudCount").textContent = `${rows.length} record${rows.length === 1 ? "" : "s"}`;
        $("crudTableBody").innerHTML = rows.length ? rows
            .map((r) => `<tr>${cfg.columns.map((c) => `<td>${displayValue(crudType, r, c[0])}</td>`).join("")}<td><div class="table-actions"><button class="mini-btn" data-edit="${r.id}">Edit</button>${r.active === false ? `<button class="mini-btn" data-activate="${r.id}">Activate</button>` : `<button class="mini-btn danger" data-deactivate="${r.id}">Deactivate</button>`}</div></td></tr>`,)
            .join("") : `<tr><td colspan="${cfg.columns.length + 1}" class="empty-state">No records found. Click Add record to create one.</td></tr>`;
        $("crudTableBody")
            .querySelectorAll("[data-edit]")
            .forEach((b) => b.addEventListener("click", () => openRecordModal(b.dataset.edit)),);
        $("crudTableBody")
            .querySelectorAll("[data-deactivate]")
            .forEach((b) => b.addEventListener("click", () => toggleActive(b.dataset.deactivate, false),),);
        $("crudTableBody")
            .querySelectorAll("[data-activate]")
            .forEach((b) => b.addEventListener("click", () => toggleActive(b.dataset.activate, true),),);
    }

    $("crudSearch").addEventListener("input", drawCrudRows);
    $("addRecordBtn").addEventListener("click", () => openRecordModal());

    function toggleActive(id, active) {
        const row = state[crudType].find((x) => x.id === id);
        if (!row) return;
        if (crudType === "users" && row.id === currentUser.id && !active) {
            toast("You cannot deactivate the currently signed-in account.", true);
            return;
        }
        row.active = active;
        audit(active ? "ACTIVATE" : "DEACTIVATE", crudType, `${crudType} record ${row.name || row.username || row.code || row.id}`,);
        save();
        renderCrud();
        if (["departments", "doctors", "shifts", "counters", "printers"].includes(crudType,)) renderReceptionOptions();
        toast(active ? "Record activated." : "Record deactivated.");
    }

    function fieldInput(field, value) {
        const [key, label, type, required] = field;
        const id = `field_${key}`;
        if (type === "checkbox") return `<label class="check-field field-span-2"><input id="${id}" type="checkbox" ${value !== false ? "checked" : ""}> ${escapeHTML(label)}</label>`;
        if (type === "multiselect") {
            const selected = new Set(value || []);
            return `<label class="field-span-2">${escapeHTML(label)}<select id="${id}" multiple size="${Math.min(5, Math.max(3, state.departments.length))}">${state.departments.map((d) => `<option value="${d.id}" ${selected.has(d.id) ? "selected" : ""}>${escapeHTML(d.code + " — " + d.name)}</option>`).join("")}</select><small class="muted">Use Ctrl (Windows) to select multiple departments. No selection means all departments.</small></label>`;
        }
        if (type === "selectPrinters") return `<label>${escapeHTML(label)}<select id="${id}"><option value="">No printer assigned</option>${state.printers.map((p) => `<option value="${p.id}" ${value === p.id ? "selected" : ""}>${escapeHTML(p.name)}</option>`).join("")}</select></label>`;
        if (type === "selectRole") return `<label>${escapeHTML(label)}<select id="${id}" ${required ? "required" : ""}>${["ADMIN", "SUPERVISOR", "RECEPTIONIST"].map((x) => `<option ${value === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>`;
        if (type === "selectConnection") return `<label>${escapeHTML(label)}<select id="${id}">${["Windows printer", "USB", "Network", "Other"].map((x) => `<option ${value === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>`;
        if (type === "selectPaper") return `<label>${escapeHTML(label)}<select id="${id}">${["58mm", "80mm", "A4", "Other"].map((x) => `<option ${value === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>`;
        return `<label>${escapeHTML(label)}<input id="${id}" type="${type === "number" ? "number" : type === "time" ? "time" : type}" ${required ? "required" : ""} ${type === "number" ? 'min="0" step="1"' : ""} value="${escapeHTML(type === "password" ? "" : (value ?? ""))}" placeholder="${type === "password" && editingId ? "Leave blank to keep current password" : ""}"></label>`;
    }

    function openRecordModal(id) {
        editingId = id || null;
        const row = id ? state[crudType].find((x) => x.id === id) : null;
        $("recordModalTitle").textContent = `${row ? "Edit" : "Add"} ${crudConfig[crudType].title.replace(/s$/, "").toLowerCase()}`;
        $("recordFields").innerHTML = crudConfig[crudType].fields
            .map((f) => fieldInput(f, row ? row[f[0]] : f[0] === "active" ? true : f[0] === "displayOrder" ? state[crudType].length + 1 : "",),)
            .join("");
        $("recordModal").classList.remove("hidden");
    }

    function closeRecord() {
        $("recordModal").classList.add("hidden");
        editingId = null;
    }

    $("closeRecordModal").addEventListener("click", closeRecord);
    $("cancelRecordBtn").addEventListener("click", closeRecord);
    $("recordModal").addEventListener("click", (e) => {
        if (e.target === $("recordModal")) closeRecord();
    });
    $("recordForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const cfg = crudConfig[crudType], old = editingId ? state[crudType].find((x) => x.id === editingId) : null,
            obj = old ? {...old} : {id: uid(), active: true};
        for (const f of cfg.fields) {
            const [key, label, type] = f, el = $(`field_${key}`);
            if (type === "checkbox") obj[key] = el.checked; else if (type === "multiselect") obj[key] = Array.from(el.selectedOptions).map((o) => o.value); else if (type === "number") obj[key] = el.value === "" ? "" : Number(el.value); else if (type === "password") {
                if (el.value) obj[key] = el.value; else if (!old) obj[key] = "";
            } else obj[key] = el.value.trim();
        }
        if (crudType === "departments") {
            obj.code = obj.code.toUpperCase();
            if (state.departments.some((d) => d.id !== obj.id && d.code.toLowerCase() === obj.code.toLowerCase(),)) {
                toast("Department code must be unique.", true);
                return;
            }
        }
        if (crudType === "users") {
            obj.username = obj.username.trim();
            if (state.users.some((u) => u.id !== obj.id && u.username.toLowerCase() === obj.username.toLowerCase(),)) {
                toast("Username must be unique.", true);
                return;
            }
            if (!obj.password) {
                toast("Set a password for the user.", true);
                return;
            }
            if (old && old.id === currentUser.id) {
                currentUser = obj;
                $("currentUserName").textContent = obj.fullName;
                $("currentUserRole").textContent = obj.role;
            }
        }
        if (crudType === "doctors" && obj.departmentIds.length === 0) obj.departmentIds = [];
        if (old) {
            state[crudType] = state[crudType].map((x) => (x.id === old.id ? obj : x));
            audit("UPDATE", crudType, `Updated ${obj.name || obj.username || obj.code || obj.id}`,);
        } else {
            state[crudType].push(obj);
            audit("CREATE", crudType, `Created ${obj.name || obj.username || obj.code || obj.id}`,);
        }
        save();
        closeRecord();
        renderCrud();
        renderReceptionOptions();
        renderRecentTickets();
        toast("Record saved.");
    });

    function fillSettings() {
        if (!$("settingClinicName")) return;
        $("settingClinicName").value = state.settings.clinicName || "";
        $("settingCurrency").value = state.settings.currency || "Rs";
        $("settingFooter").value = state.settings.footer || "";
        $("settingTimezone").value = state.settings.timezone || "Asia/Karachi";
        $("settingTicketFormat").value = state.settings.ticketFormat || "CODE###";
        $("settingAutoShift").value = state.settings.autoShift || "yes";
    }

    $("saveSettingsBtn").addEventListener("click", () => {
        if (!$("settingsForm").reportValidity()) return;
        state.settings = {
            clinicName: $("settingClinicName").value.trim(),
            currency: $("settingCurrency").value.trim(),
            footer: $("settingFooter").value.trim(),
            timezone: $("settingTimezone").value.trim(),
            ticketFormat: $("settingTicketFormat").value,
            autoShift: $("settingAutoShift").value,
        };
        audit("UPDATE", "Settings", "Updated clinic settings");
        save();
        $("sideClinicName").textContent = state.settings.clinicName;
        renderReceptionOptions();
        toast("Settings saved.");
    });
    $("settingsForm").addEventListener("submit", (e) => e.preventDefault());

    function renderReportDepartmentOptions() {
        populateSelect($("reportDepartment"), state.departments, (x) => x.id, (x) => x.name, "All departments",);
        $("reportDepartment").insertBefore(new Option("All departments", "ALL"), $("reportDepartment").firstChild,);
        $("reportDepartment").value = "ALL";
        if (!$("reportFrom").value) $("reportFrom").value = todayISO();
        if (!$("reportTo").value) $("reportTo").value = todayISO();
    }

    function reportRows() {
        const from = $("reportFrom").value, to = $("reportTo").value, dep = $("reportDepartment").value;
        return state.tickets.filter((t) => (!from || t.date >= from) && (!to || t.date <= to) && (dep === "ALL" || t.departmentId === dep),);
    }

    function runReport() {
        if (!$("reportTableBody")) return;
        const rows = reportRows(), valid = rows.filter((t) => t.status !== "VOID"),
            voids = rows.filter((t) => t.status === "VOID");
        $("reportTicketCount").textContent = rows.length;
        $("reportValidCount").textContent = valid.length;
        $("reportVoidCount").textContent = voids.length;
        $("reportRevenue").textContent = money(valid.reduce((a, t) => a + Number(t.price || 0), 0),);
        const groups = {};
        rows.forEach((t) => {
            const name = deptName(t);
            groups[name] ??= {tickets: 0, voids: 0, revenue: 0};
            groups[name].tickets++;
            if (t.status === "VOID") groups[name].voids++; else groups[name].revenue += Number(t.price || 0);
        });
        $("reportTableBody").innerHTML = Object.entries(groups)
            .map(([name, x]) => `<tr><td>${escapeHTML(name)}</td><td>${x.tickets}</td><td>${x.voids}</td><td>${escapeHTML(money(x.revenue))}</td></tr>`,)
            .join("") || '<tr><td colspan="4" class="empty-state">No records in this date range.</td></tr>';
    }

    $("runReportBtn").addEventListener("click", runReport);
    $("reportExportBtn").addEventListener("click", () => exportTickets(reportRows(), "clinic-report.csv"),);
    $("auditExportBtn").addEventListener("click", () => {
        const cols = ["dateTime", "user", "action", "entity", "details"];
        downloadText("clinic-audit-log.csv", [cols.join(","), ...state.audit.map((r) => cols.map((k) => csvCell(r[k])).join(",")),].join("\r\n"), "text/csv;charset=utf-8",);
    });
    $("downloadCsvAllBtn").addEventListener("click", () => exportTickets(state.tickets, "all-clinic-tickets.csv"),);

    function renderAudit() {
        const q = ($("auditSearch")?.value || "").toLowerCase();
        const rows = state.audit
            .filter((r) => [r.dateTime, r.user, r.action, r.entity, r.details]
                .join(" ")
                .toLowerCase()
                .includes(q),)
            .slice(0, 1000);
        $("auditTableBody").innerHTML = rows.length ? rows
            .map((r) => `<tr><td>${escapeHTML(new Date(r.dateTime).toLocaleString())}</td><td>${escapeHTML(r.user)}</td><td>${escapeHTML(r.action)}</td><td>${escapeHTML(r.entity)}</td><td>${escapeHTML(r.details)}</td></tr>`,)
            .join("") : '<tr><td colspan="5" class="empty-state">No audit records found.</td></tr>';
    }

    $("auditSearch").addEventListener("input", renderAudit);

    function updateStorageUsage() {
        if (!$("storageUsage")) return;
        const raw = localStorage.getItem(DB_KEY) || "";
        $("storageUsage").textContent = `${(new Blob([raw]).size / 1024).toFixed(1)} KB used`;
    }

    $("downloadBackupBtn").addEventListener("click", () => {
        const payload = {
            format: "ClinicQueueSystemJSON", version: "1.2.0", exportedAt: stamp(), data: state,
        };
        downloadText(`clinic-queue-backup-${todayISO()}.json`, JSON.stringify(payload, null, 2), "application/json",);
        audit("BACKUP", "Data", "Downloaded JSON backup");
        updateStorageUsage();
    });
    $("restoreFileInput").addEventListener("change", async (e) => {
        const f = e.target.files[0];
        pendingRestore = null;
        $("restoreBackupBtn").disabled = true;
        if (!f) return;
        try {
            const parsed = JSON.parse(await f.text()), data = parsed.data || parsed;
            if (!data.departments || !data.tickets || !data.users || !data.settings) throw new Error("This does not look like a Clinic Queue System backup.",);
            pendingRestore = data;
            $("restoreBackupBtn").disabled = false;
            toast("Backup file validated. Click Restore to replace local data.");
        } catch (err) {
            toast(`Cannot read backup: ${err.message}`, true);
        }
    });
    $("restoreBackupBtn").addEventListener("click", () => {
        if (!pendingRestore) return;
        if (!confirm("Restore this backup? Current browser data will be overwritten.")) return;
        state = pendingRestore;
        save();
        audit("RESTORE", "Data", "Restored JSON backup");
        pendingRestore = null;
        $("restoreFileInput").value = "";
        $("restoreBackupBtn").disabled = true;
        renderAll();
        goPage("reception");
        toast("Backup restored.");
    });

    function init() {
        if (!state.doctors.length) state.doctors = [];
        $("sideClinicName").textContent = state.settings.clinicName || "Clinic Queue";
        renderAll();
        setInterval(() => {
            $("todayClock").textContent = new Date().toLocaleString([], {
                weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
            });
            if (state.settings.autoShift === "yes") {
                const active = shiftNow();
                if (active && $("ticketShift").value !== active.id) {
                    $("ticketShift").value = active.id;
                    updateNextTicket();
                }
            }
        }, 15000);
    }

    init();
})();
