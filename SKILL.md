---
name: planner
description: Carry out the latest request saved by the Planner app (New / Revise / Suggest looks / Apply / Export / Apply all changes) in a .planner project file. Use when the prompt says "Use the planner skill" or starts with /planner.
---

# Planner: do the latest request (Claude Code on the user's computer)

The Planner app (https://rcz18.github.io/planner-app) saves a request into a `.planner` project file and the Planner Helper starts you with the file path and the request line. You run on the user's own computer, so read and write the files directly. The user is a video editor. Reply at the end in short, simple Taglish (one or two lines).

## Hard rules
- The prompt says which computer you are on. On a **Mac**, paths use `/` (e.g. `Planner App/planner-status.json`, `Assets/AI render/_apply/`), and the user saves with **Cmd+S**. Windows paths in this skill or CLAUDE.md mean the same folders.
- Never move the user's mouse or keyboard and never operate Premiere's UI. Premiere work goes only through **Claude Apply job files** (below).
- Never save the Premiere project. The user presses Ctrl+S.
- Never touch other sequences or the user's own review/timeline edits in the `.planner` file except the ones the request names.
- Do not ask questions; there is nobody to answer. Take the most reasonable reading and say which one at the end.

## 1. Read
1. Read the `.planner` file (JSON). `request` = `{ kind: "new" | "revise" | "revise-all" | "suggest" | "apply", sequence, sequences?, beat?, at, summary, handled? }`. If there is no request or `handled: true`, say there is nothing new and stop.
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
- **Layers (in revise / revise-all):** `review.layers = { deleted?, added?, order? }` from the timeline. `deleted`: element keys like `"b2:3"` (beat id : index in `els`) the user deleted; remove them. `added`: the user's new text layers `{ id, text, t0, t1 }`; build each as a real text element in the brand style (CLAUDE.md), at the time and place the user set (their changes are in `timeline["u:<id>"]` and `review.moves["u:<id>"]`; the layer starts centered across the frame at 62% height). `order`: every element key back → front; reorder the elements so later ones draw in front, exactly as listed. The request summary also spells these out.
- **Brand (top-level `brand`, app v17.6+):** the project's brand guidelines from the Planner's 🎨 Brand window: `{ colors: [{name, hex, use}], fonts: [{role, family, weight, use}], logos: [{name, file | data}], rules, links }` (`file` is relative to the project folder, e.g. `Planner App/brand/logo.png`). Use it for every graphic in every request; when it differs from CLAUDE.md, the Brand window wins (the user edits it). Never clear or change it unless the request is **brand**: then fill / update it (from CLAUDE.md, the links, existing graphics), copy logo files into `Planner App/brand/`, keep what the user wrote unless it is wrong, change no sequence, set `request.handled`, status done (seq "Brand", 100).
- **Markers (`review.marks = [{ id, t, note }]`, app v17.6+):** a comment the user pinned at an exact time (plan seconds) on the timeline. Do each note at exactly that time. When you clear the review, markers you did go away with it; keep (put back) markers that have **no note**, they are only the user's bookmarks.
- **Mute (`review.layers.mute`, app v17.6+):** element keys the user switched with Shift+E. A key whose element has no `off` → set `off: true` on that element (keep it in the plan, never render it). A key whose element already has `off: true` → remove `off` (on again). The engine hides `off` elements, so Export never shows them. A muted photo/video suggestion has `off: true` in `review.media`: ignore it.
- **Camera keys (`review.cams = [{ t, s, x, y, ease? }]`):** `ease` = how the camera gets to that key: none = smooth, `"lin"` = linear, `"cut"` = jump. In beat `cam` arrays that is `[t, zoom, x, blur, scrim, cut?, "e" for smooth, y]`.
- **New sequence CSS:** always keep the shared base CSS (the part of an existing hook's `css` before its `/* ===== H# ===== */` marker: `.ov` show/hide, stage, roto guide, 3D text) and add the hook's own rules after `/* ===== H# ===== */`. Without it nothing hides when its time ends (H20 v1 bug).
- **Real 3D (Three.js, app v17.4+):** an element may carry `three: { scene: "<file in scenes3d/>", opts: {...} }` (or `code: "<ES module source>"`) instead of html; the engine gives it a full-frame WebGL canvas and calls the scene's `render(localTime)` every frame, so pause, scrub and export follow the plan time. Use it when the user wants smooth 3D (thick glossy objects, real light). Library scenes live in the repo's `scenes3d/` (e.g. `orbit` = offers orbiting the speaker; `opts.half` "back" | "front" | "all" for roto shots: back layer under the roto, front layer over it). New scenes: add a file to `scenes3d/` in rcz18/planner-app (default export `async ({ THREE, renderer, opts, dur, RoomEnvironment, RoundedBoxGeometry }) => ({ render(t), resize?(w,h), dispose?() })`). **Export:** copy `vendor/` and `scenes3d/` next to engine.js in the render folder and `await pv.ready3d()` before the first frame.
- **Direct (in revise / revise-all):** `review.directs[<beat>] = { note, shots: [{ t, note, marks, file | img, look? }] }` is the user's direction for that whole beat. `note` is the direction. Each shot is a screenshot of the preview as the user saw it, with their drawings (arrows, boxes, circles, lines, pen) burned in and a comment. `file` is a path relative to the project folder (e.g. `Planner App/direct/H1-B3-x.jpg`); Read that image. Follow the drawings and comments exactly. `look` means they drew on one of your looks.
- **Looks:** `review.looks[<beat>] = "<id>"` means "build this beat from my chosen look": use `suggest[<beat>]` entry with that id as the starting design (adapt timing to the beat), apply any notes/directs on top, then delete `suggest[<beat>]` and the `looks` entry.
- **suggest**: make **3 clearly different looks** for `request.beat` of that sequence and write them to the sequence as `suggest: { "<beat>": [ {id:"A", title, why, t, els, css?, cam?, fx?}, {id:"B",…}, {id:"C",…} ] }`. Keep the user's brand rules (CLAUDE.md) and any direction/notes in the summary.
  - `els` uses exactly the same format as that beat's `els` (cls, pos, html, in, out, …) with times inside the beat; `css` is extra CSS only for this look (prefix its classes with the look id, e.g. `.lkA-…`), `cam`/`fx` only if the look changes them.
  - `t` = the moment (seconds, plan time) where the look is fully on screen. The Planner app makes the screenshot itself from this; **do not render, do not make images**. `title` 2–4 words, `why` one short line.
  - Do not change `beats`, `version` or the user's review. Replace an older `suggest[<beat>]`. Then set `request.handled` and status done (seq name, 100). Reply in one line: the three look names.
- **new**: design a new tab as CLAUDE.md describes (cut from Premiere via a read-only Claude Apply job, transcript words, beats, css).
- **apply / export**: render at source quality into `Assets\AI render\` as CLAUDE.md describes, then place or replace it on the Premiere sequence with a Claude Apply job. If a render tool is missing on this computer (python, playwright, ffmpeg), set the status to error "Render tools missing on this PC" and say the user can run the export from the Claude chat instead.

### Claude Apply (Premiere, no mouse)
Write ExtendScript to `Assets\AI render\_apply\<unique name>.job.json`. The Claude Apply panel in Premiere runs it and writes `<name>.done.json` (plus any result file your script writes). Wait for the done file (poll every 2 s, up to about 2 minutes). If nothing comes, Premiere or the panel is closed: leave the job there (it runs when the panel opens), set the status step to "Waiting for Premiere (Claude Apply)" and say so.

## 4. Save safely
- Re-read the `.planner` file right before writing. Change only the tabs you worked on; keep every other tab, `mirror` fields and the user's other edits exactly.
- For each tab you finished (revise / revise-all / apply): clear its `review` (keep `approved` if set; this also clears `directs` and `looks`) and remove its `timeline` edits. A **suggest** or **brand** request clears nothing. Never remove the top-level `brand`.
- Set `request.handled = true` (keep the rest of the request) and `savedAt` to now.
- Before writing, copy the old file to `Planner App\.backups\<name> <time>.planner`. Write JSON in one go.
- Set the status to done.

## 5. Tell the user
One or two short Taglish lines: what changed and that the tab updates by itself in the Planner app.
