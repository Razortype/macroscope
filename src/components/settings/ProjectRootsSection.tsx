import { useState, useEffect } from "react";
import { X, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Section } from "./SectionWrapper";

// ── ProjectRootsContent (inner; no Section wrapper) ───────────────────────────

export function ProjectRootsContent({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation("settings");
  const [roots, setRoots] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);

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

  function addByText() {
    if (isAdding || inputValue.trim() === "") return;
    setIsAdding(true);
    invoke<string>("validate_project_root", { path: inputValue.trim() })
      .then((canonicalPath) => {
        persistRoots([...roots, canonicalPath]);
        setInputValue("");
        toast.success(t("project_roots.added_toast", { path: canonicalPath }), { duration: 2000 });
      })
      .catch((err: { kind: string; path: string }) => {
        toast.error(t(`project_roots.errors.${err.kind}`, { path: err.path }), { duration: 4000 });
      })
      .finally(() => setIsAdding(false));
  }

  async function addRoot() {
    const selected = await openDialog({ directory: true, multiple: false, title: t("project_roots.select_directory_dialog") });
    if (!selected || typeof selected !== "string") return;
    invoke<string>("validate_project_root", { path: selected })
      .then((canonicalPath) => {
        persistRoots([...roots, canonicalPath]);
        toast.success(t("project_roots.added_toast", { path: canonicalPath }), { duration: 2000 });
      })
      .catch((err: { kind: string; path: string }) => {
        toast.error(t(`project_roots.errors.${err.kind}`, { path: err.path }), { duration: 4000 });
      });
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
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addByText(); }}
          placeholder={t("project_roots.text_input_placeholder")}
          style={{
            flex: 1,
            background: "var(--color-bg-elev-2)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-sm)",
            padding: "3px 8px",
            color: "var(--color-text-primary)",
            fontSize: "var(--text-xs)",
            fontFamily: "var(--font-mono)",
            outline: "none",
            minWidth: 0,
          }}
        />
        <button
          type="button"
          onClick={addByText}
          disabled={isAdding || inputValue.trim() === ""}
          style={{
            display: "flex",
            alignItems: "center",
            background: "none",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-sm)",
            padding: "3px 8px",
            color: "var(--color-text-secondary)",
            fontSize: "var(--text-xs)",
            fontFamily: "var(--font-sans)",
            cursor: isAdding || inputValue.trim() === "" ? "not-allowed" : "pointer",
            opacity: isAdding || inputValue.trim() === "" ? 0.4 : 1,
            flexShrink: 0,
          }}
        >
          {t("project_roots.add_button")}
        </button>
        <button
          type="button"
          onClick={addRoot}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            background: "none",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-sm)",
            padding: "3px 8px",
            color: "var(--color-text-secondary)",
            fontSize: "var(--text-xs)",
            fontFamily: "var(--font-sans)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <Plus size={12} />
          {t("project_roots.add_directory")}
        </button>
      </div>
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
