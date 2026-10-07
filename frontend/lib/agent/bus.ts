import type { AgentEvent } from "./types";

/**
 * A per-capsule broadcast, held in memory.
 *
 * Every open console subscribes here, so issuer and recipient watch the same run
 * as it happens. Stored on globalThis because Next's dev server reloads modules
 * on edit, and a bus that resets on every save loses its subscribers mid-run.
 *
 * Honest about its limit: this lives in one process. It is right for a single
 * server and for the demo; across serverless instances the run and the watcher
 * can land on different machines, and this would need a shared pub/sub instead.
 */
type Sub = (e: AgentEvent) => void;
interface Channel {
  events: AgentEvent[];
  subs: Set<Sub>;
  running: boolean;
  seq: number;
}

const g = globalThis as unknown as { __valetBus?: Map<string, Channel> };
const channels = (g.__valetBus ??= new Map());

function channel(id: string): Channel {
  let c = channels.get(id);
  if (!c) channels.set(id, (c = { events: [], subs: new Set(), running: false, seq: 0 }));
  return c;
}

export function publish(id: string, e: Omit<AgentEvent, "seq" | "at" | "capsuleId">): AgentEvent {
  const c = channel(id);
  const full: AgentEvent = { ...e, seq: ++c.seq, at: Date.now(), capsuleId: id };
  c.events.push(full);
  if (c.events.length > 300) c.events.splice(0, c.events.length - 300);
  for (const s of c.subs) s(full);
  return full;
}

/**
 * Presence is broadcast but never stored: it is "who is watching now", not
 * history, and replaying it to a late joiner would report people who left.
 * It is what lets the issuer and the recipient see that the other is there.
 */
function announce(c: Channel, id: string) {
  const e = { kind: "presence", watching: c.subs.size, capsuleId: id } as unknown as AgentEvent;
  for (const s of c.subs) s(e);
}

export function subscribe(id: string, fn: Sub): () => void {
  const c = channel(id);
  c.subs.add(fn);
  announce(c, id);
  return () => {
    c.subs.delete(fn);
    announce(c, id);
  };
}

/** The last complete-or-current run, so a late joiner sees what just happened. */
export function lastRun(id: string): AgentEvent[] {
  const c = channel(id);
  const start = c.events.findLastIndex((e) => e.kind === "run-start");
  return start === -1 ? [] : c.events.slice(start);
}

/** One run at a time per capsule; a second press while one is live is ignored. */
export function tryLock(id: string): boolean {
  const c = channel(id);
  if (c.running) return false;
  c.running = true;
  return true;
}

export function unlock(id: string): void {
  channel(id).running = false;
}
