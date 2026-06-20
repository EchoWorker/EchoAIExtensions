//! UIA Spike — 验证 Rust 能否抓取 Windows 屏幕的 UI 元素树
//!
//! 验证目标：
//!   1. 能否创建 UIAutomation 实例
//!   2. 能否拿到焦点元素 / 焦点所在的顶层窗口
//!   3. 能否遍历子树，拿到每个元素的 类型/名字/包围盒
//!   4. 顺便测一下遍历整棵树要多久（性能）

use std::time::Instant;
use uiautomation::{UIAutomation, UIElement};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== UIA Spike: Windows 屏幕感知可行性验证 ===\n");

    // —— 1. 创建 UIAutomation 实例 ——
    let t0 = Instant::now();
    let automation = UIAutomation::new()?;
    println!("[1] UIAutomation 实例创建成功  ({:?})", t0.elapsed());

    // —— 2a. 拿焦点元素 ——
    let focused = automation.get_focused_element()?;
    println!(
        "[2a] 焦点元素: type={:<14} name={:?}",
        focused.get_control_type()?.to_string(),
        truncate(&focused.get_name().unwrap_or_default(), 40),
    );

    // —— 2b. 从焦点元素向上找到顶层窗口 ——
    let walker = automation.get_control_view_walker()?;
    let mut top = focused.clone();
    loop {
        // 顶层窗口的父是 desktop(root)。用 ProcessId 变化或 parent 为 root 判断。
        match walker.get_parent(&top) {
            Ok(parent) => {
                // 到 desktop root 就停（root 没有再上一层）
                if walker.get_parent(&parent).is_err() {
                    break; // parent 是 root，top 已是顶层窗口
                }
                top = parent;
            }
            Err(_) => break,
        }
    }
    println!(
        "[2b] 顶层窗口: type={:<14} name={:?}",
        top.get_control_type()?.to_string(),
        truncate(&top.get_name().unwrap_or_default(), 50),
    );

    // —— 3. 遍历顶层窗口的整棵子树，打印 + 统计 ——
    println!("\n[3] 遍历顶层窗口 UI 树 (限深度 6, 限 80 个节点):\n");
    let t1 = Instant::now();
    let mut count = 0usize;
    print_tree(&walker, &top, 0, 6, &mut count, 80)?;
    let elapsed = t1.elapsed();

    // —— 4. 再做一次"无打印的全量遍历"测真实性能 ——
    let t2 = Instant::now();
    let mut full_count = 0usize;
    count_tree(&walker, &top, 0, 30, &mut full_count)?;
    let full_elapsed = t2.elapsed();

    println!("\n=== 结果 ===");
    println!("打印遍历: {} 个节点 (限80), 耗时 {:?}", count, elapsed);
    println!("全量遍历: {} 个节点, 耗时 {:?}", full_count, full_elapsed);
    println!("\n✅ 验证通过：Rust 能抓取 Windows UI 元素树 (类型/名字/位置/层级)");

    Ok(())
}

/// 递归打印 UI 树，带缩进。返回是否已达节点上限。
fn print_tree(
    walker: &uiautomation::UITreeWalker,
    element: &UIElement,
    depth: usize,
    max_depth: usize,
    count: &mut usize,
    max_count: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    if *count >= max_count || depth > max_depth {
        return Ok(());
    }
    *count += 1;

    let indent = "  ".repeat(depth);
    let ctype = element.get_control_type().map(|t| t.to_string()).unwrap_or_default();
    let name = truncate(&element.get_name().unwrap_or_default(), 45);
    let rect = element.get_bounding_rectangle().ok();
    let box_str = rect
        .map(|r| format!("[{},{} {}x{}]", r.get_left(), r.get_top(), r.get_width(), r.get_height()))
        .unwrap_or_default();

    println!("{}{:<14} {:<47} {}", indent, ctype, format!("\"{}\"", name), box_str);

    // 递归子节点
    if let Ok(child) = walker.get_first_child(element) {
        let mut cur = child;
        loop {
            print_tree(walker, &cur, depth + 1, max_depth, count, max_count)?;
            if *count >= max_count {
                break;
            }
            match walker.get_next_sibling(&cur) {
                Ok(next) => cur = next,
                Err(_) => break,
            }
        }
    }
    Ok(())
}

/// 只数节点不打印，用于测全量遍历性能。
fn count_tree(
    walker: &uiautomation::UITreeWalker,
    element: &UIElement,
    depth: usize,
    max_depth: usize,
    count: &mut usize,
) -> Result<(), Box<dyn std::error::Error>> {
    if depth > max_depth {
        return Ok(());
    }
    *count += 1;
    if let Ok(child) = walker.get_first_child(element) {
        let mut cur = child;
        loop {
            count_tree(walker, &cur, depth + 1, max_depth, count)?;
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
    if s.chars().count() <= max {
        s
    } else {
        let t: String = s.chars().take(max).collect();
        format!("{}…", t)
    }
}
