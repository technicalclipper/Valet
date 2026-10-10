/**
 * What the agent tells the room.
 *
 * One stream of these per capsule, watched by whoever has the page open —
 * issuer and recipient see the same events, because there is one agent and one
 * truth about what it did. Values are strings so bigints survive JSON.
 */
export type StepId = "wake" | "policy" | "quote" | "floor" | "preflight" | "execute" | "settle";

export const STEPS: { id: StepId; label: string }[] = [
  { id: "wake", label: "wake" },
  { id: "policy", label: "read the permission" },
  { id: "quote", label: "quote Kuru" },
  { id: "floor", label: "set the floor" },
  { id: "preflight", label: "nineteen checks" },
  { id: "execute", label: "execute" },
  { id: "settle", label: "settle" },
];

export interface AgentEvent {
  runId: string;
  seq: number;
  at: number;
  capsuleId: string;
  kind: "run-start" | "step" | "run-end" | "ask";
  step?: StepId;
  status?: "active" | "done" | "refused" | "error";
  title: string;
  detail?: string;
  data?: Record<string, string>;
  /** the assert that refused, when one did */
  refusedBy?: string;
  txHash?: string;
  outcome?: "executed" | "refused" | "error" | "requested";
}
