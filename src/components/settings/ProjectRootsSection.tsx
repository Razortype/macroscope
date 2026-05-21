import { useState, useEffect } from "react";
import { X, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Section } from "./SectionWrapper";

// ── ProjectRootsContent (inner; no Section wrapper) ───────────────────────────

export function ProjectRootsContent({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation("settings");
  const [roots, setRoots] = useState<string[]>([]);

  useEffect(() => {
    invoke<[string, string][]>("list_settings").then((rows) => {
      const map = Object.fromEntries(rows);
      const raw = map["project_roots"];
      if (raw) {
        try {
          setRoots(JSON.parse(raw));
        } catch {
          setRoots([]);
        }
      }
    }).catch(() => {});
  }, []);

  async function persistRoots(updated: string[]) {
    await invoke("set_setting", {
      key: "project_roots",
      value: JSON.stringify(updated),
    });
    setRoots(updated);
    onChanged();
  }

  async function removeRoot(root: string) {
    await persistRoots(roots.filter((r) => r !== root));
  }

  async function addRoot() {
    const selected = await openDialog({ directory: true, multiple: false, title: t("project_roots.select_directory_dialog") });
    if (!selected || typeof selected !== "string") return;
    if (roots.includes(selected)) return;
    await persistRoots([...roots, selected]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {roots.length === 0 ? (
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--color-text-disabled)",
            fontStyle: "italic",
          }}
        >
          {t("project_roots.empty")}
        </p>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "3px",
            background: "var(--color-bg-elev-2)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 10px",
            border: "1px solid var(--color-border-subtle)",
          }}
        >
          {roots.map((root) => (
            <div
              key={root}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-secondary)",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {root}
              </span>
              <button
                type="button"
                onClick={() => removeRoot(root)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: "none",
                  border: "none",
                  padding: "2px",
                  cursor: "pointer",
                  color: "var(--color-text-disabled)",
                  flexShrink: 0,
                }}
                aria-label={t("project_roots.remove_aria", { path: root })}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={addRoot}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          alignSelf: "flex-start",
          background: "none",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-sm)",
          padding: "3px 8px",
          color: "var(--color-text-secondary)",
          fontSize: "var(--text-xs)",
          fontFamily: "var(--font-sans)",
          cursor: "pointer",
        }}
      >
        <Plus size={12} />
        {t("project_roots.add_directory")}
      </button>
    </div>
  );
}

// ── SectionProjectRoots (with Section wrapper; used in Settings) ──────────────

export function SectionProjectRoots({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation("settings");
  return (
    <Section
      title={t("project_roots.title")}
      description={t("project_roots.description")}
    >
      <ProjectRootsContent onChanged={onChanged} />
    </Section>
  );
}
