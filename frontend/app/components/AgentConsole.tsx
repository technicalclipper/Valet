"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { STEPS, type AgentEvent, type StepId } from "../../lib/agent/types";
import { ASSERT_GROUPS } from "../../lib/chain/reads";
import { ASSERT_LABEL } from "../../lib/format";

type StageState = "pending" | "active" | "done" | "refused";
type Flow = "idle" | "vault" | "toKuru" | "swapped" | "toValet" | "toRecipient" | "landed" | "blocked";
interface Line { t: number; step: string; text: string; detail?: string; tone: "info" | "good" | "bad" | "dim" }

const FLAT: string[] = ASSERT_GROUPS.flatMap((g) => g.members);
const freshStages = (): Record<StepId, StageState> =>
  Object.fromEntries(STEPS.map((s) => [s.id, "pending"])) as Record<StepId, StageState>;

/** a readable number: four places is enough to see a fill, not enough to drown in */
function short(v: string | undefined, decimals: number, unit: string, places = 4): string {
  if (!v) return "—";
  const n = Number(BigInt(v)) / 10 ** decimals;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: places })} ${unit}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The agent, watched.
 *
 * One component, opened by the issuer and the recipient alike, both subscribed
 * to the same stream — there is one agent and one account of what it did.
 *
 * Every frame is driven by a real event. The runtime adds no delays, so a run on
 * a fork can arrive whole in forty milliseconds; the pacing happens here, in a
 * player that gives each step a dwell long enough to read. The data is a record,
 * the timing is presentation, and the two are kept apart on purpose.
 */
export function AgentConsole({
  capsuleId,
  issuer,
  principal,
  perAction,
  isFork,
}: {
  capsuleId: string;
  issuer: string;
  principal: string;
  perAction: string;
  isFork: boolean;
}) {
  const router = useRouter();
  const { getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const me = wallets[0]?.address?.toLowerCase();
  const isParty = !!me && (me === issuer.toLowerCase() || me === principal.toLowerCase());
  const role =
    me && me === issuer.toLowerCase()
      ? "you are the issuer"
      : me && me === principal.toLowerCase()
        ? "you are the recipient"
        : "you are watching";

  const [stages, setStages] = useState(freshStages);
  const [flow, setFlow] = useState<Flow>("idle");
  const [lit, setLit] = useState(0);
  const [refusedAt, setRefusedAt] = useState<number | null>(null);
  const [nums, setNums] = useState<Record<string, string>>({});
  const [log, setLog] = useState<Line[]>([]);
  const [outcome, setOutcome] = useState<"executed" | "refused" | "error" | "requested" | null>(null);
  const [watching, setWatching] = useState(1);
  const [busy, setBusy] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const queue = useRef<AgentEvent[]>([]);
  const playing = useRef(false);
  const speed = useRef(1);
  const logEnd = useRef<HTMLDivElement>(null);

  const say = (l: Omit<Line, "t">) => setLog((prev) => [...prev.slice(-40), { ...l, t: Date.now() }]);

  const play = useCallback(async (e: AgentEvent) => {
    const d = (ms: number) => sleep(ms * speed.current);

    if (e.kind === "run-start") {
      setStages(freshStages());
      setFlow("idle");
      setLit(0);
      setRefusedAt(null);
      setNums({});
      setOutcome(null);
      setBusy(true);
      const by = e.data?.trigger === "keeper" ? "keeper" : e.data?.trigger === "outside" ? "outside" : "agent";
      say({ step: by, text: e.title, tone: "info" });
      return d(450);
    }

    if (e.kind === "ask") {
      say({ step: "ask", text: e.title, detail: e.detail, tone: "info" });
      setOutcome("requested");
      setBusy(false);
      return d(400);
    }

    if (e.kind === "run-end") {
      setOutcome(e.outcome ?? null);
      say({ step: "agent", text: e.title, detail: e.detail, tone: e.outcome === "executed" ? "good" : e.outcome === "refused" ? "bad" : "bad" });
      setBusy(false);
      router.refresh(); // the meters and history are server-rendered; let them catch up
      return d(300);
    }

    const step = e.step!;
    if (e.status === "active") {
      setStages((s) => ({ ...s, [step]: "active" }));
      say({ step, text: e.title, tone: "dim" });
      return d(step === "execute" || step === "settle" ? 350 : 480);
    }

    if (e.status === "refused") {
      // light the checks up to the one that refused, then stop red
      const at = Math.max(0, FLAT.indexOf(e.refusedBy ?? ""));
      for (let i = 1; i <= at; i++) {
        setLit(i);
        await d(60);
      }
      setRefusedAt(at);
      setStages((s) => ({ ...s, [step]: "refused" }));
      await d(200);
      setFlow("blocked");
      say({ step, text: e.title, detail: e.detail, tone: "bad" });
      return d(700);
    }

    // done
    if (e.data) setNums((n) => ({ ...n, ...e.data }));
    if (step === "policy") setFlow("vault");

    if (step === "preflight") {
      for (let i = 1; i <= FLAT.length; i++) {
        setLit(i);
        await d(55);
      }
    }

    setStages((s) => ({ ...s, [step]: "done" }));
    say({ step, text: e.title, detail: e.detail, tone: step === "settle" ? "good" : "info" });

    if (step === "execute") {
      setFlow("toKuru");
      await d(750);
      setFlow("swapped");
      await d(420);
      setFlow("toValet");
      return d(520);
    }
    if (step === "settle") {
      setFlow("toRecipient");
      await d(650);
      setFlow("landed");
      return d(900);
    }
    return d(step === "quote" || step === "floor" ? 620 : 520);
  }, [router]);

  const pump = useCallback(async () => {
    if (playing.current) return;
    playing.current = true;
    while (queue.current.length) {
      const e = queue.current.shift()!;
      await play(e);
      if (!queue.current.length) {
        speed.current = 1;
        setReplaying(false);
      }
    }
    playing.current = false;
  }, [play]);

  useEffect(() => {
    const opened = Date.now();
    const es = new EventSource(`/api/agent/${capsuleId}/stream`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as AgentEvent & { watching?: number };
      if ((e.kind as string) === "presence") {
        setWatching(e.watching ?? 1);
        return;
      }
      // anything arriving in the first moments is the last run being replayed
      if (Date.now() - opened < 400) {
        speed.current = 0.35;
        setReplaying(true);
      }
      queue.current.push(e);
      void pump();
    };
    return () => es.close();
  }, [capsuleId, pump]);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "nearest" });
  }, [log]);

  async function run(amountIn?: string) {
    setNote(null);
    setBusy(true);
    const res = await fetch(`/api/agent/${capsuleId}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(amountIn ? { amountIn } : {}),
    });
    if (res.status === 409) {
      setNote("A run is already in progress.");
      setBusy(false);
    }
  }

  /**
   * The agent asks the issuer for more than its per-action cap allows.
   *
   * Each ask is a transaction the agent pays for, so the server only takes it
   * from the issuer or the recipient — this sends the Privy session to prove
   * which one you are.
   */
  async function askFor(multiple: 1.5 | 10) {
    setNote(null);
    setBusy(true);
    const amt = (BigInt(perAction) * BigInt(multiple * 10)) / 10n;
    const reason = multiple === 10 ? "let me go big — ten times today's cap" : "the book is deep today; one larger buy";
    const token = await getAccessToken().catch(() => null);
    const r = await fetch(`/api/agent/${capsuleId}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ amount: amt.toString(), reason }),
    }).then((x) => x.json());
    if (!r.ok) {
      setNote(r.reason ?? "The agent could not ask.");
      setBusy(false);
    }
  }

  async function nextDay() {
    setNote(null);
    const res = await fetch(`/api/agent/${capsuleId}/advance`, { method: "POST" });
    if (res.ok) {
      say({ step: "clock", text: "A day passes — the next window opens", tone: "info" });
      router.refresh();
    }
  }

  // --- derived visuals -----------------------------------------------------
  const order = STEPS.map((s) => s.id);
  const reached = order.reduce((n, id, i) => (stages[id] !== "pending" ? i : n), -1);
  const progress = reached < 0 ? 0 : (reached / (order.length - 1)) * 100;
  const refused = outcome === "refused" || flow === "blocked";
  const current =
    STEPS.find((s) => stages[s.id] === "active" || stages[s.id] === "refused") ??
    [...STEPS].reverse().find((s) => stages[s.id] === "done");

  const WALL = 25.5; // in the gap between the vault box and Kuru's
  const POS: Record<Flow, number> = {
    idle: 9, vault: 9, toKuru: 37, swapped: 37, toValet: 64, toRecipient: 91, landed: 91, blocked: 14,
  };
  const tokenIsMon = ["swapped", "toValet", "toRecipient", "landed"].includes(flow);
  const tokenText = tokenIsMon
    ? short(nums.received ?? nums.quotedOut, 18, "MON", 3)
    : short(nums.amountIn ?? perAction, 6, "USDC", 2);

  const status = busy
    ? { word: "working", color: "var(--peri)" }
    : outcome === "executed"
      ? { word: "executed", color: "var(--enforced)" }
      : outcome === "refused"
        ? { word: "refused", color: "var(--refused)" }
        : outcome === "error"
          ? { word: "stopped", color: "var(--refused)" }
          : outcome === "requested"
            ? { word: "waiting for the issuer", color: "var(--peri)" }
          : { word: "idle", color: "var(--text-faint)" };

  return (
    <section className="card-pop p-3 sm:p-4" style={{ ["--pop" as string]: "#7e65d4" }}>
      {/* --- the bezel ---------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-3">
        <span className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${busy ? "breathe" : ""}`}
            style={{ background: busy ? "#7e65d4" : outcome === "refused" ? "#d8366f" : "#2f9e5e" }}
          />
          <span className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] on-card">agent console</span>
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em]" style={{ color: status.color === "var(--text-faint)" ? "#9a9aad" : status.color === "var(--peri)" ? "#7e65d4" : status.color === "var(--enforced)" ? "#2f9e5e" : "#d8366f" }}>
          {status.word}
        </span>
        {replaying && <span className="font-mono text-[11px] on-card-faint">· replaying the last run</span>}
        <span className="ml-auto font-mono text-[11px] on-card-faint">
          {watching} watching now · {role}
        </span>
      </div>

      {/* --- the screen --------------------------------------------------- */}
      <div className="scan relative overflow-hidden rounded-[10px] border-2 border-[#16161a] bg-[#101014] p-4 sm:p-5">
        <div className="grid-field pointer-events-none absolute inset-0 opacity-40" />

        {/* pipeline */}
        <div className="relative">
          <div className="absolute left-[11px] right-[11px] top-[11px] h-[2px] bg-white/10" />
          <div
            className="absolute left-[11px] top-[11px] h-[2px] transition-[width] duration-500 ease-out"
            style={{
              width: `calc((100% - 22px) * ${progress / 100})`,
              background: refused ? "var(--refused)" : "var(--enforced)",
              boxShadow: `0 0 10px ${refused ? "rgb(253 121 174 / 0.6)" : "rgb(178 255 166 / 0.5)"}`,
            }}
          />
          <ol className="relative flex justify-between">
            {STEPS.map((s) => {
              const st = stages[s.id];
              return (
                <li key={s.id} className="flex w-[22px] flex-col items-center">
                  <span
                    key={st}
                    className={`grid h-[22px] w-[22px] place-items-center rounded-full border-2 font-mono text-[10px] font-bold ${
                      st === "active" ? "stage-active" : st !== "pending" ? "stage-pop" : ""
                    }`}
                    style={{
                      borderColor: st === "done" ? "var(--enforced)" : st === "refused" ? "var(--refused)" : st === "active" ? "var(--peri)" : "rgb(255 255 255 / 0.18)",
                      background: st === "done" ? "var(--enforced)" : st === "refused" ? "var(--refused)" : "#101014",
                      color: "#101014",
                    }}
                  >
                    {st === "done" ? "✓" : st === "refused" ? "✗" : st === "active" ? (
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--peri)" }} />
                    ) : null}
                  </span>
                  <span
                    className="mt-2 hidden w-20 text-center font-mono text-[10px] uppercase leading-tight tracking-[0.08em] sm:block"
                    style={{ color: st === "pending" ? "var(--text-faint)" : st === "refused" ? "var(--refused)" : st === "active" ? "var(--peri)" : "var(--text-dim)" }}
                  >
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ol>
          {/* one label, not seven: at phone width the seven collide */}
          <p className="mt-3 text-center font-mono text-[11px] uppercase tracking-[0.12em] sm:hidden" style={{ color: refused ? "var(--refused)" : "var(--peri)" }}>
            {current ? current.label : "asleep"}
            {refused ? " · refused" : ""}
          </p>
        </div>

        {/* the money */}
        <div className="relative mt-6 h-[72px] sm:mt-9 sm:h-[92px]">
          <div className="absolute left-[9%] right-[9%] top-[30px] border-t-2 border-dashed border-white/12" />
          {(
            [
              ["vault", 9, "the issuer's money", short(nums.amountIn ?? perAction, 6, "USDC", 2)],
              ["Kuru", 37, "the venue", nums.price ? `${nums.price} / MON` : "live book"],
              ["Valet", 64, "measures the fill", nums.minOut ? `floor ${short(nums.minOut, 18, "", 3)}` : "contract"],
              ["recipient", 91, "fixed at mint", nums.received ? short(nums.received, 18, "MON", 3) : nums.recipient ? `${nums.recipient.slice(0, 6)}…${nums.recipient.slice(-4)}` : "—"],
            ] as const
          ).map(([name, x, sub, value]) => {
            const hot =
              (name === "Kuru" && (flow === "toKuru" || flow === "swapped")) ||
              (name === "Valet" && flow === "toValet") ||
              (name === "recipient" && flow === "landed") ||
              (name === "vault" && (flow === "vault" || flow === "blocked"));
            const tone = name === "recipient" && flow === "landed" ? "var(--enforced)" : name === "vault" && flow === "blocked" ? "var(--refused)" : "var(--peri)";
            return (
              <div key={name} className="absolute top-0 flex w-[22%] -translate-x-1/2 flex-col items-center" style={{ left: `${x}%` }}>
                <div
                  className={`grid h-[48px] w-full max-w-[120px] place-items-center rounded-lg border-2 bg-[#16161c] px-1 transition-all duration-300 sm:h-[60px] sm:px-2 ${name === "recipient" && flow === "landed" ? "land" : ""}`}
                  style={{ borderColor: hot ? tone : "rgb(255 255 255 / 0.12)", boxShadow: hot ? `0 0 18px ${tone === "var(--enforced)" ? "rgb(178 255 166 / 0.35)" : tone === "var(--refused)" ? "rgb(253 121 174 / 0.4)" : "rgb(194 181 255 / 0.3)"}` : "none" }}
                >
                  <div className="text-center">
                    <div className="text-[11px] font-semibold text-text sm:text-[13px]">{name}</div>
                    <div className="mt-0.5 hidden truncate font-mono text-[10px] text-text-faint sm:block">{value}</div>
                  </div>
                </div>
                <span className="mt-1.5 hidden font-mono text-[9px] text-text-faint sm:block">{sub}</span>
              </div>
            );
          })}

          {/* the wall: what a refusal looks like */}
          {flow === "blocked" && (
            <div className="wall-rise absolute top-[2px] h-[56px] w-[5px] -translate-x-1/2 rounded-full" style={{ left: `${WALL}%`, background: "var(--refused)", boxShadow: "0 0 18px rgb(253 121 174 / 0.8)" }} />
          )}

          {/* the token
           * Placement and motion live on two elements. The slam is a transform
           * animation, and so is the positioning; on one element the slam
           * overwrote the placement and the token landed on top of the vault's
           * label instead of flush against the wall.
           */}
          {flow !== "idle" && (
            <div
              className="absolute top-[18px] z-10 hidden sm:block"
              style={{
                left: `${flow === "blocked" ? WALL : POS[flow]}%`,
                transform: flow === "blocked" ? "translateX(calc(-100% - 7px))" : "translateX(-50%)",
                transition: "left 0.7s cubic-bezier(0.65, 0, 0.35, 1), transform 0.7s cubic-bezier(0.65, 0, 0.35, 1)",
                opacity: flow === "landed" ? 0 : 1,
              }}
            >
              <div
                key={flow === "blocked" ? "blocked" : "moving"}
                className={`whitespace-nowrap rounded-full border-2 px-2.5 py-1 font-mono text-[10px] font-bold ${flow === "blocked" ? "slam" : ""}`}
                style={{
                  transition: "background 0.3s, border-color 0.3s, color 0.3s",
                  background: flow === "blocked" ? "#3a1424" : tokenIsMon ? "#2a2147" : "#132a3a",
                  borderColor: flow === "blocked" ? "var(--refused)" : tokenIsMon ? "var(--peri)" : "#5fb3ff",
                  color: flow === "blocked" ? "var(--refused)" : tokenIsMon ? "var(--peri)" : "#9fd0ff",
                  boxShadow: `0 0 14px ${flow === "blocked" ? "rgb(253 121 174 / 0.5)" : tokenIsMon ? "rgb(194 181 255 / 0.45)" : "rgb(95 179 255 / 0.4)"}`,
                }}
              >
                {tokenText}
              </div>
            </div>
          )}
          {flow === "blocked" && (
            <p className="absolute top-[66px] hidden -translate-x-1/2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] sm:block" style={{ left: `${WALL}%`, color: "var(--refused)" }}>
              nothing moved
            </p>
          )}
        </div>

        {flow === "blocked" && (
          <p className="mt-1 text-center font-mono text-[11px] uppercase tracking-[0.14em] sm:hidden" style={{ color: "var(--refused)" }}>
            nothing moved
          </p>
        )}

        {/* readouts + the nineteen */}
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["quote", short(nums.quotedOut, 18, "MON")],
                ["floor", short(nums.minOut, 18, "MON")],
                ["received", short(nums.received, 18, "MON")],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                <div className="eyebrow">{k}</div>
                <div key={v} className="tick-in mt-0.5 truncate font-mono text-[12px]" style={{ color: k === "received" && nums.received ? "var(--enforced)" : "var(--text)" }}>
                  {v}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <div className="eyebrow mb-1.5">the nineteen checks</div>
            <div className="flex flex-wrap gap-x-2.5 gap-y-1.5">
              {ASSERT_GROUPS.map((g) => (
                <div key={g.label} className="flex gap-[3px]" title={g.label}>
                  {g.members.map((name) => {
                    const i = FLAT.indexOf(name);
                    const isRef = refusedAt === i;
                    const on = i < lit || isRef;
                    return (
                      <span
                        key={`${name}-${on}-${isRef}`}
                        title={ASSERT_LABEL[name]}
                        className={`h-[11px] w-[11px] rounded-[3px] ${on ? "light-on" : ""}`}
                        style={{
                          background: isRef ? "var(--refused)" : on ? "var(--enforced)" : "rgb(255 255 255 / 0.1)",
                          boxShadow: isRef ? "0 0 10px rgb(253 121 174 / 0.9)" : on ? "0 0 6px rgb(178 255 166 / 0.35)" : "none",
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* the log */}
        <div className="mt-4 h-[148px] overflow-y-auto rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-[11px] leading-relaxed">
          {log.length === 0 && <p className="text-text-faint">the agent is asleep until the next window. wake it below.</p>}
          {log.map((l, i) => (
            <div key={l.t + i} className="row-in">
              <span className="text-text-faint">{new Date(l.t).toLocaleTimeString(undefined, { hour12: false })} </span>
              <span style={{ color: "var(--peri)" }}>{l.step.padEnd(9, " ")}</span>{" "}
              <span
                className={i === log.length - 1 ? "caret" : ""}
                style={{ color: l.tone === "good" ? "var(--enforced)" : l.tone === "bad" ? "var(--refused)" : l.tone === "dim" ? "var(--text-faint)" : "var(--text)" }}
              >
                {l.text}
              </span>
              {l.detail && <div className="pl-4 text-text-faint sm:pl-[8.5rem]">{/^0x[0-9a-f]{40,}$/i.test(l.detail) ? `${l.detail.slice(0, 18)}…${l.detail.slice(-6)}` : l.detail}</div>}
            </div>
          ))}
          <div ref={logEnd} />
        </div>
      </div>

      {/* --- the controls -------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 px-1 pt-3">
        <button
          onClick={() => run()}
          disabled={busy}
          className="rounded-full px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-40"
          style={{ background: "#16161a" }}
        >
          ▶ Wake the agent
        </button>
        <button
          onClick={() => run((BigInt(perAction) * 4n).toString())}
          disabled={busy}
          className="rounded-full border-2 px-4 py-2 text-sm font-semibold transition disabled:opacity-40"
          style={{ borderColor: "#d8366f", color: "#b5245a" }}
        >
          Ask for 4× — watch it refuse
        </button>
        {isParty && (<>
        <button
          onClick={() => askFor(1.5)}
          disabled={busy}
          className="rounded-full border-2 px-4 py-2 text-sm font-semibold transition disabled:opacity-40"
          style={{ borderColor: "#7e65d4", color: "#5b45a8" }}
        >
          Agent asks for 1.5×
        </button>
        <button
          onClick={() => askFor(10)}
          disabled={busy}
          className="rounded-full border-2 px-4 py-2 text-sm font-semibold transition disabled:opacity-40"
          style={{ borderColor: "#7e65d4", color: "#5b45a8" }}
        >
          Agent asks for 10×
        </button>
        </>)}
        {isFork && (
          <button
            onClick={nextDay}
            disabled={busy}
            className="rounded-full border-2 px-4 py-2 text-sm font-medium transition disabled:opacity-40 on-card"
            style={{ borderColor: "rgb(22 22 26 / 0.2)" }}
          >
            +1 day
          </button>
        )}
        {note && <span className="text-[12px]" style={{ color: "#d8366f" }}>{note}</span>}
        <span className="ml-auto hidden font-mono text-[10px] on-card-faint sm:inline">
          every frame is a real event · the timing is ours, the data is the chain&apos;s
        </span>
      </div>
    </section>
  );
}
