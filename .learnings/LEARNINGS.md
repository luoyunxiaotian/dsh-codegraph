# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

---

### [LRN-20261011-01] 严禁未经用户测试与授权擅自 git push，以及版本发布管理规范
**Date**: 2026-10-11
**Category**: correction
**Priority**: CRITICAL
**Status**: Logged
**Trigger**: 用户发出严厉警告：未经用户测试与同意，擅自推送 GitHub 更新；且推送未遵循版本号规范。

**Root Cause**:
在完成自更新功能实现与本地测试后，草率地默认执行了 `git push` 将 commit 推送到远程 `main` 分支，严重侵犯了用户的版本发布控制权，且破坏了规范的版本打标（Tag）与发布（Release）流程。

**Correction & Strict Rules**:
1. **绝对禁止私自 Git Push**：
   - 所有的代码编写、构建与测试在本地工作区完成。
   - 严禁在未经用户明确允许/测试批准的情况下执行任何 `git push`、`git tag -a` 远程推送或发布操作。
   - 必须等待用户本地测试满意、明确发出“推送”、“发布”或“git push”指令后，方可执行推送。
2. **严格遵守版本管理规范**：
   - 任何涉及版本的推送必须清晰明确：
     - 当前 `package.json` 的版本号变更（Patch/Minor/Major）；
     - `feed/manifest.json` 的版本与构建产物一致性；
     - 是否需要打 Git Tag（如 `git tag v2.1.0`）；
     - 是否需要创建 GitHub Release。
   - 绝不允许模糊提交或无版本规划地直接污染远程分支。
