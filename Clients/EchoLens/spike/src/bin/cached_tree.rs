//! 终极验证：cache「子节点结构」而非属性
//! 归因实验证明大头是 TreeWalker 导航(57%)。正确解法是用 CacheRequest
//! 缓存 children 结构 + 属性，然后纯本地 get_cached_children 递归，零导航 IPC。

use std::time::Instant;
use std::collections::VecDeque;
use uiautomation::{UIAutomation, UIElement};
use uiautomation::types::{TreeScope, UIProperty, Point};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== 终极验证：cache 子树结构 ===\n");

    let automation = UIAutomation::new()?;
    let walker = automation.get_control_view_walker()?;

    let hit = automation.element_from_point(Point::new(750, 400))?;
    let mut top = hit.clone();
    loop {
        match walker.get_parent(&top) {
            Ok(p) => { if walker.get_parent(&p).is_err() { break; } top = p; }
            Err(_) => break,
        }
    }
    println!("窗口: {:?}\n", truncate(&top.get_name().unwrap_or_default(), 50));

    // cache request：TreeScope::Subtree + 属性 + （children 结构随 scope 自动缓存）
    let cache_req = automation.create_cache_request()?;
    cache_req.add_property(UIProperty::Name)?;
    cache_req.add_property(UIProperty::ControlType)?;
    cache_req.add_property(UIProperty::BoundingRectangle)?;
    cache_req.set_tree_scope(TreeScope::Subtree)?;

    // —— 方式 C：build_updated_cache 缓存整棵子树，再用 get_cached_children 递归 ——
    for _ in 0..2 {
        let t = Instant::now();
        let cached_root = top.build_updated_cache(&cache_req)?;
        let t_build = t.elapsed();

        let mut count = 0usize;
        let mut sink = 0i32;
        walk_cached(&cached_root, 150, &mut count, &mut sink);
        let t_total = t.elapsed();

        let status = if t_total.as_millis() < 100 { "✅" } else { "⚠️" };
        println!("{} build_updated_cache + 本地递归: {} 节点, build {:?}, 总 {:?}",
            status, count, t_build, t_total);
    }

    // 对照：实时 bounded BFS（150 上限）
    let t = Instant::now();
    let n = bfs_live(&walker, &top, 150, 12);
    println!("   对照 实时BFS:                   {} 节点, {:?}", n, t.elapsed());

    Ok(())
}

/// 纯本地递归已缓存的树（get_cached_children 不走 IPC）
fn walk_cached(el: &UIElement, max: usize, count: &mut usize, sink: &mut i32) {
    if *count >= max { return; }
    *count += 1;
    let _ = el.get_cached_name();
    let _ = el.get_cached_control_type();
    if let Ok(r) = el.get_cached_bounding_rectangle() { *sink = sink.wrapping_add(r.get_left()); }
    if let Ok(children) = el.get_cached_children() {
        for c in &children {
            if *count >= max { break; }
            walk_cached(c, max, count, sink);
        }
    }
}

fn bfs_live(walker: &uiautomation::UITreeWalker, root: &UIElement, max_nodes: usize, max_depth: usize) -> usize {
    let mut queue: VecDeque<(UIElement, usize)> = VecDeque::new();
    queue.push_back((root.clone(), 0));
    let mut visited = 0usize;
    let mut sink = 0i32;
    while let Some((el, depth)) = queue.pop_front() {
        if visited >= max_nodes { break; }
        visited += 1;
        let _ = el.get_name();
        let _ = el.get_control_type();
        if let Ok(r) = el.get_bounding_rectangle() { sink = sink.wrapping_add(r.get_left()); }
        if depth < max_depth {
            if let Ok(child) = walker.get_first_child(&el) {
                let mut cur = child;
                loop {
                    queue.push_back((cur.clone(), depth + 1));
                    match walker.get_next_sibling(&cur) { Ok(next) => cur = next, Err(_) => break }
                }
            }
        }
    }
    let _ = sink;
    visited
}

fn truncate(s: &str, max: usize) -> String {
    let s = s.replace('\n', " ").replace('\r', "");
    if s.chars().count() <= max { s } else {
        let t: String = s.chars().take(max).collect();
        format!("{}…", t)
    }
}
