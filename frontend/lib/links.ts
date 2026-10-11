/**
 * The links this browser has seen, kept locally.
 *
 * The chain stores a capsule's policy hash, not its sentence, so nowhere can
 * list "the intents you wrote". What this browser minted, or opened from a
 * link, it remembers — enough for the dashboard to show the original words
 * beside the chain's own description. Losing it loses nothing that matters:
 * every term is still on chain.
 */
export interface KnownLink {
  sentence: string;
  recipient: string;
  email?: string;
  role?: "issuer" | "recipient";
  seenAt: number;
}

const KEY = "valet.links";

export function readLinks(): Record<string, KnownLink> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, KnownLink>;
  } catch {
    return {};
  }
}

export function rememberLink(capsuleId: string, link: Omit<KnownLink, "seenAt">) {
  try {
    const all = readLinks();
    all[capsuleId] = { ...all[capsuleId], ...link, seenAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // private mode or blocked storage: the dashboard falls back to chain terms
  }
}

export function linkFor(capsuleId: string, origin: string, l: KnownLink): string {
  const s = btoa(unescape(encodeURIComponent(l.sentence))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${origin}/c/${capsuleId}?s=${s}&r=${l.recipient}`;
}
