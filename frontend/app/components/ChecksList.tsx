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
    <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
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
                        state === "refused" ? "#d8366f" : state === "passed" ? "#2f9e5e" : "#a8a8b8",
                    }}
                  >
                    {state === "refused" ? "✗" : state === "passed" ? "✓" : "·"}
                  </span>
                  <span className={state === "unreached" ? "on-card-faint" : "on-card-dim"}>
                    {ASSERT_LABEL[name] ?? name}
                  </span>
                  {state === "refused" && (
                    <code className="ml-auto font-mono text-[11px]" style={{ color: "#d8366f" }}>
                      {name}
                    </code>
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
