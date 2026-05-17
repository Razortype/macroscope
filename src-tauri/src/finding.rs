use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Disk,
    Security,
    Network,
    Persistence,
    Process,
    Apps,
    Files,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SuggestedAction {
    DeletePaths,
    Investigate,
    Ignore,
}

fn default_suggested_action() -> SuggestedAction {
    SuggestedAction::Investigate
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Finding {
    pub id: String,
    pub severity: Severity,
    pub category: Category,
    pub title: String,
    pub description: String,
    pub rationale: String,
    #[serde(default = "default_suggested_action")]
    pub suggested_action: SuggestedAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paths_to_remove: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_bytes_freed: Option<u64>,
}
