#!/usr/bin/env bash
set -euo pipefail

FEATURE="$*"
ROOT="$(pwd)"

run_codex() {
  local prompt="$1"
  codex exec --cd "$ROOT" --ask-for-approval never "$prompt"
}

run_codex '$speckit-specify '"$FEATURE"

run_codex '$speckit-clarify
If clarification is required, write the questions to the spec artifacts and stop. Otherwise proceed with reasonable assumptions.'

run_codex '$speckit-plan
Use the existing project stack and architecture unless the spec explicitly says otherwise.'

run_codex '$speckit-tasks'

run_codex '$speckit-implement
After implementation, run the project test/typecheck/lint commands you find in package.json or equivalent.'