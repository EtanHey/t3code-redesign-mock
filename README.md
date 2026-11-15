# t3code-redesign-mock

An unofficial, fully mocked preview of the [T3 Code](https://github.com/pingdotgg/t3code) web app as
it looks on the redesign stack by [@maria-rcks](https://github.com/maria-rcks)
([#28839](https://github.com/pingdotgg/t3code/pull/28839) to
[#28845](https://github.com/pingdotgg/t3code/pull/28845)).

The real UI runs in your browser against an in-browser fake server with planted threads, so you can
click through the redesign without building it. Nothing is real: no agents run and nothing resolves.

It rebuilds about hourly from the newest commit on `maria/redesign/6-workspace-panes`. This repo holds
only the overlay (the fake server and fixtures) and the build pipeline; T3 Code itself is MIT licensed
and copyright T3 Tools Inc. Not affiliated with T3 Tools.

## How it stays current

GitHub Actions checks hourly, on pushes to `main`, and when manually dispatched. It rebuilds when
the upstream redesign tip or this repository's `main` changes; a manual dispatch can force a rebuild.
See the [Actions tab](https://github.com/EtanHey/t3code-redesign-mock/actions) and
[/build-info.json](https://t3code-redesign-mock.vercel.app/build-info.json) for the last build.
A failed check leaves the previous site in place and opens or updates an issue; a successful build
closes it.
