---
title: 설치
description: 설치 방법 — npx, 글로벌, macOS 네이티브 앱, 소스에서 실행.
eyebrow: 시작하기
permalink: /ko/docs/installation/index.html
---
{% from "docs/callouts.njk" import callout %}

[빠른 시작](/purplemux/ko/docs/quickstart/)에서 `npx purplemux@latest`로 충분했다면 더 읽을 필요 없습니다. 이 페이지는 영구 설치, 데스크탑 앱, 또는 소스에서 실행하고 싶은 경우를 위한 안내입니다.

## 요구사항

- **macOS 13 이상 또는 Linux** — Windows는 지원하지 않습니다. WSL2는 대체로 동작하지만 테스트 범위 밖입니다.
- **[Node.js](https://nodejs.org) 20 이상** — `node -v`로 확인하세요.
- **[tmux](https://github.com/tmux/tmux)** — 3.0 이상이면 OK.

## 설치 방법

### npx (설치 없이)

```bash
npx purplemux@latest
```

첫 실행 시 `~/.npm/_npx/`에 캐시됩니다. 잠깐 써보거나 원격 서버에서 일회성으로 돌릴 때 좋습니다. 매 실행마다 최신 버전을 사용합니다.

### 글로벌 설치

```bash
npm install -g purplemux
purplemux
```

pnpm과 yarn도 같은 방식입니다 (`pnpm add -g purplemux` / `yarn global add purplemux`). 이후 실행이 더 빠르고, 업데이트는 `npm update -g purplemux`로 합니다.

짧은 별칭 `pmux`로도 실행할 수 있습니다.

### macOS 네이티브 앱

[Releases](https://github.com/subicura/purplemux/releases/latest)에서 최신 `.dmg`를 내려받으세요 — Apple Silicon과 Intel 빌드가 모두 제공됩니다. 자동 업데이트 내장.

앱에는 Node, tmux, purplemux 서버가 번들되어 있고 다음 기능이 추가됩니다:

- 서버 상태를 보여주는 메뉴바 아이콘
- 네이티브 알림 (Web Push와는 별개)
- 로그인 시 자동 실행 (**설정 → 일반**에서 토글)

### 소스에서 실행

```bash
git clone https://github.com/subicura/purplemux.git
cd purplemux
pnpm install
pnpm build
pnpm start
```

개발 모드(핫 리로드):

```bash
pnpm dev
```

## 포트와 환경변수

purplemux는 **8022** 포트에서 listen합니다 (web + ssh 합성, 농담). `PORT`로 바꿀 수 있습니다:

```bash
PORT=9000 purplemux
```

로그는 `LOG_LEVEL` (기본 `info`)과 모듈별 오버라이드용 `LOG_LEVELS`로 제어합니다:

```bash
LOG_LEVEL=debug purplemux
# Claude 훅 모듈만 debug로
LOG_LEVELS=hooks=debug purplemux
# 여러 모듈 한 번에
LOG_LEVELS=hooks=debug,status=warn purplemux
```

레벨: `trace` · `debug` · `info` · `warn` · `error` · `fatal`. `LOG_LEVELS`에 없는 모듈은 `LOG_LEVEL`을 따릅니다.

전체 목록은 [포트 & 환경변수](/purplemux/ko/docs/ports-env-vars/)를 참고하세요.

## 자동 시작

{% call callout('tip', '가장 쉬운 방법') %}
macOS 앱을 쓴다면 **설정 → 일반 → 로그인 시 실행**을 켜기만 하면 됩니다. 별도 스크립트 불필요.
{% endcall %}

CLI 설치라면 launchd (macOS) 또는 systemd (Linux)로 감싸면 됩니다. 최소 systemd 유닛 예시:

```ini
# ~/.config/systemd/user/purplemux.service
[Unit]
Description=purplemux

[Service]
ExecStart=/usr/local/bin/purplemux
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now purplemux
```

## 업데이트

| 방법 | 명령 |
|---|---|
| npx | 자동 (매 실행 최신) |
| 글로벌 npm | `npm update -g purplemux` |
| macOS 앱 | 자동 (실행 시 업데이트) |
| 소스에서 | `git pull && pnpm install && pnpm build && pnpm start` |

## 제거

```bash
npm uninstall -g purplemux          # pnpm remove -g / yarn global remove 도 가능
rm -rf ~/.purplemux                 # 설정과 세션 데이터 전체 삭제
```

네이티브 앱은 휴지통으로 드래그. `~/.purplemux/` 안에 무엇이 저장되는지는 [데이터 디렉토리](/purplemux/ko/docs/data-directory/)를 참고하세요.
