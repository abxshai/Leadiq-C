"use client";

import { useEffect, useRef, useState } from "react";

// Width of each row. Even spacing reads best in a monospace grid.
const COLS = 28;
const ROWS = 10;

// Gradient from low-density to high-density glyphs.
const RAMP = " ·:-=+*#%▒▓█";

/**
 * Flowing ASCII heatmap — each cell samples a 2D sine field that drifts
 * in time, producing a smooth wave that looks like "processing" or
 * "qualification pipeline activity".
 *
 * Pure CSS color via the text-primary class, so it picks up sky-blue.
 * Runs at 10 fps, cheap on battery.
 */
export function LoginHero() {
  const [frame, setFrame] = useState("");
  const tRef = useRef(0);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const step = 1000 / 10; // 10 fps

    const tick = (now: number) => {
      if (now - last >= step) {
        last = now;
        tRef.current += 0.08;
        setFrame(compose(tRef.current));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <pre
      aria-hidden
      className="text-[10px] leading-[1.2] text-primary/70 font-mono whitespace-pre select-none tracking-wider"
    >
      {frame}
    </pre>
  );
}

function compose(t: number): string {
  const out: string[] = [];
  for (let y = 0; y < ROWS; y++) {
    const row: string[] = [];
    for (let x = 0; x < COLS; x++) {
      // Two overlapping sine waves — phase-shifted per row.
      const v =
        Math.sin(x * 0.35 - t) * 0.5 +
        Math.sin(x * 0.15 + y * 0.3 + t * 0.8) * 0.5;
      // Map [-1, 1] → [0, RAMP.length-1]
      const idx = Math.max(
        0,
        Math.min(RAMP.length - 1, Math.floor(((v + 1) / 2) * RAMP.length))
      );
      row.push(RAMP[idx]);
    }
    out.push(row.join(""));
  }
  return out.join("\n");
}
