import { useEffect, useLayoutEffect, useRef, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const REVEAL_DURATION_MS = 96;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

function safeSliceEnd(text: string, requestedEnd: number): number {
  if (requestedEnd >= text.length) {
    return text.length;
  }

  const previousCodeUnit = text.charCodeAt(requestedEnd - 1);
  const nextCodeUnit = text.charCodeAt(requestedEnd);
  const splitsSurrogatePair =
    previousCodeUnit >= 0xd800 &&
    previousCodeUnit <= 0xdbff &&
    nextCodeUnit >= 0xdc00 &&
    nextCodeUnit <= 0xdfff;
  return splitsSurrogatePair ? requestedEnd + 1 : requestedEnd;
}

/**
 * Smooths appended provider chunks across a few frames. Existing text stays
 * visible, and replacements render immediately so navigation never replays a
 * completed response.
 */
export function useSoftStreamedText(text: string): string {
  const [stream, setStream] = useState(() => ({
    targetText: text,
    visibleText: text,
    revealStartLength: text.length,
  }));
  const targetTextRef = useRef(text);
  const revealStartLengthRef = useRef(text.length);
  const revealStartedAtRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  if (stream.targetText !== text) {
    const isAppend =
      text.length > stream.visibleText.length &&
      text.startsWith(stream.visibleText) &&
      !prefersReducedMotion();
    setStream({
      targetText: text,
      visibleText: isAppend ? stream.visibleText : text,
      revealStartLength: isAppend ? stream.visibleText.length : text.length,
    });
  }

  useLayoutEffect(() => {
    targetTextRef.current = stream.targetText;
    revealStartLengthRef.current = stream.revealStartLength;
    revealStartedAtRef.current = performance.now();

    if (stream.targetText.length === stream.revealStartLength) {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      return;
    }

    const revealNextFrame = (now: number) => {
      const targetText = targetTextRef.current;
      const startLength = revealStartLengthRef.current;
      const appendedLength = targetText.length - startLength;
      const elapsed = Math.max(0, now - revealStartedAtRef.current);
      const progress = Math.min(1, elapsed / REVEAL_DURATION_MS);
      const requestedEnd = Math.max(
        startLength + 1,
        startLength + Math.ceil(appendedLength * progress),
      );
      const nextEnd = safeSliceEnd(targetText, requestedEnd);
      const nextText = targetText.slice(0, nextEnd);

      setStream((current) =>
        current.targetText === targetText
          ? { ...current, visibleText: nextText }
          : current,
      );

      if (nextEnd < targetText.length) {
        frameRef.current = window.requestAnimationFrame(revealNextFrame);
      } else {
        frameRef.current = null;
      }
    };

    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(revealNextFrame);
    }
  }, [stream.revealStartLength, stream.targetText]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    },
    [],
  );

  return stream.targetText === text ? stream.visibleText : text;
}
