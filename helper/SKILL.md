---
name: planner
description: Carry out the latest request saved by the Planner app (New / Revise / Apply / Export / Apply all changes) in a .planner project file. Use when the prompt says "Use the planner skill" or starts with /planner.
---

# Planner: do the latest request (Claude Code on the user's computer)

The Planner app (https://rcz18.github.io/planner-app) saves a request into a `.planner` project file and the Planner Helper starts you with the file path and the request line. You run on the user's own computer, so read and write the files directly. The user is a video editor. Reply at the end in short, simple Taglish (one or two lines).

## Hard rules
- Never move the user's mouse or keyboard and never operate Premiere's UI. Premiere work goes only through **Claude Apply job files** (below).
- Never save the Premiere project. The user presses Ctrl+S.
- Never touch other sequences or the user's own review/timeline edits in the `.planner` file except the ones the request names.
- Do not ask questions; there is nobody to answer. Take the most reasonable reading and say which one at the end.

## 1. Read
1. Read the `.planner` file (JSON). `request` = `{ kind: "new" | "revise" | "revise-all" | "apply", sequence, sequences?, at, summary, handled? }`. If there is no request or `handled: true`, say there is nothing new and stop.
2. Read the project's `CLAUDE.md` (in the folder above `Planner App`). It has the user's brand rules, file format notes and how each kind of request is done. Follow it.

## 2. Show progress in the app
Write `Planner App\planner-status.json` beside the project file (merge with what is there):
`{"jobs":[{"project":"<project id>","seq":"P2","pct":40,"step":"Designing the beats","state":"working"}]}`
Milestones: reading 10 → transcript 25 → designing 50 → checking 80 → saving 95 → `"state":"done"`, 100, with `"at":"<ISO time>"`. On a blocker use `"state":"error"` and a short step text, then stop.

## 3. Do the work
- **revise / revise-all**: apply every pick, note, timeline change, move (pos translate/scale), zoom/pan key and drawing comment of each named tab exactly, then bump that tab's `version` and `badge`. Tabs marked approved with no notes stay as they are. A tab with `mirror` (e.g. FULL) is rebuilt from the tabs it mirrors.
- **new**: design a new tab as CLAUDE.md describes (cut from Premiere via a read-only Claude Apply job, transcript words, beats, css).
- **apply / export**: render at source quality into `Assets\AI render\` as CLAUDE.md describes, then place or replace it on the Premiere sequence with a Claude Apply job. If a render tool is missing on this computer (python, playwright, ffmpeg), set the status to error "Render tools missing on this PC" and say the user can run the export from the Claude chat instead.

### Claude Apply (Premiere, no mouse)
Write ExtendScript to `Assets\AI render\_apply\<unique name>.job.json`. The Claude Apply panel in Premiere runs it and writes `<name>.done.json` (plus any result file your script writes). Wait for the done file (poll every 2 s, up to about 2 minutes). If nothing comes, Premiere or the panel is closed: leave the job there (it runs when the panel opens), set the status step to "Waiting for Premiere (Claude Apply)" and say so.

## 4. Save safely
- Re-read the `.planner` file right before writing. Change only the tabs you worked on; keep every other tab, `mirror` fields and the user's other edits exactly.
- For each tab you finished: clear its `review` (keep `approved` if set) and remove its `timeline` edits.
- Set `request.handled = true` (keep the rest of the request) and `savedAt` to now.
- Before writing, copy the old file to `Planner App\.backups\<name> <time>.planner`. Write JSON in one go.
- Set the status to done.

## 5. Tell the user
One or two short Taglish lines: what changed and that the tab updates by itself in the Planner app.
