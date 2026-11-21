---
name: planner
description: Carry out the latest request saved by the Planner app (New / Revise / Suggestions / Apply / Export / Apply all changes) in a .planner project file. Use when the prompt says "Use the planner skill" or starts with /planner.
---

# Planner: do the latest request (Claude Code on the user's computer)

The Planner app (https://rcz18.github.io/planner-app) saves a request into a `.planner` project file and the Planner Helper starts you with the file path and the request line. You run on the user's own computer, so read and write the files directly. The user is a video editor. Reply at the end in short, simple Taglish (one or two lines).

## Hard rules
- The prompt says which computer you are on. On a **Mac**, paths use `/` (e.g. `Planner App/planner-status.json`, `Assets/AI render/_apply/`), and the user saves with **Cmd+S**. Windows paths in this skill or CLAUDE.md mean the same folders.
- Never move the user's mouse or keyboard and never operate Premiere's UI. Premiere work goes only through **Claude Apply job files** (below).
- Never save the Premiere project. The user presses Ctrl+S.
- Never touch other sequences or the user's own review/timeline edits in the `.planner` file except the ones the request names.
- Do not ask questions; there is nobody to answer. Take the most reasonable reading and say which one at the end.
- **Be fast. No self-check renders.** For new / revise / revise-all / suggest, do NOT render, screenshot or preview your work (no headless Chrome, Playwright, ffmpeg frames, contact sheets). The user sees the result live in the Planner app the moment you save. Only **apply / export** renders video.
- Don't download or read the Planner app's source code to learn the format; this skill and the project's CLAUDE.md are enough. Read only what the request needs, then write the file.

## 1. Read
1. Read the `.planner` file (JSON). `request` = `{ kind: "new" | "revise" | "revise-all" | "ideas" | "suggest" | "apply", sequence, sequences?, beat?, at, summary, handled? }`. If there is no request or `handled: true`, say there is nothing new and stop.
   - **Save tokens:** the file can hold big pictures (`data:image/...` strings). Never Read the whole file raw. Print it with the pictures cut out, and write the pictures you need to files:
     `node -e "const f=process.argv[1],fs=require('fs'),p=require('path');let n=0;const o=JSON.stringify(JSON.parse(fs.readFileSync(f,'utf8')),(k,v)=>typeof v==='string'&&v.startsWith('data:image')?(fs.writeFileSync(p.join(require('os').tmpdir(),'planner-img-'+(++n)+'.jpg'),Buffer.from(v.split(',')[1],'base64')),'<picture planner-img-'+n+'.jpg in temp>'):v,1);console.log(o)" "<file>"`
     Then Read only the pictures that matter for this request.
2. Read the project's `CLAUDE.md` (in the folder above `Planner App`). It has the user's brand rules, file format notes and how each kind of request is done. Follow it.

## 2. Show progress in the app
Write `Planner App\planner-status.json` beside the project file (merge with what is there):
`{"jobs":[{"project":"<project id>","seq":"P2","pct":40,"step":"Designing the beats","state":"working"}]}`
Milestones: reading 10 → transcript 25 → designing 50 → checking 80 → saving 95 → `"state":"done"`, 100, with `"at":"<ISO time>"`. On a blocker use `"state":"error"` and a short step text, then stop.

## 3. Do the work
- **revise / revise-all**: apply every pick, note, timeline change, move (pos translate/scale), zoom/pan key and drawing comment of each named tab exactly, then bump that tab's `version` and `badge`. Tabs marked approved with no notes stay as they are. A tab with `mirror` (e.g. FULL) is rebuilt from the tabs it mirrors.
- **Direct (in revise / revise-all):** `review.direct = { note, shots: [{ t, beat, cam: [...], note, marks, file | img, look? }] }` is the user's direction for the **whole part** (that tab). Its main purpose is **camera and cinematic control**: where to go close-up, where to zoom out, camera moves and the feel of the animations. `note` is the direction for the part. Each shot is a screenshot of the preview at time `t` (plan seconds, inside `beat`) with the user's drawings burned in (arrows, boxes, circles, lines, pen) and a comment. `file` is a path relative to the project folder (e.g. `Planner App/direct/P2-b1-x.jpg`); Read that image. `cam` tags are camera wishes at that moment, turn them into camera keys of that beat around `t`: **Close-up** = tight push on the subject the drawing marks (or the speaker), **Zoom in** = smooth push in, **Zoom out** = pull back, **Wide** = full frame / zoomed out, **Pan ←/→** = move the frame that way, **Impact** = quick punch-in or shake on the hit. Follow drawings and comments exactly; keep moves smooth unless asked. `look` means they drew on one of your looks.
- **Looks:** `review.looks[<beat>] = "<id>"` means "build this beat from my chosen look": use `suggest[<beat>]` entry with that id as the starting design (adapt timing to the beat), apply any notes/directs on top, then delete `suggest[<beat>]` and the `looks` entry.
- **suggest**: make **3 clearly different looks** for `request.beat` of that sequence and write them to the sequence as `suggest: { "<beat>": [ {id:"A", title, why, t, els, css?, cam?, fx?}, {id:"B",…}, {id:"C",…} ] }`. Keep the user's brand rules (CLAUDE.md) and any direction/notes in the summary.
  - `els` uses exactly the same format as that beat's `els` (cls, pos, html, in, out, …) with times inside the beat; `css` is extra CSS only for this look (prefix its classes with the look id, e.g. `.lkA-…`), `cam`/`fx` only if the look changes them.
  - `t` = the moment (seconds, plan time) where the look is fully on screen. The Planner app makes the screenshot itself from this; **do not render, do not make images**. `title` 2–4 words, `why` one short line.
  - Do not change `beats`, `version` or the user's review. Replace an older `suggest[<beat>]`. Then set `request.handled` and status done (seq name, 100). Reply in one line: the three look names.
- **ideas** (💡 Suggestions): make **4 clearly different suggestions for the whole part** (`request.sequence`) and write them to that sequence as
  `ideas: { at, note, history: [titles of every earlier suggestion], list: [ {id:"A", title, read, skill:{name, why}, shots:[t,…], beats:{ "<beatId>": {els, css?, cam?, fx?} }, css?}, … "D" ] }`.
  - `title` 2–5 words. `read` = 2–4 short sentences in simple Taglish the user reads in the window: what it looks like, the camera, why it fits this part.
  - `skill.name` = the skill that fits it best, from the table below; `skill.why` = one short line.
  - `beats` = only the beats this suggestion changes, in the same format as the part's beats (`els` with cls/pos/html/in/out inside the beat, optional `cam` keys and `fx`); `css` = extra CSS for it (prefix every class with the id, e.g. `.idA-…`).
  - `shots` = 1–3 plan times (seconds) where it looks best. **The Planner app makes the screenshots itself from this; do not render or make images.**
  - Use the user's taste: top-level `likes` in the project file (suggestions they starred), their `review.direct`, notes and CLAUDE.md brand rules. Never repeat a title in `ideas.history`; add the new titles to it.
  - Do not change `beats`, `version` or the review. Set `request.handled`, status done (seq name, 100). Reply in one line: the 4 titles.
- **review.idea = "<id>"** (in revise / revise-all): rebuild that part from `ideas.list[<id>]` with its skill (table below), then apply the user's notes and `review.direct` on top. Bump version/badge as usual; keep `ideas` so they can come back to it.
- **Skills for suggestions** (what to put in `skill.name`, and how to use it when it is applied). They are open-source libraries; when one is applied, fetch it once (`git clone --depth 1 <repo> ~/<name>` or `git -C ~/<name> pull`), read its SKILL.md / AGENTS.md for the technique, and build the look in the Planner's own format (els / css / cam). Only Export renders video.
  | name | best for | repo |
  |---|---|---|
  | `planner-css` | clean kinetic text, callouts, simple cards, fastest | — |
  | `video-shotcraft` | cinematic shot recipes: camera pushes, parallax, product/UI hero shots, beat sync | github.com/Vincentwei1021/video-shotcraft |
  | `remotion-video` | motion graphics, infographics, counters, text highlights, light leaks, 3D | github.com/remotion-dev/skills |
  | `lemo-opuscar` | a strong art style for the whole part (watercolor, oil paint, ukiyo-e, satellite briefing, exploded teardown) | github.com/lemomo-ai/lemo-opuscar |
  | `pixel2motion` | logo reveals and brand stings | github.com/nolangz/pixel2motion |
- **new**: design a new tab as CLAUDE.md describes (cut from Premiere via a read-only Claude Apply job, transcript words, beats, css).
- **apply / export**: render at source quality into `Assets\AI render\` as CLAUDE.md describes, then place or replace it on the Premiere sequence with a Claude Apply job. If a render tool is missing on this computer (python, playwright, ffmpeg), set the status to error "Render tools missing on this PC" and say the user can run the export from the Claude chat instead.

### Claude Apply (Premiere, no mouse)
Write ExtendScript to `Assets\AI render\_apply\<unique name>.job.json`. The Claude Apply panel in Premiere runs it and writes `<name>.done.json` (plus any result file your script writes). Wait for the done file (poll every 2 s, up to about 2 minutes). If nothing comes, Premiere or the panel is closed: leave the job there (it runs when the panel opens), set the status step to "Waiting for Premiere (Claude Apply)" and say so.

## 4. Save safely
- Re-read the `.planner` file right before writing. Change only the tabs you worked on; keep every other tab, `mirror` fields and the user's other edits exactly.
- For each tab you finished (revise / revise-all / apply): clear its `review` (keep `approved` if set; this also clears `direct` and `looks`) and remove its `timeline` edits. A **suggest** or **ideas** request clears nothing.
- Set `request.handled = true` (keep the rest of the request) and `savedAt` to now.
- Before writing, copy the old file to `Planner App\.backups\<name> <time>.planner`. Write JSON in one go.
- Set the status to done.

## 5. Tell the user
One or two short Taglish lines: what changed and that the tab updates by itself in the Planner app.
