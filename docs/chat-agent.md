# Urumi Chat Agent

The `/chat/` page accepts a database-backed Urumi user API key (admin or member). It sends conversation text to `POST /api/chat`; the LLM provider credential remains in the gateway process and Kubernetes Secret.

The agent discovers tools through the gateway's Streamable HTTP MCP endpoint, then executes model-requested tools using the signed-in user's API key. Those tool calls traverse the normal gateway path and are recorded in PostgreSQL under the authenticated key identity. The browser never receives the provider API key.

## Provider configuration

The default platform chart configures the **Groq OpenAI-compatible API** at `https://api.groq.com/openai/v1`, using model `openai/gpt-oss-120b` and the Responses API endpoint `/responses`. The implementation sends function tools in Responses API format (`type`, `name`, `description`, `parameters`) and returns tool results as `function_call_output` items. The request uses `store: false`; prior response items are carried forward by the gateway rather than relying on provider-side response storage.

The platform chart expects a Secret named `urumi-llm-credentials` with key `api-key`. Never commit the provider key or place it in Helm values. To use another compatible provider, override `chat.llm.baseUrl` and `chat.llm.model`, then verify that the provider supports the Responses API's function-calling request/response format used by this implementation.

## Request limits and behavior

The chat API accepts up to 20 user/assistant messages, with each message limited to 6,000 characters. It processes at most 12 tool calls across up to five function-calling rounds. The model uses live gateway tools for store facts; tool calls and results are returned to the UI. When a tool fails, the agent should describe the failure rather than claim the operation succeeded.
