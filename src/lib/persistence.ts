import type { PersistenceEntry } from "../types/snapshot";

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
