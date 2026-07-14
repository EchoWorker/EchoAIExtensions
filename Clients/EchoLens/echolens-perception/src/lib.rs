//! # echolens-perception
//!
//! The core of EchoLens: extract a structured UI Automation tree from the
//! Windows desktop, prune it to a token budget, and serialize it as compact XML
//! for an LLM. See `../docs/IMPLEMENTATION.md` §2 for the full design.
//!
//! Layering:
//! - [`model`] — platform-independent `VisualNode` tree (owned, no OS handles).
//! - `capture` — platform-specific extraction (`#[cfg(windows)]` UI Automation),
//!   exposed only through the [`Scope`] input and the [`capture`] entry point.
//! - `builder` — platform-independent prune → best-first select → serialize.
//!
//! Public entry: [`capture`]. Internal layers are crate-private; the contract is
//! deliberately small (a [`Scope`] in, a [`PerceptionResult`] out).

pub mod model;

pub(crate) mod builder;
pub(crate) mod capture;
pub mod error;

pub use builder::Budget;
pub use capture::Scope;
pub use error::PerceptionError;
pub use model::{Rect, Role, VisualNode};

/// Final product of one perception pass, ready for the shell to emit to the UI
/// and wrap into a `<screen_context>` block.
#[derive(Debug, Clone)]
pub struct PerceptionResult {
    /// Compact XML to feed the LLM.
    pub xml: String,
    /// Number of nodes actually included.
    pub node_count: usize,
    /// Number of nodes omitted by the budget (>0 → "more available").
    pub omitted: usize,
}

/// Capture the given [`Scope`] with the default budget.
///
/// On non-Windows targets this returns [`PerceptionError::UnsupportedPlatform`]
/// (the builder layer still compiles and is unit-tested everywhere).
pub fn capture(scope: Scope) -> Result<PerceptionResult, PerceptionError> {
    capture_with_budget(scope, &Budget::default())
}

/// Capture with an explicit budget.
///
/// Programs against the [`capture::VisualSource`] trait via
/// [`capture::default_source`] — the concrete platform implementation is never
/// named here, keeping this entry point platform-agnostic.
pub fn capture_with_budget(
    scope: Scope,
    budget: &Budget,
) -> Result<PerceptionResult, PerceptionError> {
    let source = capture::default_source()?;
    let cap = source.capture(scope)?;
    let out = builder::build(cap, budget);
    Ok(PerceptionResult { xml: out.xml, node_count: out.node_count, omitted: out.omitted })
}
