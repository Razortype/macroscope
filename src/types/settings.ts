import { z } from "zod";

export const settingsSchema = z.object({
  snapshot_retention: z.coerce.number().int().min(1).max(100).default(10),
  hotkey_combo: z.string().trim().default("Cmd+Shift+M"),
  hotkey_enabled: z.boolean().default(false),
  artifact_active_days: z.coerce.number().int().min(1).max(365).default(14),
  artifact_stale_days: z.coerce.number().int().min(1).max(1000).default(90),
  artifact_min_size_mb: z.coerce.number().int().min(1).max(10000).default(100),
});

export type SettingsValues = z.infer<typeof settingsSchema>;

export const SETTINGS_KEYS = {
  SNAPSHOT_RETENTION: "snapshot_retention",
  HOTKEY_COMBO: "hotkey_combo",
  HOTKEY_ENABLED: "hotkey_enabled",
  ARTIFACT_ACTIVE_DAYS: "artifact_active_days",
  ARTIFACT_STALE_DAYS: "artifact_stale_days",
  ARTIFACT_MIN_SIZE_MB: "artifact_min_size_mb",
} as const;
