import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';

const GUIDE = `# purplemux CLI HTTP API

Unless stated otherwise below, endpoints require header \`x-pmux-token: <PMUX_TOKEN>\`.

## Workspaces

GET /api/cli/workspaces
  Response: { "workspaces": [{ "id": "...", "name": "...", "directories": [...] }] }

POST /api/cli/workspaces
  Body: { "cwd": "/absolute/path", "name"?: "..." }
  Creates a new workspace through the shared Browser/CLI workspace runtime.
  This mutation is not idempotent and clients must not retry it automatically after an unknown outcome.
  Transport failures, invalid success responses, and server errors may mean creation committed;
  the CLI reports "outcome unknown; do not retry automatically" for these cases.
  Response: { "id": "ws-...", "name": "Workspace N", "directories": ["/absolute/path"],
              "initialTab": { "tabId": "tab-...", "workspaceId": "ws-...", "name": "",
                              "panelType": "terminal", "agentProviderId": null } }
  initialTab is the authoritative identity of the initial/default tab created by this mutation.

GET /api/cli/workspaces/<workspaceId>
  Read authoritative workspace state for mutation reconciliation.
  Response when present: { "workspaceId": "ws-...", "state": "present", "workspace": { ... } }
  Response when absent:  { "workspaceId": "ws-...", "state": "absent", "workspace": null }

DELETE /api/cli/workspaces/<workspaceId>?ifEmpty=true
  Atomically deletes the exact workspace only when it has no registered tabs or tmux sessions.
  The required ifEmpty=true guard prevents unconditional public deletion.
  Newly deleted (HTTP 200):
    { "workspaceId": "ws-...", "status": "deleted", "deleted": true }
  Already absent (HTTP 200; desired final state already holds):
    { "workspaceId": "ws-...", "status": "absent", "deleted": false }
  Non-empty (HTTP 409; no state is changed):
    { "workspaceId": "ws-...", "status": "not-empty", "deleted": false,
      "tabCount": 1, "sessionCount": 1 }
  If a response is lost or a 5xx result leaves the mutation outcome uncertain, use the GET
  endpoint above (or GET /api/cli/workspaces) to reconcile from authoritative server state.

## External tmux servers

These endpoints accept x-pmux-token or an authenticated browser session cookie.
Registration records a server/socket source, not a fixed session or window allowlist.

POST /api/cli/external-servers
  Body: { "socketPath": "/absolute/known/tmux/socket", "name": "dev-server" }
  Freezes the Unix socket identity and returns:
  { "id": "...", "name": "dev-server", "socketPath": "...", "socketIdentity": "opaque-frozen-identity" }
  The path must be absolute, must name a live tmux socket, and must not be the
  PurpleMux-owned purple socket. HTTP 400 reports invalid or unavailable sockets.
  CLI equivalent: purplemux external-server register --socket /absolute/path --name dev-server

GET /api/cli/external-servers
  Returns every registration with a fresh runtime inventory. A live server has
  { "id", "name", "socketPath", "socketIdentity", "exists": true,
    "sessions": [{ "id": "$0", "name", "exists": true, "attached",
      "windows": [{ "id": "@0", "name", "index", "exists": true, "active",
        "panes": [{ "id": "%0", "index", "exists": true, "active", "pid",
          "currentCommand", "currentPath", "dead" }] }] }] }
  An unavailable or replaced registered server has exists:false, sessions:[], and
  unavailableReason. Every discovered session, window, and pane remains an unowned
  external resource; registration does not grant PurpleMux lifecycle ownership.
  CLI equivalent: purplemux external-server list

GET /api/cli/external-servers/<serverId>/workspaces
  Returns a fresh Workspace/Tab adapter view of one registered server. Each live tmux
  session is a Workspace whose id is its stable $sessionId; each live window is a Tab
  whose id is its stable @windowId. Tabs include their pane metadata and the exact
  { "serverId", "sessionId", "windowId" } externalTerminalTarget. Unavailable registrations
  remain visible with exists:false and workspaces:[]. This view is rebuilt from tmux on
  every request and never persists external Workspaces or Tabs.

POST /api/cli/external-servers/<serverId>/workspaces/<$sessionId>/tabs
  Body: { "sessionCreated": "exact-tmux-session-creation-identity",
          "requestId": "client-stable-id" }
  Adds one unowned window to the exact live session represented by the Workspace.
  Response: { "tabId": "@7", "workspaceId": "$4", "sessionCreated": "...",
              "externalTerminalTarget": { "serverId": "...", "sessionId": "$4", "windowId": "@7" } }
  The returned stable IDs select the new Tab immediately. HTTP 409 reports session or
  socket identity drift; the operation never creates a session or writes Workspace state.

DELETE /api/cli/external-servers/<serverId>
  Removes only the registration, including when the server is unavailable.
  HTTP 200: { "deleted": true }; HTTP 404: { "error": "External server not found" }.
  CLI equivalent: purplemux external-server unregister SERVER_ID
  Never sends tmux commands or kills external sessions, windows, or panes.

The stable id identifies the registration. Every tmux operation rechecks the frozen
socket identity and fails closed if the path is missing or has been replaced.
Open /external-server in an authenticated browser to browse this same fresh inventory
and attach the normal interactive terminal to one exact discovered session/window.
Input, paste, resize, reconnect, and Terminal Copy are supported. Closing or detaching
the UI never kills the external session, window, or pane; target drift closes the
connection rather than following another window. There is no
interactive /external-target/<id> URL or ext-review-based interactive registration.

## External review (PurpleMux 0.5.0)

These endpoints accept x-pmux-token or an authenticated browser session cookie.
Definitions observe external tmux resources without adopting them into Workspaces or tabs.
Reviews remain a separate, read-only fixed-window observation feature.

POST /api/cli/ext-reviews
  Body: { "socketPath": "/absolute/known/tmux/socket", "session": "exact-session-name",
          "windowTargets": ["@1", "@3"] }
  Requires a known absolute socket path (no symlink or PurpleMux-owned purple socket),
  exact session name or $sessionId, and a nonempty list of unique @windowIds.
  No socket, session, or window discovery; validation never starts a tmux server.
  HTTP 201: { "id": "...", "createdAt": "...", "socketPath": "...",
              "socketIdentity": "...", "serverPid": "...", "sessionId": "$...",
              "sessionCreated": "...", "windowIds": ["@1", "@3"], "url": "/ext-review/<id>" }
  Invalid or unavailable creation targets return HTTP 400 with { "error": "..." }.
  CLI equivalent: purplemux ext-review create --socket /absolute/known/tmux/socket
                 --session 'exact-session-name' --window @1 --window @3
  CLI prints one JSON document with id and an absolute browser url.

GET /api/cli/ext-reviews
  Response: { "reviews": [{ "id", "createdAt", "socketPath", "socketIdentity",
                            "serverPid", "sessionId", "sessionCreated", "windowIds" }] }
  Lists persisted definitions, including unavailable ones; this is not target discovery.
  There is no ext-review list CLI command.

GET /api/cli/ext-reviews/<reviewId>
  Resolves the frozen allowlist against the persisted socket/server/session/window identities.
  HTTP 200: the definition fields above, without url.
  HTTP 404: { "error": "Review not found" }; HTTP 409: { "error": "..." } for changed/unavailable targets.
  CLI equivalent: purplemux ext-review get REVIEW_ID (prints JSON).

DELETE /api/cli/ext-reviews/<reviewId>
  Removes only the definition, even when its external resources are unavailable.
  HTTP 200: { "deleted": true }; HTTP 404: { "error": "Review not found" }.
  CLI equivalent: purplemux ext-review delete REVIEW_ID (prints JSON).
  Never sends tmux commands or kills external sessions/windows/panes.

Open the returned /ext-review/<id> url in an authenticated browser.
/ext-review lists definitions and supports manual explicit-target creation, Open, and definition-only Delete.
/ext-review/<id> shows only approved windows as live current-screen snapshots, not output history.
Observation is fixed and read-only: no input, paste, send-keys, kill, rename, or tmux resize.
Browser resizing affects only the local renderer. Added windows never enter the allowlist;
changed or missing frozen identities make the Review unavailable, with no recreation/substitution.
There is no target-update endpoint; explicitly create a new definition to change targets.
Definitions and external resources are excluded from Workspace ownership, discovery, and cleanup.

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
