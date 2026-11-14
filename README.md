# Choice Buttons

SillyTavern 第三方扩展，将 AI 回复中的 `<choices>` 选项转换为按钮。面向 1.19.0，移动端优先，无外部依赖、无需构建。

## 功能

- 从原始消息解析末尾的 choices 标记，只接受 2–4 个非空、单行字符串组成的数组。兼容中文双引号和尾逗号；格式不符时不生成按钮。
- 监听消息渲染、编辑、swipe、聊天切换和历史消息加载，更新按钮并避免重复。
- 扩展面板提供隐藏原文开关，设置随 SillyTavern 保存。仅修改显示 DOM，不改写 `message.mes`。
- 按钮使用 textContent，选项中的 HTML 不会作为按钮代码执行。
- 点击选项后填写酒馆输入框、派发 input 事件，等待 50 毫秒后点击发送按钮，走与手动发送相同的消息与生成流程。
- 优先读取 `chat[mesId].mes`。兼容转义标签、常见零宽字符及数组外的 HTML 格式标签；聊天 DOM 被其他扩展重建后自动重新挂载按钮。

## 安装

在 SillyTavern 的扩展安装界面填入以下仓库 URL，安装后刷新网页：

https://github.com/BileTitan-lab/choice-buttons

四个文件位于仓库根目录，无需构建。

手动安装：把上述文件放进 `public/scripts/extensions/third-party/choice-buttons/`，重启服务，在扩展管理中确认启用并硬刷新。

## 配合提示词

将下面的要求写入 System Prompt 或 Author's Note：

```text
每次回复正文结束后，另起一行输出：
<choices>
["行动1", "行动2", "行动3"]
</choices>
不少于 3 条、不超过 4 条，不加任何解释。
选项必须使用英文半角双引号，JSON 数组必须可被 JSON.parse 解析。
choices 标签必须独占起始行并放在整条回复的末尾，标签内部只能有选项数组。
```

建议使用合法 JSON，不要添加 Markdown 代码围栏。

## 已知限制

- 1.0.2 起移除了 `/send` 路径。需要酒馆 API 连接正常、发送按钮可用；生成中或控件不可用时会提示，并保留已经填写的选项供手动重试。扩展不主动清空输入框。
- 以 `/` 开头的选项拒绝发送，避免变成命令。输入框已有草稿时会提示清空，不覆盖草稿。
- SillyTavern 1.19.0 的 `#send_form` 是 div，派发 submit 事件不会启动生成，因此不将它作为发送兜底。
- 酒馆自己的宏替换、正则和用户消息处理仍然有效。
- 接受回复末尾的 `<choices>...</choices>`（含转义的标签）或明确标注为 choices 的代码围栏。不解析普通 json 代码块、裸数组、编号列表或标签里的解释文字，避免将教程与正文误当作选项。流式消息等渲染完成后显示按钮。
- 隐藏支持 DOM 中保留的 choices 元素及跨文本节点的完整标签。若其他扩展或 HTML 清理已经移除了标签，仅留下选项正文，无法可靠识别隐藏范围；按钮仍从原始消息解析。可关闭冲突的正则处理后重试。
- 没有在真实安卓 WebView / SillyDroid 上实机验证。过旧 WebView 需更新到能正常运行 SillyTavern 的版本。
- 日志前缀为 `[choice-buttons]`，主要在浏览器/WebView 的 JavaScript 控制台；App 服务端终端不一定显示前端日志。
- 检测到 choices 标记但格式无效时，日志会显示消息编号和原文前 200 字符；相同消息内容不重复打印。排查共存问题时可查看这些日志。
- 1.0.3 增加了 DOM 重建后的恢复处理，但没有在你的酒馆助手脚本和安卓设备上实测。若其他脚本改写了 `chat[mesId].mes` 本身或持续清空按钮，仍需结合实际脚本排查。

接口参考：https://docs.sillytavern.app/for-contributors/writing-extensions/
