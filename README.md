# Task Triage PWA

A zero-backend, local-first mobile-friendly task prioritisation prototype.

## What it does
- Add project tasks/reminders with deadline, effort, importance, category and notes.
- Automatically recalculates a deterministic priority score after every change.
- Shows configurable Top N urgent tasks.
- Shows configurable Top N longest-open tasks.
- Mark complete/reopen, edit and delete tasks.
- Stores live data in browser localStorage.
- Export/import the entire dataset as JSON.
- Works offline after first successful hosted load via a service worker.
- Can be installed to the home screen as a PWA when served over HTTPS.

## Run locally on a computer
From this folder:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Important mobile note
Do not rely on opening `index.html` directly with `file://` on a phone. The core page may open, but PWA installation/service workers require an HTTP(S) origin. For easiest mobile testing, publish the folder to GitHub Pages or another static HTTPS host.

## Priority algorithm
The score is deliberately explainable rather than "AI magic":
- deadline urgency
- business importance
- task age
- small effort adjustment

Overdue tasks get the strongest deadline boost. Old undated work also rises gradually instead of disappearing forever.

## Future cloud storage adapter
The app currently uses localStorage. The UI and ranking logic are independent of storage, so a next version can replace `loadState()` / `saveState()` with an authenticated cloud adapter, for example:
- Google Identity Services + Google Drive API
- Microsoft identity platform + Microsoft Graph / OneDrive

For a real production app, do not embed OAuth client secrets in this static front-end. Use OAuth flows intended for browser/public clients and follow the provider's security guidance.


## Task fields (v2)

Each task supports Task/reminder, Deadline, Priority, Project/category, Action By (Vendor/Cust), Status (Open/Closed/KIV), Effort, and Notes. Open tasks are ranked in the urgent and longest-open panels; KIV tasks are parked and excluded from those focus lists; Closed tasks are retained in history.
