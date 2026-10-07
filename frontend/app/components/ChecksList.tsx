import { ASSERT_GROUPS, type AssertName } from "../../lib/chain/reads";
import { ASSERT_LABEL } from "../../lib/format";

/**
 * The nineteen, named.
 *
 * The dot row on the homepage works because it is a glance at a verdict. Here
 * the reader has opened the proof on purpose, so each light gets the sentence it
 * stands for — phrased as the thing confirmed, so a green line reads as a true
 * statement rather than an averted failure.
 */
export function ChecksList({ refusedBy }: { refusedBy: AssertName }) {
  const flat = ASSERT_GROUPS.flatMap((g) => g.members);
  const stopAt = refusedBy === "NONE" ? flat.length : flat.indexOf(refusedBy);

  return (
    <div className="space-y-4">
      {ASSERT_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="eyebrow">{group.label}</p>
          <ul className="mt-1.5 space-y-1">
            {group.members.map((name) => {
              const i = flat.indexOf(name);
              const state = name === refusedBy ? "refused" : i < stopAt ? "passed" : "unreached";
              return (
                <li key={name} className="flex items-baseline gap-2 text-[13px]">
                  <span
                    className="font-mono text-[11px]"
                    style={{
                      color:
                        state === "refused"
                          ? "var(--refused)"
                          : state === "passed"
                            ? "var(--enforced)"
                            : "var(--text-faint)",
                    }}
                  >
                    {state === "refused" ? "✗" : state === "passed" ? "✓" : "·"}
                  </span>
                  <span className={state === "unreached" ? "text-text-faint" : "text-text-dim"}>
                    {ASSERT_LABEL[name] ?? name}
                  </span>
                  {state === "refused" && (
                    <code className="ml-auto font-mono text-[11px]" style={{ color: "var(--refused)" }}>
                      {name}
                    </code>
                  )}
                  {state === "unreached" && (
                    <span className="ml-auto text-[11px] text-text-faint">not reached</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
