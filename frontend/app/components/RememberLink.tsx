"use client";

import { useEffect } from "react";
import { rememberLink } from "../../lib/links";

/** When a capsule is opened from its link, keep the sentence for the dashboard. */
export function RememberLink({ capsuleId, sentence, recipient }: { capsuleId: string; sentence?: string; recipient?: string }) {
  useEffect(() => {
    if (sentence && recipient) rememberLink(capsuleId, { sentence, recipient });
  }, [capsuleId, sentence, recipient]);
  return null;
}
