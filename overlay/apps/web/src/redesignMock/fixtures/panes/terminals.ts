// Canned terminal sessions, by thread id. Read by handlers/panes/terminal.handler.ts.
import type { Span } from "~/redesignMock/api";

import { REPO_ROOT } from "./repo";

export const PANES_THREAD_ID = "p00-workspace-panes";
export const TERMINALS_THREAD_ID = "p01-terminals";

export const PROMPT = "\x1b[36morbit-dashboard\x1b[0m \x1b[2mon\x1b[0m \x1b[35mfeature/region-table\x1b[0m $ ";

export interface PlantedTerminal {
  readonly terminalId: string;
  readonly label: string;
  readonly cwd: string;
  /** A command is still running in the shell. */
  readonly running: boolean;
  /** Exit code of the last finished command, as shell integration reports it. */
  readonly lastExitCode?: number;
  readonly startedAgo: Span;
  readonly history: string;
}

const crlf = (lines: ReadonlyArray<string>) => lines.join("\r\n");
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;

const DEV_SERVER = crlf([
  `${PROMPT}pnpm dev`,
  "",
  `> orbit-dashboard@0.4.0 dev ${REPO_ROOT}`,
  "> vite",
  "",
  `  ${green("VITE v7.2.0")}  ${dim("ready in")} ${bold("412")} ms`,
  "",
  `  ${green("➜")}  ${bold("Local")}:   http://localhost:5173/`,
  `  ${green("➜")}  ${dim("Network: use --host to expose")}`,
  "",
  `${dim("10:42:07")} ${green("[vite]")} page reload src/summary.ts`,
  `${dim("10:42:31")} ${green("[vite]")} hmr update /src/components/RegionTable.tsx`,
  `${dim("10:43:02")} ${green("[vite]")} hmr update /src/components/RegionTable.tsx, /src/styles.css`,
  "",
]);

const TESTS_PASSED = crlf([
  `${PROMPT}pnpm test`,
  "",
  `> orbit-dashboard@0.4.0 test ${REPO_ROOT}`,
  "> vitest run",
  "",
  ` ${bold("RUN")}  v4.0.6 ${REPO_ROOT}`,
  "",
  ` ${green("✓")} src/lib/format.test.ts ${dim("(4 tests)")} 6ms`,
  ` ${green("✓")} src/lib/parse.test.ts ${dim("(5 tests)")} 4ms`,
  ` ${green("✓")} src/summary.test.ts ${dim("(9 tests)")} 11ms`,
  ` ${green("✓")} src/components/RegionTable.test.tsx ${dim("(6 tests)")} 48ms`,
  "",
  ` ${dim("Test Files")}  ${green("4 passed")} (4)`,
  `      ${dim("Tests")}  ${green("24 passed")} (24)`,
  `   ${dim("Start at")}  10:44:12`,
  `   ${dim("Duration")}  612ms`,
  "",
  PROMPT,
]);

const LINT_FAILED = crlf([
  `${PROMPT}pnpm lint`,
  "",
  `> orbit-dashboard@0.4.0 lint ${REPO_ROOT}`,
  "> eslint src",
  "",
  `${REPO_ROOT}/src/components/RegionTable.tsx`,
  `  ${dim("4:10")}  ${red("error")}    'useMemo' is defined but never used             ${dim("no-unused-vars")}`,
  `  ${dim("12:9")}  ${yellow("warning")}  Missing \"key\" prop for element in iterator  ${dim("react/jsx-key")}`,
  "",
  `${REPO_ROOT}/src/summary.ts`,
  `  ${dim("27:5")}  ${red("error")}    Unexpected console statement                  ${dim("no-console")}`,
  "",
  red(bold("✖ 3 problems (2 errors, 1 warning)")),
  "",
  ` ${red("ELIFECYCLE")}  Command failed with exit code 1.`,
  PROMPT,
]);

const SHELL = crlf([
  dim("This terminal is part of the redesign preview. You can type, but nothing runs."),
  `${PROMPT}git status --short`,
  ` M src/components/RegionTable.tsx`,
  ` M src/styles.css`,
  `?? src/components/RegionTable.test.tsx`,
  PROMPT,
]);

function plantedSet(): PlantedTerminal[] {
  return [
    { terminalId: "term-1", label: "pnpm dev", cwd: REPO_ROOT, running: true, startedAgo: "6m", history: DEV_SERVER },
    { terminalId: "term-2", label: "pnpm test", cwd: REPO_ROOT, running: false, lastExitCode: 0, startedAgo: "4m", history: TESTS_PASSED },
    { terminalId: "term-3", label: "pnpm lint", cwd: REPO_ROOT, running: false, lastExitCode: 1, startedAgo: "3m", history: LINT_FAILED },
  ];
}

export const PLANTED_TERMINALS: Readonly<Record<string, ReadonlyArray<PlantedTerminal>>> = {
  [PANES_THREAD_ID]: [
    ...plantedSet(),
    { terminalId: "term-4", label: "zsh", cwd: REPO_ROOT, running: false, lastExitCode: 0, startedAgo: "2m", history: SHELL },
  ],
  [TERMINALS_THREAD_ID]: plantedSet(),
};
