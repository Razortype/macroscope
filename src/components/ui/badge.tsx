import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-bg-elev-3 text-text-secondary",
        info: "text-severity-info-fg",
        low: "text-severity-low-fg",
        medium: "text-severity-medium-fg",
        high: "text-severity-high-fg",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, style, ...props }: BadgeProps) {
  const bgMap: Record<string, string> = {
    info: "var(--color-severity-info-bg)",
    low: "var(--color-severity-low-bg)",
    medium: "var(--color-severity-medium-bg)",
    high: "var(--color-severity-high-bg)",
  };
  const fgMap: Record<string, string> = {
    info: "var(--color-severity-info-fg)",
    low: "var(--color-severity-low-fg)",
    medium: "var(--color-severity-medium-fg)",
    high: "var(--color-severity-high-fg)",
  };
  const severityStyle =
    variant && variant !== "default"
      ? { backgroundColor: bgMap[variant], color: fgMap[variant], ...style }
      : style;

  return (
    <div
      className={cn(badgeVariants({ variant }), className)}
      style={severityStyle}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
