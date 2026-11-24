# Fresh Claude launch profiles

`purplemux tab capabilities` (GET `/api/cli/tabs?capabilities=1`) advertises version 1 argument application and SessionStart capture. A client requiring a profile must refuse older servers/CLIs before creating resources.

POST `/api/cli/tabs` or `tab create --launch-profile JSON` accepts:

```json
{"version":1,"provider":"claude","model":"claude-sonnet-5","effort":"high"}
```

Only fresh `claude-code` tabs accept profiles. Unknown keys/version/provider, aliases, unsafe model strings, invalid effort, and resume+profile are rejected. The installed CLI help must expose model, effort, settings, and session-id before resource creation. Full IDs are syntactically validated, not a guarantee that a provider currently serves that model.

The launcher preserves workspace prompt, permission flags, statusLine and managed hooks. It copies managed hook settings into a private per-tab directory under `.purplemux/launch-profiles`, appends a first-write-only SessionStart observer, and assigns a fresh UUID with `--session-id`. It never rewrites shared settings or modifies an existing session. Global/user settings retain their existing CLI precedence; explicit model/effort arguments take precedence. The generated directory is retained as launch evidence after tab close; it contains no credentials. Remove retired artifacts only after their evidence is no longer needed.

Create/status responses expose `launchEvidence`:
- `receipt`: workspace/tab/tmux/session identity, normalized requested profile, and `appliedAt` after the launcher command has been submitted. This means arguments were applied to the command, **not** that Claude started or inference succeeded.
- `startup`: the first SessionStart session/model/source/time, or null. No effort or inference claim. Wrong/missing model/session remains visible for a caller to refuse. Duplicate/late observations cannot replace the first record.

The caller must compare the receipt, live provider/session, and startup before sending work. This is local launch evidence, not remote attestation against an actor who can modify the user's files. Raw settings/hook paths are not returned. A command submission error or persistence failure uses the existing tab rollback; never blindly recreate a tab after an unknown HTTP result. Village retains its own durable creation intent/requestId to prevent that retry.

Deploy this compatible PurpleMux release before Village profile support. Existing profile-less tabs, resume paths, and settings are unchanged. Rollback cannot safely make an older Village ignore profiles: retain the new Village dispatch guard or hold affected Agents before downgrading. SSH, alternate CLI versions, and alternate auth backends require separate acceptance.

Verification evidence: `model-implementation` contains isolated API startup (both full IDs), separate inference native model/high, restart and failure logs. Tests use no production session. Startup effort is unobservable; only the submitted argument and separate inference record support high.
