//! Element scoring for best-first context building.
//!
//! Borrowed (in spirit, not code) from Everywhere's `VisualContextBuilder`:
//! - four propagation directions (parent / prev-sibling / next-sibling / child),
//! - a dual distance (global from the anchor, local from the current origin),
//! - sibling directions do NOT multiply by type weight (otherwise a low-weight
//!   sibling would block enumeration of the siblings after it).
//!
//! Scoring is purely topological (tree hops + role weight). We deliberately do
//! NOT factor in screen geometry: UIA bounding rectangles are unreliable
//! (containers often report invalid rects while their children are valid), and
//! tree topology already approximates spatial adjacency well. If geometric
//! scoring is ever needed it should be added deliberately, with tests.

use crate::model::VisualNode;

/// Dual distance, preventing "change direction then drill forever".
/// `global` accumulates across direction changes (overall penalty);
/// `local` resets to 1 on a direction change, accumulates within a direction.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Distance {
    pub global: u32,
    pub local: u32,
}

impl Distance {
    /// A node reached by `hops` parent-steps up the ancestor spine (same
    /// direction the whole way, so global == local == hops). `up(0)` is the
    /// anchor itself (distance zero).
    pub fn up(hops: u32) -> Self {
        Distance { global: hops, local: hops }
    }

    /// Continue in the same direction: both counters advance.
    pub fn step(self) -> Self {
        Distance { global: self.global + 1, local: self.local + 1 }
    }

    /// Change direction: global keeps growing, local resets to 1.
    pub fn turn(self) -> Self {
        Distance { global: self.global + 1, local: 1 }
    }
}

/// Propagation direction relative to the node we just dequeued.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Direction {
    Parent,
    PrevSibling,
    NextSibling,
    Child,
}

impl Direction {
    /// Base topology score: siblings most relevant (same-level context), then
    /// parent, then child. Magnitudes mirror Everywhere's production values.
    pub fn base_score(self) -> f32 {
        match self {
            Direction::PrevSibling | Direction::NextSibling => 10_000.0,
            Direction::Parent => 2_000.0,
            Direction::Child => 1_000.0,
        }
    }

    pub fn is_sibling(self) -> bool {
        matches!(self, Direction::PrevSibling | Direction::NextSibling)
    }
}

/// Score a node reached via `dir` at distance `dist`.
///
/// `topology = base / local − (global − local)`; then multiply by type weight
/// **only** for parent/child directions (siblings keep the raw topology so a
/// low-weight sibling can't truncate the sibling scan).
///
/// Higher score = more relevant = selected earlier.
pub(crate) fn score(node: &VisualNode, dir: Direction, dist: Distance) -> f32 {
    let local = dist.local.max(1) as f32;
    let global_penalty = dist.global.saturating_sub(dist.local) as f32;
    let topology = dir.base_score() / local - global_penalty;
    if dir.is_sibling() {
        topology
    } else {
        topology * node.role.weight()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Rect, Role};

    fn n(role: Role) -> VisualNode {
        VisualNode::new(1, role, "x", Rect::new(0, 0, 10, 10))
    }

    #[test]
    fn sibling_outranks_child_at_same_distance() {
        let d = Distance::up(0).step();
        let s_sib = score(&n(Role::Text), Direction::NextSibling, d);
        let s_child = score(&n(Role::Text), Direction::Child, d);
        assert!(s_sib > s_child, "sibling {s_sib} should outrank child {s_child}");
    }

    #[test]
    fn parent_child_scoring_respects_type_weight() {
        let d = Distance::up(0).step();
        let s_text = score(&n(Role::Text), Direction::Child, d); // weight 1.0
        let s_image = score(&n(Role::Image), Direction::Child, d); // weight 0.2
        assert!(s_text > s_image, "text child should outrank image child via weight");
    }

    #[test]
    fn sibling_direction_ignores_type_weight() {
        // A weak sibling (Image) and a strong sibling (Text) at equal distance
        // must score equally — sibling scoring must NOT apply type weight, else a
        // weak sibling would truncate the sibling scan.
        let d = Distance::up(0).step();
        let s_text = score(&n(Role::Text), Direction::PrevSibling, d);
        let s_image = score(&n(Role::Image), Direction::PrevSibling, d);
        assert_eq!(s_text, s_image, "sibling scoring must ignore type weight");
    }

    #[test]
    fn closer_local_distance_scores_higher() {
        let near = Distance { global: 1, local: 1 };
        let far = Distance { global: 3, local: 3 };
        let s_near = score(&n(Role::Text), Direction::Child, near);
        let s_far = score(&n(Role::Text), Direction::Child, far);
        assert!(s_near > s_far, "nearer node should score higher");
    }

    #[test]
    fn global_distance_penalty_accrues_with_turns() {
        // The global penalty is `global − local`. Two nodes at the SAME local
        // distance (same `base/local` boost) but different global distance: the
        // one that took a longer, more-turning path (higher global) scores lower.
        // This is how "drilling deep then turning" is ultimately penalized.
        let near = Distance { global: 1, local: 1 }; // straight, penalty 0
        let far = Distance { global: 4, local: 1 }; // reached via turns, penalty 3
        let s_near = score(&n(Role::Text), Direction::Child, near);
        let s_far = score(&n(Role::Text), Direction::Child, far);
        assert!(
            s_near > s_far,
            "at equal local distance, higher global distance must score lower ({s_near} vs {s_far})"
        );
    }
}
