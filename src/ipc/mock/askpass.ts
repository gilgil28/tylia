// Credential prompts in browser mode. Nothing asks on its own; Playwright (or the console)
// raises one with `window.__tyliaAskpass.raise({ kind, prompt, … })`, which resolves with the
// answer (`null` when cancelled).

import type { Backend } from "../backend";
import type { AskpassPrompt } from "../bindings/AskpassPrompt";

type PromptInput = Pick<AskpassPrompt, "kind" | "prompt"> & Partial<AskpassPrompt>;

export interface MockAskpass {
  /** Whether the UI is listening for prompts yet. */
  listening(): boolean;
  raise(prompt: PromptInput): Promise<string | null>;
  /** Withdraws a prompt, as when its operation is cancelled. */
  close(id: number): void;
}

declare global {
  interface Window {
    __tyliaAskpass?: MockAskpass;
  }
}

const promptHandlers = new Set<(prompt: AskpassPrompt) => void>();
const closedHandlers = new Set<(id: number) => void>();
const waiting = new Map<number, (answer: string | null) => void>();
let lastId = 0;

function settle(id: number, answer: string | null): boolean {
  const resolve = waiting.get(id);
  waiting.delete(id);
  resolve?.(answer);
  return resolve !== undefined;
}

window.__tyliaAskpass = {
  listening: () => promptHandlers.size > 0,
  raise: (input) => {
    const id = ++lastId;
    const prompt: AskpassPrompt = {
      operationId: 1,
      repo: null,
      host: null,
      detail: null,
      secret: input.kind !== "username" && input.kind !== "hostKey",
      ...input,
      id,
    };
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      promptHandlers.forEach((handler) => handler(prompt));
    });
  },
  close: (id) => {
    if (settle(id, null)) closedHandlers.forEach((handler) => handler(id));
  },
};

export const askpass: Pick<Backend, "onAskpassPrompt" | "onAskpassClosed" | "askpassRespond"> = {
  onAskpassPrompt: async (handler) => {
    promptHandlers.add(handler);
    return () => void promptHandlers.delete(handler);
  },
  onAskpassClosed: async (handler) => {
    closedHandlers.add(handler);
    return () => void closedHandlers.delete(handler);
  },
  askpassRespond: async (id, answer) => void settle(id, answer),
};
