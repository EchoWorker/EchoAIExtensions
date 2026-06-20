//! 真正有效的优化验证：局部遍历（bounded BFS）
//!
//! 前两次发现 CacheRequest 在本 crate 反而更慢，说明方向错了。
//! Everywhere 的真实解法不是 cache，而是「根本不全量遍历」：
//!   - 从焦点元素出发，BFS 扩散
//!   - 硬上限 N 个节点（token 预算的代理）
//!   - 限制深度
//! 验证：限定 150 节点的局部遍历能否稳定 < 100ms。

use std::time::Instant;
use std::collections::VecDeque;
use uiautomation::{UIAutomation, UIElement};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== 局部遍历（bounded）性能验证 ===\n");

    let automation = UIAutomation::new()?;
    let walker = automation.get_control_view_walker()?;

    // 模拟真实使用：从焦点元素出发
    let focused = automation.get_focused_element()?;

    // 找焦点所在的顶层窗口作为遍历起点
    let mut top = focused.clone();
    loop {
        match walker.get_parent(&top) {
            Ok(p) => { if walker.get_parent(&p).is_err() { break; } top = p; }
            Err(_) => break,
        }
    }
    println!("起点窗口: {:?}\n", truncate(&top.get_name().unwrap_or_default(), 50));

    for max_nodes in [50usize, 100, 150, 200, 300] {
        // 跑 3 次取最好成绩（避开冷启动/调度抖动）
        let mut best = std::time::Duration::MAX;
        let mut got = 0usize;
        for _ in 0..3 {
            let t = Instant::now();
            let n = bounded_bfs(&walker, &top, max_nodes, 12);
            let e = t.elapsed();
            if e < best { best = e; got = n; }
        }
        let status = if best.as_millis() < 100 { "✅" } else { "⚠️" };
        println!("{} 上限 {:>3} 节点 -> 实抓 {:>3}, 最优 {:?}", status, max_nodes, got, best);
    }

    println!("\n说明：真实产品里起点是「光标下元素」，遍历范围更小更聚焦，会更快。");
    Ok(())
}

/// Bounded BFS：从 root 广度优先，最多访问 max_nodes 个节点、最深 max_depth。
/// 每个节点读 name+type+rect（真实属性开销）。
fn bounded_bfs(
    walker: &uiautomation::UITreeWalker,
    root: &UIElement,
    max_nodes: usize,
    max_depth: usize,
) -> usize {
    let mut queue: VecDeque<(UIElement, usize)> = VecDeque::new();
    queue.push_back((root.clone(), 0));
    let mut visited = 0usize;
    let mut sink = 0i32;

    while let Some((el, depth)) = queue.pop_front() {
        if visited >= max_nodes { break; }
        visited += 1;

        // 真实属性读取
        let _ = el.get_name();
        let _ = el.get_control_type();
        if let Ok(r) = el.get_bounding_rectangle() { sink = sink.wrapping_add(r.get_left()); }

        if depth < max_depth {
            if let Ok(child) = walker.get_first_child(&el) {
                let mut cur = child;
                loop {
                    queue.push_back((cur.clone(), depth + 1));
                    match walker.get_next_sibling(&cur) {
                        Ok(next) => cur = next,
                        Err(_) => break,
                    }
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
