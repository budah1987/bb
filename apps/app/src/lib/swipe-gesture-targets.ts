/**
 * Shared arbitration for horizontal touch gestures (the sidebar's edge swipe
 * and the compact workspace swipe). Both must yield to the same things — a
 * horizontal scroller under the finger, and an expanded text selection the user
 * is still adjusting — so the predicates live once, here.
 */

function isHorizontallyScrollableElement(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (view === null || !(element instanceof view.HTMLElement)) {
    return false;
  }

  const overflowX = view.getComputedStyle(element).overflowX;
  if (
    overflowX !== "auto" &&
    overflowX !== "scroll" &&
    overflowX !== "overlay"
  ) {
    return false;
  }

  return element.scrollWidth > element.clientWidth + 1;
}

/**
 * Walks ancestors for a scroller that owns the horizontal axis, stopping at the
 * gesture's own surface so the search cannot escape into unrelated chrome.
 */
export function isInsideHorizontalScrollRegion(
  target: Element,
  boundarySelector: string,
): boolean {
  let element: Element | null = target;
  while (element !== null) {
    if (isHorizontallyScrollableElement(element)) {
      return true;
    }
    if (element.matches(boundarySelector)) {
      return false;
    }
    element = element.parentElement;
  }

  return false;
}

const BLOCKING_OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[data-vaul-drawer][data-state="open"]',
  // The mobile sidebar drawer, whichever visual variant it renders with.
  '[data-sidebar="panel"][data-state="open"]',
  // Radix popovers, dropdowns, selects, and comboboxes all portal through this.
  "[data-radix-popper-content-wrapper]",
].join(", ");

/**
 * True while an overlay owns the screen. A page-level swipe must not start
 * underneath one — not even on the uncovered part of a backdrop, which belongs
 * to the overlay — because a partial drag would be an ambiguous way to dismiss
 * it. The overlay's own affordances (backdrop tap, Vaul swipe-to-close, Escape)
 * stay the only way out.
 */
export function isBlockingOverlayOpen(ownerDocument: Document): boolean {
  return ownerDocument.querySelector(BLOCKING_OVERLAY_SELECTOR) !== null;
}

/** The nearest region whose prose the user may be selecting by dragging. */
export function getSwipeSelectionRoot(
  target: EventTarget | null,
): Element | null {
  return target instanceof Element
    ? target.closest("[data-sidebar-swipe-selectable]")
    : null;
}

export function hasExpandedTextSelectionWithin(root: Element): boolean {
  const selection = root.ownerDocument.getSelection();
  if (selection === null || selection.isCollapsed) {
    return false;
  }

  return (
    (selection.anchorNode !== null && root.contains(selection.anchorNode)) ||
    (selection.focusNode !== null && root.contains(selection.focusNode))
  );
}
