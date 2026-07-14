//! Platform-independent context builder: prune → best-first select → serialize.
//!
//! Everything here consumes an owned [`VisualNode`] tree and produces a String,
//! so it is fully unit-testable without a real screen. The submodules are crate-
//! internal; the only thing the rest of the crate needs is [`build`] + [`Budget`].

pub(crate) mod prune;
pub(crate) mod scoring;
pub(crate) mod serialize;
pub(crate) mod traversal;

pub use traversal::Budget;

use crate::capture::CaptureResult;

/// Outcome of building context from a capture.
#[derive(Debug, Clone)]
pub struct BuildOutput {
    /// Compact XML to feed the LLM (inside `<screen_context>`).
    pub xml: String,
    /// Number of nodes actually kept.
    pub node_count: usize,
    /// Number of nodes dropped by the budget.
    pub omitted: usize,
}

/// Build screen context from a capture under the given budget.
///
/// Pipeline: `prune` (compress, remapping the anchor across id-changing passes)
/// → `select` (best-first under the token budget, centered on the anchor)
/// → `to_xml` (serialize the kept subtree).
pub fn build(cap: CaptureResult, budget: &Budget) -> BuildOutput {
    let mut tree = cap.root;
    let mut anchor = cap.anchor_id;

    // 1) Compress. `prune` keeps `anchor` valid even when it collapses/merges
    //    the node the anchor pointed at.
    prune::prune(&mut tree, &mut anchor);

    // 2) Best-first selection under the token budget, centered on the anchor.
    let sel = traversal::select(&tree, anchor, budget);

    // 3) Serialize the selected subtree.
    let xml = serialize::to_xml(&tree, &sel);

    BuildOutput { node_count: sel.kept.len(), omitted: sel.omitted, xml }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Rect, Role, VisualNode};

    #[test]
    fn build_pipeline_produces_xml_and_counts() {
        let mut root = VisualNode::new(1, Role::Window, "Form", Rect::new(0, 0, 800, 600));
        root.children = vec![
            VisualNode::new(2, Role::Edit, "anchor field", Rect::new(100, 100, 10, 10)),
            VisualNode::new(3, Role::Text, "label", Rect::new(120, 100, 10, 10)),
            VisualNode::new(4, Role::Button, "Submit", Rect::new(140, 100, 10, 10)),
        ];
        let cap = CaptureResult { root, anchor_id: Some(2) };

        let out = build(cap, &Budget::default());
        assert!(out.node_count >= 1, "at least the anchor is kept");
        assert!(out.xml.contains("<window"), "xml has window root");
        assert!(out.xml.contains("anchor field"), "anchor content present");
    }

    #[test]
    fn build_remaps_anchor_when_prune_collapses_it() {
        // Anchor on a nameless single-child group that prune will collapse; the
        // pipeline must still center on the surviving child, not fall back to root.
        let mut root = VisualNode::new(1, Role::Window, "win", Rect::new(0, 0, 800, 600));
        let mut group = VisualNode::new(2, Role::Group, "", Rect::new(10, 10, 100, 100));
        group.children = vec![VisualNode::new(3, Role::Edit, "field", Rect::new(20, 20, 10, 10))];
        // A far sibling that should be reachable only if the anchor stays correct.
        root.children = vec![group, VisualNode::new(4, Role::Text, "side", Rect::new(700, 20, 10, 10))];
        let cap = CaptureResult { root, anchor_id: Some(2) };

        let out = build(cap, &Budget::default());
        // The collapsed-to child (the edit "field") must appear.
        assert!(out.xml.contains("field"), "anchor survived the collapse");
    }
}
