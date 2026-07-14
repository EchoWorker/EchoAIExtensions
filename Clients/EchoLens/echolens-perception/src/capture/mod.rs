//! Platform-independent capture abstractions.
//!
//! A [`VisualSource`] turns a [`Scope`] into a [`CaptureResult`] (an owned
//! `VisualNode` tree + an optional focus anchor). The Windows implementation
//! lives in `windows.rs`; future macOS/Linux sources implement the same trait
//! and the builder layer never changes.

use crate::error::PerceptionError;
use crate::model::VisualNode;

#[cfg(windows)]
pub mod windows;

/// What slice of the screen to perceive (mirrors PRODUCT_DESIGN §3.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    /// Focused element + its rippling neighborhood (default).
    Focus,
    /// The whole foreground window's element tree.
    Window,
    /// A shallow overview of all visible top-level windows.
    Screen,
}

impl Scope {
    /// Parse from a CLI/IPC string; defaults to `Window` on anything unknown.
    pub fn parse(s: &str) -> Scope {
        match s.trim().to_ascii_lowercase().as_str() {
            "focus" => Scope::Focus,
            "screen" => Scope::Screen,
            _ => Scope::Window,
        }
    }
}

/// The product of one capture: a tree plus the focus anchor (if any).
#[derive(Debug, Clone)]
pub struct CaptureResult {
    pub root: VisualNode,
    /// `VisualNode.id` of the focus anchor; `None` for Window/Screen scope.
    pub anchor_id: Option<u32>,
}

/// Platform abstraction. Each OS implements this to produce `VisualNode`s.
pub trait VisualSource {
    fn capture(&self, scope: Scope) -> Result<CaptureResult, PerceptionError>;
}

/// Construct the platform's default [`VisualSource`]. This is the only place
/// that names a concrete implementation; the rest of the crate depends on the
/// `VisualSource` trait (dependency inversion), so adding macOS/Linux later is
/// a change isolated to this factory + a new `capture::<os>` module.
pub fn default_source() -> Result<Box<dyn VisualSource>, PerceptionError> {
    #[cfg(windows)]
    {
        Ok(Box::new(windows::WindowsSource::new()?))
    }
    #[cfg(not(windows))]
    {
        Err(PerceptionError::UnsupportedPlatform)
    }
}
