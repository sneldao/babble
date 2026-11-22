#!/usr/bin/env bash
# Babble × OpenClaw × Cerebras setup.
# Usage: CEREBRAS_API_KEY=csk-... [NEBIUS_API_KEY=...] ./scripts/setup-openclaw.sh
# NEBIUS_API_KEY adds the GPU race lane (agent babble-gpu, same workspace).
# The gateway must see the same keys in its environment.
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
        models: [{
          id: "$MODEL_ID", name: "Kimi K3.1 Pro (trial, Cerebras)", input: ["text", "image"],
          // K3.1 Pro always reasons; without these OpenClaw sends no reasoning_effort
          // and the model runs at its default, max. "low" is the floor.
          reasoning: true,
          compat: {
            supportsReasoningEffort: true,
            supportedReasoningEfforts: ["low", "medium", "high", "max"],
            reasoningEffortMap: { off: "low", minimal: "low" },
          },
        }],
      },
    },
  },
  agents: { defaults: {
    model: { primary: "cerebras/$MODEL_ID" },
    // x-openclaw-model overrides are rejected unless the model is listed here.
    modelPolicy: { allow: ["cerebras/$MODEL_ID"] },
  } },
  gateway: {
    auth: { mode: "token", token: "$GW_TOKEN" },
    http: { endpoints: { chatCompletions: { enabled: true } } },
  },
}
JSON5

echo "▸ dedicated babble agent"
openclaw agents add babble --workspace "$PWD/agent-workspace" \
  --model "cerebras/$MODEL_ID" --non-interactive || true
# One fast pass per capture: low reasoning, no skills, and tools only for the
# SESSION END memory write, confined to the workspace.
openclaw config patch --stdin <<JSON5
{
  agents: { entries: { babble: {
    thinkingDefault: "low",
    skills: [],
    tools: { allow: ["read", "write", "edit"], fs: { workspaceOnly: true } },
  } } },
}
JSON5

if [ -n "${NEBIUS_API_KEY:-}" ]; then
  echo "▸ GPU race lane: nebius provider + babble-gpu agent (same workspace)"
  openclaw config patch --stdin <<JSON5
{
  models: { mode: "merge", providers: { nebius: {
    baseUrl: "https://api.tokenfactory.nebius.com/v1",
    apiKey: "\${NEBIUS_API_KEY}",
    api: "openai-completions",
    models: [{
      id: "moonshotai/Kimi-K3.1-Pro", name: "Kimi K3.1 Pro (Nebius, GPU)", input: ["text", "image"],
      reasoning: true,
      compat: {
        supportsReasoningEffort: true,
        supportedReasoningEfforts: ["low", "high", "max"],
        reasoningEffortMap: { off: "low", minimal: "low", medium: "high" },
        // Without this, OpenClaw omits stream_options.include_usage for a
        // custom endpoint and Nebius returns no token usage.
        supportsUsageInStreaming: true,
      },
    }],
  } } },
}
JSON5
  openclaw agents add babble-gpu --workspace "$PWD/agent-workspace" \
    --model "nebius/moonshotai/Kimi-K3.1-Pro" --non-interactive || true
  openclaw config patch --stdin <<JSON5
{ agents: {
  defaults: { modelPolicy: { allow: ["cerebras/$MODEL_ID", "nebius/moonshotai/Kimi-K3.1-Pro"] } },
  entries: { "babble-gpu": { thinkingDefault: "low", skills: [], tools: { allow: [] } } },
} }
JSON5
fi

echo "▸ gateway token → .env"
printf "OPENCLAW_TOKEN=%s\nBABBLE_MODEL=openclaw/babble\n" "$GW_TOKEN" > .env
echo "   (server reads OPENCLAW_TOKEN from env or .env — source it:  export \$(cat .env | xargs))"

echo "▸ start gateway (foreground: openclaw gateway run --force)"
openclaw gateway run --force --port 18789 &
sleep 3
openclaw models list --provider cerebras || true
echo "✔ done — verify: curl -s http://127.0.0.1:18789/v1/models -H 'Authorization: Bearer $GW_TOKEN'"
