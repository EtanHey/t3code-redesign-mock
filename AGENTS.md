# t3code-redesign-mock

A static, backend-less preview of the T3 Code web app as it looks on Maria's redesign stack
(`pingdotgg/t3code`, branch `maria/redesign/6-workspace-panes`, PRs #28839 to #28845). The real UI runs
in the browser against an in-browser fake server with planted threads, so people can click through
the redesign without building it. Nothing here is real: no agents run, nothing resolves.

This is an unofficial community preview. It is not affiliated with T3 Tools.

## Layout

- `upstream/` is a checkout of Maria's tip. It is gitignored and disposable. **Never edit a file that
  exists upstream.** The hourly build throws it away and takes her newest commit.
- `overlay/` is everything we add. It mirrors upstream paths and holds only NEW files, so it can be
  copied over any future tip of her branch without a conflict.
  - `overlay/apps/web/src/redesignMock/` is the mock: the fake server kernel, RPC handlers, fixtures.
  - `overlay/apps/web/vite.mock.config.ts` is the build config that swaps in the fake.
- `scripts/` holds `sync.sh` (copy overlay into upstream), `check.sh` (sync, typecheck, build, smoke),
  `build.sh` (produce `dist/`), `dev.sh` (local dev server), `setup-worktree.sh`.
- `docs.local/` is gitignored working material (plan, briefs, recon, screenshots).

## Rules

1. Add files under `overlay/` only. If the mock needs an upstream file to behave differently, replace
   the module at build time from `vite.mock.config.ts`; do not patch it.
2. Fixtures and RPC handlers are picked up by glob (`*.fixture.ts`, `*.handler.ts`). Add your own
   files; do not edit a shared index or another lane's files.
3. Type everything against `@t3tools/contracts`. No `any`, no casts that hide a wrong shape: the
   typecheck is how we find out that Maria changed a contract.
4. Run `scripts/check.sh` before you call anything done. It must pass.
5. Never set `VITE_HTTP_URL`, `VITE_WS_URL`, `VITE_HOSTED_APP_CHANNEL` or a Clerk key for the mock build.
6. Content is public. Write believable, neutral developer transcripts. No real people, companies,
   secrets, private paths or usernames. Use `/workspace/<project>` paths and invented repo names.
7. Start dev servers from your own shell and stop them by the PID you started. Never kill by pattern.
