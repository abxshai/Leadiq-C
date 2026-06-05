"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Glyph pool the characters flip through while "decoding". Skewed toward the
// techy symbol set that reads well in the wide-caps heading face.
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_/\\[]{}<>=+*^?#$%&";

/**
 * Text "render"/decode animation (à la hermes-agent.nousresearch.com): each
 * character starts blank, cycles through random glyphs over a short window,
 * then resolves to the final letter — a left-to-right decode shimmer.
 *
 * Re-runs on a `loopMs` interval (default 10s). The animated glyphs are
 * overlaid on an invisible full-text "sizer" so the decode never changes
 * layout width (no page jitter). SSR-safe (renders the final text on the
 * server / first paint, so no hydration mismatch and the real text is present
 * for no-JS), and screen-reader-safe via `aria-label` with the live glyph soup
 * marked `aria-hidden`. Honors prefers-reduced-motion.
 */
export function ScrambleText({
  text,
  className,
  loopMs = 10000,
}: {
  text: string;
  className?: string;
  loopMs?: number;
}) {
  const [display, setDisplay] = useState(text);
  const rafRef = useRef<number | null>(null);

  const scramble = useCallback(() => {
    // Each char gets a staggered start/end (in frames, ~60fps) so the reveal
    // ripples across the word instead of resolving all at once.
    const slots = Array.from(text, (ch) => {
      const start = Math.floor(Math.random() * 16);
      return {
        to: ch,
        start,
        end: start + 8 + Math.floor(Math.random() * 24),
        glyph: "",
      };
    });
    let frame = 0;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    // Function declaration (hoisted) so the rAF self-recursion is clean.
    function step() {
      let done = 0;
      let out = "";
      for (const slot of slots) {
        if (frame >= slot.end) {
          done++;
          out += slot.to;
        } else if (frame >= slot.start) {
          // Re-roll occasionally so it shimmers rather than holds one glyph.
          if (!slot.glyph || Math.random() < 0.28) {
            slot.glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          }
          out += slot.glyph;
        } else {
          out += " ";
        }
      }
      setDisplay(out);
      if (done === slots.length) {
        rafRef.current = null;
        return;
      }
      frame += 1;
      rafRef.current = requestAnimationFrame(step);
    }

    rafRef.current = requestAnimationFrame(step);
  }, [text]);

  useEffect(() => {
    // Reduced motion: skip the animation entirely. `display` is already
    // initialized to the final text, so there's nothing to set.
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    scramble(); // decode once on mount
    const id = setInterval(scramble, loopMs); // …then on the loop
    return () => {
      clearInterval(id);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [text, loopMs, scramble]);

  return (
    <span
      aria-label={text}
      className={cn("relative inline-block whitespace-nowrap", className)}
    >
      {/* Sizer: reserves the final width so the overlay can't shift layout. */}
      <span aria-hidden="true" className="invisible">
        {text}
      </span>
      {/* Animated overlay — absolutely positioned, inherits the heading style. */}
      <span aria-hidden="true" className="absolute left-0 top-0">
        {display}
      </span>
    </span>
  );
}
