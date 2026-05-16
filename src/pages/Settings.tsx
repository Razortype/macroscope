import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Form } from "../components/ui/form";
import { settingsSchema, type SettingsValues } from "../types/settings";
import { loadSettings, saveSettings } from "../lib/settings";

// ── Section wrapper ────────────────────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--color-bg-elev-1)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-md)",
        padding: "20px",
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: "var(--text-xs)",
          fontWeight: 600,
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {title}
      </h2>
      {description && (
        <p
          style={{
            margin: "4px 0 16px",
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
            lineHeight: "var(--leading-snug)",
          }}
        >
          {description}
        </p>
      )}
      <div style={{ marginTop: description ? 0 : "16px" }}>{children}</div>
    </section>
  );
}

// ── Field row layout helper ────────────────────────────────────────────────────

function FieldRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {children}
    </div>
  );
}

// ── Stub sections (filled in later commits) ───────────────────────────────────

function SectionGeneral() {
  return <Section title="General" />;
}

function SectionClaudeCLI() {
  return <Section title="Claude CLI" />;
}

function SectionHotkey() {
  return <Section title="Hotkey" />;
}

function SectionSafety() {
  return <Section title="Safety" />;
}

function SectionAbout() {
  return <Section title="About" />;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Settings() {
  const [saving, setSaving] = useState(false);

  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: settingsSchema.parse({}),
  });

  useEffect(() => {
    loadSettings().then((values) => form.reset(values));
  }, []);

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      await saveSettings(values);
      toast.success("Settings saved");
      form.reset(values);
    } catch (e) {
      toast.error(`Could not save: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  });

  const isDirty = form.formState.isDirty;

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "var(--color-bg-base)" }}>
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "24px" }}>
        {/* Header */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            paddingBottom: "16px",
            borderBottom: "1px solid var(--color-border-divider)",
            marginBottom: "20px",
          }}
        >
          <Link
            to="/"
            style={{
              display: "flex",
              alignItems: "center",
              color: "var(--color-text-muted)",
              textDecoration: "none",
              padding: "4px",
              borderRadius: "var(--radius-sm)",
            }}
          >
            <ArrowLeft size={16} />
          </Link>
          <span
            style={{
              fontSize: "var(--text-xl)",
              fontWeight: 500,
              color: "var(--color-text-primary)",
              flex: 1,
            }}
          >
            Settings
          </span>
          <button
            onClick={onSubmit}
            disabled={!isDirty || saving}
            style={{
              background: isDirty && !saving ? "var(--color-accent)" : "var(--color-accent-muted)",
              color: "var(--color-accent-on)",
              border: "none",
              borderRadius: "var(--radius-md)",
              padding: "7px 16px",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              cursor: isDirty && !saving ? "pointer" : "not-allowed",
              opacity: isDirty && !saving ? 1 : 0.6,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </header>

        {/* Form */}
        <Form {...form}>
          <form
            onSubmit={onSubmit}
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            <SectionGeneral />
            <SectionClaudeCLI />
            <SectionHotkey />
            <SectionSafety />
            <SectionAbout />
          </form>
        </Form>
      </div>
    </div>
  );
}

export { Section, FieldRow };
