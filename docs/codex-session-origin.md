# Codex tab session provenance

The managed Codex launcher and hook run on the PurpleMux server host. `hook-settings.ts` writes the hook command under that host's `$HOME/.purplemux`; the hook reads the same host's port/token files and posts to `localhost`. The provider reads native sessions under that host's `.codex/sessions`. Electron's remote mode loads a remote server URL; it does not relay a local Codex hook/native path to a different host.

Codex child threads can inherit the parent hook destination and cwd. An implicit cwd scan must skip positive child provenance (`source.subagent`, `thread_source=subagent`, `/root/...` agent path), and the HTTP hook must verify the native header before changing tab session metadata or emitting state events. `forked_from_id` alone does not indicate a child: normal CLI forks, resume and clear retain the existing path. Explicit ID lookup remains exact.

A missing/unreadable header, missing session ID or mismatched ID cannot prove the caller's root identity. The hook acknowledges without applying metadata or events; it does not retry work. A subsequent naturally occurring hook with a readable root header is accepted. If the initial header is delayed and no later hook arrives, identity can remain unknown; we do not infer it from cwd alone. There is no persistent cache that can carry stale child identity across a restart.

Custom cross-host hook forwarding with an unshared native filesystem is not supported by this provenance check. Such a bridge needs a separate authenticated provenance contract, not a fallback that treats missing metadata as root. Existing managed remote-server use executes the check on the server where the CLI/native file resides. No SSH hook relay or remote native-reader contract exists in this implementation.
