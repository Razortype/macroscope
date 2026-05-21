import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";

interface Props {
  path: string;
}

export default function RowActions({ path }: Props) {
  const { t } = useTranslation("common");

  function handleReveal() {
    invoke("reveal_in_finder", { path }).catch((err: unknown) => {
      toast.error(t("errors.could_not_open_finder", { detail: String(err) }));
    });
  }

  function handleCopy() {
    navigator.clipboard.writeText(path).catch((err: unknown) => {
      toast.error(t("errors.could_not_copy_path", { detail: String(err) }));
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "none",
            border: "none",
            padding: "2px 4px",
            borderRadius: "var(--radius-xs)",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--color-bg-elev-3)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "none";
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={handleReveal}>
          {t("actions.reveal_in_finder")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleCopy}>
          {t("actions.copy_path")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
