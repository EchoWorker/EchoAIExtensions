//! Public-API integration test.
//!
//! The builder's unit tests now live in-module (`#[cfg(test)]` inside each
//! `src/builder/*.rs`), exercising the crate-private internals directly. This
//! file deliberately touches ONLY the public surface — proving that the public
//! contract (a `Scope`/`Budget` in, a `PerceptionResult`/`VisualNode` out) is
//! coherent and that internals stay private.

use echolens_perception::{Budget, PerceptionError, Rect, Role, Scope, VisualNode};

#[test]
fn public_model_types_are_usable() {
    // VisualNode is the only tree type we expose; it must be constructible and
    // navigable from outside the crate (the shell builds/consumes these).
    let mut win = VisualNode::new(1, Role::Window, "App", Rect::new(0, 0, 800, 600));
    win.children.push(VisualNode::new(2, Role::Button, "OK", Rect::new(10, 10, 40, 20)));

    assert_eq!(win.count(), 2, "count walks the subtree");
    assert_eq!(win.find(2).map(|n| n.role), Some(Role::Button), "find locates by id");
    assert!(win.find(99).is_none(), "missing id returns None");
    assert_eq!(win.rect.center(), (400, 300), "rect geometry is public");
}

#[test]
fn budget_has_sensible_default() {
    let b = Budget::default();
    assert!(b.max_tokens > 0, "default token budget is positive");
    assert!(b.max_depth > 0, "default depth backstop is positive");
}

#[test]
fn scope_parses_from_strings() {
    assert_eq!(Scope::parse("focus"), Scope::Focus);
    assert_eq!(Scope::parse("screen"), Scope::Screen);
    assert_eq!(Scope::parse("window"), Scope::Window);
    assert_eq!(Scope::parse("anything-else"), Scope::Window, "unknown defaults to Window");
}

#[test]
#[cfg(not(windows))]
fn capture_is_unsupported_off_windows() {
    // On non-Windows the public entry point reports UnsupportedPlatform rather
    // than panicking — proving the platform boundary is handled at the API edge.
    let err = echolens_perception::capture(Scope::Window).unwrap_err();
    assert!(matches!(err, PerceptionError::UnsupportedPlatform));
}

#[test]
fn perception_error_is_display() {
    // Errors are public and printable (the shell surfaces them to the user).
    let e = PerceptionError::NothingToCapture;
    assert!(!format!("{e}").is_empty());
}
