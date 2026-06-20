//! CacheRequest 性能对比 —— 验证能否把单窗口遍历压到 100ms 内
//!
//! 关键修正：不抓整个 Desktop（那不真实），而是遍历桌面下每个顶层窗口，
//! 对每个窗口分别用 A/B 两种方式测，看真实单窗口场景的表现。
//!
//! 方式 A（旧）: TreeWalker 逐节点 + 实时取属性，每属性一次跨进程 COM IPC
//! 方式 B（新）: find_all_build_cache(Subtree) 一次 COM 调用预取整棵子树+属性

use std::time::Instant;
use uiautomation::{UIAutomation, UIElement};
use uiautomation::types::{TreeScope, UIProperty};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== CacheRequest 单窗口性能对比 ===\n");

    let automation = UIAutomation::new()?;
    let walker = automation.get_control_view_walker()?;
    let root = automation.get_root_element()?;

    // 预先建好 cache request（可复用）
    let cache_req = automation.create_cache_request()?;
    cache_req.add_property(UIProperty::Name)?;
    cache_req.add_property(UIProperty::ControlType)?;
    cache_req.add_property(UIProperty::BoundingRectangle)?;
    cache_req.set_tree_scope(TreeScope::Subtree)?;
    let condition = automation.create_true_condition()?;

    println!("{:<42} {:>7} {:>11} {:>11} {:>8}", "窗口", "节点", "A实时", "B缓存", "加速");
    println!("{}", "-".repeat(82));

    // 遍历每个顶层窗口
    let mut win = match walker.get_first_child(&root) {
        Ok(w) => w,
        Err(e) => { println!("无法取顶层窗口: {e}"); return Ok(()); }
    };
    let mut total_a = std::time::Duration::ZERO;
    let mut total_b = std::time::Duration::ZERO;
    loop {
        let name = top_name(&win);

        // 方式 A：实时遍历
        let ta = Instant::now();
        let mut count_a = 0usize;
        let mut sink = 0i32;
        let _ = walk_live(&walker, &win, 0, 50, &mut count_a, &mut sink);
        let ea = ta.elapsed();

        // 方式 B：CacheRequest 预取
        let tb = Instant::now();
        let count_b = match win.find_all_build_cache(TreeScope::Subtree, &condition, &cache_req) {
            Ok(els) => {
                let mut s = 0i32;
                for el in &els {
                    let _ = el.get_cached_name();
                    let _ = el.get_cached_control_type();
                    if let Ok(r) = el.get_cached_bounding_rectangle() { s = s.wrapping_add(r.get_left()); }
                }
                let _ = s;
                els.len()
            }
            Err(_) => 0,
        };
        let eb = tb.elapsed();

        // 只显示有内容的窗口（>5 节点）
        if count_a > 5 {
            let speed = if eb.as_secs_f64() > 0.0 { ea.as_secs_f64() / eb.as_secs_f64() } else { 0.0 };
            println!("{:<42} {:>7} {:>11} {:>11} {:>7.1}x",
                truncate(&name, 40), count_a,
                format!("{:?}", ea), format!("{:?}", eb), speed);
            total_a += ea;
            total_b += eb;
        }

        match walker.get_next_sibling(&win) {
            Ok(next) => win = next,
            Err(_) => break,
        }
    }

    println!("{}", "-".repeat(82));
    println!("合计 A 实时: {:?}   B 缓存: {:?}", total_a, total_b);
    if total_b.as_secs_f64() > 0.0 {
        println!("总体加速: {:.1}x", total_a.as_secs_f64() / total_b.as_secs_f64());
    }
    Ok(())
}

fn top_name(el: &UIElement) -> String {
    el.get_name().unwrap_or_default()
}

fn walk_live(
    walker: &uiautomation::UITreeWalker,
    element: &UIElement,
    depth: usize,
    max_depth: usize,
    count: &mut usize,
    sink: &mut i32,
) -> Result<(), Box<dyn std::error::Error>> {
    if depth > max_depth { return Ok(()); }
    *count += 1;
    let _ = element.get_name();
    let _ = element.get_control_type();
    if let Ok(r) = element.get_bounding_rectangle() { *sink = sink.wrapping_add(r.get_left()); }
    if let Ok(child) = walker.get_first_child(element) {
        let mut cur = child;
        loop {
            walk_live(walker, &cur, depth + 1, max_depth, count, sink)?;
            match walker.get_next_sibling(&cur) {
                Ok(next) => cur = next,
                Err(_) => break,
            }
        }
    }
    Ok(())
}

fn truncate(s: &str, max: usize) -> String {
    let s = s.replace('\n', " ").replace('\r', "");
    if s.chars().count() <= max { s } else {
        let t: String = s.chars().take(max).collect();
        format!("{}…", t)
    }
}
