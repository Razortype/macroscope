import { invoke } from "@tauri-apps/api/core";
import { settingsSchema, SETTINGS_KEYS, type SettingsValues } from "../types/settings";

export async function loadSettings(): Promise<SettingsValues> {
  const rows = await invoke<[string, string][]>("list_settings");
  const map = Object.fromEntries(rows);

  const raw: Record<string, unknown> = {
    snapshot_retention: map[SETTINGS_KEYS.SNAPSHOT_RETENTION] ?? 10,
    hotkey_combo: map[SETTINGS_KEYS.HOTKEY_COMBO] ?? "Cmd+Shift+M",
    hotkey_enabled: map[SETTINGS_KEYS.HOTKEY_ENABLED] === "true",
    locale: map[SETTINGS_KEYS.LOCALE] ?? "en",
  };

  return settingsSchema.parse(raw);
}

export async function saveSettings(values: SettingsValues): Promise<void> {
  const entries: [string, string][] = [
    [SETTINGS_KEYS.SNAPSHOT_RETENTION, String(values.snapshot_retention)],
    [SETTINGS_KEYS.HOTKEY_COMBO, values.hotkey_combo],
    [SETTINGS_KEYS.HOTKEY_ENABLED, String(values.hotkey_enabled)],
    [SETTINGS_KEYS.LOCALE, values.locale],
  ];

  for (const [key, value] of entries) {
    await invoke("set_setting", { key, value });
  }
}
