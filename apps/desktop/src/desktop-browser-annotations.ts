import {
  bbDesktopBrowserAnnotationDraftSchema,
  type BbDesktopBrowserAnnotationDraft,
  type BbDesktopBrowserAnnotationMarker,
} from "@bb/desktop-contract";

export const BB_BROWSER_ANNOTATION_ISOLATED_WORLD_ID = 1004;

const BB_BROWSER_ANNOTATION_STYLES = String.raw`
:host {
  all: initial;
  color-scheme: light;
  --bb-surface: #fafafa;
  --bb-surface-raised: #ffffff;
  --bb-text: #171717;
  --bb-text-muted: #525252;
  --bb-hover: rgba(0, 0, 0, 0.06);
  --bb-ring: rgba(0, 0, 0, 0.14);
  --bb-focus: #171717;
  --bb-selection: #171717;
  --bb-selection-soft: rgba(23, 23, 23, 0.08);
  --bb-selection-contrast: #ffffff;
}
:host([data-scheme="dark"]) {
  color-scheme: dark;
  --bb-surface: #202020;
  --bb-surface-raised: #292929;
  --bb-text: #f5f5f5;
  --bb-text-muted: #c4c4c4;
  --bb-hover: rgba(255, 255, 255, 0.09);
  --bb-ring: rgba(255, 255, 255, 0.16);
  --bb-focus: #ffffff;
  --bb-selection: #f5f5f5;
  --bb-selection-soft: rgba(255, 255, 255, 0.08);
  --bb-selection-contrast: #171717;
}
* { box-sizing: border-box; }
.toolbar {
  position: fixed;
  right: 12px;
  top: 50%;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 24px);
  gap: 2px;
  transform: translateY(-50%);
  padding: 4px;
  border-radius: 12px;
  background: var(--bb-surface);
  box-shadow: 0 0 0 1px var(--bb-ring), 0 8px 24px rgba(0, 0, 0, 0.16);
  overflow-y: auto;
  scrollbar-width: none;
}
button {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--bb-text-muted);
  font: 600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  cursor: pointer;
}
button:hover { background: var(--bb-hover); color: var(--bb-text); }
button:focus-visible { outline: 2px solid var(--bb-focus); outline-offset: -2px; }
.active { background: var(--bb-text) !important; color: var(--bb-surface-raised) !important; }
.divider { height: 1px; margin: 2px 6px; background: var(--bb-ring); }
.outline {
  position: fixed;
  z-index: 2147483645;
  pointer-events: none;
  border: 2px solid var(--bb-selection);
  border-radius: 5px;
  background: var(--bb-selection-soft);
  box-shadow: 0 0 0 1px var(--bb-surface-raised);
}
.marker { position: fixed; z-index: 2147483646; background: transparent !important; }
.marker span {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 2px solid var(--bb-surface-raised);
  border-radius: 999px;
  background: var(--bb-selection);
  color: var(--bb-selection-contrast);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.24);
  font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums;
}
.marker:hover span { opacity: 0.84; }
.composer {
  position: fixed;
  z-index: 2147483647;
  width: min(280px, calc(100vw - 24px));
  padding: 8px;
  border-radius: 13px;
  background: var(--bb-surface);
  box-shadow: 0 0 0 1px var(--bb-ring), 0 12px 32px rgba(0, 0, 0, 0.2);
  color: var(--bb-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.composer textarea {
  display: block;
  width: 100%;
  min-height: 84px;
  resize: vertical;
  border: 0;
  border-radius: 8px;
  padding: 9px 10px;
  background: var(--bb-surface-raised);
  color: var(--bb-text);
  box-shadow: 0 0 0 1px var(--bb-ring);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  outline: none;
}
.composer textarea:focus-visible { box-shadow: 0 0 0 2px var(--bb-focus); }
.actions { display: flex; justify-content: flex-end; gap: 4px; margin-top: 8px; }
.actions button { display: block; width: auto; height: 40px; padding: 0 12px; }
.save { background: var(--bb-text) !important; color: var(--bb-surface-raised) !important; }
@media (prefers-reduced-motion: no-preference) {
  button {
    transition-property: transform, background-color, color, opacity;
    transition-duration: 150ms;
    transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  }
  button:active { transform: scale(0.96); }
  .marker span {
    transition-property: transform, opacity;
    transition-duration: 150ms;
    transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  }
  .marker:active span { transform: scale(0.96); }
  .composer { animation: bbAnnotationIn 250ms cubic-bezier(0.22, 1, 0.36, 1); }
  .composer.is-closing { animation: bbAnnotationOut 150ms cubic-bezier(0.22, 1, 0.36, 1) both; pointer-events: none; }
  @keyframes bbAnnotationIn {
    from { opacity: 0; transform: translateY(4px) scale(0.97); }
    to { opacity: 1; transform: none; }
  }
  @keyframes bbAnnotationOut {
    to { opacity: 0; transform: translateY(2px) scale(0.99); }
  }
}
@media (forced-colors: active) {
  .toolbar, .composer, .composer textarea { border: 1px solid CanvasText; box-shadow: none; }
  .outline { border-color: Highlight; background: transparent; box-shadow: none; }
  button:focus-visible { outline-color: Highlight; }
}`;

/**
 * Runs in an isolated world. It can inspect the page DOM, but page JavaScript
 * cannot read or replace the controller state or completion promise.
 */
export const BB_BROWSER_ANNOTATION_ENABLE_SCRIPT = String.raw`
(() => {
  const key = "__bbAnnotationControllerV1";
  let controller = globalThis[key];
  if (!controller) {
    const root = document.createElement("div");
    root.setAttribute("data-bb-annotation-ui", "true");
    const shadow = root.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = ${JSON.stringify(BB_BROWSER_ANNOTATION_STYLES)};
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Page annotation tools");
    toolbar.innerHTML = '<button class="active" data-mode="element" type="button" aria-label="Select element" aria-pressed="true" title="Element">◇</button><button data-mode="text" type="button" aria-label="Select text" aria-pressed="false" title="Text">T</button><button data-mode="area" type="button" aria-label="Select area" aria-pressed="false" title="Area">▱</button><button data-mode="multi" type="button" aria-label="Select multiple elements" aria-pressed="false" title="Multi-select">⧉</button><span class="divider" aria-hidden="true"></span><button data-action="focused" type="button" aria-label="Select focused page content" title="Select focused content (Control or Command+Shift+Enter)">↵</button><button data-mode="comment" type="button" aria-label="Add comment to element" aria-pressed="false" title="Comment">＋</button><button data-mode="pause" type="button" aria-label="Pause annotation capture" aria-pressed="false" title="Pause">Ⅱ</button>';
    const outline = document.createElement("div");
    outline.className = "outline";
    outline.hidden = true;
    shadow.append(style, toolbar, outline);
    (document.documentElement || document.body).appendChild(root);

    controller = {
      root, shadow, toolbar, outline, composer: null, target: null, capture: null,
      areaStart: null, markers: new Map(), mode: "element", waiters: [],
      layoutFrame: 0, latestPointer: null, markersDirty: false, lastPageTarget: null
    };
    globalThis[key] = controller;

    const isOwnUi = (node) => node instanceof Node && (node === root || root.contains(node));
    const updateScheme = () => {
      const surface = document.body || document.documentElement;
      const color = getComputedStyle(surface).backgroundColor;
      const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
      const alpha = Number(color.match(/[\d.]+/g)?.[3] ?? 1);
      const dark = channels.length === 3 && alpha > 0
        ? (channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722) < 128
        : matchMedia("(prefers-color-scheme: dark)").matches;
      root.setAttribute("data-scheme", dark ? "dark" : "light");
    };
    updateScheme();
    const schemeObserver = new MutationObserver(updateScheme);
    schemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    if (document.body) schemeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });

    const selectorFor = (element) => {
      if (element.id) return "#" + CSS.escape(element.id);
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
        let part = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
          if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
        }
        parts.unshift(part);
        current = parent;
      }
      return parts.join(" > ");
    };
    const placeRect = (rect) => {
      outline.hidden = false;
      outline.style.left = rect.left + "px";
      outline.style.top = rect.top + "px";
      outline.style.width = rect.width + "px";
      outline.style.height = rect.height + "px";
    };
    controller.focusRect = placeRect;
    const placeOutline = (element) => placeRect(element.getBoundingClientRect());
    const markerRect = (marker) => {
      try {
        const element = document.querySelector(marker.annotation.selector);
        if (element instanceof Element && marker.annotation.selector !== "body") return element.getBoundingClientRect();
      } catch {}
      const rectangle = marker.annotation.rectangle;
      return { left: rectangle.x, top: rectangle.y, right: rectangle.x + rectangle.width, bottom: rectangle.y + rectangle.height, width: rectangle.width, height: rectangle.height };
    };
    const positionMarker = (marker) => {
      const rect = markerRect(marker);
      marker.node.style.left = Math.max(0, Math.min(innerWidth - 40, rect.right - 20)) + "px";
      marker.node.style.top = Math.max(0, Math.min(innerHeight - 40, rect.top - 20)) + "px";
    };
    const updateMarkersNow = () => controller.markers.forEach(positionMarker);
    const runLayout = () => {
      controller.layoutFrame = 0;
      const event = controller.latestPointer;
      controller.latestPointer = null;
      if (event) {
        if (controller.mode === "area" && controller.areaStart) {
          const left = Math.min(controller.areaStart.x, event.clientX);
          const top = Math.min(controller.areaStart.y, event.clientY);
          placeRect({ left, top, width: Math.abs(event.clientX - controller.areaStart.x), height: Math.abs(event.clientY - controller.areaStart.y) });
        } else if (controller.mode !== "pause" && controller.mode !== "text" && controller.mode !== "area" && !controller.composer && event.target instanceof Element && !isOwnUi(event.target)) {
          controller.target = event.target;
          placeOutline(event.target);
        }
      }
      if (controller.markersDirty) {
        controller.markersDirty = false;
        updateMarkersNow();
      }
    };
    const scheduleLayout = () => {
      if (!controller.layoutFrame) controller.layoutFrame = requestAnimationFrame(runLayout);
    };
    const scheduleMarkerUpdate = () => { controller.markersDirty = true; scheduleLayout(); };
    const addMarker = (annotation) => {
      const marker = document.createElement("button");
      marker.className = "marker";
      marker.type = "button";
      marker.title = annotation.comment;
      marker.setAttribute("aria-label", "Annotation " + annotation.number + ": " + annotation.comment);
      const number = document.createElement("span");
      number.textContent = String(annotation.number);
      marker.appendChild(number);
      const entry = { node: marker, annotation };
      marker.addEventListener("click", () => placeRect(markerRect(entry)));
      controller.markers.set(annotation.id, entry);
      shadow.appendChild(marker);
      positionMarker(entry);
    };
    controller.syncMarkers = (annotations) => {
      const nextIds = new Set(annotations.map((annotation) => annotation.id));
      controller.markers.forEach((marker, id) => {
        if (!nextIds.has(id)) { marker.node.remove(); controller.markers.delete(id); }
      });
      annotations.forEach((annotation) => {
        const existing = controller.markers.get(annotation.id);
        if (!existing) { addMarker(annotation); return; }
        existing.annotation = annotation;
        existing.node.title = annotation.comment;
        existing.node.setAttribute("aria-label", "Annotation " + annotation.number + ": " + annotation.comment);
        existing.node.firstElementChild.textContent = String(annotation.number);
      });
      scheduleMarkerUpdate();
    };
    const closeComposer = (restoreFocus = false) => {
      const composer = controller.composer;
      if (composer) {
        if (matchMedia("(prefers-reduced-motion: no-preference)").matches) {
          composer.classList.add("is-closing");
          setTimeout(() => composer.remove(), 150);
        } else {
          composer.remove();
        }
      }
      controller.composer = null;
      controller.target = null;
      controller.capture = null;
      if (restoreFocus && controller.lastPageTarget?.isConnected && typeof controller.lastPageTarget.focus === "function") controller.lastPageTarget.focus();
    };
    const setMode = (mode) => {
      controller.mode = mode;
      controller.areaStart = null;
      outline.hidden = true;
      closeComposer();
      toolbar.querySelectorAll("button[data-mode]").forEach((button) => {
        const active = button.dataset.mode === mode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
    };
    toolbar.querySelectorAll("button[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
    toolbar.addEventListener("keydown", (event) => {
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      const buttons = Array.from(toolbar.querySelectorAll("button"));
      const index = buttons.indexOf(shadow.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    });
    const openComposer = (capture) => {
      closeComposer();
      controller.capture = capture;
      const rect = capture.currentRect();
      placeRect(rect);
      const composer = document.createElement("div");
      composer.className = "composer";
      composer.setAttribute("role", "dialog");
      composer.setAttribute("aria-label", "Add page annotation");
      const width = Math.max(0, Math.min(280, innerWidth - 24));
      const left = Math.max(12, Math.min(innerWidth - width - 12, rect.right + 10));
      const top = Math.max(12, Math.min(innerHeight - 150, rect.top));
      composer.style.left = left + "px";
      composer.style.top = top + "px";
      composer.innerHTML = '<textarea maxlength="8000" aria-label="Annotation comment" placeholder="Describe the change…"></textarea><div class="actions"><button class="cancel" type="button">Cancel</button><button class="save" type="button">Add comment</button></div>';
      shadow.appendChild(composer);
      controller.composer = composer;
      const textarea = composer.querySelector("textarea");
      textarea.focus();
      composer.querySelector(".cancel").addEventListener("click", () => closeComposer(true));
      const save = () => {
        const comment = textarea.value.trim();
        if (!comment) { textarea.focus(); return; }
        const currentRect = capture.currentRect();
        const result = {
          selector: capture.selector,
          url: location.href,
          viewport: { width: Math.round(innerWidth), height: Math.round(innerHeight) },
          rectangle: { x: currentRect.x, y: currentRect.y, width: currentRect.width, height: currentRect.height },
          comment
        };
        closeComposer();
        outline.hidden = true;
        const waiters = controller.waiters.splice(0);
        waiters.forEach((resolve) => resolve(result));
      };
      composer.querySelector(".save").addEventListener("click", save);
      textarea.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); save(); }
      });
    };
    const captureFocused = () => {
      if (controller.composer) return;
      if (!["element", "text", "area"].includes(controller.mode)) return;
      if (controller.mode === "text") {
        const selection = getSelection();
        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const container = range.commonAncestorContainer;
          const target = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
          const rect = range.getBoundingClientRect();
          if (target instanceof Element && (rect.width > 0 || rect.height > 0)) {
            openComposer({ selector: selectorFor(target), currentRect: () => rect });
            return;
          }
        }
      }
      const target = controller.lastPageTarget || document.activeElement;
      if (!(target instanceof Element) || isOwnUi(target)) return;
      openComposer({ selector: selectorFor(target), currentRect: () => target.getBoundingClientRect() });
    };
    toolbar.querySelector("button[data-action=focused]").addEventListener("click", captureFocused);
    const onFocusIn = (event) => {
      if (event.target instanceof Element && !isOwnUi(event.target)) controller.lastPageTarget = event.target;
    };
    const onMove = (event) => {
      controller.latestPointer = { clientX: event.clientX, clientY: event.clientY, target: event.target };
      scheduleLayout();
    };
    const onClick = (event) => {
      if (controller.mode === "pause" || controller.mode === "text" || controller.mode === "area" || isOwnUi(event.target) || !(event.target instanceof Element)) return;
      event.preventDefault();
      event.stopPropagation();
      controller.target = event.target;
      controller.lastPageTarget = event.target;
      openComposer({ selector: selectorFor(event.target), currentRect: () => event.target.getBoundingClientRect() });
    };
    const onMouseUp = (event) => {
      if (controller.mode !== "text" || isOwnUi(event.target)) return;
      const selection = getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const target = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
      if (!(target instanceof Element)) return;
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      controller.lastPageTarget = target;
      openComposer({ selector: selectorFor(target), currentRect: () => rect });
    };
    const onPointerDown = (event) => {
      if (controller.mode !== "area" || isOwnUi(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      controller.areaStart = { x: event.clientX, y: event.clientY };
      placeRect({ left: event.clientX, top: event.clientY, width: 0, height: 0 });
    };
    const onPointerUp = (event) => {
      if (controller.mode !== "area" || !controller.areaStart) return;
      event.preventDefault();
      event.stopPropagation();
      const left = Math.min(controller.areaStart.x, event.clientX);
      const top = Math.min(controller.areaStart.y, event.clientY);
      const rect = { left, top, x: left, y: top, right: Math.max(controller.areaStart.x, event.clientX), bottom: Math.max(controller.areaStart.y, event.clientY), width: Math.abs(event.clientX - controller.areaStart.x), height: Math.abs(event.clientY - controller.areaStart.y) };
      controller.areaStart = null;
      if (rect.width < 4 || rect.height < 4) { outline.hidden = true; return; }
      openComposer({ selector: "body", currentRect: () => rect });
    };
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        captureFocused();
        return;
      }
      if (event.key !== "Escape") return;
      if (controller.composer) { closeComposer(true); return; }
      outline.hidden = true;
      controller.target = null;
    };
    const destroy = () => {
      const waiters = controller.waiters.splice(0);
      waiters.forEach((resolve) => resolve(null));
      if (controller.layoutFrame) cancelAnimationFrame(controller.layoutFrame);
      schemeObserver.disconnect();
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", scheduleMarkerUpdate, true);
      globalThis.removeEventListener("resize", scheduleMarkerUpdate);
      root.remove();
      delete globalThis[key];
    };
    controller.dispose = destroy;
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", scheduleMarkerUpdate, true);
    globalThis.addEventListener("resize", scheduleMarkerUpdate);
  }
  return new Promise((resolve) => controller.waiters.push(resolve));
})()
`;

export function buildBrowserAnnotationFocusScript(rectangle: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string {
  const serialized = JSON.stringify({
    left: rectangle.x,
    top: rectangle.y,
    width: rectangle.width,
    height: rectangle.height,
  });
  return `(() => { const controller = globalThis.__bbAnnotationControllerV1; if (!controller?.focusRect) return; controller.focusRect(${serialized}); })()`;
}

export function buildBrowserAnnotationSyncScript(
  annotations: readonly BbDesktopBrowserAnnotationMarker[],
): string {
  const serialized = JSON.stringify(annotations);
  return `(() => { const controller = globalThis.__bbAnnotationControllerV1; if (!controller?.syncMarkers) return; controller.syncMarkers(${serialized}); })()`;
}

export const BB_BROWSER_ANNOTATION_DISABLE_SCRIPT = String.raw`
(() => {
  const controller = globalThis.__bbAnnotationControllerV1;
  if (!controller) return;
  controller.dispose();
})()
`;

export function parseBrowserAnnotationDraft(
  tabId: string,
  payload: unknown,
): BbDesktopBrowserAnnotationDraft | null {
  const parsed = bbDesktopBrowserAnnotationDraftSchema.safeParse({
    ...(typeof payload === "object" && payload !== null ? payload : {}),
    tabId,
  });
  return parsed.success ? parsed.data : null;
}
