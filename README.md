# 光瑞止付扩展（Dashboard 主流程）

主流程使用 `dashboard.html` + `dashboard.js`，同时保留：
- `popup.html/popup.js` 入口
- `accounts.html/accounts.js`（IndexedDB 账号管理 + 批量触发）
- `content.js`（页面字段匹配、经办警官弹窗勾选、表单提交）

## 本次升级加固范围（最小相关改动）

已完成并落地在源码中的关键修复：
1. `content.js` 合并为**单一** `getVisibleSelectDropdowns` / `typeSelectSearch` 实现，避免重复定义覆盖。
2. 修复 `openOperatorPicker` 函数边界与返回结构，消息监听不再被错误包裹，可正常执行。
3. 经办警官选择支持 `operatorNames` 数组：在弹窗表格逐行按姓名匹配并勾选，不使用顶部姓名搜索框；点击弹窗“确定”后强制检查弹窗关闭，否则返回 `skipped/error` 阻断提交。
4. `dashboard.js` 的批量步骤改为读取并传递全部经办人（`gr_selected_operator_list`），并在 `OPEN_OPERATOR_PICKER` 失败时立即暂停，不继续提交。
5. 银行“止付账户所属银行”下拉采用短超时精确匹配（优先精确文本、一次短重试），去除长时间卡死等待。
6. 转出时间保留 `parseDateValue`，通过 input/change + 日期时间弹层确认按钮/回车完成提交，并做最终非空与格式校验，失败明确报错。
7. `accounts.js` 批量流程改为正确异步读取经办人数组后再判断，传递 `operatorNames`，选择失败禁止提交。
8. 修复明显括号/边界/未定义变量问题，确保 `dashboard` 页面脚本可加载。

## 保留的功能面

- 插件 UI（Dashboard / Popup / Accounts）
- Excel 导入与历史记录（依赖 xlsx）
- IndexedDB 账号管理
- 图片素材库存储
- 模板保存/加载
- 断点续传（按 startIndex + batch）
- 银行卡止付 / 第三方止付流程
- 提交日志与异常中心

## 运行与加载扩展前置资源

以下资源当前仓库**未提交**，需在加载扩展前自行提供：
- `lib/xlsx.full.min.js`
- `icons/icon128.png`

否则：
- Dashboard 的 Excel 导入将不可用（会提示缺少 xlsx）
- 浏览器扩展图标资源可能缺失

## 未能在本仓库内真实验证的网页 DOM 假设

由于无法访问目标业务系统页面，`content.js` 采用了通用匹配策略，仍依赖目标页面满足以下假设：
- 经办警官弹窗标题/按钮文本包含“经办/警官/确定/确认”关键词。
- 经办人表格每行可通过文本匹配姓名，且存在可点击复选控件。
- 日期时间控件为 Element/Ant/通用弹层之一，支持输入事件与确认按钮或回车确认。
- 表单字段标签、placeholder、name 与业务中文字段关键字存在可匹配关系。
