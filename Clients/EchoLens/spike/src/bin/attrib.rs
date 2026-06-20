//! 归因实验：到底慢在「遍历结构」还是「读属性」？
//! 并测试 element_from_point（光标命中）——这才是真实产品的入口。

use std::time::Instant;
use std::collections::VecDeque;
use uiautomation::{UIAutomation, UIElement};
use uiautomation::types::Point;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== 归因实验：结构 vs 属性 ===\n");

    let automation = UIAutomation::new()?;
    let walker = automation.get_control_view_walker()?;

    // —— 真实入口：抓屏幕中心点下的元素（模拟「光标位置」）——
    let t = Instant::now();
    let point = Point::new(750, 400);
    let hit = automation.element_from_point(point)?;
    println!("[入口] element_from_point((750,400)): {:?}  ({:?})",
        truncate(&hit.get_name().unwrap_or_default(), 40), t.elapsed());

    // 找这个点所在的顶层窗口
    let mut top = hit.clone();
    loop {
        match walker.get_parent(&top) {
            Ok(p) => { if walker.get_parent(&p).is_err() { break; } top = p; }
            Err(_) => break,
        }
    }
    let win_name = top.get_name().unwrap_or_default();
    println!("[窗口] {:?}\n", truncate(&win_name, 50));

    // —— 实验 1：只遍历结构，不读属性 ——
    let t1 = Instant::now();
    let n1 = bfs(&walker, &top, 150, 12, false);
    println!("[1] 只遍历结构(不读属性):     {} 节点, {:?}", n1, t1.elapsed());

    // —— 实验 2：遍历 + 读属性 ——
    let t2 = Instant::now();
    let n2 = bfs(&walker, &top, 150, 12, true);
    println!("[2] 遍历 + 读 name/type/rect:  {} 节点, {:?}", n2, t2.elapsed());

    // —— 实验 3：第二次跑实验2（COM 预热后）——
    let t3 = Instant::now();
    let n3 = bfs(&walker, &top, 150, 12, true);
    println!("[3] 同上(预热后第2次):         {} 节点, {:?}", n3, t3.elapsed());

    // —— 实验 4：只读属性的单次成本 ——
    let t4 = Instant::now();
    for _ in 0..100 { let _ = top.get_name(); }
    println!("[4] get_name x100:             {:?} (单次 {:?})",
        t4.elapsed(), t4.elapsed() / 100);

    println!("\n=== 解读 ===");
    println!("若 [1] 远小于 [2]：瓶颈是读属性(IPC)，CacheRequest 方向本应对");
    println!("若 [1] 约等于 [2]：瓶颈是 TreeWalker 导航本身(每次 get_child 也是 IPC)");
    Ok(())
}

fn bfs(
    walker: &uiautomation::UITreeWalker,
    root: &UIElement,
    max_nodes: usize,
    max_depth: usize,
    read_props: bool,
) -> usize {
    let mut queue: VecDeque<(UIElement, usize)> = VecDeque::new();
    queue.push_back((root.clone(), 0));
    let mut visited = 0usize;
    let mut sink = 0i32;
    while let Some((el, depth)) = queue.pop_front() {
        if visited >= max_nodes { break; }
        visited += 1;
        if read_props {
            let _ = el.get_name();
            let _ = el.get_control_type();
            if let Ok(r) = el.get_bounding_rectangle() { sink = sink.wrapping_add(r.get_left()); }
        }
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
