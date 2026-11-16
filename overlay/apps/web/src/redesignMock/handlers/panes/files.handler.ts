// Project files: the tree, file reads (and in-memory writes, so an edit "saves" for the session),
// path and content search, and metadata, all against the virtual repos in fixtures/panes/repo.ts.
import {
  ProjectListEntriesError,
  ProjectReadFileError,
  ProjectWriteFileError,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { rpc } from "~/redesignMock/api";

import {
  allDirectories,
  allFiles,
  byteLengthOf,
  listDirectory,
  relativeTo,
  repoFor,
} from "../../fixtures/panes/repo";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default [
  rpc(WS_METHODS.projectsListEntries, (input) => {
    const repo = repoFor(input.cwd);
    if (!repo) {
      return Effect.fail(
        new ProjectListEntriesError({ cwd: input.cwd, failure: "workspace_root_not_found" }),
      );
    }
    return { entries: listDirectory(repo, relativeTo(repo, input.directoryPath ?? "")), truncated: false };
  }),

  rpc(WS_METHODS.projectsSearchEntries, (input) => {
    const repo = repoFor(input.cwd);
    if (!repo) return { entries: [], truncated: false };
    const query = input.query.toLowerCase();
    const candidates = [
      ...(input.kind === "file" ? [] : allDirectories(repo).map((path) => ({ path, kind: "directory" as const }))),
      ...(input.kind === "directory" ? [] : allFiles(repo).map((path) => ({ path, kind: "file" as const }))),
    ].filter((entry) => !input.imageOnly || /\.(png|jpe?g|gif|webp|svg)$/i.test(entry.path));
    const matches = candidates.filter((entry) => query === "" || entry.path.toLowerCase().includes(query));
    return { entries: matches.slice(0, input.limit), truncated: matches.length > input.limit };
  }),

  rpc(WS_METHODS.projectsSearchContents, (input) => {
    const repo = repoFor(input.cwd);
    if (!repo) return { matches: [], truncated: false };
    const source = input.useRegex ? input.query : escapeRegExp(input.query);
    let pattern: RegExp;
    try {
      pattern = new RegExp(input.wholeWord ? `\\b(?:${source})\\b` : source, input.caseSensitive ? "g" : "gi");
    } catch (error) {
      return { matches: [], truncated: false, regexFallbackError: String(error) };
    }
    const matches: Array<{
      path: string;
      lineNumber: number;
      lineContent: string;
      matchRanges: Array<{ start: number; end: number }>;
    }> = [];
    for (const [path, contents] of [...repo.text.entries()].toSorted(([left], [right]) => left.localeCompare(right))) {
      contents.split("\n").forEach((line, index) => {
        const ranges = [...line.matchAll(pattern)]
          .filter((match) => match[0].length > 0)
          .map((match) => ({ start: match.index, end: match.index + match[0].length }));
        if (ranges.length > 0) matches.push({ path, lineNumber: index + 1, lineContent: line, matchRanges: ranges });
      });
    }
    return { matches: matches.slice(0, input.limit), truncated: matches.length > input.limit };
  }),

  rpc(WS_METHODS.projectsListIgnoredFiles, (input) => {
    const repo = repoFor(input.cwd);
    if (!repo || repo.ignoredDirectories.length === 0) return { files: [], truncated: false };
    const files = [{ path: ".env.local", byteLength: 64 }];
    const query = input.query?.toLowerCase();
    return { files: query ? files.filter((file) => file.path.includes(query)) : files, truncated: false };
  }),

  rpc(WS_METHODS.projectsReadFile, (input) => {
    const repo = repoFor(input.cwd);
    const path = repo ? relativeTo(repo, input.relativePath) : input.relativePath;
    const contents = repo?.text.get(path);
    if (contents !== undefined) {
      return { relativePath: input.relativePath, contents, byteLength: byteLengthOf(contents), truncated: false, exists: true };
    }
    if (repo?.binary.has(path)) {
      return Effect.fail(
        new ProjectReadFileError({ cwd: input.cwd, relativePath: input.relativePath, failure: "binary_file" }),
      );
    }
    if (input.allowMissing) {
      return { relativePath: input.relativePath, contents: "", byteLength: 0, truncated: false, exists: false };
    }
    return Effect.fail(
      new ProjectReadFileError({ cwd: input.cwd, relativePath: input.relativePath, failure: "operation_failed" }),
    );
  }),

  rpc(WS_METHODS.projectsWriteFile, (input) => {
    const repo = repoFor(input.cwd);
    if (!repo) {
      return Effect.fail(
        new ProjectWriteFileError({ cwd: input.cwd, relativePath: input.relativePath, failure: "operation_failed" }),
      );
    }
    // Kept for this page load only; a reload brings back the planted file.
    repo.text.set(relativeTo(repo, input.relativePath), input.contents);
    return { relativePath: input.relativePath };
  }),

  rpc(WS_METHODS.filesystemGetMetadata, (input) => ({
    entries: input.paths.map((absolute) => {
      const repo = repoFor(absolute);
      if (!repo) return null;
      const path = relativeTo(repo, absolute);
      if (path === "" || allDirectories(repo).includes(path)) return { kind: "directory" as const };
      const contents = repo.text.get(path);
      if (contents !== undefined) return { kind: "file" as const, byteLength: byteLengthOf(contents) };
      const binary = repo.binary.get(path);
      return binary ? { kind: "file" as const, byteLength: binary.byteLength, mimeType: binary.mimeType } : null;
    }),
  })),
];
