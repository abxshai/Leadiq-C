"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type GroqStore = {
  apiKey: string | null;
  setKey: (key: string) => void;
  clearKey: () => void;
};

/**
 * BYOK store for the Groq API key.
 *
 * - Lives in memory for fast reads.
 * - Mirrored to sessionStorage so a refresh within the same tab keeps
 *   the user connected; tab close wipes it.
 * - NEVER persisted to localStorage, cookies, or our own backend.
 */
export const useGroqStore = create<GroqStore>()(
  persist(
    (set) => ({
      apiKey: null,
      setKey: (key) => set({ apiKey: key }),
      clearKey: () => set({ apiKey: null }),
    }),
    {
      name: "qualifier.groq-byok",
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? (undefined as unknown as Storage)
          : window.sessionStorage
      ),
    }
  )
);

export { GROQ_BASE_URL, GROQ_MODEL } from "@/lib/groq-config";
