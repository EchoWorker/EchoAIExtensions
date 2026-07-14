//! Windows UI Automation capture (the only platform-specific module in M1).
//!
//! Recipe proven by the spike (see `../../spike/`): one `build_updated_cache`
//! call pulls a whole subtree (structure + properties) into local memory, then
//! `get_cached_*` recursion is free of cross-process COM IPC (~48ms / 150 nodes).
//!
//! M1 anchors via `get_focused_element()` + walker walk-up, deliberately NOT
//! depending on the `windows` crate (GetForegroundWindow / DWM). The shell layer
//! (M2) will add a precise foreground-window path; until then `Window` scope is
//! captured the same way as `Focus` (the focused element's top-level window),
//! which is correct for the "press hotkey while looking at an app" case.

use uiautomation::controls::ControlType;
use uiautomation::core::UICacheRequest;
use uiautomation::types::{TreeScope, UIProperty};
use uiautomation::{UIAutomation, UIElement, UITreeWalker};

use crate::capture::{CaptureResult, Scope, VisualSource};
use crate::error::PerceptionError;
use crate::model::{Rect, Role, VisualNode};

/// Windows screen perception source.
pub struct WindowsSource {
    automation: UIAutomation,
    walker: UITreeWalker,
}

impl WindowsSource {
    pub fn new() -> Result<Self, PerceptionError> {
        let automation = UIAutomation::new()?;
        // ControlView walker filters out most decorative/raw nodes for free.
        let walker = automation.get_control_view_walker()?;
        Ok(WindowsSource { automation, walker })
    }

    /// Build the one-shot cache request: a single COM call caches the whole
    /// subtree's structure + the properties we read locally afterwards.
    fn cache_request(&self) -> Result<UICacheRequest, PerceptionError> {
        let req = self.automation.create_cache_request()?;
        req.add_property(UIProperty::Name)?;
        req.add_property(UIProperty::ControlType)?;
        req.add_property(UIProperty::BoundingRectangle)?;
        req.add_property(UIProperty::RuntimeId)?;
        req.add_property(UIProperty::IsPassword)?;
        req.set_tree_scope(TreeScope::Subtree)?;
        Ok(req)
    }

    /// Walk up to the top-level window from any element (spike's proven method).
    fn top_window(&self, from: &UIElement) -> UIElement {
        let mut top = from.clone();
        while let Ok(parent) = self.walker.get_parent(&top) {
            // The desktop root has no parent; stop one level below it.
            if self.walker.get_parent(&parent).is_err() {
                break;
            }
            top = parent;
        }
        top
    }

    /// Focus / Window scope (M1: same path) — focused element's top-level window.
    fn capture_focus_or_window(&self) -> Result<CaptureResult, PerceptionError> {
        let focused = self
            .automation
            .get_focused_element()
            .map_err(|_| PerceptionError::NothingToCapture)?;
        let focus_runtime = focused.get_runtime_id().unwrap_or_default();

        let window = self.top_window(&focused);
        let req = self.cache_request()?;
        // One COM round-trip caches the entire subtree.
        let cached_root = window.build_updated_cache(&req)?;

        let mut idgen = IdGen::default();
        // Track which generated id corresponds to the focused runtime id.
        let mut anchor_id: Option<u32> = None;
        let root = convert_cached(&cached_root, &mut idgen, &focus_runtime, &mut anchor_id);

        Ok(CaptureResult { root, anchor_id })
    }

    /// Screen scope — a shallow overview of all top-level windows. Each window
    /// is cached with a `Children`-scoped request (one COM call per window for
    /// its own props + direct children), then converted one level deep. This
    /// answers "what's on my screen" without the cost of full subtrees.
    fn capture_screen(&self) -> Result<CaptureResult, PerceptionError> {
        let root_el = self.automation.get_root_element()?;
        let req = self.shallow_cache_request()?;
        let mut idgen = IdGen::default();
        let mut children = Vec::new();

        if let Ok(first) = self.walker.get_first_child(&root_el) {
            let mut cur = first;
            loop {
                // Cache window + its direct children in one COM call.
                if let Ok(cached) = cur.build_updated_cache(&req) {
                    children.push(convert_shallow(&cached, &mut idgen, 1));
                }
                match self.walker.get_next_sibling(&cur) {
                    Ok(next) => cur = next,
                    Err(_) => break,
                }
            }
        }

        let root = VisualNode {
            id: idgen.next(),
            role: Role::Other,
            name: "Desktop".to_string(),
            rect: Rect::default(),
            children,
        };
        Ok(CaptureResult { root, anchor_id: None })
    }

    /// Shallow cache request (element + direct children) for the screen overview.
    fn shallow_cache_request(&self) -> Result<UICacheRequest, PerceptionError> {
        let req = self.automation.create_cache_request()?;
        req.add_property(UIProperty::Name)?;
        req.add_property(UIProperty::ControlType)?;
        req.add_property(UIProperty::BoundingRectangle)?;
        req.set_tree_scope(TreeScope::Children)?;
        Ok(req)
    }
}

impl VisualSource for WindowsSource {
    fn capture(&self, scope: Scope) -> Result<CaptureResult, PerceptionError> {
        match scope {
            Scope::Focus | Scope::Window => self.capture_focus_or_window(),
            Scope::Screen => self.capture_screen(),
        }
    }
}

/// Recursively convert a cached UIA subtree into an owned `VisualNode` tree.
/// Pure local `get_cached_*` reads — no COM IPC (the focus RuntimeId match also
/// reads from the cache). While converting, if a node's runtime id matches
/// `focus_runtime`, record its generated id as the anchor.
fn convert_cached(
    el: &UIElement,
    idgen: &mut IdGen,
    focus_runtime: &[i32],
    anchor_id: &mut Option<u32>,
) -> VisualNode {
    let id = idgen.next();
    let role = map_role(el.get_cached_control_type().unwrap_or(ControlType::Custom));

    // Password fields: never leak content/name to the LLM (PRIVACY, docs §6).
    // Password content only exists on Edit controls, so only pay for the extra
    // property read there — skipping it for the other (usually hundreds of)
    // nodes keeps capture fast.
    let is_password = matches!(role, Role::Edit)
        && el
            .get_cached_property_value(UIProperty::IsPassword)
            .ok()
            .and_then(|v| v.try_into().ok())
            .unwrap_or(false);
    let name = if is_password {
        String::new()
    } else {
        el.get_cached_name().unwrap_or_default()
    };

    let rect = el.get_cached_bounding_rectangle().map(to_rect).unwrap_or_default();

    // Record the anchor if this element's runtime id matches the focused one.
    // Read the RuntimeId from the *cache* (added to the cache request), so this
    // stays a pure local read — no per-node cross-process COM call.
    if anchor_id.is_none() && !focus_runtime.is_empty() {
        let rid = el
            .get_cached_property_value(UIProperty::RuntimeId)
            .ok()
            .map(|v| variant_to_i32_vec(&v))
            .unwrap_or_default();
        if rid == focus_runtime {
            *anchor_id = Some(id);
        }
    }

    let mut node = VisualNode { id, role, name, rect, children: Vec::new() };
    if let Ok(children) = el.get_cached_children() {
        for c in &children {
            node.children.push(convert_cached(c, idgen, focus_runtime, anchor_id));
        }
    }
    node
}

/// Convert a cached element shallowly (used by Screen scope): self + cached
/// children down to `depth` levels. Children beyond the cache scope are absent.
fn convert_shallow(el: &UIElement, idgen: &mut IdGen, depth: u32) -> VisualNode {
    let role = map_role(el.get_cached_control_type().unwrap_or(ControlType::Custom));
    let name = el.get_cached_name().unwrap_or_default();
    let rect = el.get_cached_bounding_rectangle().map(to_rect).unwrap_or_default();
    let mut node = VisualNode::new(idgen.next(), role, name, rect);
    if depth > 0 {
        if let Ok(children) = el.get_cached_children() {
            for c in &children {
                node.children.push(convert_shallow(c, idgen, depth - 1));
            }
        }
    }
    node
}

/// Normalize a UIA `ControlType` to our cross-platform [`Role`].
fn map_role(t: ControlType) -> Role {
    match t {
        ControlType::Window => Role::Window,
        ControlType::Pane => Role::Pane,
        ControlType::Group => Role::Group,
        ControlType::Text => Role::Text,
        ControlType::Edit => Role::Edit,
        ControlType::Document => Role::Document,
        ControlType::Button => Role::Button,
        ControlType::Hyperlink => Role::Link,
        ControlType::List => Role::List,
        ControlType::ListItem => Role::ListItem,
        ControlType::Tab => Role::Tab,
        ControlType::TabItem => Role::TabItem,
        ControlType::MenuItem => Role::MenuItem,
        ControlType::CheckBox => Role::CheckBox,
        ControlType::Image => Role::Image,
        ControlType::Table | ControlType::DataGrid => Role::Table,
        ControlType::DataItem => Role::Row,
        _ => Role::Other,
    }
}

fn to_rect(r: uiautomation::types::Rect) -> Rect {
    Rect { x: r.get_left(), y: r.get_top(), w: r.get_width(), h: r.get_height() }
}

/// Extract a `Vec<i32>` (a UIA RuntimeId) from a cached `Variant`, or empty on
/// any mismatch. Reads the already-cached value — no COM round-trip.
fn variant_to_i32_vec(v: &uiautomation::variants::Variant) -> Vec<i32> {
    use uiautomation::variants::Value;
    match v.get_value() {
        Ok(Value::ArrayI4(arr)) => arr,
        _ => Vec::new(),
    }
}

/// Monotonic id generator — stable within a single capture (not the OS
/// RuntimeId, which is reused after element destruction).
#[derive(Default)]
struct IdGen(u32);
impl IdGen {
    fn next(&mut self) -> u32 {
        self.0 += 1;
        self.0
    }
}
