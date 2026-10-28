#!/usr/bin/env bash
# Corncam guardrail: hackathon rule "generated fakes never leave the hackathon".
# Blocks Bash commands that would upload media files or data/ contents off this machine.
# Reads the PreToolUse JSON payload on stdin; prints a deny decision when it matches.

cmd="$(jq -r '.tool_input.command // empty')"
[ -z "$cmd" ] && exit 0

upload_re='(curl[^|;&]*(\s-F\s|\s--form|\s-T\s|--upload-file|--data-binary\s+@)|(^|\s)scp\s|rsync[^|;&]*\s[^ ]+:|(^|\s)(hf|huggingface-cli)\s+upload|gh\s+(release\s+upload|gist\s+create)|transfer\.sh|wetransfer|upload_file\(|fal_client\.upload)'
media_re='(\.(png|jpe?g|webp|gif|heic|mp4|mov|webm|avi|mkv|wav|mp3|m4a|flac|ogg)\b|(^|[ /"'"'"'])data/|/pool/|/fakes?/)'

if printf '%s' "$cmd" | grep -Eiq "$upload_re" && printf '%s' "$cmd" | grep -Eiq "$media_re"; then
  jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny",
    permissionDecisionReason: "Blocked by Corncam rule: generated media must never leave the hackathon machine (no uploads of media files or data/). If this is a hosted-generation call the team approved, run it yourself outside Claude Code."}}'
fi
exit 0
