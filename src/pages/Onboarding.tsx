import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
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

const TOTAL_STEPS = 5;

interface OnboardingProps {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(1);

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

      {/* Centered content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px",
          overflow: "auto",
        }}
      >
        <div
          style={{
            background: "var(--color-bg-elev-1)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-lg)",
            padding: "40px",
            width: "100%",
            maxWidth: "520px",
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

          {/* Placeholder body */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              minHeight: "120px",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Step {step} of {TOTAL_STEPS}
            </span>
            <p
              style={{
                margin: 0,
                fontSize: "var(--text-base)",
                color: "var(--color-text-secondary)",
                textAlign: "center",
              }}
            >
              Onboarding wizard placeholder · Step {step} of {TOTAL_STEPS}
            </p>
          </div>

          {/* Navigation */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
              onClick={step < TOTAL_STEPS ? () => setStep((s) => s + 1) : complete}
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
              {step < TOTAL_STEPS ? (
                <>
                  Continue
                  <ChevronRight size={14} />
                </>
              ) : (
                "Take first snapshot"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
