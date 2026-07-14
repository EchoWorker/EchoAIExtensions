//! Serialize the selected subtree into compact XML for the LLM.
//!
//! Only nodes present in the [`Selection`] are emitted. Textual leaves render as
//! `<text>content</text>` (cheaper than attributes); other nodes carry a `name`
//! attribute and an `id` for later "expand this element" tool calls. Where a
//! node has children that were dropped by the budget, an omission comment is
//! emitted so the LLM knows more detail is available.

use crate::builder::traversal::Selection;
use crate::model::{Role, VisualNode};

/// Render `root` (filtered by `sel`) to compact XML. A trailing summary comment
/// reports `sel.omitted` (the global count of dropped nodes).
pub(crate) fn to_xml(root: &VisualNode, sel: &Selection) -> String {
    let mut out = String::new();
    write_node(&mut out, root, sel, 0);
    if sel.omitted > 0 {
        out.push_str(&format!(
            "<!-- {} more elements omitted; ask to expand a specific element by id -->\n",
            sel.omitted
        ));
    }
    out
}

fn write_node(out: &mut String, node: &VisualNode, sel: &Selection, depth: usize) {
    if !sel.contains(node.id) {
        return;
    }
    let indent = "  ".repeat(depth);
    let has_kept_child = node.children.iter().any(|c| sel.contains(c.id));

    // Textual leaf → <text>content</text>.
    if node.role.is_textual() && !node.name.is_empty() && !has_kept_child {
        out.push_str(&format!("{indent}<text>{}</text>\n", xml_escape(&node.name)));
        return;
    }

    let tag = role_tag(node.role);
    let name_attr = if node.name.is_empty() {
        String::new()
    } else {
        format!(" name=\"{}\"", xml_escape(&node.name))
    };

    if has_kept_child {
        out.push_str(&format!("{indent}<{tag}{name_attr} id=\"{}\">\n", node.id));
        for c in &node.children {
            write_node(out, c, sel, depth + 1);
        }
        // If this node had children but some weren't kept, hint that it can expand.
        if node.children.iter().any(|c| !sel.contains(c.id)) {
            out.push_str(&format!("{indent}  <!-- some children of id={} omitted -->\n", node.id));
        }
        out.push_str(&format!("{indent}</{tag}>\n"));
    } else {
        // Leaf (or all children dropped) → self-closing tag.
        out.push_str(&format!("{indent}<{tag}{name_attr} id=\"{}\"/>\n", node.id));
    }
}

/// Map a [`Role`] to its XML tag name.
fn role_tag(r: Role) -> &'static str {
    match r {
        Role::Window => "window",
        Role::Button => "button",
        Role::Link => "link",
        Role::Edit => "edit",
        Role::Tab | Role::TabItem => "tab",
        Role::List => "list",
        Role::ListItem => "item",
        Role::Group | Role::Pane => "group",
        Role::Image => "image",
        Role::Table => "table",
        Role::Row => "row",
        Role::Cell => "cell",
        Role::MenuItem => "menuitem",
        Role::CheckBox => "checkbox",
        Role::Text | Role::Document => "text",
        Role::Other => "node",
    }
}

/// Escape the five XML special characters in attribute/text content, and
/// collapse control chars to spaces to keep the output single-line-per-node.
fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c if c.is_control() => out.push(' '),
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builder::traversal::{select, Budget};
    use crate::model::Rect;

    fn node(id: u32, role: Role, name: &str) -> VisualNode {
        VisualNode::new(id, role, name, Rect::new(0, 0, 10, 10))
    }
    fn with_children(mut n: VisualNode, children: Vec<VisualNode>) -> VisualNode {
        n.children = children;
        n
    }

    #[test]
    fn serializes_kept_tree_with_ids_and_text_leaves() {
        let kids = vec![
            node(2, Role::Button, "OK"),
            node(3, Role::Text, "Summary"),
            node(4, Role::Image, "logo"),
        ];
        let root = with_children(node(1, Role::Window, "Release"), kids);
        let budget = Budget { max_tokens: 10_000, max_depth: 16 };
        let sel = select(&root, None, &budget);
        let xml = to_xml(&root, &sel);

        assert!(xml.contains("<window"), "root window tag present");
        assert!(xml.contains("name=\"Release\""), "window name present");
        assert!(xml.contains("<button"), "button rendered");
        assert!(xml.contains("<text>Summary</text>"), "text leaf rendered inline");
        assert!(xml.contains("id=\""), "elements carry ids");
    }

    #[test]
    fn emits_omitted_comment_when_budget_drops_nodes() {
        let mut kids = vec![node(2, Role::Edit, "anchor")];
        for i in 0..30u32 {
            kids.push(node(10 + i, Role::Text, "lots of text content here"));
        }
        let root = with_children(node(1, Role::Window, "win"), kids);
        let budget = Budget { max_tokens: 30, max_depth: 16 };
        let sel = select(&root, Some(2), &budget);
        let xml = to_xml(&root, &sel);
        assert!(sel.omitted > 0, "budget should drop nodes");
        assert!(xml.contains("omitted"), "omission comment should appear");
    }

    #[test]
    fn xml_escape_handles_all_specials() {
        let out = xml_escape(r#"<a> & "b" 'c'"#);
        assert!(out.contains("&lt;"));
        assert!(out.contains("&gt;"));
        assert!(out.contains("&amp;"));
        assert!(out.contains("&quot;"));
        assert!(out.contains("&apos;"));
        assert!(!out.contains('<'), "no raw < should remain");
    }

    #[test]
    fn xml_escape_collapses_control_chars() {
        let out = xml_escape("line1\nline2\tend");
        assert!(!out.contains('\n'), "newlines collapsed");
        assert!(!out.contains('\t'), "tabs collapsed");
    }

    #[test]
    fn role_tag_covers_representative_roles() {
        assert_eq!(role_tag(Role::Window), "window");
        assert_eq!(role_tag(Role::Button), "button");
        assert_eq!(role_tag(Role::Other), "node");
    }
}
