"use client";

import { ASSERT_GROUPS, type AssertName } from "../../lib/chain/reads";

/**
 * Nineteen lights, grouped the way the contract reasons.
 *
 * `refusedBy` is whatever `preflight` returned — the contract's own judgement,
 * read back, not a second implementation of the rules. The checks before the
 * refusal are green because the contract got past them; the ones after are
 * unknown, because it stopped and never looked.
 */
export function AssertRow({ refusedBy }: { refusedBy: AssertName }) {
  const flat = ASSERT_GROUPS.flatMap((g) => g.members);
  const stopAt = refusedBy === "NONE" ? flat.length : flat.indexOf(refusedBy);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">the nineteen checks</span>
        <span className="font-mono text-xs" style={{ color: refusedBy === "NONE" ? "var(--enforced)" : "var(--refused)" }}>
          {refusedBy === "NONE" ? "all clear" : refusedBy}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {ASSERT_GROUPS.map((group) => (
          <div key={group.label} className="flex items-center gap-3">
            <span className="w-24 shrink-0 font-mono text-[10px] text-text-faint">{group.label}</span>
            <div className="flex flex-wrap gap-1.5">
              {group.members.map((name) => {
                const i = flat.indexOf(name);
                const state = name === refusedBy ? "refused" : i < stopAt ? "passed" : "unreached";
                return (
                  <span
                    key={name}
                    title={`${name}${state === "unreached" ? " — not reached" : ""}`}
                    className={`h-2.5 w-2.5 rounded-sm ${state === "passed" ? "tick-in" : ""}`}
                    style={{
                      animationDelay: `${i * 28}ms`,
                      background:
                        state === "refused"
                          ? "var(--refused)"
                          : state === "passed"
                            ? "var(--enforced)"
                            : "rgb(255 255 255 / 0.09)",
                      boxShadow: state === "refused" ? "0 0 10px rgb(253 121 174 / 0.6)" : undefined,
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {refusedBy !== "NONE" && (
        <p className="mt-3 border-l-2 pl-3 text-[13px]" style={{ borderColor: "var(--refused)" }}>
          <span className="text-text-dim">refused by </span>
          <span className="font-mono" style={{ color: "var(--refused)" }}>
            the contract
          </span>
          <span className="text-text-dim"> · </span>
          <span className="font-mono text-text">{refusedBy}</span>
          <br />
          <span className="text-text-faint">nothing moved</span>
        </p>
      )}
    </div>
  );
}
