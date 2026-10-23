# 企业微信通知功能 / WeChat Work Notification

## 功能说明 / Description

该功能允许在 Agent 需要提问或一轮工作结束后，通过企业微信机器人发送通知消息。

This feature allows sending notifications via WeChat Work bot when the agent asks questions or finishes a work round.

## 配置方法 / Configuration

### 1. 创建企业微信机器人 / Create WeChat Work Bot

1. 在企业微信群聊中，点击右上角 `...` 菜单
2. 选择「添加群机器人」
3. 创建机器人并复制 Webhook 地址

In WeChat Work group chat:
1. Click the `...` menu in the top right
2. Select "Add Group Bot"
3. Create a bot and copy the Webhook URL

### 2. 配置插件 / Configure Plugin

1. 打开 DeepSeek Harness 设置页面
2. 找到「宠物」(Pets) 部分，下拉到「通知」(Notifications)
3. 打开「启用通知」开关（默认关闭，这是一键总开关）
4. 在「企业微信 Webhook」输入框粘贴 Webhook 地址，点右边的「保存」按钮或按回车
5. 保存成功后按钮下方出现绿色的「✓ 已保存，配置即刻生效」；地址不是以 `https://` 开头时输入框标红且保存按钮不可点

In DeepSeek Harness:
1. Open Settings page
2. Navigate to the "Pets" section and scroll to "Notifications"
3. Turn on "Enable Notifications" (off by default — this is the master switch)
4. Paste the Webhook URL into the "WeChat Work Webhook" field, then click "Save" (or press Enter)
5. A green "✓ Saved — it takes effect immediately" appears under the button; an address that does not start with `https://` turns the field red and disables Save

> 输入框是「草稿」：只有点「保存」或回车才写入，改动未保存时会提示「有未保存的修改」。开关关闭时地址不会被清空，可以随时一键暂停 / 恢复通知。
>
> The field is a draft: nothing is written until you press Save or Enter, and an "Unsaved changes" hint appears in the meantime. Turning the switch off keeps the address, so notifications can be paused and resumed with one click.

## 通知场景 / Notification Scenarios

### 1. Agent 需要确认 / Agent Asks for Confirmation

当 Agent 需要用户确认某个操作时，会发送通知：

When the agent needs user confirmation, a notification is sent:

```
🔔 DeepSeek Harness 通知

会话：[会话标题]
状态：等待操作
问题：[具体问题]

时间：2024-10-23 19:47:02
```

### 2. 工作完成 / Work Completed

当 Agent 完成一轮工作时，会发送通知：

When the agent finishes a work round, a notification is sent:

```
✅ DeepSeek Harness 通知

会话：[会话标题]
状态：已完成
输出token：1234

时间：2024-10-23 19:47:02
```

### 3. 出错 / Error Occurred

当工作出现错误时：

When an error occurs:

```
❌ DeepSeek Harness 通知

会话：[会话标题]
状态：出错了：[错误信息]

时间：2024-10-23 19:47:02
```

## 技术实现 / Technical Implementation

### Host 端 (index.js)

- 添加 `webhookUrl` 配置项到 `DEFAULT_UI`
- 实现 `sendWeChatNotification()` 函数发送消息
- 实现 `formatNotificationMessage()` 函数格式化通知内容
- 在 `approval/asked` 和 `turn/end` 事件中触发通知

### Client 端 (client.js)

- 添加中英文翻译文本
- 在设置页面添加 Webhook URL 输入框
- 提供配置说明和提示

## 安全性 / Security

- Webhook URL 仅在 Host 端使用，不会暴露到客户端
- 消息发送超时限制为 5 秒
- 发送失败不影响 Agent 正常运行，仅记录警告日志

The Webhook URL is only used on the host side and is not exposed to the client. Message sending has a 5-second timeout. Failures do not affect agent operation and only log warnings.

## 故障排查 / Troubleshooting

### 没有收到通知 / Not Receiving Notifications

1. 检查 Webhook URL 是否正确填写
2. 确认 URL 以 `https://` 开头
3. 查看控制台是否有错误日志
4. 测试 Webhook URL 是否可以正常访问

1. Check if the Webhook URL is correctly configured
2. Ensure the URL starts with `https://`
3. Check the console for error logs
4. Test if the Webhook URL is accessible

### 消息格式不正确 / Incorrect Message Format

企业微信机器人只接受文本消息格式，消息内容会自动格式化为：

WeChat Work bot only accepts text messages. The content is automatically formatted as:

```json
{
  "msgtype": "text",
  "text": {
    "content": "[通知内容]"
  }
}
```
