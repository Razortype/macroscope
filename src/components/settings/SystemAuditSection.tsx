import { useTranslation } from "react-i18next";
import { Section } from "./SectionWrapper";
import { SYSTEM_PROBE_REGISTRY } from "../../lib/system-probes";

export function SectionSystemAudit() {
  const { t } = useTranslation("settings");
  return (
    <Section
      title={t("always_scanned.title")}
      description={t("always_scanned.description")}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {SYSTEM_PROBE_REGISTRY.map((probe) => (
          <div
            key={probe.key}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              padding: "10px 12px",
              background: "var(--color-bg-elev-2)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border-subtle)",
            }}
          >
            <span
              style={{
                fontSize: "var(--text-xs)",
                fontWeight: 600,
                color: "var(--color-text-primary)",
              }}
            >
              {t(`probes.${probe.key}.label`)}
            </span>
            <span
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--color-text-muted)",
                lineHeight: "var(--leading-snug)",
              }}
            >
              {t(`probes.${probe.key}.description`)}
            </span>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "4px",
                marginTop: "2px",
              }}
            >
              {probe.scope.map((s) => (
                <span
                  key={s}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    color: "var(--color-text-disabled)",
                    background: "var(--color-bg-base)",
                    border: "1px solid var(--color-border-subtle)",
                    borderRadius: "var(--radius-sm)",
                    padding: "1px 5px",
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
