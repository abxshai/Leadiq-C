"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type PbApiKeyStore = {
  apiKey: string | null;
  setKey: (key: string) => void;
  clearKey: () => void;
};

/**
 * BYOK store for the Phantombuster API key.
 *
 * - sessionStorage-scoped: refresh persists, tab close wipes.
 * - Forwarded via the X-PB-Key header to /api/pb-fetch only when the user
 *   initiates a fetch. Held in the server route's closure for one call.
 * - Never persisted to our DB.
 */
export const usePbApiKeyStore = create<PbApiKeyStore>()(
  persist(
    (set) => ({
      apiKey: null,
      setKey: (apiKey) => set({ apiKey }),
      clearKey: () => set({ apiKey: null }),
    }),
    {
      name: "qualifier.pb-byok",
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? (undefined as unknown as Storage)
          : window.sessionStorage
      ),
    }
  )
);
