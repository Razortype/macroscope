use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelExtension {
    pub bundle_id: String,
    pub version: String,
    pub refs: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelReport {
    pub extensions: Vec<KernelExtension>,
}
