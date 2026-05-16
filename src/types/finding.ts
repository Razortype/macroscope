export type Severity = "info" | "low" | "medium" | "high";
export type Category = "disk" | "security" | "network" | "persistence" | "process";
export type ActionType = "delete_paths" | "investigate" | "ignore";

export interface Finding {
  id: string;
  severity: Severity;
  category: Category;
  title: string;
  description: string;
  suggested_action: ActionType;
  paths_to_remove: string[] | null;
  rationale: string;
  estimated_bytes_freed: number | null;
}
