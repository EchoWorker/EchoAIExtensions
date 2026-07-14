//! Compression passes applied to the captured tree before selection/serialization.
//!
//! All passes are pure tree transforms (no OS deps), fully unit-testable:
//!   1. collapse single-child containers (a nameless container with exactly one
//!      child is replaced by that child),
//!   2. merge consecutive text nodes (adjacent `Text`/`Document` siblings with no
//!      children are joined into one, saving tokens),
//!   3. truncate over-long text (middle-elided: "head … [N omitted] … tail").
//!
//! Passes 1 and 2 change the set of node ids in the tree. To keep the focus
//! anchor valid downstream, [`prune`] threads the anchor id through and remaps
//! it whenever the node it points at is collapsed or merged away. This keeps id
//! lifecycle ownership inside the module that mutates ids (single responsibility)
//! rather than leaking the concern into the traversal stage.

use crate::model::VisualNode;

/// Default per-node text length above which we middle-elide.
pub(crate) const DEFAULT_MAX_TEXT: usize = 500;

/// Private sentinel marking an already-elided string (idempotency guard). Chosen
/// to be unlikely to occur in real UI text so we don't skip a genuine long node.
const ELISION_SENTINEL: char = '\u{2026}'; // the "…" we insert; see middle_elide

/// Run all compression passes in place, keeping `anchor` valid across id-changing
/// passes. `is_root` marks the tree root so it is never collapsed away (we must
/// keep the top-level window frame for context).
pub(crate) fn prune(node: &mut VisualNode, anchor: &mut Option<u32>) {
    collapse_single_child_containers(node, anchor, true);
    merge_adjacent_text(node, anchor);
    truncate_long_text(node, DEFAULT_MAX_TEXT);
}

/// A nameless pure-container with exactly one child is replaced by that child
/// (recursively, bottom-up). The root is never collapsed (`is_root`). If the
/// collapsed-away container *was* the anchor, the anchor moves to the promoted
/// child so the focus center survives.
pub(crate) fn collapse_single_child_containers(
    node: &mut VisualNode,
    anchor: &mut Option<u32>,
    is_root: bool,
) {
    for c in &mut node.children {
        collapse_single_child_containers(c, anchor, false);
    }
    if is_root {
        return; // keep the top-level frame
    }
    while node.role.is_container() && node.name.is_empty() && node.children.len() == 1 {
        let child = node.children.remove(0);
        // If the anchor pointed at the container being dropped, move it down.
        if *anchor == Some(node.id) {
            *anchor = Some(child.id);
        }
        *node = child;
    }
}

/// Merge runs of adjacent childless textual siblings into one node. If a merged-
/// away node was the anchor, the anchor moves to the surviving (first) node.
pub(crate) fn merge_adjacent_text(node: &mut VisualNode, anchor: &mut Option<u32>) {
    for c in &mut node.children {
        merge_adjacent_text(c, anchor);
    }
    if node.children.len() < 2 {
        return;
    }
    let mut merged: Vec<VisualNode> = Vec::with_capacity(node.children.len());
    for child in std::mem::take(&mut node.children) {
        if is_text_leaf(&child) {
            if let Some(last) = merged.last_mut() {
                if is_text_leaf(last) {
                    // Anchor follows the merge into the surviving node.
                    if *anchor == Some(child.id) {
                        *anchor = Some(last.id);
                    }
                    last.name.push(' ');
                    last.name.push_str(&child.name);
                    last.rect = union_rect(last.rect, child.rect);
                    continue;
                }
            }
        }
        merged.push(child);
    }
    node.children = merged;
}

fn is_text_leaf(n: &VisualNode) -> bool {
    n.role.is_textual() && n.children.is_empty() && !n.name.is_empty()
}

/// Middle-elide any node whose name exceeds `max` chars. Idempotent: a string
/// already containing the elision sentinel is left alone, so re-running `prune`
/// can't double-elide.
pub(crate) fn truncate_long_text(node: &mut VisualNode, max: usize) {
    let len = node.name.chars().count();
    if len > max && !node.name.contains(ELISION_SENTINEL) {
        node.name = middle_elide(&node.name, max);
    }
    for c in &mut node.children {
        truncate_long_text(c, max);
    }
}

/// "head … [N chars omitted] … tail", keeping `max/2` chars on each side.
/// Char-boundary safe (operates on `char`s, not bytes).
pub(crate) fn middle_elide(s: &str, max: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max {
        return s.to_string();
    }
    let keep = max / 2;
    let head: String = chars[..keep].iter().collect();
    let tail: String = chars[chars.len() - keep..].iter().collect();
    let omitted = chars.len() - 2 * keep;
    format!("{head} {ELISION_SENTINEL} [{omitted} chars omitted] {ELISION_SENTINEL} {tail}")
}

fn union_rect(a: crate::model::Rect, b: crate::model::Rect) -> crate::model::Rect {
    use crate::model::Rect;
    // Degenerate rects (zero area) shouldn't drag the union to the origin.
    if a.area() == 0 {
        return b;
    }
    if b.area() == 0 {
        return a;
    }
    let left = a.x.min(b.x);
    let top = a.y.min(b.y);
    let right = (a.x + a.w).max(b.x + b.w);
    let bottom = (a.y + a.h).max(b.y + b.h);
    Rect { x: left, y: top, w: right - left, h: bottom - top }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Rect, Role};

    fn node(id: u32, role: Role, name: &str) -> VisualNode {
        VisualNode::new(id, role, name, Rect::new(0, 0, 10, 10))
    }
    fn with_children(mut n: VisualNode, children: Vec<VisualNode>) -> VisualNode {
        n.children = children;
        n
    }

    #[test]
    fn collapses_nameless_single_child_container() {
        let leaf = node(3, Role::Text, "hello");
        let inner = with_children(node(2, Role::Group, ""), vec![leaf]);
        // Wrap under a named root so the collapse target isn't the root itself.
        let mut root = with_children(node(1, Role::Window, "win"), vec![inner]);
        let mut anchor = None;
        collapse_single_child_containers(&mut root, &mut anchor, true);
        // root preserved; its single nameless-group child collapsed to the text.
        assert_eq!(root.id, 1);
        assert_eq!(root.children.len(), 1);
        assert_eq!(root.children[0].id, 3);
        assert_eq!(root.children[0].name, "hello");
    }

    #[test]
    fn never_collapses_root_even_if_nameless_single_child() {
        let child = node(2, Role::Text, "only child");
        let mut root = with_children(node(1, Role::Window, ""), vec![child]);
        let mut anchor = None;
        collapse_single_child_containers(&mut root, &mut anchor, true);
        assert_eq!(root.id, 1, "root window frame must survive");
        assert_eq!(root.children.len(), 1);
    }

    #[test]
    fn does_not_collapse_named_container() {
        let leaf = node(2, Role::Text, "hello");
        let mut named = with_children(node(1, Role::Group, "Named Group"), vec![leaf]);
        let mut anchor = None;
        collapse_single_child_containers(&mut named, &mut anchor, false);
        assert_eq!(named.id, 1, "named container must survive");
    }

    #[test]
    fn anchor_follows_collapsed_container() {
        // group(2, anchor) > text(3). Collapsing moves the anchor 2 → 3.
        let leaf = node(3, Role::Text, "hello");
        let inner = with_children(node(2, Role::Group, ""), vec![leaf]);
        let mut root = with_children(node(1, Role::Window, "win"), vec![inner]);
        let mut anchor = Some(2);
        collapse_single_child_containers(&mut root, &mut anchor, true);
        assert_eq!(anchor, Some(3), "anchor must follow the collapse to the child");
    }

    #[test]
    fn merges_three_adjacent_text_nodes() {
        let kids = vec![
            node(2, Role::Text, "alpha"),
            node(3, Role::Text, "beta"),
            node(4, Role::Text, "gamma"),
        ];
        let mut parent = with_children(node(1, Role::Group, "g"), kids);
        let mut anchor = None;
        merge_adjacent_text(&mut parent, &mut anchor);
        assert_eq!(parent.children.len(), 1);
        assert_eq!(parent.children[0].name, "alpha beta gamma");
    }

    #[test]
    fn anchor_follows_merged_text() {
        // Anchor on the 2nd text node; after merge it must point at the survivor.
        let kids = vec![node(2, Role::Text, "alpha"), node(3, Role::Text, "beta")];
        let mut parent = with_children(node(1, Role::Group, "g"), kids);
        let mut anchor = Some(3);
        merge_adjacent_text(&mut parent, &mut anchor);
        assert_eq!(anchor, Some(2), "anchor follows merge into the survivor");
    }

    #[test]
    fn does_not_merge_text_separated_by_button() {
        let kids = vec![
            node(2, Role::Text, "alpha"),
            node(3, Role::Button, "Click"),
            node(4, Role::Text, "beta"),
        ];
        let mut parent = with_children(node(1, Role::Group, "g"), kids);
        let mut anchor = None;
        merge_adjacent_text(&mut parent, &mut anchor);
        assert_eq!(parent.children.len(), 3, "button breaks the text run");
    }

    #[test]
    fn truncates_long_text_middle_elided() {
        let long: String = "a".repeat(600);
        let mut n = node(1, Role::Text, &long);
        truncate_long_text(&mut n, 500);
        assert!(n.name.contains("chars omitted"));
        assert!(n.name.chars().count() < 600);
        assert!(n.name.starts_with("aaaa"));
        assert!(n.name.ends_with("aaaa"));
    }

    #[test]
    fn middle_elide_keeps_short_strings_intact() {
        assert_eq!(middle_elide("short", 500), "short");
    }

    #[test]
    fn middle_elide_is_char_boundary_safe() {
        let s: String = "中".repeat(600);
        let out = middle_elide(&s, 100);
        assert!(out.contains("chars omitted"));
    }

    #[test]
    fn prune_is_idempotent_on_long_text() {
        let long: String = "a".repeat(700);
        let mut once = node(1, Role::Text, &long);
        let mut anchor = None;
        prune(&mut once, &mut anchor);
        let after_one = once.name.clone();
        prune(&mut once, &mut anchor);
        assert_eq!(after_one, once.name, "second prune must not re-elide");
    }
}
