import type { PersistenceEntry } from "../types/snapshot";

export function computeServiceTarget(entry: PersistenceEntry): string {
  const uid = "501";
  switch (entry.kind) {
    case "user_agent":
    case "login_item":
      return `gui/${uid}/${entry.label}`;
    case "user_daemon":
      return `user/${uid}/${entry.label}`;
    case "system_daemon":
    case "system_agent":
      return `system/${entry.label}`;
  }
}

const KNOWN_PREFIXES = [
  "com.notion.",
  "com.raycast.",
  "com.spotify.",
  "us.zoom.",
  "com.slack.",
  "com.tinyspeck.slackmacgap",
  "com.microsoft.",
  "com.google.",
  "com.adobe.",
  "com.docker.",
  "com.tailscale.",
  "com.1password.",
  "org.mozilla.",
  "com.brave.",
  "com.jetbrains.",
  "com.linear.",
  "com.figma.",
];

export function classifyPersistence(
  entry: PersistenceEntry,
  flaggedLabels: Set<string>
): "flagged" | "known" | "disabled" | "normal" {
  if (entry.disabled) return "disabled";
  if (flaggedLabels.has(entry.label)) return "flagged";
  if (KNOWN_PREFIXES.some((p) => entry.label.startsWith(p))) return "known";
  return "normal";
}
