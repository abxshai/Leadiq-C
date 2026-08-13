"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type ApifyStore = {
  apiKey: string | null;
  setKey: (key: string) => void;
  clearKey: () => void;
};

/**
 * BYOK store for the Apify API token.
 *
 * - Lives in memory + mirrored to sessionStorage so a refresh within the same
 *   tab keeps the connection; tab close wipes it.
 * - NEVER persisted to localStorage, cookies, or our backend.
 * - Forwarded as the `X-Apify-Token` header per fetch; held only in the server
 *   route's closure for that one call. Same pattern as the Groq / PB keys.
 */
export const useApifyStore = create<ApifyStore>()(
  persist(
    (set) => ({
      apiKey: null,
      setKey: (key) => set({ apiKey: key }),
      clearKey: () => set({ apiKey: null }),
    }),
    {
      name: "qualifier.apify-byok",
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? (undefined as unknown as Storage)
          : window.sessionStorage
      ),
    }
  )
);

// The default actor we fetch from: harvestapi/linkedin-profile-scraper
// ("LinkedIn Profile Scraper + Email, No Cookies"). Overridable in the UI.
export const DEFAULT_APIFY_ACTOR_ID = "LpVuK3Zozwuipa5bp";
