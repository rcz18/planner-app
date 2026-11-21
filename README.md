# Planner

A small video-editing planner app (Windows + Mac, installs from Chrome).

- **Open / Save / Save As** `.planner` project files (they stay on your own drive).
- **Preview** the plan live over the video, with text, animations and camera moves.
- **Timeline** like Premiere: beats, words, text/animation tracks, video thumbnails, camera keys, audio waveform. Drag clips to move them, drag edges to trim.
- **Review**: Approve / Make something else / No graphic and notes per beat, then **Revise** or **Apply**: the request is saved into the project file and one line is copied for the Claude chat.

Open it at https://rcz18.github.io/planner-app/ in Chrome and click **Install** in the address bar.

## Claude Code on your computer (Planner Helper)

Lets Revise / Apply all changes / Export go straight to Claude Code (uses your Claude subscription, no API).

- **Windows** (PowerShell): `irm https://raw.githubusercontent.com/rcz18/planner-app/main/helper/setup.ps1 | iex`
- **Mac** (Terminal): `curl -fsSL https://raw.githubusercontent.com/rcz18/planner-app/main/helper/setup-mac.sh | bash`

Run the same command again to update. To remove: `uninstall.ps1` (Windows) or `uninstall-mac.sh` (Mac), same way.
