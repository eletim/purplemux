# UI / CLI runtime path investigation

## Purpose

Browser UIとCLIがPurpleMuxの同じserver-side runtime semanticsを利用できる構造にするため、現在の経路差分を調査した記録。

この調査は、特に次の疑問に答えることを目的とする。

- Browser UIでCodex / Claude agent tabを作成した場合、どのserver-side provider、tmux、status trackingを通るか。
- `purplemux tab create -t codex-cli` がBrowser UIと同じCodex起動経路を通るか。
- create以外のsend、status、result、interrupt、closeがUIとCLIで同じprimitiveを利用しているか。
- 既存のprovider / status-manager / timeline / tmux semanticsを再利用して、UIとCLIの入口を薄くできるか。
- 新しいLangGraph runtimeやCLI専用runtimeを作る必要があるか。

調査はコードリーディングにより行った。この文書の時点ではruntime実装の変更は行っていない。

## Executive summary

`purplemux tab create -w ... -t codex-cli` は、Browser UIの正規Codex起動経路を通らない。

Browser UIは `codexProvider.buildLaunchCommand()` でPurpleMux管理のCodex launcher commandを作り、launcherがserverからhook、developer instructions、permission設定を含むruntime argsを取得してCodexを起動する。一方、CLI createは `panelType: "codex-cli"` のtabとtmux shellを作るだけで、Codex processを起動しない。また、CLI createは即時の `StatusManager.registerTab()` と `StatusManager.markAgentLaunch()` も行わない。

create以外も完全には統一されていない。

- UIのagent sendはterminal WebSocket経由のPTY write、CLI sendはtmux `send-keys`を使ったbracketed paste + Enter 2回である。
- UI statusのSoTはin-memory `StatusManager`、CLI statusはlayoutへpersistされた `tab.cliState` とtmux current commandである。
- UI timelineのSoTはproviderが検出したJSONLとstructured parser、CLI resultはtmux pane captureである。
- UI interruptはterminalへESCを2回送るが、CLIにはinterrupt operationがない。
- closeはUIとCLIの双方が `removeTabFromPane()` と `killSession()` を使用しており、core lifecycle semanticsはほぼ共通である。

新しいagent engineは不要である。必要なのは、既存provider、status-manager、timeline parser、tmux helperを束ねる薄いserver-side orchestration layerである。

## Current architecture

現在の構造はoperationごとに異なる。createの主要経路は次のようになっている。

```text
Browser UI
  ├─> POST /api/codex/launch-command
  │     └─> codexProvider.buildLaunchCommand()
  └─> POST /api/layout/pane/:paneId/tabs { command }
        ├─> layout-store.addTabToPane()
        │     ├─> tmux.createSession()
        │     ├─> tmux.sendKeys(command)
        │     └─> layout.json
        └─> StatusManager.registerTab() / markAgentLaunch()

CLI
  └─> POST /api/cli/tabs { panelType: "codex-cli" }
        └─> layout-store.addTabToPane() without command
              ├─> tmux.createSession()
              └─> layout.json

Runtime observation
  ├─> provider.detectActiveSession() / isAgentRunning() / watchSessions()
  ├─> provider.readRuntimeSnapshot()
  ├─> timeline-server + provider JSONL parser
  ├─> status-manager
  └─> tmux.ts process/session metadata
```

Browser UIにはさらに3つのWebSocket経路がある。

```text
/api/terminal
  -> terminal-server.handleConnection()
  -> node-pty attached to tmux

/api/timeline
  -> timeline-server.handleTimelineConnection()
  -> provider session detection
  -> provider JSONL watcher/parser

/api/status
  -> status-server.handleStatusConnection()
  -> StatusManager in-memory state
```

WebSocketのroute登録は `server.ts` の `createWsServers()` と `handleWsUpgrade()` にある。

現在は「共通server runtimeが一つ存在し、その上にUI/CLIが載る」というより、provider、status-manager、timeline-server、layout-store、tmux.tsという既存のruntime部品を、各API handlerが異なる組み合わせで直接利用している。

## Browser UI paths

### create: new Codex tab

Desktop Browser UIの完全なcall graphは次のとおり。

```text
src/components/features/workspace/pane-new-tab-menu.tsx
  PaneNewTabMenu.handleSelect()
  -> handleStartAgent('codex')
  -> launchCodexNewConversation()
  -> src/lib/providers/codex/client.ts
       fetchCodexLaunchCommand(workspaceId)
  -> POST /api/codex/launch-command

src/pages/api/codex/launch-command.ts
  handler()
  -> checkAgentAvailabilityForPanelType(codexProvider.panelType)
  -> codexProvider.buildLaunchCommand({ workspaceId })

src/lib/providers/codex/index.ts
  codexProvider.buildLaunchCommand()
  -> composeLaunchCommand()
  -> ensureCodexLauncherScript()
  -> command: node ~/.purplemux/codex-launcher.js --workspace-id ...

Browser receives command
  -> PaneNewTabMenu.onCreateTab('codex-cli', { command })
  -> src/components/features/workspace/pane-container.tsx
       PaneContainer.handleCreateTab()
  -> src/hooks/use-layout.ts
       useLayoutStore.createTabInPane()
  -> POST /api/layout/pane/:paneId/tabs
       body: { cwd, panelType: 'codex-cli', command }

src/pages/api/layout/pane/[paneId]/tabs/index.ts
  handler()
  -> checkAgentAvailabilityForPanelType(panelType)
  -> addTabToPane(wsId, paneId, name, cwd, panelType, command)

src/lib/layout-store.ts
  addTabToPane()
  -> workspaceSessionName()
  -> tmux.createSession(sessionName, 80, 24, cwd)
  -> tmux.sendKeys(sessionName, command)
  -> create ITab
  -> writeLayoutFile(layout, layoutPath)

tmux shell executes ~/.purplemux/codex-launcher.js
  -> POST /api/codex/launch-args

src/pages/api/codex/launch-args.ts
  handler()
  -> buildCodexRuntimeArgs(workspaceId, resumeSessionId)

src/lib/providers/codex/index.ts
  buildCodexRuntimeArgs()
  -> getDangerouslySkipPermissions()
  -> buildCodexHookFlags()
  -> buildDeveloperInstructionsArgs()
  -> add resume args when requested
  -> add --yolo when configured
  -> launcher spawn('codex', args, { stdio: 'inherit' })

src/pages/api/layout/pane/[paneId]/tabs/index.ts
  after addTabToPane()
  -> getProviderByPanelType(tab.panelType)
  -> StatusManager.registerTab(tab.id, initialEntry)
  -> StatusManager.markAgentLaunch(tab.id) when command was supplied
  -> return ITab

Browser receives ITab
  -> useTabStore.initTab()
  -> set session view to 'check'
  -> active tab connects to /api/terminal
  -> CodexPanel connects to /api/timeline?panelType=codex-cli
  -> global useAgentStatus() receives /api/status updates
```

#### Codex provider launch semantics

`src/lib/providers/codex/index.ts` の `codexProvider.buildLaunchCommand()` はCodex binaryを直接含む固定commandを返さない。`composeLaunchCommand()` が管理対象の `~/.purplemux/codex-launcher.js` を生成し、そのlauncherを起動するcommandを返す。

launcherは実行時に `POST /api/codex/launch-args` を呼ぶ。`buildCodexRuntimeArgs()` は次の既存semanticsを一か所に集約している。

- `src/lib/providers/codex/hook-config.ts` の `buildCodexHookFlags()` によるPurpleMux hookとユーザーhookのmerge。
- `src/lib/providers/codex/prompt.ts` で管理されるworkspace developer instructions。
- `getDangerouslySkipPermissions()` に対応する `--yolo`。
- resume時の `resume <sessionId>`。
- session ID format validation。

Codex hook scriptは `src/lib/hook-settings.ts` の `CODEX_HOOK_SCRIPT_CONTENT` で管理される。hook実行時にtmux session nameを取得し、次へ送る。

```text
POST /api/status/hook?provider=codex&tmuxSession=<session>
```

#### Layout/status ordering

現状の `addTabToPane()` は次の順で処理する。

1. `createSession()`
2. commandがあれば `sendKeys()`
3. tab object作成
4. layoutへtabを追加して保存
5. API handlerへreturn
6. API handlerが `StatusManager.registerTab()`
7. API handlerが `StatusManager.markAgentLaunch()`

したがってcommand launchがstatus registrationより先である。通常はlauncherとCodexの起動時間があるため動作するが、hookが極端に早く到着した場合、`StatusManager` がtmux sessionからtab IDを解決できずhookを無視するraceの余地がある。shared create primitiveではstatus登録をlaunchより前に行うのが望ましい。

#### Mobile UI

Mobile UIも同じruntime semanticsを利用する。

```text
src/components/features/mobile/mobile-new-tab-dialog.tsx
  MobileNewTabDialog.handleStartNew()
  -> symbolic command 'codex-new'

src/components/features/mobile/mobile-terminal-page.tsx
  handleCreateTab()
  -> fetchCodexLaunchCommand(activeWorkspaceId)
  -> useLayoutStore.createTabInPane(..., command)
```

### create: Claude note

Claude providerには `src/lib/providers/claude/index.ts` の `claudeProvider.buildLaunchCommand()` が存在する。しかしBrowser UIの新規Claude起動はprovider methodを呼ばず、browser-safeな `src/lib/providers/claude/client.ts` の `buildClaudeLaunchCommand()` を使用する。

```text
PaneNewTabMenu.handleStartAgent('claude')
  -> buildClaudeLaunchCommand() in providers/claude/client.ts
  -> onCreateTab('claude-code', { command })
  -> layout API / addTabToPane()
```

現在server provider版とclient版はほぼ同じflagsを生成するが、command compositionが二重実装になっている。共通化ではClaudeもserver-side `provider.buildLaunchCommand()` をSoTにするべきである。

### send

Browser UIにはraw terminal inputとagent composer inputの2経路がある。

#### Raw terminal input

```text
src/hooks/use-terminal.ts
  terminal.onData(data)
  -> PaneContainer/useTerminalWebSocket.sendStdin(data)
  -> encodeStdin(data)
  -> WebSocket /api/terminal

src/lib/terminal-server.ts
  handleConnection()
  -> handleMessage(MSG_STDIN)
  -> ptyProcess.write(data)
  -> node-pty attached to tmux session
  -> tmux / foreground process
```

raw terminal inputはterminalが生成したbyte sequenceをそのままPTYへ渡す。Enter、Ctrl+C、矢印キーなどは通常のterminal semanticsになる。

#### Agent WebInput composer

```text
src/components/features/workspace/web-input-bar.tsx
  WebInputBar
  -> src/hooks/use-web-input.ts
       useWebInput.send()
  -> sendWebStdin(text or bracketed-paste text)
  -> after submitDelayMs, sendWebStdin('\r')
  -> WebSocket /api/terminal as MSG_WEB_STDIN

src/lib/terminal-server.ts
  handleMessage(MSG_WEB_STDIN)
  -> tmux.exitCopyMode(sessionName)
  -> ptyProcess.write(data)
```

submit semanticsは次のとおり。

- 空白だけのmessageは送らない。
- 単一行はplain textで送る。
- 改行を含む場合だけbracketed pasteを使う。
- text送信後、既定250ms後に `\r` を1回送る。
- `/new` と `/clear` はterminalへ送らずsession restart callbackを呼ぶ。
- pending user messageはtimeline上でoptimistic表示される。

timeline permission/plan/ask-user UIの一部は `POST /api/tmux/send-input` を使用し、`src/lib/tmux.ts` の `sendRawKeys()` を呼ぶ。これはWebInput composerの一般message submit経路とは別である。

### status

```text
src/pages/_app.tsx
  useAgentStatus()
  -> src/hooks/use-agent-status.ts
       WebSocket /api/status

server.ts
  handleWsUpgrade('/api/status')
  -> src/lib/status-server.ts
       handleStatusConnection()
  -> StatusManager.addClient()
  -> StatusManager.getAllForClient()
  -> status:sync / status:update / status:hook-event
```

UI statusのSoTは `src/lib/status-manager.ts` のin-memory `StatusManager.tabs` である。`ITabStatusEntry` は次を含む。

- `TCliState`
- workspace/tab/tmux mapping
- current process / pane title
- provider ID / agent session ID
- agent summary / last user message / last assistant snippet
- current action
- busy/review/dismiss/compact timestamps
- permission request
- last hook event / sequence
- JSONL pathなどのserver-only metadata

`StatusManager` はserver startup時に `server.ts` の `getStatusManager().init()` で初期化される。`scanAll()` と定期pollによりlayout、tmux pane、provider runtimeを照合する。

provider eventは次の経路で状態へ反映される。

```text
Codex or Claude hook
  -> POST /api/status/hook
  -> provider hook translator
  -> StatusManager.handleProviderEvent()
  -> StatusManager.updateTabFromHook()
  -> deriveAgentCliState()
  -> persistToLayout()
  -> status WebSocket broadcast
```

`StatusManager` はpoll/watch中に次のprovider methodsを利用する。

- `isAgentRunning()`
- `detectActiveSession()`
- `readRuntimeSnapshot()`

Codex JSONL/Claude JSONLのruntime snapshotからinterrupt、idle、current action、last assistant snippetも更新する。

### result / timeline

```text
src/components/features/workspace/codex-panel.tsx
  CodexPanel
  -> src/hooks/use-timeline.ts
  -> src/hooks/use-timeline-websocket.ts
  -> WebSocket /api/timeline
       query: session, agentSessionId, panelType

server.ts
  handleWsUpgrade('/api/timeline')
  -> src/lib/timeline-server.ts
       handleTimelineConnection()
  -> getProviderByPanelType(panelType)
  -> getSessionPanePid(sessionName)
  -> provider.detectActiveSession(panePid)
  -> provider.isAgentRunning(panePid)
  -> provider.watchSessions(panePid, ...)
  -> resolve JSONL path
  -> subscribeToFile()

Codex JSONL
  -> createCodexParser() / readTailCodexEntries()
  -> src/lib/session-parser-codex.ts
  -> structured ITimelineEntry[]

Claude JSONL
  -> readTailEntries() / parseIncremental()
  -> src/lib/session-parser.ts
  -> structured ITimelineEntry[]

timeline:init / timeline:append
  -> useTimeline()
  -> TimelineView
```

Codex assistant responseは `src/lib/session-parser-codex.ts` でJSONL `agent_message` eventから `ITimelineAssistantMessage` へ変換される。Claude assistant responseは `src/lib/session-parser.ts` でassistant entryのtext blockから変換される。

したがって、UIに表示されるstructured assistant responseのSoTは次である。

```text
provider session JSONL + provider-aware timeline parser
```

tmux pane contentはtimelineのSoTではない。`StatusManager.lastAssistantMessage` も `provider.readRuntimeSnapshot()` が返す長さ制限付きsnippetであり、full responseの代用ではない。

### interrupt

```text
src/components/features/workspace/web-input-bar.tsx
  handleInterruptClick()
  -> InterruptDialog
  -> handleInterruptConfirm()
  -> useWebInput.interrupt()

src/hooks/use-web-input.ts
  interrupt()
  -> sendStdin('\x1b\x1b')
  -> WebSocket /api/terminal as MSG_WEB_STDIN

src/lib/terminal-server.ts
  -> exitCopyMode()
  -> ptyProcess.write(ESC ESC)
  -> foreground Codex/Claude TUI
```

UIのstop buttonはCtrl+CではなくESCを2回送る。Codex/Claudeでprovider-specific branchはなく、同じinputを使用する。

`IAgentProvider` interfaceにinterrupt methodはない。また、UIはinterrupt時にstatusを直接idleへ変更しない。agentがhook/JSONLへinterrupt結果を出した後、provider runtime semanticsを通じて状態が更新される。

Codexでは `src/lib/session-parser-codex.ts` が `turn_aborted` / `TurnAborted` をtimeline `interrupt` entryへ変換する。`src/lib/providers/codex/runtime-snapshot.ts` も同eventを `interrupted: true` として検出し、`StatusManager.onJsonlFileChange()` がsynthetic interruptを発生できる。Claudeもruntime snapshotがinterrupt markerを検出する。

### close

```text
src/components/features/workspace/pane-container.tsx
  handleDeleteTab()
  -> src/hooks/use-layout.ts
       useLayoutStore.deleteTabInPane()
  -> optimistic client layout removal
  -> DELETE /api/layout/pane/:paneId/tabs/:tabId

src/pages/api/layout/pane/[paneId]/tabs/[tabId]/index.ts
  handler(DELETE)
  -> removeTabFromPane(wsId, paneId, tabId)

src/lib/layout-store.ts
  removeTabFromPane()
  -> tmux.killSession(sessionName) for non-browser tabs
  -> remove tab from pane
  -> update active tab / order
  -> remove empty pane when appropriate
  -> writeLayoutFile()
       -> StatusManager layout reconciler removes stale status entry
       -> layout sync broadcast

API handler
  -> StatusManager.removeTab(tabId)
```

UI handlerの明示的 `StatusManager.removeTab()` は、`writeLayoutFile()` が呼ぶlayout reconcilerと重複するが、core close semanticsは `removeTabFromPane()` に集約されている。

## CLI paths

CLI entrypointは `bin/purplemux.js` である。`tab` commandを認識すると `bin/cli.js` をloadする。`bin/cli.js` は `~/.purplemux/port` と `~/.purplemux/cli-token`、または環境変数から接続情報を取得し、CLI用HTTP APIを呼ぶ。

### tab create

```text
bin/purplemux.js
  -> require('./cli.js')

bin/cli.js
  main()
  -> cmdTabCreate(args)
  -> POST /api/cli/tabs
       {
         workspaceId,
         name?,
         panelType: 'codex-cli'
       }

src/pages/api/cli/tabs/index.ts
  handler(POST)
  -> verifyCliToken()
  -> getWorkspaceById(workspaceId)
  -> resolveFirstPaneId(workspaceId)
  -> validate panelType
  -> checkAgentAvailabilityForPanelType(resolvedType)
       -> provider.preflight() only
  -> addTabToPane(
       workspaceId,
       paneId,
       name,
       ws.directories[0],
       resolvedType
       // command argument is absent
     )

src/lib/layout-store.ts
  addTabToPane()
  -> tmux.createSession()
  -> no sendKeys() because command is undefined
  -> create ITab with panelType 'codex-cli'
  -> writeLayoutFile()

CLI API response
  -> agentProviderId: null
  -> agentSessionId: null
```

この経路は `codexProvider.buildLaunchCommand()` を呼ばない。Codex processを起動せず、shellだけが動作する `codex-cli` 表示tabを作る。

`checkAgentAvailabilityForPanelType()` はproviderを選択して `provider.preflight()` を実行するが、launch commandの生成・実行には使われない。

CLI handlerは次も行わない。

- `StatusManager.registerTab()`
- `StatusManager.markAgentLaunch()`
- provider session metadataの初期化
- hook/timeline trackingの明示的な開始

`StatusManager.poll()` は後からlayout上の新tabを発見できるが、通常poll間隔はtab数に応じて30、45、60秒である。`writeLayoutFile()` のlayout reconcilerは削除されたtabをstatus-managerから除去するだけで、新規tabを登録しない。そのためcreate直後はhookがtabを解決できない期間も発生する。

### tab send

```text
bin/cli.js
  main()
  -> cmdTabSend(args)
  -> POST /api/cli/tabs/:tabId/send?workspaceId=...
       { content }

src/pages/api/cli/tabs/[tabId]/send.ts
  handler()
  -> verifyCliToken()
  -> findTab(workspaceId, tabId)
  -> tmux.hasSession(sessionName)
  -> tmux.sendBracketedPaste(sessionName, content)

src/lib/tmux.ts
  sendBracketedPaste()
  -> exitCopyMode()
  -> tmux send-keys -l with bracketed paste markers
  -> tmux send-keys Enter
  -> wait 600ms
  -> tmux send-keys Enter
```

CLI sendは常にbracketed pasteを使い、Enterを2回送る。UI agent composerの「multiline時のみbracketed paste、250ms後にEnter 1回」と同じsemanticsではない。

また、CLIにはraw/control input modeがない。Ctrl+Cなどをcontentとして渡してもbracketed pasteに包まれるため、terminal controlとして同等にはならない。

### tab status

```text
bin/cli.js
  main()
  -> cmdTabStatus(args)
  -> GET /api/cli/tabs/:tabId/status?workspaceId=...

src/pages/api/cli/tabs/[tabId]/status.ts
  handler()
  -> verifyCliToken()
  -> findTab(workspaceId, tabId)
  -> getProviderByPanelType(tab.panelType)
  -> provider.readSessionId(tab)
  -> tmux.hasSession(sessionName)
  -> tmux.getPaneCurrentCommand(sessionName)
  -> return tab.cliState from persisted layout
```

CLI statusは`StatusManager`のlive entryを読まない。`tab.cliState` は `StatusManager.persistToLayout()` により更新されるため同じ状態機械の結果を一部反映するが、次のin-memory情報を欠く。

- `lastEvent` / `eventSeq`
- `busySince` / `readyForReviewAt`
- `currentAction`
- `lastAssistantMessage`
- permission request
- live agent metadata

CLIが `getPaneCurrentCommand()` を返すこと自体はlifecycle情報として有用だが、`TCliState` のSoTとしてprocess nameを使用すべきではない。

### tab result

```text
bin/cli.js
  main()
  -> cmdTabResult(args)
  -> GET /api/cli/tabs/:tabId/result?workspaceId=...

src/pages/api/cli/tabs/[tabId]/result.ts
  handler()
  -> verifyCliToken()
  -> findTab(workspaceId, tabId)
  -> tmux.hasSession(sessionName)
  -> tmux.capturePaneContent(sessionName)

src/lib/tmux.ts
  capturePaneContent()
  -> tmux capture-pane -p -t <session>
```

`tab result` は単なる現在のtmux pane captureである。provider session、JSONL、timeline parser、runtime snapshotを使用しない。

これはUI timelineのstructured resultとは異なる。画面幅、TUI再描画、scrollback、折返しなどの影響も受けるため、agentの最終assistant responseのSoTにはできない。

### tab close

```text
bin/cli.js
  main()
  -> cmdTabClose(args)
  -> DELETE /api/cli/tabs/:tabId?workspaceId=...

src/pages/api/cli/tabs/[tabId]/index.ts
  handler(DELETE)
  -> verifyCliToken()
  -> findTab(workspaceId, tabId)
  -> removeTabFromPane(workspaceId, paneId, tabId)

src/lib/layout-store.ts
  removeTabFromPane()
  -> tmux.killSession()
  -> layout cleanup
  -> writeLayoutFile()
  -> layout reconciler removes StatusManager entry
```

UI closeと同じ `removeTabFromPane()` / `killSession()` を使用する。CLI handlerは `StatusManager.removeTab()` を明示的に呼ばないが、layout write時のreconcilerによりstatus cleanupは実行される。

### CLI interrupt

CLIには `tab interrupt` commandも対応APIも存在しない。`tab send` はbracketed paste semanticsなので、UI stop buttonのESC ESCやraw terminalのCtrl+Cを代替しない。

## Comparison

| Operation | UI path | CLI path | Same semantics? | Divergence | Recommended change |
| --------- | ------- | -------- | --------------- | ---------- | ------------------ |
| create | provider command API → layout API → tmux session → command launch → status registration/launch tracking | CLI tabs API → layout-store → tmux shell creation only | No | CLIはprovider launch/resume、hook injection、即時status登録を通らない | `createTabRuntime()` をserver-side shared entry pointにし、UI/CLI両handlerから呼ぶ |
| send | raw terminalまたはWebInput → terminal WebSocket → PTY write | CLI send API → `sendBracketedPaste()` → tmux send-keys | No | paste条件、Enter回数、delay、control input semanticsが異なる | agent submit用 `submitTabInput()` とraw/control用primitiveを共通化する |
| status | `/api/status` WebSocket → live in-memory `StatusManager` | persisted `tab.cliState` + tmux alive/current command | No | CLIはstatus-managerのlive entryをSoTにしていない | `StatusManager.getForClient(tabId)` または `getTabRuntimeStatus()` を公開する |
| result | timeline WebSocket → provider detection → JSONL watcher/parser → structured entries | tmux `capture-pane` | No | structured assistant resultとterminal screenという別データを返す | captureとagent resultのcontractを分離し、agent resultはtimeline parserを再利用する |
| interrupt | WebInput → ESC ESC → terminal WebSocket/PTY。結果はprovider hook/runtime snapshotで検出 | command/APIなし | No | CLI未公開で、共通server primitiveもない | `interruptTab()` を追加し、UIと新CLI commandから呼ぶ |
| close | layout DELETE API → `removeTabFromPane()` → `killSession()` → layout/status cleanup | CLI DELETE API →同じ `removeTabFromPane()` / `killSession()` | Mostly yes | UI handlerのみ明示的 `StatusManager.removeTab()` を重複実行 | `closeTabRuntime()` でwrapperを共通化できるが、core semanticsは既に共通 |

## Findings

### UIとCLIが分岐している地点

最初の決定的な分岐はcreate APIへ入る前である。

```text
Browser UI
  -> POST /api/codex/launch-command
  -> codexProvider.buildLaunchCommand()
  -> command付き POST /api/layout/pane/:paneId/tabs

CLI
  -> POST /api/cli/tabs
  -> commandなし addTabToPane()
```

同じ `addTabToPane()` に到達する時点で、UIはlauncher commandを持ち、CLIは持っていない。

第二の分岐はlayout API handlerにある。Browser用handlerはtab作成後に `StatusManager.registerTab()` / `markAgentLaunch()` を行うが、CLI handlerは行わない。

send/status/result/interruptもCLI handlerが低レベルtmux helperを直接使うか、operation自体が存在しないため分岐している。

### `codexProvider.buildLaunchCommand()` が使われる経路

新規Codex sessionで直接呼ぶのは `src/pages/api/codex/launch-command.ts` である。

```text
PaneNewTabMenu / MobileTerminalPage / PaneContainer
  -> fetchCodexLaunchCommand()
  -> POST /api/codex/launch-command
  -> codexProvider.buildLaunchCommand()
```

resumeでは同handlerまたはlayout/timeline resume経路から `buildResumeCommand()` が呼ばれる。

- `src/pages/api/codex/launch-command.ts`
- `src/pages/api/layout/pane/[paneId]/tabs/index.ts`
- `src/lib/timeline-server.ts` の `handleResumeMessage()`
- `src/lib/auto-resume.ts`
- `src/pages/api/workspace/index.ts`

CLI `tab create` は `buildLaunchCommand()` を呼ばない。

### `src/lib/tmux.ts` の責務

`tmux.ts` はPurpleMux専用tmux socket `purple` に対する低レベルadapterである。主な責務は次のとおり。

- session lifecycle: `createSession()`, `killSession()`, `hasSession()`, `listSessions()`
- session identity: `workspaceSessionName()`, `defaultSessionName()`
- pane metadata: `getSessionCwd()`, `getSessionPanePid()`, `getPaneCurrentCommand()`, `getPaneTitle()`, `getAllPanesInfo()`
- input: `sendKeys()`, `sendKeysSeparated()`, `sendRawKeys()`, `sendBracketedPaste()`
- capture: `capturePaneContent()`, `capturePaneContentWithHistory()`
- process/listening port inspection
- tmux config apply/reset

`killSession()` はpane PIDをprocess group IDとしてSIGTERMを送り、tmux sessionをkillし、生存時はSIGKILLへescalateする。したがってlayout closeは単なる `tmux kill-session` ではなくprocess group cleanup semanticsを含む。

主要な呼び出し元は次のとおり。

- `src/lib/layout-store.ts`: tab/pane/workspace lifecycle。
- `src/lib/terminal-server.ts`: interactive PTY transportとad-hoc session attach/create。
- `src/lib/status-manager.ts`: pane/process/cwd観測。
- `src/lib/timeline-server.ts`: provider session検出、resume command送信。
- `src/lib/auto-resume.ts`: startup resume/recreate。
- `src/lib/workspace-store.ts`: workspace削除時のsession cleanup。
- CLI API handlers: send/status/resultで直接利用。

`tmux.ts` はprovider policyやagent state machineを持たない。shared runtimeから呼ばれる低レベル層として維持するのが適切である。

### `src/lib/status-manager.ts` の責務

`StatusManager` はagent/terminal statusのserver-side SoTである。

主な責務:

- layout上のtabとtmux sessionを対応付ける。
- providerをpanel typeから選択する。
- `provider.isAgentRunning()` / `detectActiveSession()` でruntimeを検出する。
- `provider.readRuntimeSnapshot()` でidle/busy/interrupt/current action/assistant snippetを補完する。
- Codex/Claude hook eventを共通 `TAgentWorkStateEvent` に変換してstate transitionへ適用する。
- `TCliState` をlayoutへpersistする。
- JSONL watcherを管理する。
- status WebSocketへsync/update/hook eventsをbroadcastする。
- ready-for-review、needs-input、dismiss、session history、push notificationを管理する。
- layout reconcilerとして削除tab/status watcherをcleanupする。

CLI statusが別途terminal screenやprocess nameからagent stateを推測する設計にするべきではない。`StatusManager` のread APIをCLIへ公開するのが正しい。

### UI側ですでに存在するruntime semantics

UI経路ですでに利用されている、再実装不要な機能は次のとおり。

- provider registryとpanel typeからのprovider選択。
- provider preflight。
- Codex/Claude launch/resume command composition。
- Codex hook mergeとmanaged launcher。
- workspace prompt/developer instructions。
- permission bypass configuration。
- tmux session lifecycle。
- provider session ID/JSONL path/summary persistence。
- agent process/session detection。
- session directory watching。
- provider runtime snapshot。
- hook-driven `TCliState` transition。
- status polling/watch/broadcast。
- structured timeline JSONL parsing。
- resume safety checkとresume launch。
- process groupを含むclose cleanup。

これらをCLI専用に再実装する必要はない。

### CLI側で未公開なだけの機能

CLIから直接利用できないがserver側には存在する機能:

- `provider.buildLaunchCommand()` / `buildResumeCommand()`。
- provider session detection/watch。
- live `StatusManager` entry。
- timelineのstructured entries。
- provider JSONLからのassistant response。
- UI相当のinterrupt operation。
- launch readiness pollingとmarking。

resumeについてもtimeline-server、workspace API、auto-resumeに既存semanticsがあるため、CLI専用resume engineは不要である。

### 本当に新規実装が必要なprimitive

新しいagent runtime、LangGraph runtime、terminal screen state detectorは不要である。

必要なのは既存部品をoperation単位で束ねる薄いserver-side facadeである。

1. `createTabRuntime()`
   - provider selection、availability、launch/resume、layout、tmux、provider metadata、status registrationを一つのtransactional flowにする。
2. `submitTabInput()` / control input primitive
   - UI composerとCLI sendのsubmit semanticsを共通化する。
3. `interruptTab()`
   - 現行UIのinterrupt inputをserver operationとして公開する。
4. `getTabRuntimeStatus()`
   - live StatusManager entryとtmux lifecycle情報を返すread facade。
5. structured result read adapter
   - provider session/JSONLを解決し、既存timeline parserでassistant resultを返す。これは新runtimeではなく既存timeline sourceのread-only adapterである。

closeのcore primitiveは `removeTabFromPane()` と `killSession()` として既に存在する。handlerを薄くするwrapperは有用だが、新しいclose semanticsは不要である。

## Recommended direction

目標構造:

```text
Browser UI ─┐
            ├─> shared server-side runtime
CLI ────────┘           ↓
                    provider
                        ↓
                  status-manager
                        ↓
                     tmux.ts
```

より具体的には次の依存方向にする。

```text
Browser components / CLI executable
  -> thin HTTP/WebSocket handlers
  -> src/lib/tab-runtime.ts (proposed)
       ├─> provider registry / IAgentProvider
       ├─> StatusManager
       ├─> layout-store
       ├─> timeline read helpers
       └─> tmux.ts
```

LangGraph専用runtimeやCLI専用runtimeを新しく作らず、既存server-side runtime semanticsをSoTとしてUI/CLI双方から利用する。

### Proposed shared create entry point

例:

```ts
interface ICreateTabRuntimeOptions {
  workspaceId: string;
  paneId?: string;
  name?: string;
  cwd?: string;
  panelType: TPanelType;
  resumeSessionId?: string;
}

createTabRuntime(options): Promise<ITabRuntimeResult>
```

推奨処理順:

```text
createTabRuntime()
  -> workspace / pane / cwd validation
  -> getProviderByPanelType(panelType)
  -> provider.preflight()
  -> provider.buildLaunchCommand() or buildResumeCommand()
  -> create shell-backed tab and persist layout
  -> persist provider session metadata for resume
  -> StatusManager.registerTab()
  -> send launch command to tmux
  -> StatusManager.markAgentLaunch()
  -> return normalized tab DTO
```

status registrationをcommand launchより前に置き、初期hook raceを避ける。

Browser UIはraw commandを取得・送信せず、次だけを送る。

```json
{
  "panelType": "codex-cli"
}
```

CLIも同じfunctionを呼ぶ。Claudeもclient-side command builderではなくserver provider methodを利用する。

### Proposed input separation

interactive terminal transportとagent submit semanticsを区別する。

```text
raw terminal input
  -> existing /api/terminal WebSocket

agent message submit
  -> submitTabInput(tab, text)
  -> one canonical paste/Enter policy

control input
  -> sendTabControl(tab, 'ctrl-c' | 'escape' | ...)

interrupt
  -> interruptTab(tab)
```

UI/CLIが同じagent submit primitiveを使用すれば、Enter回数やbracketed pasteの差をなくせる。raw terminal UIはinteractive transportとして維持できる。

### Proposed status read

`StatusManager` にsingle-tabのread-only accessorを追加するのが最小である。

```ts
getForClient(tabId: string): IClientTabStatusEntry | null
```

CLI status APIはこれをSoTとし、`alive` などのtmux lifecycle情報だけを補足する。process nameから `TCliState` を推測しない。

### Proposed result contract

terminal captureとagent resultを混同しない。

推奨する概念分離:

```text
tab capture
  -> tmux pane capture

tab agent result
  -> provider session detection
  -> provider JSONL
  -> timeline parser
  -> structured/latest assistant response
```

既存CLI互換性のため現行 `tab result` をcaptureとして残す場合は、名前またはAPI documentationで明示し、structured result用operationを追加する。`StatusManager.lastAssistantMessage` はsnippetなのでfull resultの代替にしない。

## Next implementation steps

この調査結果に基づく実装は、次の単位に分けるのが安全である。この文書の時点では実装しない。

### Step 1: shared create lifecycleを抽出

- `src/lib/tab-runtime.ts` などのserver-only moduleを追加する。
- Browser layout create handlerのprovider selection、availability、status registration、launch markingを移す。
- provider launch/resume command生成を同moduleへ集約する。
- command launch前にtab/layout/status mappingを確立する。
- terminal、agent-sessions、diff、web-browserなど非agent panelの既存挙動を維持する。

### Step 2: Browser create APIを薄くする

- Browserからraw `command` を送る必要をなくす。
- Codexの事前 `/api/codex/launch-command` 呼び出しをcreate lifecycle内部へ移す。
- Claudeのclient-side command duplicationを解消し、`claudeProvider.buildLaunchCommand()` を使用する。
- mobile/desktop両UIを同じrequest contractにする。

### Step 3: CLI createをshared lifecycleへ接続

- `POST /api/cli/tabs` から `createTabRuntime()` を呼ぶ。
- `-t codex-cli` / `-t claude-code` でagentを実際に起動する。
- normalized provider/session fieldsをresponseに返す。
- immediate status registrationとlaunch trackingを保証する。

### Step 4: status readを統一

- `StatusManager.getForClient(tabId)` または同等のread facadeを追加する。
- CLI status handlerの `cliState` sourceをlayoutからStatusManagerへ変更する。
- `alive` / current commandは補助的なtmux情報として残す。
- external CLI response compatibilityを確認する。

### Step 5: send/control/interrupt semanticsを定義

- UI WebInputとCLI sendのdesired submit semanticsを明文化する。
- common `submitTabInput()` を実装する。
- raw/control inputをtext submitと区別する。
- common `interruptTab()` を実装し、UI stop buttonを接続する。
- `purplemux tab interrupt` とAPIを薄いadapterとして追加する。
- interrupt後のstateは手動推測せず、provider hook/runtime snapshotをSoTにする。

### Step 6: result contractを分離

- 現行 `tab result` がpane captureであることをdocumentする。
- structured agent resultが必要なら、timeline-serverのJSONL resolution/parser処理をread-only helperへ抽出する。
- CLI structured resultはprovider-aware parserを使用する。
- terminal screen解析でassistant response/stateを推測しない。

### Step 7: close handlerを整理

- UI/CLI両handler用の `closeTabRuntime()` wrapperを必要に応じて追加する。
- `removeTabFromPane()` / `killSession()` をcore lifecycleとして維持する。
- layout reconcilerと明示的 `StatusManager.removeTab()` の重複を整理する。
- process group SIGTERM/SIGKILL semanticsを維持する。

### Step 8: tests

最低限、次のserver-side testsを追加する。

- UI/CLI相当のcreate requestが同じprovider methodsを呼ぶこと。
- `codex-cli` createが `codexProvider.buildLaunchCommand()` を通ること。
- `claude-code` createが `claudeProvider.buildLaunchCommand()` を通ること。
- status registrationがcommand launchより前に行われること。
- CLI statusがlive StatusManager stateを返すこと。
- UI/CLI submitが同じEnter/paste semanticsになること。
- interruptが同じcontrol inputを送り、stateをterminal captureから推測しないこと。
- UI/CLI closeが同じkill/layout/status cleanupを行うこと。
- structured resultがtmux captureではなくprovider JSONL parserを使用すること。

## Final decision

PurpleMuxはすでにprovider、status-manager、timeline、tmuxの必要なruntime semanticsを持っている。問題はruntime不足ではなく、入口ごとのorchestration差である。

最小かつ設計制約に沿う方向は次のとおり。

1. server-side `createTabRuntime()` を共通入口にする。
2. providerのlaunch/resume methodsを唯一のagent command SoTにする。
3. `StatusManager` をagent stateのSoTとしてCLIにも公開する。
4. assistant resultはprovider JSONL/timeline parserをSoTとし、tmux captureと分離する。
5. tmux.tsは低レベルadapterとしてshared runtimeの下に置く。

LangGraphからtmuxを直接操作しない。LangGraphやCLIでterminal screenを解析してagent stateを推測しない。CLI専用runtime、UI専用launch semantics、新しいagent engineは作らない。
