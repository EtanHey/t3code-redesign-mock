// The notice pill: says this is an unofficial mock, names the upstream branch and commit, links
// to the PR and the mock repo, and carries "Reset demo". Plain DOM in a fixed layer of its own,
// so it never takes part in the app's layout. Collapses to a dot; the choice is remembered.
import type { MockRuntime } from "./runtime";
import { BUILD_INFO } from "./runtime";

const COLLAPSED_KEY = "t3code-redesign-mock:notice-collapsed";
export const NOTICE_STORAGE_KEYS = [COLLAPSED_KEY];

const PR_URL = "https://github.com/pingdotgg/t3code/pull/28845";
const REPO_URL = "https://github.com/EtanHey/t3code-redesign-mock";

const STYLE = `
.rdm-notice{position:fixed;z-index:2147483000;top:14px;right:52px;font:500 11.5px/1.35 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#f5f5f4;pointer-events:none}
.rdm-notice *{box-sizing:border-box}
.rdm-pill{pointer-events:auto;display:flex;align-items:center;gap:6px;max-width:min(600px,calc(100vw - 120px));padding:4px 6px 4px 10px;border-radius:999px;background:rgba(24,24,27,.86);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 0 0 1px rgba(255,255,255,.1),0 6px 20px rgba(0,0,0,.25)}
.rdm-dot{width:7px;height:7px;border-radius:50%;background:#f59e0b;flex:none;box-shadow:0 0 0 3px rgba(245,158,11,.22)}
.rdm-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.rdm-text b{font-weight:650}
.rdm-muted{color:#a1a1aa}
.rdm-link,.rdm-button{pointer-events:auto;color:#f5f5f4;text-decoration:none;border:0;background:rgba(255,255,255,.08);border-radius:999px;padding:2px 8px;font:inherit;cursor:pointer;white-space:nowrap}
.rdm-link:hover,.rdm-button:hover{background:rgba(255,255,255,.16)}
.rdm-button[data-armed="true"]{background:#b91c1c}
.rdm-close{pointer-events:auto;border:0;background:transparent;color:#a1a1aa;cursor:pointer;font:inherit;padding:2px 4px;border-radius:999px}
.rdm-close:hover{color:#f5f5f4}
.rdm-collapsed{pointer-events:auto;width:22px;height:22px;border-radius:50%;border:0;padding:0;display:grid;place-items:center;cursor:pointer;background:rgba(24,24,27,.86);box-shadow:0 0 0 1px rgba(255,255,255,.12),0 4px 12px rgba(0,0,0,.25)}
@media (max-width:1100px){.rdm-hide-narrow{display:none}}
`;

// On a phone the pill would sit over the thread title, so narrow screens start with the dot.
const NARROW = 700;
let sessionChoice: boolean | null = null;

function readCollapsed(): boolean {
  if (sessionChoice !== null) return sessionChoice;
  try {
    const stored = window.localStorage.getItem(COLLAPSED_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    // Fall through to the width default.
  }
  return window.innerWidth < NARROW;
}

function writeCollapsed(collapsed: boolean): void {
  sessionChoice = collapsed;
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Not remembered; it still collapses for this page.
  }
}

function relative(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Clears everything this visitor's browser holds for the preview, then reloads. */
export async function resetDemo(runtime: MockRuntime): Promise<void> {
  runtime.log.clear();
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key !== null && !NOTICE_STORAGE_KEYS.includes(key)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
    window.sessionStorage.clear();
  } catch {
    // Storage blocked: nothing was saved either.
  }
  try {
    const databases = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
    await Promise.all(
      databases.map(
        (database) =>
          new Promise<void>((resolve) => {
            if (!database.name) return resolve();
            const request = indexedDB.deleteDatabase(database.name);
            request.onsuccess = request.onerror = request.onblocked = () => resolve();
          }),
      ),
    );
  } catch {
    // No IndexedDB; nothing to clear.
  }
  window.location.assign("/");
}

export function mountNotice(runtime: MockRuntime): void {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);

  const root = document.createElement("div");
  root.className = "rdm-notice";
  root.setAttribute("data-redesign-mock-notice", "");
  document.body.append(root);

  const render = () => {
    root.replaceChildren();
    if (readCollapsed()) {
      const dot = document.createElement("button");
      dot.className = "rdm-collapsed";
      dot.title = "Unofficial mock preview: show details";
      dot.setAttribute("aria-label", "Show mock preview notice");
      const inner = document.createElement("span");
      inner.className = "rdm-dot";
      dot.append(inner);
      dot.addEventListener("click", () => {
        writeCollapsed(false);
        render();
      });
      root.append(dot);
      return;
    }

    const pill = document.createElement("div");
    pill.className = "rdm-pill";
    pill.setAttribute("role", "status");

    const dot = document.createElement("span");
    dot.className = "rdm-dot";

    const text = document.createElement("span");
    text.className = "rdm-text";
    const built = relative(BUILD_INFO.builtAt);
    text.innerHTML = "";
    const strong = document.createElement("b");
    strong.textContent = "Unofficial mock preview";
    const detail = document.createElement("span");
    detail.className = "rdm-muted rdm-hide-narrow";
    detail.textContent = ` · ${BUILD_INFO.branch} @ ${BUILD_INFO.shortCommit}${built ? ` · built ${built}` : ""} · nothing here is real`;
    text.append(strong, detail);
    text.title = `Branch ${BUILD_INFO.branch}\nCommit ${BUILD_INFO.commit}\nCommitted ${BUILD_INFO.committedAt || "unknown"}\nBuilt ${BUILD_INFO.builtAt}\nFixtures ${BUILD_INFO.fixtureVersion}`;

    const pr = document.createElement("a");
    pr.className = "rdm-link";
    pr.href = PR_URL;
    pr.target = "_blank";
    pr.rel = "noreferrer noopener";
    pr.textContent = "PR #28845";

    const repo = document.createElement("a");
    repo.className = "rdm-link rdm-hide-narrow";
    repo.href = REPO_URL;
    repo.target = "_blank";
    repo.rel = "noreferrer noopener";
    repo.textContent = "Mock source";

    const reset = document.createElement("button");
    reset.className = "rdm-button";
    reset.type = "button";
    reset.textContent = "Reset demo";
    reset.title = "Forget everything you did here and bring back the planted threads";
    reset.addEventListener("click", () => {
      if (reset.dataset.armed !== "true") {
        reset.dataset.armed = "true";
        reset.textContent = "Click to confirm";
        setTimeout(() => {
          reset.dataset.armed = "false";
          reset.textContent = "Reset demo";
        }, 4_000);
        return;
      }
      reset.textContent = "Resetting…";
      void resetDemo(runtime);
    });

    const close = document.createElement("button");
    close.className = "rdm-close";
    close.type = "button";
    close.textContent = "✕";
    close.title = "Collapse to a dot";
    close.setAttribute("aria-label", "Collapse the mock preview notice");
    close.addEventListener("click", () => {
      writeCollapsed(true);
      render();
    });

    pill.append(dot, text, pr, repo, reset, close);
    root.append(pill);
  };

  render();
}
