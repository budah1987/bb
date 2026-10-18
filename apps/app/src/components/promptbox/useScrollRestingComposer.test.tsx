// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomAnchorContext } from "@/components/ui/bottom-anchored-scroll-body";
import { useScrollRestingComposer } from "./useScrollRestingComposer";

function Harness({
  blocked = false,
  isAtBottom = false,
  resetKey = "thread-a",
} = {}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const getScrollElement = useCallback(() => scrollRef.current, []);
  return (
    <BottomAnchorContext.Provider
      value={{
        getScrollElement,
        isAtBottom,
        scrollToBottom: () => {},
        anchorNextUserMessage: () => {},
        captureScrollAnchor: () => {},
        scrollElementIntoView: () => {},
        scrollElementIntoViewClampedToMaxScroll: () => {},
      }}
    >
      <div data-floating-chat="">
        <div
          tabIndex={0}
          data-testid="timeline"
          ref={(element) => {
            scrollRef.current = element;
            if (!element) return;
            Object.defineProperties(element, {
              scrollHeight: { configurable: true, value: 1200 },
              clientHeight: { configurable: true, value: 400 },
            });
            element.scrollTop = 300;
          }}
        >
          <div data-testid="nested" style={{ overflowY: "auto" }}>
            Tool output
          </div>
        </div>
        <Composer blocked={blocked} resetKey={resetKey} />
      </div>
    </BottomAnchorContext.Provider>
  );
}

function Composer({
  blocked,
  resetKey,
}: {
  blocked: boolean;
  resetKey: string;
}) {
  const composerRef = useRef<HTMLDivElement>(null);
  const { isResting, expand } = useScrollRestingComposer({
    composerRef,
    enabled: true,
    blocked,
    resetKey,
  });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("Keep this draft");
  return (
    <div ref={composerRef}>
      <output data-testid="resting">{String(isResting)}</output>
      <input
        aria-label="Draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={expand}
      />
      <button
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Model Deck
      </button>
    </div>
  );
}

function wheel(deltaY = -30, target = screen.getByTestId("timeline")) {
  fireEvent.wheel(target, { deltaY });
}
function expectResting(value: boolean) {
  expect(screen.getByTestId("resting").textContent).toBe(String(value));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("desktop composer resting state", () => {
  it("requires a deliberate gesture, rather than a scroll event or streamed resize", () => {
    render(<Harness />);
    fireEvent.scroll(screen.getByTestId("timeline"));
    fireEvent(window, new Event("resize"));
    expectResting(false);
    wheel(-10);
    expectResting(false);
    wheel(-15);
    expectResting(true);
  });

  it("keeps the plugin trigger and draft mounted while resting, and restores on editor focus", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Model Deck" });
    const input = screen.getByRole("textbox", { name: "Draft" });
    wheel();
    expectResting(true);
    expect(screen.getByRole("button", { name: "Model Deck" })).toBe(trigger);
    expect(screen.getByDisplayValue("Keep this draft")).toBe(input);
    fireEvent.focus(input);
    expectResting(false);
  });

  it("expands for a plugin-owned overlay opened while the trigger is unfocused", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Model Deck" });
    wheel();
    expectResting(true);
    fireEvent.click(trigger);
    await waitFor(() => expectResting(false));
    wheel();
    expectResting(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("does not steal wheel gestures from a scrollable tool result", () => {
    render(<Harness />);
    const nested = screen.getByTestId("nested");
    Object.defineProperties(nested, {
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 100 },
    });
    nested.scrollTop = 100;
    wheel(-40, nested);
    expectResting(false);
    nested.scrollTop = 0;
    wheel(-40, nested);
    expectResting(true);
  });

  it("keeps protected drafts, attachments, and recording states expanded", () => {
    const view = render(<Harness />);
    wheel();
    expectResting(true);
    view.rerender(<Harness blocked />);
    expectResting(false);
    wheel();
    expectResting(false);
  });

  it("restores when returning to latest or changing thread", () => {
    const view = render(<Harness />);
    wheel();
    expectResting(true);
    view.rerender(<Harness isAtBottom />);
    expectResting(false);
    view.rerender(<Harness />);
    wheel();
    expectResting(true);
    view.rerender(<Harness resetKey="thread-b" />);
    expectResting(false);
  });

  it("handles keyboard timeline navigation immediately and ignores zoom gestures", () => {
    render(<Harness />);
    fireEvent.wheel(screen.getByTestId("timeline"), {
      deltaY: -100,
      ctrlKey: true,
    });
    expectResting(false);
    act(() => {
      fireEvent.keyDown(screen.getByTestId("timeline"), { key: "PageUp" });
    });
    expectResting(true);
  });
});
