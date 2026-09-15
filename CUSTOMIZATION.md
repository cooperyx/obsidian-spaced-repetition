# Spaced Repetition 个人桌面定制版

## 版本与范围

- 上游：[1.15.4](https://github.com/st3v3nmw/obsidian-spaced-repetition/releases/tag/1.15.4)，2026-06-14 发布。
- 上游提交：`22fbea0a71ebd39fe29e0bc2d571aea4c42e10e4`。
- 定制版本：`1.15.4-cooperyx.1`，仅限 Obsidian 桌面端个人使用。
- 保持插件 ID `obsidian-spaced-repetition`，直接读取已有设置和笔记内的调度注释。

## PRD 评审结论

需求可实现，无需补充产品决策。落实以下边界：

- 普通卡片复习以 Again 加全部配置日期按钮代替 Hard、Good、Easy。显示答案后才可提交，日期档位窄屏自动换行。
- 所选 N 天以点击当日本地日期为基准，加 N 个自然日；OSR、FSRS 都写入上游原有格式。FSRS 保持其内部学习记录，手动日期选择后转入 Review 状态。
- Again 使用上游算法计算及短期重排逻辑；默认快捷键 `0` 对应 Again。空格显示答案，`J` 打开原文，`S` 跳过。原文获得焦点时不拦截这些按键。日期按钮可用 Tab 移动焦点及 Enter 激活。
- 上游临时练习（Cram）继续不保存复习计划，显示 Again 和“完成”；整篇笔记复习维持上游行为。
- 编辑图标与“打开原文”都进入可编辑的原文视图。保存后刷新当前卡片，保留答案状态和复习进度。
- 当前卡片被删除、语法失效、增删挖空导致子卡片数量变化，或一次大范围编辑使身份不再可确认时，提示并停止评分；可跳过或返回卡组重新载入。
- 不新增持久卡片 ID，不迁移整库，不批量改写笔记。已有唯一 Obsidian block ID 可帮助跟踪大幅编辑；没有 ID 时按保存前后的源范围跟踪。
- 只在原文已保存并与当前快照一致时写入计划；写入使用 Obsidian 原子更新接口。原文又发生修改时停止本次提交并保留当前卡片。

## 安装

1. 在 Obsidian 中停用原 Spaced Repetition 插件。
2. 备份库中 `.obsidian/plugins/obsidian-spaced-repetition/` 目录及重要笔记。已有 `data.json` 是个人设置，保留它。
3. 把 `release/obsidian-spaced-repetition/` 中的 `main.js`、`manifest.json`、`styles.css` 三个文件复制到该插件目录，替换同名文件。
4. 重新启用插件，或重启 Obsidian。
5. 进入插件的 Flashcards 设置页，配置“手动复习天数”。默认值是 `1, 2, 3, 5, 7, 10, 14, 30, 60, 90`。

不要在同一库中同时加载两个相同 ID 的版本；本定制版直接替代原插件。避免点击社区插件更新而覆盖定制文件。

## 更新与恢复上游

- 更新定制版：停用插件，保留 `data.json`，用新包替换三个文件，再启用。
- 恢复上游：停用定制版，从上游 1.15.4 发布页取回同名三个文件，覆盖后重新启用。
- 复习计划仍在笔记中的上游调度注释内。恢复插件版本不会撤销已完成的复习；如需撤销笔记修改，应使用安装前的笔记备份或 Obsidian 文件恢复。

## 源码构建

沿用上游 TypeScript 与 pnpm 锁文件：

```sh
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit --skipLibCheck
pnpm exec jest --runInBand
pnpm build
```

构建输出为 `build/main.js` 与根目录 `styles.css`，搭配 `manifest.json` 即可安装。构建产物不提交到源码历史。

本版的通用构建和测试在家庭 Linux 服务器的独立工作目录执行；不使用 GPU、不启动服务器服务。

Mac 临时材料按统一 scratch 目录保存。安装包与源码不依赖临时目录。

验证记录见 [VALIDATION.md](VALIDATION.md)。
