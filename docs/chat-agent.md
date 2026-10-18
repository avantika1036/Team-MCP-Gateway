# Urumi Chat Agent

The `/chat/` page accepts a database-backed Urumi user API key (admin or member). It sends conversation text to `POST /api/chat`; the LLM provider credential remains in the gateway process and Kubernetes Secret.

The agent discovers tools through the gateway's Streamable HTTP MCP endpoint, then executes model-requested tools using the signed-in user's API key. Those tool calls traverse the normal gateway path and are recorded in PostgreSQL under the authenticated key identity. The browser never receives the provider API key.

## xAI / Grok configuration

The platform chart configures the xAI API at `https://api.x.ai/v1`, using `grok-4.7` and `POST /v1/responses`. Function tools use the Responses API format (`type`, `name`, `description`, `parameters`) and tool results are returned as `function_call_output` items. The implementation preserves returned response items, including Grok 4.7 encrypted reasoning items, unchanged in the next request. The request uses `store: false` and carries the stateless input history itself.

The chart expects a Secret named `urumi-llm-credentials` containing key `api-key`. Never commit the provider key or place it in Helm values.

## Request limits

The chat API accepts up to 20 user/assistant messages (24,000 total characters) and processes at most 12 tool calls across up to five function-calling rounds. The model uses live gateway tools for store facts, and tool calls/results are returned to the UI.
