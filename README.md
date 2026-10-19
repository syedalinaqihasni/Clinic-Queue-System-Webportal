# Clinic Queue System Web v1.3

Local HTML/CSS/JavaScript application. No SQL database or server required.

## Run
1. Extract the ZIP to a local folder.
2. Open `index.html` in Edge or Chrome.
3. Sign in with `admin` / `admin123`.

## Storage and logins
- Clinic records and tickets are stored in browser `localStorage` under `clinic_queue_data_v13`.
- User accounts are stored separately under `clinic_queue_users_v13`. The app has **Export users.json** and **Import users.json** controls in Administration → Users & roles. Browsers do not permit a web page to silently write a JSON file to a chosen disk path; export/import is the safe browser-supported alternative.
- Signed-in session is cached in `sessionStorage` for up to 12 hours and is cleared on logout or browser session end.
- First run: `admin` / `admin123`. Create a unique admin password before entering real data.

## Numbering
Ticket sequence is derived separately for each **date + shift + department**. Every new combination starts at `001`; examples: G001 for General OPD, C001 for Consultant OPD, E001 for ENT OPD. Sequence numbers are not reused if a ticket is voided.

## Included
Reception ticket issuance and print dialog; ticket preview; ticket history; reprint tracking; voiding; departments, doctors, shifts, counters, printers and user CRUD; clinic settings; daily reports; CSV exports; audit log; JSON backup/restore; separate users JSON export/import.

## Important limitations
This is a single-browser, single-device app. Browser local storage is not a shared database and cannot safely coordinate simultaneous tickets across several computers. Browser login storage is not production-grade authentication, and client-side credentials can be inspected by someone with access to the browser profile. Do not store sensitive patient data until you use a secure backend and conduct a security review. Browser printing uses the system print dialog; select the thermal printer and set its paper size in the printer driver.
