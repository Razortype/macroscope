#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("db error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("claude cli error: {0}")]
    ClaudeCli(String),

    #[error("probe failed: {probe}: {message}")]
    Probe { probe: String, message: String },

    #[error("path not allowed: {0}")]
    PathNotAllowed(String),

    #[error("config error: {0}")]
    Config(String),
}

impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.to_string()
    }
}
