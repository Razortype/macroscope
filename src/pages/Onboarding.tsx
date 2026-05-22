import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronLeft, ChevronRight, CheckCircle2,
  Cpu, Folder, Sparkles, Shield,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import MacroscopeLogo from "../components/MacroscopeLogo";
import { AIProviderContent } from "../components/settings/AIProviderSection";
import { ProjectRootsContent } from "../components/settings/ProjectRootsSection";
import {
  PermissionsStep,
  type PermMode,
} from "../components/onboarding/PermissionsStep";
import { PROVIDER_LABELS } from "../types/provider";
import type { ProviderConfig } from "../types/provider";
import { SYSTEM_PROBE_REGISTRY } from "../lib/system-probes";

const TOTAL_STEPS = 6;

// ── Step header (mono uppercase, matches section headers in Settings) ─────────

function StepHeader({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: "var(--text-xs)",
        fontWeight: 600,
        color: "var(--color-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        fontFamily: "var(--font-mono)",
      }}
    >
      {children}
    </p>
  );
}

// ── Step 1: Welcome ───────────────────────────────────────────────────────────

const FEATURE_ROW_CONFIGS = [
  { num: 1, key: "see_what_gets_scanned", Icon: Shield },
  { num: 2, key: "pick_an_ai_provider",   Icon: Cpu },
  { num: 3, key: "grant_permissions",     Icon: Folder },
  { num: 4, key: "confirm_project_locations", Icon: Sparkles },
] as const;

function StepWelcome() {
  const { t } = useTranslation("onboarding");
  const featureRows = FEATURE_ROW_CONFIGS.map(({ num, key, Icon }) => ({
    num,
    title: t(`steps.welcome.features.${key}.title`),
    desc: t(`steps.welcome.features.${key}.desc`),
    Icon,
  }));
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "28px",
        padding: "8px 0",
      }}
    >
      <MacroscopeLogo size={48} />

      <div style={{ textAlign: "center" }}>
        <h1
          style={{
            margin: "0 0 8px",
            fontSize: "var(--text-2xl)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {t("steps.welcome.title")}
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-base)",
            color: "var(--color-text-secondary)",
          }}
        >
          {t("steps.welcome.subtitle")}
        </p>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          width: "100%",
        }}
      >
        {featureRows.map(({ num, title, desc, Icon }) => (
          <div
            key={num}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "14px",
              padding: "14px 16px",
              background: "var(--color-bg-elev-2)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-border-subtle)",
            }}
          >
            <div
              style={{
                width: "24px",
                height: "24px",
                borderRadius: "var(--radius-full)",
                background: "var(--color-accent-glow)",
                border: "1px solid var(--color-accent-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "10px",
                  fontWeight: 700,
                  color: "var(--color-accent)",
                }}
              >
                {num}
              </span>
            </div>
            <div>
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: 500,
                  color: "var(--color-text-primary)",
                  marginBottom: "2px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Icon size={13} style={{ color: "var(--color-accent)" }} />
                {title}
              </div>
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-muted)",
                }}
              >
                {desc}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Step 2: What Macroscope Scans ─────────────────────────────────────────────

function StepScanScope() {
  const { t } = useTranslation(["onboarding", "settings"]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <StepHeader>{t("onboarding:steps.scan_scope.header")}</StepHeader>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          {t("onboarding:steps.scan_scope.fixed_note")}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {SYSTEM_PROBE_REGISTRY.map((probe) => (
          <div
            key={probe.key}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              padding: "10px 12px",
              background: "var(--color-bg-elev-2)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border-subtle)",
            }}
          >
            <Shield
              size={12}
              style={{
                color: "var(--color-accent)",
                flexShrink: 0,
                marginTop: "2px",
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                }}
              >
                {t(`settings:probes.${probe.key}.label`)}
              </span>
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-muted)",
                  lineHeight: "var(--leading-snug)",
                }}
              >
                {t(`settings:probes.${probe.key}.description`)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          padding: "10px 12px",
          background: "var(--color-accent-glow)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--color-accent-muted)",
        }}
      >
        <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>
          {t("onboarding:steps.scan_scope.optional_note")}
        </p>
      </div>
    </div>
  );
}

// ── Step 3: AI Provider ───────────────────────────────────────────────────────

function StepAIProvider() {
  const { t } = useTranslation("onboarding");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <StepHeader>{t("steps.ai_provider.header")}</StepHeader>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          {t("steps.ai_provider.hint")}
        </p>
      </div>
      <AIProviderContent />
    </div>
  );
}

// ── Step 4: Permissions ───────────────────────────────────────────────────────

function StepPermissions({
  mode,
  onModeChange,
  onGrantedCountChange,
}: {
  mode: PermMode;
  onModeChange: (m: PermMode) => void;
  onGrantedCountChange: (count: number) => void;
}) {
  const { t } = useTranslation("onboarding");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <StepHeader>{t("steps.permissions.header")}</StepHeader>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          {t("steps.permissions.hint")}
        </p>
      </div>
      <PermissionsStep
        mode={mode}
        onModeChange={onModeChange}
        onGrantedCountChange={onGrantedCountChange}
      />
    </div>
  );
}

// ── Step 5: Project Roots ─────────────────────────────────────────────────────

function StepProjectRoots() {
  const { t } = useTranslation("onboarding");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <StepHeader>{t("steps.project_roots.header")}</StepHeader>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          {t("steps.project_roots.hint")}
        </p>
      </div>
      <ProjectRootsContent onChanged={() => {}} />
    </div>
  );
}

// ── Step 6: Done ──────────────────────────────────────────────────────────────

function StepDone({
  permMode,
  grantedCount,
  onSkip,
}: {
  permMode: PermMode;
  grantedCount: number;
  onSkip: () => void;
}) {
  const { t } = useTranslation("onboarding");
  const [providerName, setProviderName] = useState<string>("—");
  const [rootCount, setRootCount] = useState<number>(0);

  useEffect(() => {
    invoke<ProviderConfig>("get_provider_config")
      .then((cfg) => setProviderName(PROVIDER_LABELS[cfg.active_provider] ?? cfg.active_provider))
      .catch(() => {});

    invoke<[string, string][]>("list_settings")
      .then((rows) => {
        const map = Object.fromEntries(rows);
        try {
          setRootCount(JSON.parse(map["project_roots"] ?? "[]").length);
        } catch {
          setRootCount(0);
        }
      })
      .catch(() => {});
  }, []);

  const permText =
    permMode === "fda"
      ? t("steps.done.permissions_fda")
      : t("steps.done.permissions_granular", { count: grantedCount });

  const stats = [
    { label: t("steps.done.stat_ai_provider"), value: providerName },
    { label: t("steps.done.stat_permissions"), value: permText },
    { label: t("steps.done.stat_project_roots"), value: t("steps.done.project_roots", { count: rootCount }) },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "24px",
        padding: "8px 0",
      }}
    >
      <CheckCircle2
        size={56}
        style={{ color: "var(--color-status-ok)" }}
      />

      <div style={{ textAlign: "center" }}>
        <h2
          style={{
            margin: "0 0 6px",
            fontSize: "var(--text-2xl)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {t("steps.done.title")}
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-base)",
            color: "var(--color-text-secondary)",
          }}
        >
          {t("steps.done.subtitle")}
        </p>
      </div>

      {/* Stat grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "10px",
          width: "100%",
        }}
      >
        {stats.map(({ label, value }) => (
          <div
            key={label}
            style={{
              background: "var(--color-bg-elev-2)",
              borderRadius: "var(--radius-sm)",
              padding: "12px",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              border: "1px solid var(--color-border-subtle)",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                fontWeight: 600,
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {label}
            </span>
            <span
              style={{
                fontSize: "var(--text-sm)",
                fontWeight: 500,
                color: "var(--color-text-primary)",
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onSkip}
        style={{
          background: "none",
          border: "none",
          color: "var(--color-text-muted)",
          fontSize: "var(--text-xs)",
          fontFamily: "var(--font-sans)",
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: "3px",
          padding: "4px",
        }}
      >
        {t("nav.skip_to_dashboard")}
      </button>
    </div>
  );
}

// ── Main Onboarding component ─────────────────────────────────────────────────

interface OnboardingProps {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const { t } = useTranslation("onboarding");
  const [step, setStep] = useState(1);
  const [permMode, setPermMode] = useState<PermMode>("granular");
  const [permGrantedCount, setPermGrantedCount] = useState(0);

  // On first launch, detect macOS system locale and seed the locale setting
  // if it has not been written yet. Runs once — subsequent launches already
  // have a locale stored and skip the detection call.
  useEffect(() => {
    invoke<string | null>("get_setting", { key: "locale" })
      .then((existing) => {
        if (existing != null) return;
        return invoke<string>("get_system_locale").then((detected) =>
          invoke("set_setting", { key: "locale", value: detected })
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" && step < TOTAL_STEPS) setStep((s) => s + 1);
      if (e.key === "ArrowLeft" && step > 1) setStep((s) => s - 1);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [step]);

  async function complete() {
    await invoke("set_first_run_state", { completed: true }).catch(() => {});
    onComplete();
  }

  async function completeWithSnapshot() {
    const readiness = await invoke<{ ready: boolean }>("is_provider_ready").catch(() => ({ ready: false }));
    if (readiness.ready) {
      sessionStorage.setItem("mscope_auto_snapshot", String(Date.now()));
    }
    await complete();
  }

  const continueLabel =
    step === 1 ? t("nav.get_started") :
    step === TOTAL_STEPS ? t("nav.take_first_snapshot") :
    t("common:actions.continue");

  const cardMaxWidth = step === 2 || step === 4 || step === 5 ? "600px" : "520px";

  function renderStep() {
    switch (step) {
      case 1: return <StepWelcome />;
      case 2: return <StepScanScope />;
      case 3: return (
        <StepPermissions
          mode={permMode}
          onModeChange={setPermMode}
          onGrantedCountChange={setPermGrantedCount}
        />
      );
      case 4: return <StepAIProvider />;
      case 5: return <StepProjectRoots />;
      case 6: return (
        <StepDone
          permMode={permMode}
          grantedCount={permGrantedCount}
          onSkip={complete}
        />
      );
      default: return null;
    }
  }

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "var(--color-bg-base)",
        overflow: "hidden",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          borderBottom: "1px solid var(--color-border-divider)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <MacroscopeLogo size={20} />
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              color: "var(--color-text-primary)",
            }}
          >
            {t("topbar.app_name")}
          </span>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              style={{
                background: "none",
                border: "none",
                color: "var(--color-text-muted)",
                fontSize: "var(--text-sm)",
                fontFamily: "var(--font-sans)",
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {t("topbar.skip_setup")}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("skip_dialog.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("skip_dialog.description")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={complete}>{t("skip_dialog.confirm")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Scrollable content area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "32px 24px",
          overflow: "auto",
        }}
      >
        <div
          style={{
            background: "var(--color-bg-elev-1)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-lg)",
            padding: "32px",
            width: "100%",
            maxWidth: cardMaxWidth,
            display: "flex",
            flexDirection: "column",
            gap: "24px",
          }}
        >
          {/* Progress bar */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div
                key={i}
                style={{
                  height: "3px",
                  flex: 1,
                  borderRadius: "var(--radius-full)",
                  background: i < step
                    ? "var(--color-accent)"
                    : "var(--color-border-strong)",
                  transition: `background var(--duration-base)`,
                }}
              />
            ))}
          </div>

          {/* Step content */}
          {renderStep()}

          {/* Navigation */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: "8px",
              borderTop: "1px solid var(--color-border-divider)",
              marginTop: "auto",
            }}
          >
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  background: "none",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: "var(--radius-md)",
                  padding: "7px 14px",
                  color: "var(--color-text-secondary)",
                  fontSize: "var(--text-sm)",
                  fontFamily: "var(--font-sans)",
                  cursor: "pointer",
                }}
              >
                <ChevronLeft size={14} />
                {t("common:actions.back")}
              </button>
            ) : (
              <div />
            )}

            <button
              type="button"
              onClick={
                step < TOTAL_STEPS
                  ? () => setStep((s) => s + 1)
                  : completeWithSnapshot
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background: "var(--color-accent)",
                color: "var(--color-accent-on)",
                border: "none",
                borderRadius: "var(--radius-md)",
                padding: "7px 16px",
                fontSize: "var(--text-sm)",
                fontFamily: "var(--font-sans)",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {continueLabel}
              {step > 1 && step < TOTAL_STEPS && <ChevronRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
