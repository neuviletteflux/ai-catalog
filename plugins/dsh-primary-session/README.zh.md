# dsh-primary-session

[English](README.md) | **简体中文**

在 DSH 侧栏给每个工作区标记一个**唯一主会话**。

![行首「主」徽标与会话行菜单](assets/primary-badge.png)

![会话行菜单里的「设为主会话」](assets/dsh-primary-session.png)

## 做什么

DSH 已经内置**置顶**：置顶的会话会排到所属工作区分组最前，行尾常驻图钉。但每个
工作区可以置顶多个，多开并行会话后置顶区又会变得和普通列表一样难分辨。

本插件在置顶之上加一个会话行菜单项：

| 菜单项 | 行为 |
|---|---|
| **设为主会话** | 先取消**同一工作区**（未分组会话算一个桶）里其它置顶会话，再置顶当前会话 |
| **取消主会话** | 只取消当前会话的置顶，不动其它工作区 |

列表里每个工作区最多一个主会话：取 Host 置顶列表（最近置顶在前）中属于该工作区的
第一条。该行在行首显示一个强调色的**「主」徽标**（行尾仍保留内置图钉），并排在普通行
之前。不新增存储、schema 或会话事件。已归档会话不提供该项（Host 上置顶与归档互斥）。

## 安装

本包是一个 DSH Profile Bundle。由于 `desktop` profile 由 Electron 应用独占，请在应用内安装：

**设置 → 插件 → 添加插件 → 粘贴本地目录路径**，例如
`/Users/lives/Github/ai-catalog/plugins/dsh-primary-session`，然后重启 DSH。

非 desktop profile 可以使用 CLI：

```bash
dsh plugin --profile web add link:/path/to/ai-catalog/plugins/dsh-primary-session
```

### 开发期挂载（与 Bundle 安装互斥）

调试时可以用 home 层 patch 直接挂载包：

```yaml
- insert:
    - id: dsh-primary-session
      name: /Users/lives/Github/ai-catalog/plugins/dsh-primary-session/lib/index.js
```

**不要和 Profile Bundle 安装同时使用**：同一个包会从两个激活的 Loader 来源解析，
客户端模块组合会报错。

## 兼容性与失败行为

在 DSH `0.2.1-rc.2`（桌面版）验证。依赖
`sidebar.workspaces.session.menu.item` slot 与客户端 `workspaces` 服务
（`list` + `pinSession` / `unpinSession`）。缺任一面时菜单项不会注册；Host 调用
失败只打一条 console warning，置顶状态以 Host 返回为准（workspace 插件的通知通道
未对外暴露）。

## 存储

不新增存储。复用 Host 已有的置顶集合
（`<DSH_HOME>/storages/workspace.json` → `global.pinnedSessionIds`），刷新、换浏览器
都保留。

## 边界

- 唯一性是**每个工作区**（未分组会话算一个桶），不是全局唯一。
- 手动再置顶第二个会话会打破唯一；此时“最近置顶”的那条成为主会话（徽标跟着移动），
  再点一次「设为主会话」即可收敛回一个。
- 「主」徽标位于行首 seat，该 seat 只在会话 idle 时渲染；运行中的行显示状态点，
  此时仍以行尾图钉标记。
- 直接调用 `workspaces` 服务只更新 Host 置顶集与置顶分区，不会像内置置顶按钮那样
  顺带改写本地保存的手动拖拽顺序。

## 卸载

在同一个设置页移除插件（或删除开发期用的 home patch 条目），然后重启 DSH；
无需先取消置顶。
