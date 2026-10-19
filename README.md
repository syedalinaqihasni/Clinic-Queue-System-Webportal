# Clinic Queue System v1.4 — Persistent JSON edition

This version retains the HTML/CSS/JavaScript interface and adds a small Node.js local service. Tickets and settings no longer rely on browser cache as their permanent storage.

## Requirements

- Windows 10/11
- Node.js 18 or newer (no third-party npm packages required)

## Run

1. Extract the ZIP to a normal folder, e.g. `C:\ClinicQueue`.
2. Install Node.js 18+ from https://nodejs.org/ if it is not installed.
3. Double-click `start-windows.bat`, or open a terminal in this folder and run `node server.js`.
4. Open `http://127.0.0.1:4173` if the browser does not open automatically.
5. Log in with `admin` / `admin123`, then create a stronger account/password and deactivate defaults if appropriate.

Do not open `index.html` directly. The app must run through `server.js` for permanent JSON saving.

## Permanent data

Created beside the application in `clinic-data/`:

- `clinic-data.json` — clinic settings, departments, doctors, shifts, counters, printers, tickets and audit records.
- `users.json` — users separately from clinic data.
- `backups/` — timestamped snapshots, created on idle after a quiet period and periodically when data has not changed.

The app may still use browser storage as a fallback cache, but the server JSON files are authoritative. Clearing browser cache/site data will not delete these files. Back up the entire `clinic-data` folder somewhere else regularly.

## Numbering and duplicates

Ticket numbering is calculated from existing tickets by `date + shiftId + departmentId`. Therefore, the first ticket for each combination is 001 (e.g. G001) and the sequence starts again when the date or shift changes. Ticket IDs are unique; the server removes repeated records with the same record ID during saves. Ticket records are not removed when voided.

## Notes and limitations

- This server binds only to `127.0.0.1`, for single-PC use. Do not expose it to a network without authentication, access control and concurrency protections.
- Current login credentials in the existing UI are not cryptographically hashed. Use only on a trusted PC and do not treat this starter as a security-hardened medical records system.
- Automatic backups are snapshots, not a replacement for an external backup. Copy `clinic-data/backups` and the JSON files to a separate drive regularly.
- Print output remains controlled by the browser and the installed printer driver.
