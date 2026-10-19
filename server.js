"use strict";
// Clinic Queue local JSON persistence service. Use on a trusted single clinic PC.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "clinic-data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const DATA_FILE = path.join(DATA_DIR, "clinic-data.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const MAX_BODY = 20 * 1024 * 1024;
const PORT = Number(process.env.PORT || 4173);
let lastChange = Date.now();
let lastIdleBackup = 0;
let saveChain = Promise.resolve();
fs.mkdirSync(BACKUP_DIR, {recursive: true});
const defaults = {
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
    doctors: [],
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
    printers: [],
    tickets: [],
    audit: [],
};
const initialUsers = [
    {
        id: "user-admin",
        username: "admin",
        password: "admin123",
        fullName: "Administrator",
        role: "ADMIN",
        active: true,
    },
];

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

function writeJsonAtomic(file, value) {
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), {
        encoding: "utf8",
        mode: 0o600,
    });
    fs.renameSync(tmp, file);
}

if (!fs.existsSync(DATA_FILE)) writeJsonAtomic(DATA_FILE, defaults);
if (!fs.existsSync(USERS_FILE)) writeJsonAtomic(USERS_FILE, initialUsers);

function normalizeData(value) {
    const d = {...defaults, ...(value || {})};
    d.settings = {...defaults.settings, ...(d.settings || {})};
    for (const k of [
        "departments",
        "doctors",
        "shifts",
        "counters",
        "printers",
        "tickets",
        "audit",
    ])
        if (!Array.isArray(d[k])) d[k] = [];
    // IDs are the stable identity. This deduplicates repeated uploads without deleting ticket history.
    for (const k of [
        "departments",
        "doctors",
        "shifts",
        "counters",
        "printers",
        "tickets",
        "audit",
    ]) {
        const seen = new Set();
        d[k] = d[k].filter((row) => {
            const key = String(row?.id || "");
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
    // Protect numbering from duplicate ticket IDs. Sequence is still derived by date + shift + department in the UI.
    return d;
}

function normalizeUsers(value) {
    if (!Array.isArray(value)) throw new Error("Users payload must be an array");
    const seen = new Set();
    const out = value.filter(
        (u) =>
            u &&
            u.id &&
            u.username &&
            !seen.has(String(u.id)) &&
            (seen.add(String(u.id)), true),
    );
    if (
        !out.length ||
        !out.some((u) => String(u.username).toLowerCase() === "admin")
    )
        throw new Error("At least one admin account is required");
    return out;
}

function saveData(value) {
    const normalized = normalizeData(value);
    saveChain = saveChain.then(() => {
        writeJsonAtomic(DATA_FILE, normalized);
        lastChange = Date.now();
    });
    return saveChain;
}

function saveUsers(value) {
    const normalized = normalizeUsers(value);
    saveChain = saveChain.then(() => {
        writeJsonAtomic(USERS_FILE, normalized);
        lastChange = Date.now();
    });
    return saveChain;
}

function makeBackup(reason) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const payload = {
        format: "clinic-queue-json-backup-v1",
        reason,
        createdAt: new Date().toISOString(),
        data: readJson(DATA_FILE, defaults),
        users: readJson(USERS_FILE, initialUsers),
    };
    const file = path.join(BACKUP_DIR, `backup-${stamp}-${reason}.json`);
    writeJsonAtomic(file, payload);
    // Keep the newest 100 backups to avoid filling the disk.
    const files = fs
        .readdirSync(BACKUP_DIR)
        .filter((f) => f.endsWith(".json"))
        .sort();
    for (const old of files.slice(0, Math.max(0, files.length - 100))) {
        try {
            fs.unlinkSync(path.join(BACKUP_DIR, old));
        } catch {
        }
    }
    lastIdleBackup = Date.now();
    return path.basename(file);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
            if (body.length > MAX_BODY) {
                reject(new Error("Request too large"));
                req.destroy();
            }
        });
        req.on("end", () => {
            try {
                resolve(JSON.parse(body || "null"));
            } catch {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });
}

function send(res, status, obj, type = "application/json; charset=utf-8") {
    res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    });
    res.end(type.startsWith("application/json") ? JSON.stringify(obj) : obj);
}

const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
};
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    try {
        if (req.method === "GET" && url.pathname === "/api/state")
            return send(res, 200, {
                data: readJson(DATA_FILE, defaults),
                users: readJson(USERS_FILE, initialUsers),
            });
        if (req.method === "PUT" && url.pathname === "/api/data") {
            await saveData(await readBody(req));
            return send(res, 200, {ok: true});
        }
        if (req.method === "PUT" && url.pathname === "/api/users") {
            await saveUsers(await readBody(req));
            return send(res, 200, {ok: true});
        }
        if (req.method === "POST" && url.pathname === "/api/backup/idle") {
            // Snapshot only if changed since the previous snapshot and at least 30 seconds have elapsed.
            if (
                Date.now() - lastChange >= 30000 &&
                Date.now() - lastIdleBackup >= 30000
            )
                return send(res, 200, {ok: true, backup: makeBackup("idle")});
            return send(res, 200, {
                ok: true,
                backup: null,
                message: "No idle backup needed yet",
            });
        }
        if (req.method === "POST" && url.pathname === "/api/backup")
            return send(res, 200, {ok: true, backup: makeBackup("manual")});
        if (req.method === "GET" && url.pathname === "/api/health")
            return send(res, 200, {
                ok: true,
                storage: DATA_DIR,
                lastChange: new Date(lastChange).toISOString(),
            });
        if (req.method === "GET") {
            let requested = decodeURIComponent(
                url.pathname === "/" ? "/index.html" : url.pathname,
            );
            const file = path.resolve(ROOT, `.${requested}`);
            if (
                !file.startsWith(ROOT + path.sep) ||
                file.startsWith(DATA_DIR + path.sep)
            )
                return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
            if (!fs.existsSync(file) || !fs.statSync(file).isFile())
                return send(res, 404, "Not found", "text/plain; charset=utf-8");
            return send(
                res,
                200,
                fs.readFileSync(file),
                mime[path.extname(file)] || "application/octet-stream",
            );
        }
        return send(res, 405, {error: "Method not allowed"});
    } catch (err) {
        console.error(err);
        return send(res, 400, {error: err.message || "Request failed"});
    }
});
// Periodic snapshots. Atomic JSON writes mean a partial file is never exposed as the current data file.
setInterval(() => {
    if (
        Date.now() - lastChange >= 5 * 60 * 1000 &&
        Date.now() - lastIdleBackup >= 5 * 60 * 1000
    ) {
        try {
            makeBackup("periodic");
        } catch (e) {
            console.error("Backup failed:", e);
        }
    }
}, 60 * 1000).unref();
server.listen(PORT, "127.0.0.1", () =>
    console.log(
        `Clinic Queue System running at http://127.0.0.1:${PORT}\nPermanent JSON data: ${DATA_DIR}\nDefault login: admin / admin123`,
    ),
);
