#!/usr/bin/env bash
# Babble × OpenClaw × Cerebras setup.
# Usage: CEREBRAS_API_KEY=csk-... ./scripts/setup-openclaw.sh
set -euo pipefail
cd "$(dirname "$0")/.."

: "${CEREBRAS_API_KEY:?export CEREBRAS_API_KEY first}"
MODEL_ID="moonshotai-kimi-k3.1-pro-trial"
GW_TOKEN="${OPENCLAW_TOKEN:-babble-$(openssl rand -hex 8)}"

echo "▸ onboard (cerebras provider)"
openclaw onboard --non-interactive --accept-risk --skip-health --mode local \
  --auth-choice cerebras-api-key --cerebras-api-key "$CEREBRAS_API_KEY" || true

echo "▸ cerebras provider plugin"
openclaw plugins install @openclaw/cerebras-provider || true

echo "▸ config patch: trial model + chat-completions endpoint + token auth"
openclaw config patch --stdin <<JSON5
{
  models: {
    mode: "merge",
    providers: {
      cerebras: {
        baseUrl: "https://api.cerebras.ai/v1",
        apiKey: "\${CEREBRAS_API_KEY}",
        api: "openai-completions",
        models: [{ id: "$MODEL_ID", name: "Kimi K3.1 Pro (trial, Cerebras)", input: ["text", "image"] }],
      },
    },
  },
  agents: { defaults: { model: { primary: "cerebras/$MODEL_ID" } } },
  gateway: {
    auth: { mode: "token", token: "$GW_TOKEN" },
    http: { endpoints: { chatCompletions: { enabled: true } } },
  },
}
JSON5

echo "▸ dedicated babble agent"
openclaw agents add babble --workspace "$PWD/agent-workspace" \
  --model "cerebras/$MODEL_ID" --non-interactive || true

echo "▸ gateway token → .env"
printf "OPENCLAW_TOKEN=%s\nBABBLE_MODEL=openclaw/babble\n" "$GW_TOKEN" > .env
echo "   (server reads OPENCLAW_TOKEN from env or .env — source it:  export \$(cat .env | xargs))"

echo "▸ start gateway (foreground: openclaw gateway run --force)"
openclaw gateway run --force --port 18789 &
sleep 3
openclaw models list --provider cerebras || true
echo "✔ done — verify: curl -s http://127.0.0.1:18789/v1/models -H 'Authorization: Bearer $GW_TOKEN'"
