import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';

const GUIDE = `# purplemux CLI HTTP API

All endpoints require header \`x-pmux-token: <PMUX_TOKEN>\`.

## Workspaces

GET /api/cli/workspaces
  Response: { "workspaces": [{ "id": "...", "name": "...", "directories": [...] }] }

POST /api/cli/workspaces
  Body: { "cwd": "/absolute/path", "name"?: "..." }
  Creates a new workspace through the shared Browser/CLI workspace runtime.
  This mutation is not idempotent and clients must not retry it automatically after an unknown outcome.
  Transport failures, invalid success responses, and server errors may mean creation committed;
  the CLI reports "outcome unknown; do not retry automatically" for these cases.
  Response: { "id": "ws-...", "name": "Workspace N", "directories": ["/absolute/path"] }

## Tabs

GET /api/cli/tabs?workspaceId=WS
  List tabs. Without workspaceId, lists tabs across all workspaces.
  Response: { "tabs": [{ "tabId", "workspaceId", "name", "sessionName", "panelType", "agentProviderId", "agentSessionId" }] }

POST /api/cli/tabs
  Body: { "workspaceId": "WS", "name"?: "...", "panelType"?: "terminal" | "claude-code" | "codex-cli" | "agent-sessions" | "web-browser" | "diff" }
  Invalid panelType returns HTTP 400 with validPanelTypes.
  Creates a tab in the first pane of the workspace.
  Response: { "tabId", "workspaceId", "paneId", "sessionName", "name", "panelType", "agentProviderId", "agentSessionId" }

GET /api/cli/tabs/<tabId>?workspaceId=WS
  Tab info.
  Response: { "tabId", "workspaceId", "paneId", "name", "sessionName", "panelType", "agentProviderId", "agentSessionId" }

DELETE /api/cli/tabs/<tabId>?workspaceId=WS
  Close the tab (kills tmux session and removes from layout).

POST /api/cli/tabs/<tabId>/send?workspaceId=WS
  Body: { "content": "..." }
  Submit text using the shared Browser/CLI agent-input semantics.
  Single-line input is literal text; multiline input uses bracketed paste.
  Both wait briefly and send Enter once.
  Response: { "status": "sent" }

POST /api/cli/tabs/<tabId>/interrupt?workspaceId=WS
  Send the shared ESC ESC interrupt sequence to the foreground agent.
  Agent state is updated only by provider hooks/runtime snapshots.
  Response: { "status": "interrupted" }

GET /api/cli/tabs/<tabId>/status?workspaceId=WS
  Agent runtime fields come from live StatusManager state. If no matching live entry exists,
  persisted layout state is used as a recovery fallback. Tmux fields are lifecycle metadata only.
  Response: { "tabId", "workspaceId", "panelType", "alive", "command", "currentCommand",
              "cliState", "agentProviderId", "agentSessionId", "claudeSessionId",
              "currentAction"?, "lastAssistantMessage"?, "lastUserMessage"?, "lastEvent"?,
              "eventSeq"?, "busySince"?, "readyForReviewAt"?, "permissionRequest"? }

GET /api/cli/tabs/<tabId>/result?workspaceId=WS
  Read the latest completed assistant response from the provider JSONL timeline.
  This never falls back to terminal pane capture and does not infer agent state.
  Response: { "tabId", "workspaceId", "panelType", "agentProviderId", "agentSessionId",
              "status": "completed" | "not-ready" | "interrupted" | "not-applicable" | "unavailable",
              "reason", "text", "completed", "timestamp", "completionTimestamp", "interrupted" }
  If a newer turn was interrupted, the previous completed response remains available with
  "status": "completed" and "interrupted": true. An interrupted first turn has no text and
  returns "status": "interrupted".

GET /api/cli/tabs/<tabId>/capture?workspaceId=WS
  Capture the current terminal pane content. This is a screen snapshot, not an agent result.
  Response: { "content": "..." }

## Web-browser tabs

These endpoints only work when the tab's panelType is "web-browser" and the webview
has attached (dom-ready has fired at least once). Electron runtime required;
503 is returned in headless/remote mode.

GET /api/cli/tabs/<tabId>/browser/url?workspaceId=WS
  Current URL + title of the webview.
  Response: { "tabId", "url", "title" }

GET /api/cli/tabs/<tabId>/browser/screenshot?workspaceId=WS[&full=1][&format=base64]
  PNG screenshot. Default returns image/png; format=base64 returns { base64 } JSON.
  full=1 captures beyond the viewport.

GET /api/cli/tabs/<tabId>/browser/console?workspaceId=WS[&since=MS][&level=LEVEL]
  Ring buffer (last 500 entries) of console messages, Log entries, and exceptions.
  Response: { "tabId", "entries": [{ "level", "text", "ts", "source"?, "url"?, "line"? }] }

GET /api/cli/tabs/<tabId>/browser/network?workspaceId=WS[&since=MS][&method=M][&url=SUBSTR][&status=CODE]
  Ring buffer (last 500 requests).
  Response: { "tabId", "entries": [{ "requestId", "method", "url", "status"?, "mimeType"?,
                                     "resourceType"?, "error"?, "ts", "endedAt"? }] }

GET /api/cli/tabs/<tabId>/browser/network?workspaceId=WS&requestId=RID
  Fetch response body for one request (cached after first call).
  Response: { "tabId", "requestId", "body" }

POST /api/cli/tabs/<tabId>/browser/eval?workspaceId=WS
  Body: { "expression": "..." }
  Evaluates the expression in the webview via CDP Runtime.evaluate
  (returnByValue, awaitPromise, 10s timeout).
  Response: { "tabId", "value" }
`;

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCliToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  return res.status(200).send(GUIDE);
};

export default handler;
