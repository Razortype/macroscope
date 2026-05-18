import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronLeft, ChevronRight, CheckCircle2,
  Cpu, Folder, Sparkles,
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
  type PermStatus,
} from "../components/onboarding/PermissionsStep";
import { PROVIDER_LABELS } from "../types/provider";
import type { ProviderConfig } from "../types/provider";

const TOTAL_STEPS = 5;

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

const FEATURE_ROWS = [
  {
    num: 1,
    title: "Pick an AI provider",
    desc: "Choose Gemini, Claude, OpenAI, or run locally with Ollama",
    Icon: Cpu,
  },
  {
    num: 2,
    title: "Grant permissions",
    desc: "macOS will ask for access to specific folders",
    Icon: Folder,
  },
  {
    num: 3,
    title: "Confirm project locations",
    desc: "Tell Macroscope where your code lives",
    Icon: Sparkles,
  },
] as const;

function StepWelcome() {
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
          Welcome to Macroscope
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-base)",
            color: "var(--color-text-secondary)",
          }}
        >
          Let&apos;s get you set up in 3 quick steps.
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
        {FEATURE_ROWS.map(({ num, title, desc, Icon }) => (
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

// ── Step 2: AI Provider ───────────────────────────────────────────────────────

function StepAIProvider() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <StepHeader>AI Provider</StepHeader>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          You can change this later in Settings.
        </p>
      </div>
      <AIProviderContent />
    </div>
  );
}

// ── Step 3: Permissions ───────────────────────────────────────────────────────

function StepPermissions({
  mode,
  onModeChange,
  statuses,
  onStatusChange,
}: {
  mode: PermMode;
  onModeChange: (m: PermMode) => void;
  statuses: Record<string, PermStatus>;
  onStatusChange: (id: string, s: PermStatus) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <StepHeader>Permissions</StepHeader>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          You can grant these later — Macroscope will prompt when needed.
        </p>
      </div>
      <PermissionsStep
        mode={mode}
        onModeChange={onModeChange}
        statuses={statuses}
        onStatusChange={onStatusChange}
      />
    </div>
  );
}

// ── Step 4: Project Roots ─────────────────────────────────────────────────────

function StepProjectRoots() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <StepHeader>Project Roots</StepHeader>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          Macroscope will only scan these folders.
        </p>
      </div>
      <ProjectRootsContent onChanged={() => {}} />
    </div>
  );
}

// ── Step 5: Done ──────────────────────────────────────────────────────────────

function StepDone({
  permMode,
  grantedCount,
  onSkip,
}: {
  permMode: PermMode;
  grantedCount: number;
  onSkip: () => void;
}) {
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
      ? "Full Disk Access"
      : `${grantedCount} / 4 granted`;

  const stats = [
    { label: "AI Provider", value: providerName },
    { label: "Permissions", value: permText },
    { label: "Project Roots", value: `${rootCount} folder${rootCount !== 1 ? "s" : ""}` },
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
          You&apos;re all set
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-base)",
            color: "var(--color-text-secondary)",
          }}
        >
          Macroscope is ready to take your first snapshot.
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
        Skip and go to Dashboard
      </button>
    </div>
  );
}

// ── Main Onboarding component ─────────────────────────────────────────────────

interface OnboardingProps {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(1);
  const [permMode, setPermMode] = useState<PermMode>("granular");
  const [permStatuses, setPermStatuses] = useState<Record<string, PermStatus>>({});

  const grantedCount = Object.values(permStatuses).filter((s) => s === "granted").length;

  function handleStatusChange(id: string, status: PermStatus) {
    setPermStatuses((prev) => ({ ...prev, [id]: status }));
  }

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
    sessionStorage.setItem("mscope_auto_snapshot", "1");
    await invoke("set_first_run_state", { completed: true }).catch(() => {});
    onComplete();
  }

  const continueLabel =
    step === 1 ? "Get started" :
    step === TOTAL_STEPS ? "Take first snapshot" :
    "Continue";

  const cardMaxWidth = step === 2 || step === 4 ? "600px" : "520px";

  function renderStep() {
    switch (step) {
      case 1: return <StepWelcome />;
      case 2: return <StepAIProvider />;
      case 3: return (
        <StepPermissions
          mode={permMode}
          onModeChange={setPermMode}
          statuses={permStatuses}
          onStatusChange={handleStatusChange}
        />
      );
      case 4: return <StepProjectRoots />;
      case 5: return (
        <StepDone
          permMode={permMode}
          grantedCount={grantedCount}
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
            Macroscope
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
              Skip setup
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Skip setup?</AlertDialogTitle>
              <AlertDialogDescription>
                You can complete setup at any time from Settings. Some features may not work until configured.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={complete}>Skip anyway</AlertDialogAction>
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
                Back
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
