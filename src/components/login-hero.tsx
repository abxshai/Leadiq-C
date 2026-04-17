"use client";

import { useEffect, useRef, useState } from "react";

// Base pattern. Whitespace is preserved as-is — only density glyphs
// (░ ▒ ▓ █) shimmer. Each character's intensity drifts over time, so
// the shape stays locked but the surface appears to breathe.
const PATTERN = `                          ░░░░▒▓████▓░░░░░
                          ░░▓███▓▓▓██████▒░░░
                          ▒██▓░░░░░░░░░▒███▒░
                       ░░███▒░░░       ░░▒███▒░
                  ░░░░░███▓░░            ░░▒██▓░░░
                  ░░░███▓░░░░            ░░░░██▓░░
                  ░▒██▓░░░                  ░▓█▓░░
                  ░▓█▓░░                 ░░░▒██▒░░
                  ░██▒░░               ░░░░▒██▒░░░
                  ░██▒░░               ░░░███░░
                  ░▓█▓░░               ░▓██▓░░░
                  ░▓█▓░░            ░░░███░░░
                  ░▒██░░          ░░░▓██▓░░░░
                  ░░██▒░          ░░███░░░
                  ░░▓██░          ░███░
                  ░░░██▒░░     ░░░▓██░░
                     ▓██░░     ░░▒██░░░
                     ░▓██░     ░▒██▒░
                     ░░▓██▒░░░░░██▓░░
                     ░░░▒███▓░▒███░░░
                       ░░░░█████▒░`;

// Intensity ramp — must be ordered low→high density.
function quantize(v: number): string {
  if (v < 0.28) return "░";
  if (v < 0.55) return "▒";
  if (v < 0.82) return "▓";
  return "█";
}

function baseIntensity(ch: string): number | null {
  if (ch === "░") return 0.25;
  if (ch === "▒") return 0.5;
  if (ch === "▓") return 0.75;
  if (ch === "█") return 1.0;
  return null; // whitespace etc. — leave alone
}

const GRID: (number | null)[][] = PATTERN.split("\n").map((row) =>
  Array.from(row, baseIntensity)
);
const ORIGINAL: string[][] = PATTERN.split("\n").map((row) =>
  Array.from(row)
);

export function LoginHero() {
  const [frame, setFrame] = useState("");
  const tRef = useRef(0);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const step = 1000 / 10; // 10 fps, same as before

    const tick = (now: number) => {
      if (now - last >= step) {
        last = now;
        tRef.current += 0.12;
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
      className="text-[11px] sm:text-[13px] leading-[1.05] text-primary/70 font-mono whitespace-pre select-none"
    >
      {frame}
    </pre>
  );
}

function compose(t: number): string {
  const rows: string[] = [];
  for (let y = 0; y < GRID.length; y++) {
    let row = "";
    for (let x = 0; x < GRID[y].length; x++) {
      const base = GRID[y][x];
      if (base === null) {
        row += ORIGINAL[y][x];
        continue;
      }
      // Smooth 2D drift with slight phase variation — shape stays, density pulses.
      const noise =
        Math.sin(x * 0.22 + y * 0.18 + t) * 0.28 +
        Math.sin(x * 0.08 - y * 0.11 + t * 0.7) * 0.12;
      const v = Math.max(0.05, Math.min(1, base + noise));
      row += quantize(v);
    }
    rows.push(row);
  }
  return rows.join("\n");
}
