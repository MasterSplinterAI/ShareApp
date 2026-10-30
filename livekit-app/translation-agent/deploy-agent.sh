#!/bin/bash
# Deploy a LiveKit Cloud agent with build traceability.
#
#   ./deploy-agent.sh                          # stable agent (livekit.toml)
#   ./deploy-agent.sh livekit-codeswitch.toml  # codeswitch agent (production default)
#
# Stamps AGENT_BUILD_REF with the current git commit so the agent's startup
# log ("build_ref=...") always identifies the deployed code. Without this,
# prod logs show build_ref=unknown and deploys can't be traced to a commit.
set -euo pipefail

cd "$(dirname "$0")"
CONFIG="${1:-livekit.toml}"

if [ ! -f "$CONFIG" ]; then
  echo "Config not found: $CONFIG" >&2
  exit 1
fi

REF="$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  echo "Warning: working tree is dirty — deploying committed code at $REF plus uncommitted local files." >&2
fi

echo "Deploying $CONFIG at commit $REF (AGENT_BUILD_REF=$REF)"
lk agent deploy --config "$CONFIG" --secrets "AGENT_BUILD_REF=$REF"
