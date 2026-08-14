"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type AgentPromptStore = {
  /** User-supplied ICP / signal context prepended to the agent's base prompt. */
  systemPrompt: string;
  setSystemPrompt: (v: string) => void;
};

/**
 * The LeadQuery agent's user-editable system prompt (ICP / signal context).
 * Not a secret — persisted to localStorage so it survives sessions (you set
 * your ICP once and reuse it). Sent in the chat message body per request.
 */
export const useAgentPromptStore = create<AgentPromptStore>()(
  persist(
    (set) => ({
      systemPrompt: "",
      setSystemPrompt: (v) => set({ systemPrompt: v }),
    }),
    {
      name: "qualifier.agent-system-prompt",
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? (undefined as unknown as Storage)
          : window.localStorage
      ),
    }
  )
);
