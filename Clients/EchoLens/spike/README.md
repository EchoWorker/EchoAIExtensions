# EchoLens UIA Spike

可行性验证代码 — 验证 Rust 能否抓取 Windows 屏幕的 UI 元素树（无障碍树），
以及性能能否满足实时召唤式交互。结论见 `../docs/PRODUCT_DESIGN.md` §2。

## 依赖
- `uiautomation` v0.25（Apache-2.0），封装 Windows IUIAutomation COM。

## 运行

```bash
cargo run --bin uia-spike      # 遍历焦点窗口 UI 树并打印（类型/名字/包围盒/层级）
cargo run --bin cache          # CacheRequest vs 实时遍历 性能对比（逐窗口）
cargo run --bin bounded        # bounded BFS（限节点数）性能
cargo run --bin attrib         # 归因实验：瓶颈是「结构导航」还是「读属性」
cargo run --bin cached_tree    # 终极方案验证：build_updated_cache 一次性缓存子树
```

## 关键结论（实测）

| bin | 发现 |
|-----|------|
| `uia-spike` | ✅ 完整抓到整个桌面 UI 树，每元素带 `[x,y WxH]` 像素位置 |
| `attrib` | 瓶颈是 TreeWalker 逐节点导航的跨进程 COM IPC（占 ~57%），不是读属性 |
| `cache` | ❌ `find_all_build_cache`+TrueCondition 反而更慢（扁平 Vec 开销） |
| `cached_tree` | ✅ **正解**：`build_updated_cache(TreeScope::Subtree)` 一次性缓存子树 + 本地递归，**150 节点 48ms**，比实时遍历快 3 倍 |

## 核心配方（已验证可跑）

```
element_from_point(光标入口, 21ms)
  → 向上找顶层窗口
  → build_updated_cache(Subtree) 一次 COM 调用缓存整棵子树+属性 (48ms/150节点)
  → get_cached_children / get_cached_* 本地递归（零额外 IPC）
  → best-first 裁剪 + 节点预算
  → 序列化 XML 喂 LLM
```

> 注：这是一次性的可行性验证代码，非产品代码。产品实现见未来的 `echolens-perception` crate。
