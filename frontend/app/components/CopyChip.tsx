"use client";

import { useState } from "react";

/**
 * A value you can take with you.
 *
 * An address shown and not copyable is a small cruelty — the reader has to
 * select fourteen characters of hex by hand and will get it wrong. The label
 * stays truncated because the full value is for the clipboard, not the eye.
 */
export function CopyChip({
  label,
  value,
  display,
}: {
  label: string;
  value: string;
  display?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard can be blocked; the value is still on screen
    }
  }

  return (
    <button
      onClick={copy}
      title={value}
      className="group/chip flex min-w-0 items-baseline gap-2 rounded-lg border-2 px-3 py-1.5 text-left transition"
      style={{ borderColor: copied ? "#2f9e5e" : "rgb(22 22 26 / 0.15)" }}
    >
      <span className="eyebrow shrink-0">{label}</span>
      <span className="truncate font-mono text-[12px] on-card">{display ?? value}</span>
      <span
        className="ml-auto shrink-0 font-mono text-[10px] transition"
        style={{ color: copied ? "#2f9e5e" : "#9a9aad" }}
      >
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}
