import { z } from "zod";

export const settingsSchema = z.object({
  snapshot_retention: z.coerce.number().int().min(1).max(100).default(10),
  hotkey_combo: z.string().trim().default("Cmd+Shift+M"),
  hotkey_enabled: z.boolean().default(false),
});

export type SettingsValues = z.infer<typeof settingsSchema>;

export const SETTINGS_KEYS = {
  SNAPSHOT_RETENTION: "snapshot_retention",
  HOTKEY_COMBO: "hotkey_combo",
  HOTKEY_ENABLED: "hotkey_enabled",
} as const;
