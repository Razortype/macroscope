// Mirror of src-tauri/src/finding.rs
// Enum variants serialise as snake_case (serde rename_all = "snake_case").
// paths_to_remove and estimated_bytes_freed are absent (not null) when
// suggested_action != "delete_paths" (Rust: skip_serializing_if = "Option::is_none").

export type Severity = "info" | "low" | "medium" | "high";
export type Category = "disk" | "security" | "network" | "persistence" | "process";
export type SuggestedAction = "delete_paths" | "investigate" | "ignore";

export interface Finding {
  id: string;
  severity: Severity;
  category: Category;
  title: string;
  description: string;
  rationale: string;
  suggested_action: SuggestedAction;
  paths_to_remove?: string[];
  estimated_bytes_freed?: number;
}
