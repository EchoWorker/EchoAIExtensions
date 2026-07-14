//! Best-first selection with a **token budget** (not a node count).
//!
//! The builder consumes an owned [`VisualNode`] tree, so there are no parent
//! pointers. We first flatten the tree into an index (parent / children /
//! position), then run a best-first expansion from the anchor outward, pulling
//! in the highest-scoring neighbors until the token budget is exhausted.
//!
//! Why token budget, not node count: the real constraint on what we feed the
//! LLM is tokens. One rich text node can be worth 50 empty panels; budgeting by
//! node count would blow the context window when the focus sits next to a long
//! paragraph. (This is the core correct decision borrowed from Everywhere.)
//!
//! Note: selection is a path-dependent heuristic, not an optimal relaxation —
//! a node's score is fixed by the first path that reaches it, not the best
//! possible path. This is intentional (cheap, good-enough ranking).

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashSet};

use crate::builder::scoring::{score, Direction, Distance};
use crate::model::VisualNode;

/// Capture budget. `max_tokens` is the hard cap; `max_depth` is a soft backstop
/// (normally distance decay culls far nodes before depth matters).
#[derive(Debug, Clone, Copy)]
pub struct Budget {
    pub max_tokens: usize,
    pub max_depth: u32,
}

impl Default for Budget {
    fn default() -> Self {
        // ~Balanced level: enough for a focused window's neighborhood.
        Budget { max_tokens: 4096, max_depth: 16 }
    }
}

/// Rough per-node token cost: structure (tag + attrs ~3) + content (name/4).
/// Good enough for budgeting; swap for a real tokenizer if precision is needed.
pub(crate) fn node_token_cost(node: &VisualNode) -> usize {
    3 + node.name.chars().count() / 4
}

/// Result of selection: which node ids made the cut, and how many were omitted.
#[derive(Debug, Clone)]
pub(crate) struct Selection {
    pub kept: HashSet<u32>,
    pub omitted: usize,
}

impl Selection {
    /// Whether a node id was selected.
    pub fn contains(&self, id: u32) -> bool {
        self.kept.contains(&id)
    }
}

// ---- internal flattened index -------------------------------------------------

/// A node plus the navigation links the tree's owned form lacks (parent index,
/// child indices in document order, position among siblings).
struct Flat<'a> {
    node: &'a VisualNode,
    parent: Option<usize>,
    children: Vec<usize>,
    pos_in_parent: usize,
}

/// Flatten a tree into a `Vec<Flat>` in two passes: (1) iterative DFS assigning
/// each node an index + its parent index + sibling position; (2) back-fill each
/// node's children indices, sorted by `pos_in_parent` to restore document order.
fn flatten(root: &VisualNode) -> Vec<Flat<'_>> {
    // Pass 1: DFS, recording (node, parent_index, pos_in_parent) per node.
    let mut order: Vec<(&VisualNode, Option<usize>, usize)> = Vec::new();
    let mut stack: Vec<(&VisualNode, Option<usize>, usize)> = vec![(root, None, 0)];
    while let Some((node, parent, pos)) = stack.pop() {
        let my_index = order.len();
        order.push((node, parent, pos));
        // Reverse-push so children pop (and so get indices) in document order.
        for (i, child) in node.children.iter().enumerate().rev() {
            stack.push((child, Some(my_index), i));
        }
    }

    // Pass 2: materialize, then back-fill + sort children by sibling position.
    let mut flat: Vec<Flat<'_>> = order
        .iter()
        .map(|&(node, parent, pos)| Flat { node, parent, children: Vec::new(), pos_in_parent: pos })
        .collect();
    for idx in 0..flat.len() {
        if let Some(p) = flat[idx].parent {
            flat[p].children.push(idx);
        }
    }
    for p in 0..flat.len() {
        let mut kids = std::mem::take(&mut flat[p].children);
        kids.sort_by_key(|&c| flat[c].pos_in_parent);
        flat[p].children = kids;
    }
    flat
}

// ---- priority queue entry -----------------------------------------------------

struct Entry {
    score: f32,
    /// Tie-breaker for determinism (lower index wins on equal score).
    index: usize,
    /// Direction we arrived at this node by (drives step-vs-turn on propagation).
    dir: Direction,
    dist: Distance,
}

impl PartialEq for Entry {
    fn eq(&self, other: &Self) -> bool {
        self.score == other.score && self.index == other.index
    }
}
impl Eq for Entry {}
impl PartialOrd for Entry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Entry {
    fn cmp(&self, other: &Self) -> Ordering {
        // Max-heap by score; on tie, *lower* index first → reverse it so the
        // max-heap surfaces the lower index.
        self.score
            .total_cmp(&other.score)
            .then(other.index.cmp(&self.index))
    }
}

// ---- main selection -----------------------------------------------------------

/// Run best-first selection. `anchor_id` is the focused element (the expansion
/// center); `None` (Window/Screen scope) falls back to the root.
pub(crate) fn select(root: &VisualNode, anchor_id: Option<u32>, budget: &Budget) -> Selection {
    let flat = flatten(root);
    let total = flat.len();

    // Locate the anchor index (default: root at 0).
    let anchor_idx = anchor_id
        .and_then(|id| flat.iter().position(|f| f.node.id == id))
        .unwrap_or(0);

    let mut kept: HashSet<u32> = HashSet::new();
    let mut seen: HashSet<usize> = HashSet::new();
    let mut tokens = 0usize;
    let mut heap: BinaryHeap<Entry> = BinaryHeap::new();

    // 1) Unconditionally keep the anchor + its ancestor spine (anchors context),
    //    AND seed the queue from each spine node so the ripple can reach the
    //    focus's "uncles" (the ancestors' other children / sibling subtrees).
    //    Without seeding off the spine, the ripple would be trapped inside the
    //    anchor's own subtree + immediate siblings.
    //
    //    Two passes are required: first mark the WHOLE spine as seen+kept, then
    //    seed neighbors. Otherwise seeding off the anchor would mark its parent
    //    `seen`, and the next spine step would skip keeping that parent.
    let mut spine: Vec<usize> = Vec::new();
    let mut cur = Some(anchor_idx);
    while let Some(i) = cur {
        spine.push(i);
        seen.insert(i);
        kept.insert(flat[i].node.id);
        tokens += node_token_cost(flat[i].node);
        cur = flat[i].parent;
    }
    // Seed neighbors off each spine node. A spine node `hops` levels above the
    // anchor sits at Distance::up(hops); propagating off it is a direction change.
    for (hops, &i) in spine.iter().enumerate() {
        enqueue_neighbors(&flat, i, None, Distance::up(hops as u32), &mut seen, &mut heap);
    }

    // 2) Best-first until the token budget is exhausted. Greedy fill: when the
    //    highest-scoring node doesn't fit the remaining budget, skip it (it is
    //    counted as omitted) and keep trying cheaper nodes — this packs the
    //    budget rather than halting on one expensive node.
    while let Some(entry) = heap.pop() {
        let idx = entry.index;
        if entry.dist.global > budget.max_depth {
            continue; // soft depth backstop
        }
        let cost = node_token_cost(flat[idx].node);
        if tokens + cost > budget.max_tokens {
            continue; // doesn't fit — leave omitted, try the next-best node
        }
        kept.insert(flat[idx].node.id);
        tokens += cost;
        // Propagate outward; the arrival direction decides step-vs-turn so that
        // changing direction (e.g. drilling deep then going lateral) costs more.
        enqueue_neighbors(&flat, idx, Some(entry.dir), entry.dist, &mut seen, &mut heap);
    }

    let omitted = total.saturating_sub(kept.len());
    Selection { kept, omitted }
}

/// Enqueue the parent / prev-sibling / next-sibling / children of `idx`, each
/// scored, skipping anything already seen. `arrived_via` is how we reached
/// `idx` (`None` when seeding off the anchor/spine); `from_dist` is `idx`'s
/// distance. Continuing a direction is a `.step()`; changing it is a `.turn()`
/// (resets local distance, so the global-distance penalty starts to bite).
fn enqueue_neighbors(
    flat: &[Flat<'_>],
    idx: usize,
    arrived_via: Option<Direction>,
    from_dist: Distance,
    seen: &mut HashSet<usize>,
    heap: &mut BinaryHeap<Entry>,
) {
    // Parent.
    if let Some(p) = flat[idx].parent {
        try_enqueue(flat, p, Direction::Parent, arrived_via, from_dist, seen, heap);
    }
    // Siblings (immediate prev/next; the rest are reached transitively).
    if let Some(p) = flat[idx].parent {
        let pos = flat[idx].pos_in_parent;
        if pos > 0 {
            let prev = flat[p].children[pos - 1];
            try_enqueue(flat, prev, Direction::PrevSibling, arrived_via, from_dist, seen, heap);
        }
        if pos + 1 < flat[p].children.len() {
            let next = flat[p].children[pos + 1];
            try_enqueue(flat, next, Direction::NextSibling, arrived_via, from_dist, seen, heap);
        }
    }
    // Children (iterate by index to avoid cloning the child-index vec).
    for k in 0..flat[idx].children.len() {
        let c = flat[idx].children[k];
        try_enqueue(flat, c, Direction::Child, arrived_via, from_dist, seen, heap);
    }
}

fn try_enqueue(
    flat: &[Flat<'_>],
    target: usize,
    dir: Direction,
    arrived_via: Option<Direction>,
    from_dist: Distance,
    seen: &mut HashSet<usize>,
    heap: &mut BinaryHeap<Entry>,
) {
    if !seen.insert(target) {
        return; // already enqueued or kept
    }
    // Continuing the same direction → step; changing direction → turn. Siblings
    // count as the same "lateral" direction (prev↔next don't re-turn each other).
    let continued = match (arrived_via, dir) {
        (Some(a), d) if a == d => true,
        (Some(Direction::PrevSibling), Direction::NextSibling)
        | (Some(Direction::NextSibling), Direction::PrevSibling) => true,
        _ => false,
    };
    let dist = if continued { from_dist.step() } else { from_dist.turn() };
    let s = score(flat[target].node, dir, dist);
    heap.push(Entry { score: s, index: target, dir, dist });
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
    fn token_budget_caps_selection_and_counts_omitted() {
        let mut kids = vec![node(2, Role::Edit, "anchor")];
        for i in 0..20u32 {
            kids.push(node(10 + i, Role::Text, "some text here that costs tokens"));
        }
        let total = 1 + kids.len();
        let root = with_children(node(1, Role::Window, "win"), kids);

        let budget = Budget { max_tokens: 40, max_depth: 16 };
        let sel = select(&root, Some(2), &budget);

        assert!(sel.kept.contains(&2), "anchor must always be kept");
        assert!(sel.kept.contains(&1), "anchor's parent (spine) must be kept");
        assert!(sel.kept.len() < total, "budget must omit something");
        assert_eq!(sel.omitted, total - sel.kept.len(), "omitted accounting");
    }

    #[test]
    fn anchor_and_ancestor_spine_always_kept() {
        let anchor = node(4, Role::Edit, "deep anchor");
        let mid = with_children(node(3, Role::Group, ""), vec![anchor]);
        let mid2 = with_children(node(2, Role::Pane, ""), vec![mid]);
        let root = with_children(node(1, Role::Window, "win"), vec![mid2]);

        let budget = Budget { max_tokens: 1, max_depth: 16 };
        let sel = select(&root, Some(4), &budget);

        for id in [1, 2, 3, 4] {
            assert!(sel.kept.contains(&id), "spine id {id} must be kept");
        }
    }

    #[test]
    fn sibling_pulled_before_deep_descendant() {
        let grandchild = node(100, Role::Text, "deep grandchild text");
        let child = with_children(node(50, Role::Group, ""), vec![grandchild]);
        let anchor = with_children(node(2, Role::Edit, "anchor"), vec![child]);
        let sibling = node(3, Role::Text, "sibling text");
        let root = with_children(node(1, Role::Window, "win"), vec![anchor, sibling]);

        // Spine (root 3 + anchor 4 = 7) + sibling (6) = 13.
        let budget = Budget { max_tokens: 13, max_depth: 16 };
        let sel = select(&root, Some(2), &budget);

        assert!(sel.kept.contains(&3), "immediate sibling selected early");
        assert!(!sel.kept.contains(&100), "deep grandchild loses to the sibling");
    }

    #[test]
    fn node_token_cost_grows_with_text() {
        let short = node(1, Role::Text, "hi");
        let long = node(2, Role::Text, &"x".repeat(400));
        assert!(node_token_cost(&long) > node_token_cost(&short));
    }

    #[test]
    fn direction_change_is_penalized_vs_straight_line() {
        // A node reached by drilling deep then turning lateral should rank below
        // a node reached by going lateral directly from the anchor.
        let lateral_after_deep = node(4, Role::Text, "buried text");
        let deep = with_children(node(3, Role::Group, ""), vec![lateral_after_deep]);
        let anchor = with_children(node(2, Role::Edit, "anchor"), vec![deep]);
        let direct_sibling = node(5, Role::Text, "near text");
        let root = with_children(node(1, Role::Window, "win"), vec![anchor, direct_sibling]);

        let budget = Budget { max_tokens: 13, max_depth: 16 };
        let sel = select(&root, Some(2), &budget);
        assert!(sel.kept.contains(&5), "direct sibling beats deep-then-lateral");
        assert!(!sel.kept.contains(&4), "deep-then-lateral is penalized out");
    }

    #[test]
    fn ripple_reaches_focus_uncle_through_ancestor() {
        // The key regression for the "ripple can't pass the ancestor" bug:
        //
        //   root(1)
        //     toolbar(2)            <- uncle container (parent's sibling)
        //       saveBtn(3)          <- the node we must be able to reach
        //     editorPane(4)
        //       input(5) [anchor]
        //
        // The Save button (3) lives in the anchor's *parent's sibling* subtree.
        // A ripple trapped in the anchor's own subtree + siblings would never
        // reach it; seeding off the spine must make it reachable.
        let save = node(3, Role::Button, "Save");
        let toolbar = with_children(node(2, Role::Group, ""), vec![save]);
        let input = node(5, Role::Edit, "input");
        let editor = with_children(node(4, Role::Pane, ""), vec![input]);
        let root = with_children(node(1, Role::Window, "win"), vec![toolbar, editor]);

        let budget = Budget { max_tokens: 10_000, max_depth: 16 };
        let sel = select(&root, Some(5), &budget);
        assert!(
            sel.kept.contains(&3),
            "the focus's uncle (toolbar Save button) must be reachable"
        );
    }

    #[test]
    fn select_is_deterministic() {
        let kids = (0..10u32).map(|i| node(10 + i, Role::Text, "txt")).collect();
        let root = with_children(node(1, Role::Window, "win"), kids);
        let budget = Budget { max_tokens: 30, max_depth: 16 };
        let a = select(&root, None, &budget);
        let b = select(&root, None, &budget);
        assert_eq!(a.kept, b.kept, "selection must be deterministic");
    }
}
