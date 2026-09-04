# purplemux

**Claude Code와 Codex, 여러 작업을 동시에. 더 빠르게.**

한 화면에서 모든 세션을, 폰에서도 끊김 없이.

한국어 | <a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.ru.md">Русский</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.tr.md">Türkçe</a>

![purplemux](docs/images/screenshot.png)

![purplemux mobile](docs/images/screenshot-mobile.png)

## 설치

```bash
npx purplemux@latest
```

브라우저에서 [http://localhost:8022](http://localhost:8022)으로 접속합니다. 끝.

> Node.js 20+, tmux 필요. macOS 또는 Linux.

네이티브 앱을 선호한다면, [최신 릴리스](https://github.com/subicura/purplemux/releases/latest)에서 macOS Electron 빌드를 받을 수 있습니다 (Apple Silicon & Intel용 `.dmg`).

## 왜 purplemux인가

- **멀티 세션 대시보드** — 모든 Claude Code와 Codex 세션의 작업중/사용자 요청 상태를 한눈에 확인
- **Rate Limit 모니터링** — 5시간/7일 잔여량과 리셋 카운트다운 표시
- **푸시 알림** — 작업 완료나 입력이 필요하면 데스크탑/모바일 알림
- **모바일 & 멀티 디바이스** — 폰, 태블릿, 다른 데스크탑 어디서든 같은 세션에 접속
- **라이브 세션 뷰** — CLI 출력을 스크롤할 필요 없이, 진행 상황을 타임라인으로 정리해서 표시

그리고

- **끊김 없는 세션** — tmux 기반. 브라우저를 닫아도 세션과 작업 환경이 그대로 유지. 재접속하면 탭, 패널, 디렉토리까지 마지막 상태 그대로
- **셀프 호스팅 & 오픈소스** — 코드와 세션 데이터가 내 머신에만 존재. 외부 서버 경유 없음
- **암호화된 원격 접근** — Tailscale로 어디서든 HTTPS 접속

## 공식 Remote Control과 차이점

> 공식 Remote Control은 단일 세션 원격 제어에 초점을 둡니다. purplemux는 멀티 세션 관리, 푸시 알림, 세션 지속성이 필요할 때 사용합니다.

## 특징

### 터미널

- **패널 분할** — 가로/세로 자유 분할, 드래그로 크기 조절
- **탭 관리** — 다중 탭, 드래그 순서 변경, 프로세스명 기반 자동 타이틀
- **키보드 단축키** — 분할, 탭 전환, 포커스 이동
- **터미널 테마** — 다크/라이트 모드, 다양한 컬러 테마
- **워크스페이스 & 그룹** — 패널 레이아웃, 탭, 작업 디렉토리를 워크스페이스 단위로 저장/복원. 드래그 앤 드롭으로 워크스페이스를 그룹으로 묶어 관리
- **Git 워크플로** — Side-by-side / Line-by-line 뷰 전환과 Syntax highlighting, 인라인 hunk 펼치기, 페이지네이션 히스토리 탭. 패널에서 바로 fetch / pull / push (ahead/behind 표시) — 동기화 실패(dirty worktree, 충돌)는 원클릭으로 Claude 또는 Codex에게 질문
- **웹 브라우저 패널** — 터미널 옆 내장 브라우저로 개발 결과 확인 (Electron). `purplemux` CLI로 제어하고, 내장 디바이스 에뮬레이터로 뷰포트 전환
- **에이전트 탭** — 새 탭 메뉴에서 Claude, Codex 또는 통합 세션 목록 시작

### Claude Code와 Codex 연동

- **실시간 상태** — 작업중/사용자 요청 상태 표시, 세션 간 전환
- **라이브 세션 뷰** — 메시지, 도구 호출, 태스크, 권한 요청, thinking 블록
- **Codex 탭** — Claude와 동일한 tmux 기반 지속성으로 Codex CLI 세션 실행
- **세션 목록** — 최근 Claude와 Codex 세션을 하나의 통합 뷰에서 탐색하고 재개
- **원클릭 Resume** — 중단된 Claude 또는 Codex 세션을 브라우저에서 바로 재개
- **자동 Resume** — 서버 시작 시 이전 Claude 세션 자동 복구
- **빠른 프롬프트** — 자주 쓰는 프롬프트 등록, 원클릭 전송
- **첨부** — 채팅 입력에 이미지 드롭, 파일 첨부 시 경로 자동 삽입. 모바일에서도 동작
- **메시지 히스토리** — 이전 메시지 재사용
- **사용량 통계** — Claude + Codex 토큰, 비용, 프로젝트별 분석, 일별 AI 리포트
- **Rate Limit** — 지원되는 에이전트의 5시간/7일 잔여량, 리셋 카운트다운

### 모바일 & 접근성

- **반응형 UI** — 폰/태블릿에서 터미널과 타임라인 사용
- **PWA** — 홈 화면 추가, 네이티브 앱 느낌
- **Web Push** — 탭을 닫아도 알림 수신
- **멀티 디바이스 동기화** — 워크스페이스 변경사항 실시간 반영
- **Tailscale** — WireGuard 암호화 터널로 외부에서 HTTPS 접속
- **비밀번호 인증** — scrypt 해싱, 외부 노출 시에도 안전
- **다국어 지원** — 한국어, English, 日本語, 中文 등 11개 언어

## 지원 플랫폼

| 플랫폼 | 상태 | 비고 |
|---|---|---|
| macOS (Apple Silicon / Intel) | ✅ | Electron 앱 포함 |
| Linux | ✅ | Electron 제외 |
| Windows | ❌ | 미지원 |

## 설치 상세

### 필수 요구사항

- macOS 13+ 또는 Linux
- [Node.js](https://nodejs.org/) 20+
- [tmux](https://github.com/tmux/tmux)

Claude 탭에 필요합니다. Claude Code를 설치하고 Claude 탭을 시작하기 전에 로그인하세요:

```bash
curl -fsSL https://claude.ai/install.sh | bash
# 또는 Homebrew 최신 채널
brew install --cask claude-code@latest
```

Codex 탭은 선택 사항입니다. Codex CLI를 설치하고 Codex 탭을 시작하기 전에 로그인하세요:

```bash
npm i -g @openai/codex
# 또는
brew install --cask codex
```

### npx (가장 빠름)

```bash
npx purplemux@latest
```

### 글로벌 설치

```bash
npm install -g purplemux
purplemux
```

### CLI 예시

```bash
purplemux tab create -w WS -t codex-cli -n "fix auth"
purplemux tab create -w WS -t agent-sessions
```

### 소스에서 실행

```bash
git clone https://github.com/subicura/purplemux.git
cd purplemux
pnpm install
pnpm build
pnpm start
```

개발 모드:

```bash
pnpm dev
```

#### 로그 레벨 설정

전체 레벨은 `LOG_LEVEL`(기본 `info`)로 조절합니다.

```bash
LOG_LEVEL=debug pnpm dev
```

특정 모듈만 따로 켜고 싶으면 `LOG_LEVELS`에 `모듈=레벨` 쌍을 콤마로 나열합니다. 사용 가능한 레벨: `trace` / `debug` / `info` / `warn` / `error` / `fatal`.

```bash
# Claude Code hook 동작만 debug로 추적
LOG_LEVELS=hooks=debug pnpm dev

# 여러 모듈 동시
LOG_LEVELS=hooks=debug,status=warn pnpm dev
```

`LOG_LEVELS`에 명시되지 않은 모듈은 `LOG_LEVEL` 값을 사용합니다.

## 외부 접속 (Tailscale Serve)

```bash
tailscale serve --bg 8022
```

`https://<machine>.<tailnet>.ts.net`으로 접속. 해제:

```bash
tailscale serve --bg off 8022
```

## 보안

### 비밀번호

최초 접속 시 비밀번호를 설정합니다. scrypt로 해싱되어 `~/.purplemux/config.json`에 저장됩니다.

초기화하려면 `~/.purplemux/config.json`을 삭제하고 재시작하면 온보딩 화면이 다시 나타납니다.

### HTTPS

기본은 HTTP입니다. 외부 노출 시 반드시 HTTPS를 적용하세요:

- **Tailscale Serve** — WireGuard 암호화 + 인증서 자동 적용
- **Nginx / Caddy** — WebSocket 업그레이드 헤더(`Upgrade`, `Connection`) 전달 필수

### 데이터 디렉토리 (`~/.purplemux/`)

| 파일 | 설명 |
|---|---|
| `config.json` | 인증 정보(해싱), 앱 설정 |
| `workspaces.json` | 워크스페이스 레이아웃, 탭, 디렉토리 |
| `vapid-keys.json` | Web Push VAPID 키 (자동 생성) |
| `push-subscriptions.json` | 푸시 구독 정보 |
| `hooks/` | 사용자 정의 훅 |

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                    │
│  ┌───────────┐ ┌───────────┐ ┌──────────┐ ┌─────────────┐   │
│  │  xterm.js │ │ Timeline  │ │ Status   │ │ Multi-device│   │
│  │  Terminal │ │           │ │          │ │ Sync        │   │
│  └─────┬─────┘ └─────┬─────┘ └────┬─────┘ └──────┬──────┘   │
└────────┼─────────────┼────────────┼──────────────┼──────────┘
         │ws           │ws          │ws            │ws
         │/terminal    │/timeline   │/status       │/sync
         ▼             ▼            ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│  Node.js Server (:8022)                                     │
│  ┌──────────┐  ┌───────────────┐  ┌─────────────────────┐   │
│  │ node-pty │  │ JSONL Watcher │  │ Status Manager      │   │
│  │ PTY↔WS   │  │ File watch →  │  │ Process tree +      │   │
│  │ Binary   │  │ Parse → Send  │  │ JSONL tail analysis │   │
│  └────┬─────┘  └───────┬───────┘  └──────────┬──────────┘   │
└───────┼────────────────┼─────────────────────┼──────────────┘
        ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│  System                                                     │
│  tmux (purple socket)         Agent CLIs                    │
│  ┌────────┐ ┌────────┐       ┌────────────────────────────┐ │
│  │Session1│ │Session2│  ...  │ Claude Code                │ │
│  │ (shell)│ │ (shell)│       │   ~/.claude/projects/*.jsonl │ │
│  └────────┘ └────────┘       │ Codex                      │ │
│                              │   ~/.codex/sessions/*.jsonl │ │
│                              └────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**터미널 I/O** — xterm.js가 WebSocket으로 node-pty에 연결되고, node-pty는 tmux 세션에 연결됩니다. 이진 프로토콜로 stdin/stdout/resize를 처리하며 백프레셔를 제어합니다.

**상태 감지** — 에이전트 이벤트 훅이 HTTP POST로 즉시 업데이트를 전달합니다. Claude Code는 `SessionStart`, `Stop`, `Notification`을 사용하고, Codex는 `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `PermissionRequest`를 사용합니다. 5–15초마다 프로세스 트리를 확인하고 JSONL 파일의 마지막 8KB를 분석합니다.

**타임라인** — `~/.claude/projects/`와 `~/.codex/sessions/` 아래 JSONL 세션 로그를 감시하여 변경 시 새 줄을 파싱하고 구조화된 항목을 브라우저에 스트리밍합니다.

**tmux 격리** — 전용 `purple` 소켓을 사용하여 기존 tmux와 완전히 분리됩니다. prefix 키 없음, status bar 없음.

**자동 복구** — 서버 시작 시 `claude --resume {sessionId}`로 이전 Claude 세션을 복원합니다. Codex 세션은 세션 목록 또는 `codex resume {sessionId}`로 재개할 수 있습니다.

## License

[MIT](LICENSE)
