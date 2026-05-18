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

function FieldRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {children}
    </div>
  );
}

export { Section, FieldRow };
