# Lisaan Lab — Learning Management System

A real-time LMS for Lisaan Lab: one portal for **students, tutors and administrators**, with live
attendance registers, instantly-marked assessments, statements of result, a 100 TB storage vault and
full access control driven by the Super Administrator.

Everything in the system is **real data**. Nothing is mocked, simulated or pre-invented: the only
account that exists at first boot is the Super Administrator, plus the empty academic framework of
3 levels × 4 semesters.

---

## 1. First sign-in

| | |
|---|---|
| **Login email** | `technicallead@lisaanlab.com` |
| **Staff ID** | `LSL/ADM/2026/00001` *(works as a login too)* |
| **Password** | `LisaanLab@2026` |

A password change is **enforced** before anything else can be opened. Every other account in the
system is created by the Super Administrator from **User accounts → ＋ Create account**.

> Locked out? From a terminal in the project folder:
> `npm run reset-super-password -- "YourNewPassword1"`

---

## 2. Running it

```bash
npm install     # only needed once, or after moving the folder
npm start       # serves on http://0.0.0.0:3000
```

No external database or service — SQLite in WAL mode, a WebSocket server and Express in one process.
All state lives in `data/` (database, passport photographs, vault objects, backup archives).

---

## 3. Identity scheme

| Role | ID format | Example |
|---|---|---|
| Administrative staff, DG/CEO | `LSL/ADM/<year>/<serial>` | `LSL/ADM/2026/00002` |
| Tutors | `LSL/TUT/<year>/<serial>` | `LSL/TUT/2026/00001` |
| Students | `LSL/STU/<admission year>/<serial>` | `LSL/STU/2026/00001` |

Serials are allocated by the server per series and year, so IDs are never duplicated or guessed.

---

## 4. Roles, privileges and access

The Super Administrator creates every account and governs it with **toggle switches** — fifteen
privileges across six groups, changeable at any moment. A revoked privilege takes effect on the
user's screen immediately, without them reloading.

| Privilege group | Toggles |
|---|---|
| User Administration | create accounts · edit profiles · reset passwords · suspend/restore |
| Academics | manage courses & structure |
| Attendance | view all attendance · manage staff attendance |
| Examinations | view all assessments · **approve assessments (Exams Officer)** · publish results |
| Storage | storage vault access |
| Oversight | live supervision dashboard · audit trail |
| System | create & download backups · reset the system |

**Constitutional limits enforced in the server, not just the interface:**

- The **Super Administrator** holds every privilege permanently; they cannot be edited away.
- The **DG/CEO** is created with every privilege *except* `users.create`, and the API refuses to grant
  it — attempting to toggle it on silently resolves to `false`.
- Nobody may act on an account at or above their own rank, and the Super Administrator account can
  never be deleted or duplicated.

---

## 5. What each portal does

### Super Administrator / DG / CEO
- **Dashboard** — live KPIs, who is online right now, running registers, running papers, the exams
  vetting queue, enrolment by level, vault consumption and a streaming activity feed.
- **User accounts** — create any account with passport photograph and privilege toggles; the issued
  ID, email and temporary password are shown once for handover. Reset passwords, suspend/restore,
  change a student's placement.
- **Academics** — the fixed 3 × 4 framework, courses per semester, tutor assignment, enrolment and
  one-click auto-enrolment of a whole level.
- **Attendance** — watch any live register fill up, replay historical sheets, and supervise the staff
  duty register day by day.
- **Examinations** — inspect any paper with its marking scheme, approve or return it, read every score.
- **Results** — compute statements from real submissions and publish them to students.
- **Storage vault** — 100 TB, Super Administrator and DG/CEO only.
- **Audit trail** — every action, actor, entity and IP.
- **System** — institution settings, backups, and the guarded reset.

### Tutor
Passport and staff ID on the dashboard · clock in/out · publish a live attendance register for a
course (with a late threshold) and watch students mark themselves in real time · author tests and
examinations · send them for vetting · publish once approved · see every score as it lands.

### Student
Passport photograph, Student ID, level and semester on the dashboard · mark attendance while the
register is open · sit live papers with a countdown and **see the score the instant it is submitted**
· full attendance record by course · printable statements of result each semester.

---

## 6. How the academic machinery works

**Attendance.** The tutor publishes a register with a duration and a late threshold. Enrolled
students are notified instantly and can mark themselves until it closes. Anyone who has not marked
when the register ends is written into the sheet as **ABSENT** — so the register is a complete,
auditable document, not a partial one. Registers also auto-close on time if the tutor forgets.

**Assessments.** `DRAFT → PENDING_APPROVAL → APPROVED → LIVE → CLOSED`. Questions lock the moment a
paper is sent for vetting. A tutor cannot approve their own paper, and correct answers are never sent
to a candidate's browser. Marking is automatic on submission — multiple choice, true/false, and short
answer (pipe-separated accepted variants, case-insensitive).

**Results.** A course score is the weighted average of every test and examination in that course; a
paper never sat scores zero. Grades follow A ≥ 70, B ≥ 60, C ≥ 50, D ≥ 45, E ≥ 40, F below, with
points 5–0, and GPA weighted by credit units. Publishing freezes the statement and notifies the
student in real time.

---

## 7. Backups and reset

**Backup** produces a timestamped `.tar.gz` containing the database, every passport photograph and
the entire vault, recorded in the backup register and downloadable from the System page.

**Reset** requires typing `RESET LISAAN LAB LMS` exactly, and runs a safety backup *first* — if that
backup fails, the reset is aborted. Two scopes:

- **Operational data only** — courses, enrolments, registers, assessments, results, vault, notifications. Accounts kept.
- **Everything** — the above plus every account except the Super Administrator; levels and semesters rebuilt.

Backup history always survives a reset, for record purposes.

---

## 8. Tests

```bash
# start an isolated instance, then run the suites against it
LSL_DATA_DIR=/tmp/lsltest PORT=3100 node server/index.js &

node test/e2e.js        # 109 checks — API, permissions, academic flow
node test/realtime.js   #  12 checks — WebSocket delivery and scoping
node test/ui.js         #  69 checks — real SPA booted per role in a headless DOM
```

The suites never touch live data: `LSL_DATA_DIR` points each run at a throwaway database.
`test/ui.js` additionally needs `npm install --no-save jsdom`.

---

## 9. Layout

```
server/      index.js · db.js · core.js (identity, privileges, grading) · realtime.js
server/routes/   auth · users · academics · attendance · assessments(+results) · vault · system
public/      index.html (login) · app.html (portal) · css/styles.css · js/*
data/        lms.db · passports/ · vault/ · backups/     ← all persistent state
scripts/     reset-super-password.js
test/        e2e.js · realtime.js · ui.js
```

**Brand:** background `#DADADA`, brand navy `#2E2E64`, accent `#9F9480`.

---

## 10. Security notes

bcrypt password hashing · httpOnly session cookies with a 12-hour sliding expiry · brute-force
throttling (6 failures per identifier/IP per 10 minutes) · server-side privilege checks on every
endpoint (the interface only ever hides what the API already refuses) · passport photographs served
only to authenticated users · sessions revoked and sockets dropped the moment an account is
suspended, reset or deleted · every state change written to an append-only audit log.

Before exposing this beyond a trusted network, terminate TLS in front of it and keep `data/` on a
backed-up volume.
