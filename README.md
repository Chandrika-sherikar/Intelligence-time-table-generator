# Period Zero — Intelligent Timetable Generator (Demo)

A working fullstack demo of the Assignment 3 design: a constraint-based college
timetable generator. Node/Express API + a solver + a vanilla-JS frontend.
No native dependencies (no sqlite bindings, no build step) — just `npm install && npm start`.

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:4000** in your browser.

Data is stored in `data/db.json` (auto-created on first run, seeded with sample
rooms/faculty/subjects/sections). Delete that file (or click **Reset demo data**
in the sidebar) to start over.

## What it does

1. **Setup tab** — CRUD for Rooms, Faculty, Subjects, Sections, and Subject
   Assignments (who teaches what to whom). This is the raw input to the solver.
2. **Generate tab** — runs the solver across a fixed Mon–Fri, 6-period grid.
   Hard constraints enforced: no faculty/section/room is ever double-booked,
   and a session only lands in a room of the required type (lecture/lab).
   If something can't be placed, it's still scheduled as far as possible and
   the unplaced sessions are reported with a specific, actionable reason —
   never a silent failure.
3. **Timetable tab** — view the result by section, by faculty, or by room;
   publish a draft version to mark it the active timetable. Every generation
   run is kept (versioned), so publishing never destroys history.

## Authentication & roles

The app is behind a login screen. Sign in with one of the seeded demo
accounts (also shown as one-click chips on the login screen):

| Username | Password | Role | Can do |
|---|---|---|---|
| `admin` | `admin123` | Admin | Everything: edit setup data, run generation, publish, reset |
| `hod.cs` | `hod123` | HOD | View everything, run generation — cannot edit setup or publish |
| `anitha.rao` | `faculty123` | Faculty | View everything, manage **own** availability only — read-only elsewhere |

**How it works:**
- `POST /api/auth/login` verifies the password (hashed with bcrypt, never
  stored in plaintext) and returns a signed JWT (`server/auth.js`).
- The frontend stores the token in `localStorage` and sends it as
  `Authorization: Bearer <token>` on every API call (`public/app.js`).
- Every route is wrapped in `requireAuth()`/`requireAuth(['admin', ...])`
  middleware — the API enforces permissions itself, not just the UI, so a
  faculty account can't bypass restrictions by calling the API directly.
  (Try it: `curl -X POST /api/rooms` with a faculty token → `403`.)
- `GET /api/dataset` and `/api/reset` strip `passwordHash` and the `users`
  collection before responding — credential material never reaches the browser.
- The UI hides controls a role can't use (add/remove forms, Generate,
  Publish) as a convenience, but the real enforcement is server-side.

To change the JWT signing secret (do this before any real deployment), set
the `JWT_SECRET` environment variable — it falls back to a demo literal
otherwise.

## How the solver works

`server/solver.js` implements a **multi-restart constrained greedy search**:

- Each subject assignment expands into N "tasks" (N = weekly hours required).
- For each task, it computes every (day, period) where the faculty, the
  section, *and* a room of the right type are simultaneously free.
- It picks the best candidate using a soft heuristic (prefer a day not
  already used for that subject+section, to spread sessions across the week
  rather than clustering them).
- It runs this whole process ~30 times with different task orderings and
  keeps the run with the fewest unresolved sessions (multi-restart escapes
  local dead-ends that a single greedy pass would get stuck in).
- Anything still unresolved after the best run is reported with the precise
  reason (no matching room type at all, or no common free slot).

This is a heuristic, not an exact solver — it's built to be transparent,
fast, and easy to read for a demo. A production system at real college scale
(thousands of sections) would swap this module for an exact CP-SAT/OR-Tools
formulation without touching the API or frontend, since the solver is
isolated behind a single `generateTimetable()` function.

## Project structure

```
server/
  index.js     Express app + REST API
  db.js        JSON-file data store + seed data (rooms/faculty/subjects/sections/users) + fixed period grid
  solver.js    The scheduling algorithm
  auth.js      Password hashing, JWT issue/verify, requireAuth() middleware
public/
  index.html   Login screen + three-tab UI shell
  styles.css   Design system
  app.js       Frontend logic (auth flow, fetch calls, table rendering, grid rendering)
data/
  db.json      Generated at runtime — the "database" (includes bcrypt-hashed user records)
```

## API summary

| Method | Path | Auth required | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | — | Exchange username/password for a JWT |
| GET | `/api/auth/me` | any role | Resolve the current token to a user |
| GET | `/api/rooms`, `/api/faculty`, `/api/subjects`, `/api/sections`, `/api/assignments` | any role | Read setup data |
| POST/PUT/DELETE | same paths | **admin** | Edit setup data |
| GET | `/api/availability` | any role | List faculty blocked slots |
| POST/DELETE | `/api/availability` | admin/hod (anyone's), faculty (own only) | Manage blocked slots |
| POST | `/api/timetables/generate` | **admin, hod** | Run the solver, create a new versioned draft |
| GET | `/api/timetables`, `/api/timetables/:id` | any role | View generation runs |
| POST | `/api/timetables/:id/publish` | **admin** | Mark a run as the published/active timetable |
| DELETE | `/api/timetables/:id` | **admin** | Delete a run |
| GET | `/api/dataset` | any role | Full current dataset (credentials stripped) |
| POST | `/api/reset` | **admin** | Reset to seed data |

## Extending toward production

- Swap the JSON file store for Postgres (schema maps directly — see the
  Assignment 3 write-up's ER model).
- Add faculty-availability input to the UI (the API already supports it —
  `POST/DELETE /api/availability`).
- Add authentication/roles (Admin vs HOD vs Faculty) around the setup and
  publish endpoints.
- Replace the greedy solver with OR-Tools CP-SAT for guaranteed-optimal
  results and native support for "minimal conflicting constraint set"
  explanations on infeasibility.
