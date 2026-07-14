//! Error type for the perception pipeline. Hand-written (no `thiserror`) to keep
//! the crate dependency-free outside of the Windows capture layer.

use std::fmt;

/// Anything that can go wrong while capturing or building the screen context.
#[derive(Debug)]
pub enum PerceptionError {
    /// The platform's accessibility/automation backend failed (e.g. a COM call
    /// on Windows). Carries a human-readable description.
    Capture(String),
    /// No suitable element/window could be found to anchor the capture on
    /// (e.g. nothing is focused and the desktop is empty).
    NothingToCapture,
    /// The current platform has no capture implementation.
    UnsupportedPlatform,
}

impl fmt::Display for PerceptionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PerceptionError::Capture(msg) => write!(f, "screen capture failed: {msg}"),
            PerceptionError::NothingToCapture => write!(f, "nothing to capture (no focused element or window)"),
            PerceptionError::UnsupportedPlatform => {
                write!(f, "screen perception is only implemented on Windows")
            }
        }
    }
}

impl std::error::Error for PerceptionError {}

#[cfg(windows)]
impl From<uiautomation::errors::Error> for PerceptionError {
    fn from(e: uiautomation::errors::Error) -> Self {
        PerceptionError::Capture(e.to_string())
    }
}
