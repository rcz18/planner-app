#!/bin/bash
# Removes the Planner Helper from this Mac (keeps Claude Code and your projects).
LABEL='com.rcz18.planner-helper'
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
JS=$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:1' "$PLIST" 2>/dev/null || true)
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
if [ -n "$JS" ] && [ "$(basename "$(dirname "$JS")")" = 'Planner Helper' ]; then rm -rf "$(dirname "$JS")"; fi
rm -rf "$HOME/.claude/skills/planner"
printf '\033[32mNatanggal na ang Planner Helper.\033[0m\n'
