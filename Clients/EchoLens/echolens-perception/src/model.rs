//! Platform-independent visual element model.
//!
//! The capture layer (Windows UI Automation, future macOS AX, etc.) produces a
//! tree of [`VisualNode`]s; the builder layer consumes it. A `VisualNode` holds
//! no OS/COM handles — it is pure owned data, so the builder can be unit-tested
//! with hand-written trees on any platform.

/// One UI element, lifted out of the OS accessibility tree.
#[derive(Debug, Clone)]
pub struct VisualNode {
    /// Stable id **within a single capture** (monotonic counter, not the OS
    /// RuntimeId — which is reused after an element is destroyed and therefore
    /// not stable across captures). Used by the serializer's `elementId` and,
    /// later, the LLM's "expand this omitted node" tool.
    pub id: u32,
    /// Cross-platform normalized control role.
    pub role: Role,
    /// Element name / text (may be empty; blanked for password fields).
    pub name: String,
    /// Screen-space bounding box (absolute pixels). Used for scoring distance.
    pub rect: Rect,
    /// Child nodes, in document order.
    pub children: Vec<VisualNode>,
}

impl VisualNode {
    /// Convenience constructor for tests and the capture layer.
    pub fn new(id: u32, role: Role, name: impl Into<String>, rect: Rect) -> Self {
        VisualNode { id, role, name: name.into(), rect, children: Vec::new() }
    }

    /// Total number of nodes in this subtree (including self).
    pub fn count(&self) -> usize {
        1 + self.children.iter().map(VisualNode::count).sum::<usize>()
    }

    /// Find a node by id anywhere in this subtree (depth-first).
    pub fn find(&self, id: u32) -> Option<&VisualNode> {
        if self.id == id {
            return Some(self);
        }
        self.children.iter().find_map(|c| c.find(id))
    }
}

/// Cross-platform normalized control role. Capture layers map their native
/// control types onto this; the builder scores by it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Window,
    Pane,
    Group,
    Text,
    Edit,
    Button,
    Link,
    List,
    ListItem,
    Tab,
    TabItem,
    MenuItem,
    CheckBox,
    Image,
    Table,
    Row,
    Cell,
    Document,
    Other,
}

impl Role {
    /// Type weight: text > interactive > container > image. Used by scoring for
    /// parent/child propagation (NOT for sibling propagation — see scoring.rs).
    pub fn weight(self) -> f32 {
        match self {
            Role::Text | Role::Document | Role::Cell | Role::ListItem => 1.0,
            Role::Edit
            | Role::Button
            | Role::Link
            | Role::MenuItem
            | Role::Tab
            | Role::TabItem
            | Role::CheckBox => 0.8,
            Role::List | Role::Table | Role::Row => 0.5,
            Role::Group | Role::Pane | Role::Window => 0.3,
            Role::Image => 0.2,
            Role::Other => 0.1,
        }
    }

    /// Whether this is a "pure container" — collapsible when it has no own text
    /// and a single child (see prune.rs).
    pub fn is_container(self) -> bool {
        matches!(
            self,
            Role::Group | Role::Pane | Role::Window | Role::List | Role::Table | Role::Row
        )
    }

    /// Whether this role carries inline text worth merging / emitting as `<text>`.
    pub fn is_textual(self) -> bool {
        matches!(self, Role::Text | Role::Document)
    }
}

/// Screen-space rectangle (absolute pixels).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub fn new(x: i32, y: i32, w: i32, h: i32) -> Self {
        Rect { x, y, w, h }
    }

    /// Center point (used by scoring's distance calculation).
    pub fn center(&self) -> (i32, i32) {
        (self.x + self.w / 2, self.y + self.h / 2)
    }

    /// Area (used by container-collapse heuristics).
    pub fn area(&self) -> i64 {
        self.w as i64 * self.h as i64
    }
}
