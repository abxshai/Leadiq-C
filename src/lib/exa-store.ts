"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type ExaStore = {
  apiKey: string | null;
  setKey: (key: string) => void;
  clearKey: () => void;
};

/**
 * BYOK store for the Exa API key (used by the LeadQuery agent's exa_search
 * tool for signal-based sourcing). Session-scoped, mirrored to sessionStorage,
 * never persisted server-side — forwarded as the `X-Exa-Key` header per chat
 * request and held only in the route's closure. Same pattern as Groq / PB.
 */
export const useExaStore = create<ExaStore>()(
  persist(
    (set) => ({
      apiKey: null,
      setKey: (key) => set({ apiKey: key }),
      clearKey: () => set({ apiKey: null }),
    }),
    {
      name: "qualifier.exa-byok",
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? (undefined as unknown as Storage)
          : window.sessionStorage
      ),
    }
  )
);
