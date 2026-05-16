import { Link } from "react-router-dom";
import { Settings } from "lucide-react";
import MacroscopeLogo from "./MacroscopeLogo";

export default function TopBar() {
  return (
    <header
      style={{
        height: "56px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        background: "var(--color-bg-elev-1)",
        borderBottom: "1px solid var(--color-border-divider)",
        flexShrink: 0,
      }}
    >
      {/* Wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <MacroscopeLogo size={22} />
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            fontSize: "var(--text-base)",
            color: "var(--color-text-primary)",
            letterSpacing: "0.01em",
          }}
        >
          Macroscope
        </span>
      </div>

      {/* Gear icon → Settings route */}
      <Link
        to="/settings"
        style={{ color: "var(--color-text-muted)", display: "flex", lineHeight: 0 }}
        title="Settings"
      >
        <Settings size={18} strokeWidth={1.5} />
      </Link>
    </header>
  );
}
