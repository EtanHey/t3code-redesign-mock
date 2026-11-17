// The notice: a small "Mock preview" pill that opens a card saying this is an unofficial mock,
// naming the upstream branch and commit, linking the PR and the mock repo, and carrying "Reset
// demo". Plain DOM in a fixed layer of its own, so it never takes part in the app's layout.
//
// It must never sit on one of her controls or on the composer, and it always shows its words.
// Instead of trusting a fixed spot, it measures: it keeps its spot while that stays free, else
// tries the free end of the sidebar footer and the top right (wide screens), then scans down the
// right and left edges of the screen, and takes the first spot that covers no button, link, tab,
// field or frame of hers. It checks again on resize and every few seconds (tabs open, panels move).
import type { MockRuntime } from "./runtime";
import { BUILD_INFO } from "./runtime";

/** Kept by "Reset demo"; the notice stores nothing today. */
export const NOTICE_STORAGE_KEYS: ReadonlyArray<string> = [];

const PR_URL = "https://github.com/pingdotgg/t3code/pull/28845";
const REPO_URL = "https://github.com/EtanHey/t3code-redesign-mock";
const MARIA_URL = "https://github.com/maria-rcks";
const ETAN_URL = "https://github.com/EtanHey";
const MARIA_X = "https://x.com/maria_rcks";
const ETAN_X = "https://x.com/EtanHey";

const STYLE = `
.rdm-notice{position:fixed;z-index:2147483000;font:500 11.5px/1.35 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#f5f5f4}
.rdm-notice *{box-sizing:border-box}
.rdm-pill{display:flex;align-items:center;gap:6px;height:24px;padding:0 9px 0 8px;border:0;border-radius:999px;cursor:pointer;color:#f5f5f4;font:inherit;white-space:nowrap;background:rgba(24,24,27,.88);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 0 0 1px rgba(255,255,255,.12),0 4px 14px rgba(0,0,0,.25)}
.rdm-pill:hover{background:rgba(39,39,42,.95)}
.rdm-dot{width:7px;height:7px;border-radius:50%;background:#f59e0b;flex:none;box-shadow:0 0 0 3px rgba(245,158,11,.22)}
.rdm-card{position:fixed;width:min(320px,calc(100vw - 24px));padding:12px 12px 10px;border-radius:12px;background:rgba(24,24,27,.96);box-shadow:0 0 0 1px rgba(255,255,255,.12),0 12px 32px rgba(0,0,0,.4)}
.rdm-card b{display:block;font-size:12.5px;font-weight:650;margin-bottom:4px}
.rdm-card p{margin:0 0 10px;color:#a1a1aa}
.rdm-card p a{color:#f5f5f4;text-decoration:underline;text-underline-offset:2px}
.rdm-card p a:hover{color:#fff}
.rdm-credit{display:flex;flex-direction:column;gap:3px}
.rdm-credit span{display:flex;align-items:center;gap:5px}
.rdm-card .rdm-x{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:4px;color:#a1a1aa;text-decoration:none}
.rdm-card .rdm-x:hover{color:#fff;background:rgba(255,255,255,.1)}
.rdm-x svg{width:10px;height:10px;fill:currentColor}
.rdm-card code{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#d4d4d8}
.rdm-actions{display:flex;flex-wrap:wrap;gap:6px}
.rdm-link,.rdm-button{color:#f5f5f4;text-decoration:none;border:0;background:rgba(255,255,255,.08);border-radius:999px;padding:3px 9px;font:inherit;cursor:pointer;white-space:nowrap}
.rdm-link:hover,.rdm-button:hover{background:rgba(255,255,255,.16)}
.rdm-button[data-armed="true"]{background:#b91c1c}
`;

/** Where the pill sits: a side and a distance from it on each axis, in CSS pixels. */
interface Spot {
  readonly x: "left" | "right";
  readonly dx: number;
  readonly y: "top" | "bottom";
  readonly dy: number;
}

const sameSpot = (left: Spot, right: Spot) =>
  left.x === right.x && left.dx === right.dx && left.y === right.y && left.dy === right.dy;

/** Below this width there is no sidebar footer and the titlebar has no free corner. */
const WIDE = 640;
const MARGIN = 12;
const STEP = 12;

/** The empty end of her sidebar's icon row, then the top right corner. */
const FIXED_SPOTS: ReadonlyArray<Spot> = [
  { x: "left", dx: 116, y: "bottom", dy: 13 },
  { x: "right", dx: 52, y: "top", dy: 14 },
];

/** Every spot to try, best first: the fixed ones on wide screens, then down both edges. */
function candidates(): Spot[] {
  const spots: Spot[] = window.innerWidth >= WIDE ? [...FIXED_SPOTS] : [];
  // The titlebar row first (free when a sheet such as her phone sidebar covers it), then down
  // from just below it (52px on a phone), then up from the bottom edge.
  const right = (dy: number): Spot => ({ x: "right", dx: MARGIN, y: "top", dy });
  const left = (dy: number): Spot => ({ x: "left", dx: MARGIN, y: "top", dy });
  spots.push(right(14));
  for (let dy = 58; dy <= window.innerHeight - 40; dy += STEP) spots.push(right(dy), left(dy));
  spots.push({ x: "left", dx: 116, y: "bottom", dy: 13 }, { x: "right", dx: 52, y: "bottom", dy: 13 });
  return spots;
}

const INTERACTIVE =
  "button, a[href], input, textarea, select, iframe, [role=button], [role=tab], [role=link], [role=textbox], [contenteditable=true], [contenteditable='']";

const overlaps = (box: DOMRect, rect: DOMRect) =>
  box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top;

/** The composer's whole card: the outermost box around a text field that holds no other field. */
function composerBoxes(): DOMRect[] {
  const boxes: DOMRect[] = [];
  for (const field of document.querySelectorAll<HTMLElement>("[contenteditable=true], textarea")) {
    let box: HTMLElement = field;
    for (let parent = box.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (parent.querySelectorAll("[contenteditable=true], textarea").length > 1) break;
      if (parent.getBoundingClientRect().height > window.innerHeight * 0.4) break;
      box = parent;
    }
    boxes.push(box.getBoundingClientRect());
  }
  return boxes;
}

/** One measurement of the page: answers "would this rectangle cover the composer or a control?". */
function measure(root: HTMLElement): (rect: DOMRect) => boolean {
  const composers = composerBoxes().filter((box) => box.width > 0);
  const controls: Array<{ readonly element: HTMLElement; readonly box: DOMRect }> = [];
  for (const element of document.querySelectorAll<HTMLElement>(INTERACTIVE)) {
    if (root.contains(element)) continue;
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (box.bottom < 0 || box.top > window.innerHeight || box.right < 0 || box.left > window.innerWidth) continue;
    controls.push({ element, box });
  }
  return (rect) => {
    if (composers.some((box) => overlaps(box, rect))) return true;
    for (const { element, box } of controls) {
      const left = Math.max(box.left, rect.left);
      const right = Math.min(box.right, rect.right);
      const top = Math.max(box.top, rect.top);
      const bottom = Math.min(box.bottom, rect.bottom);
      if (left >= right || top >= bottom) continue;
      // Clipped or covered controls do not count: look at what is really drawn there.
      const drawn = document
        .elementsFromPoint((left + right) / 2, (top + bottom) / 2)
        .find((candidate) => !root.contains(candidate));
      if (drawn && (drawn === element || element.contains(drawn) || drawn.contains(element))) return true;
    }
    return false;
  };
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

function link(text: string, href: string): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.className = "rdm-link";
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noreferrer noopener";
  anchor.textContent = text;
  return anchor;
}

function inlineLink(text: string, href: string): HTMLAnchorElement {
  const anchor = link(text, href);
  anchor.className = "";
  return anchor;
}

const X_LOGO =
  "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z";

/** "Mock by EtanHey 𝕏": the handle links to GitHub, the X logo to the X profile. */
function creditLine(role: string, handle: string, github: string, x: string): HTMLSpanElement {
  const line = document.createElement("span");
  const xLink = inlineLink("", x);
  xLink.className = "rdm-x";
  xLink.setAttribute("aria-label", `${handle} on X`);
  xLink.title = `${handle} on X`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", X_LOGO);
  svg.append(path);
  xLink.append(svg);
  const githubLink = inlineLink(handle, github);
  githubLink.title = `${handle} on GitHub`;
  line.append(`${role} `, githubLink, xLink);
  return line;
}

function buildCard(runtime: MockRuntime): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "rdm-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "About this mock preview");

  const title = document.createElement("b");
  title.textContent = "Unofficial mock preview";
  const body = document.createElement("p");
  const built = relative(BUILD_INFO.builtAt);
  const branch = document.createElement("code");
  branch.textContent = `${BUILD_INFO.branch} @ ${BUILD_INFO.shortCommit}`;
  body.append(
    "Maria's T3 Code redesign, ",
    branch,
    `, built ${built || "recently"} and rebuilt every hour. Nothing here is real, and what you do stays in this browser.`,
  );
  const credit = document.createElement("p");
  credit.className = "rdm-credit";
  credit.append(
    creditLine("Redesigned by", "maria-rcks", MARIA_URL, MARIA_X),
    creditLine("Mock by", "EtanHey", ETAN_URL, ETAN_X),
  );
  body.title = `Commit ${BUILD_INFO.commit}\nCommitted ${BUILD_INFO.committedAt || "unknown"}\nBuilt ${BUILD_INFO.builtAt}\nFixtures ${BUILD_INFO.fixtureVersion}`;

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

  const actions = document.createElement("div");
  actions.className = "rdm-actions";
  actions.append(link("PR #28845", PR_URL), link("Mock source", REPO_URL), reset);
  card.append(title, body, credit, actions);
  return card;
}

export function mountNotice(runtime: MockRuntime): void {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);

  const root = document.createElement("div");
  root.className = "rdm-notice";
  root.setAttribute("data-redesign-mock-notice", "");

  const pill = document.createElement("button");
  pill.className = "rdm-pill";
  pill.type = "button";
  pill.title = "Unofficial mock preview: Maria's redesign, mocked by Etan. Nothing here is real";
  pill.setAttribute("aria-label", "About this mock preview");
  pill.setAttribute("aria-expanded", "false");
  const dot = document.createElement("span");
  dot.className = "rdm-dot";
  const label = document.createElement("span");
  label.className = "rdm-label";
  label.textContent = "Mock preview";
  pill.append(dot, label);
  root.append(pill);
  document.body.append(root);

  let card: HTMLDivElement | null = null;
  let spot: Spot | null = null;

  const moveTo = (next: Spot) => {
    Object.assign(root.style, {
      left: next.x === "left" ? `${next.dx}px` : "",
      right: next.x === "right" ? `${next.dx}px` : "",
      top: next.y === "top" ? `${next.dy}px` : "",
      bottom: next.y === "bottom" ? `${next.dy}px` : "",
    });
  };

  const place = () => {
    if (card) return;
    // Measured synchronously, so the pill never paints at a spot it then leaves.
    const covers = measure(root);
    const options = candidates();
    const current = spot;
    const ordered = current ? [current, ...options.filter((option) => !sameSpot(option, current))] : options;
    for (const candidate of ordered) {
      moveTo(candidate);
      if (!covers(pill.getBoundingClientRect())) {
        spot = candidate;
        root.dataset.spot = `${candidate.x}-${candidate.y}`;
        return;
      }
    }
    // Nothing is free (never seen): stay labeled, just under the titlebar.
    spot = options.find((option) => option.y === "top" && option.dy >= 58) ?? FIXED_SPOTS[1]!;
    root.dataset.spot = "fallback";
    moveTo(spot);
  };

  const closeCard = () => {
    card?.remove();
    card = null;
    pill.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onOutside = (event: Event) => {
    if (event.target instanceof Node && !root.contains(event.target)) closeCard();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeCard();
  };

  pill.addEventListener("click", () => {
    if (card) return closeCard();
    card = buildCard(runtime);
    root.append(card);
    pill.setAttribute("aria-expanded", "true");
    // Open toward the middle of the screen, inside the viewport.
    const anchor = pill.getBoundingClientRect();
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const left = Math.min(Math.max(12, anchor.left), window.innerWidth - width - 12);
    const below = anchor.top < window.innerHeight / 2;
    card.style.left = `${left}px`;
    card.style.top = `${below ? anchor.bottom + 8 : anchor.top - height - 8}px`;
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
  });

  place();
  window.addEventListener("resize", place);
  // The app renders after this mounts and keeps changing (tabs, panels, sheets).
  let checks = 0;
  const timer = window.setInterval(() => {
    place();
    checks += 1;
    if (checks === 10) {
      window.clearInterval(timer);
      window.setInterval(place, 3_000);
    }
  }, 500);
}
