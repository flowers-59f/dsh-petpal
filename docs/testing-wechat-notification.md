# 企业微信通知功能测试指南 / Testing Guide

## 测试步骤 / Test Steps

### 1. 准备工作 / Preparation

1. 确保插件已安装并启用
2. 准备一个企业微信群聊和机器人 Webhook URL

Ensure the plugin is installed and enabled. Prepare a WeChat Work group and bot Webhook URL.

### 2. 配置测试 / Configuration Test

1. 打开 Harness 设置 → 宠物页面
2. 找到「通知」部分
3. 输入框始终可编辑；输入内容后会提示「有未保存的修改」
4. 粘贴测试用的 Webhook URL，点「保存」或按回车
5. 应出现绿色「✓ 已保存，配置即刻生效」；刷新页面后开关与地址都应保持
6. 把地址改成 `http://…`（非 https）：输入框标红、保存按钮不可点

Open Harness Settings → Pets page, find the "Notifications" section. The field is always editable; typing shows an "Unsaved changes" hint. Paste a test Webhook URL and press Save or Enter — a green "✓ Saved" hint appears, and both the switch and the URL must survive a refresh. Changing the address to `http://…` turns the field red and disables Save.

### 3. 功能测试 / Functional Test

#### 测试场景 1: Agent 请求确认 / Agent Asks for Confirmation

触发方式：让 Agent 执行需要确认的操作

How to trigger: Ask the agent to perform an action that requires confirmation

示例对话：
```
用户：请删除这个文件 important.txt
Agent：[触发 approval/asked 事件]
```

预期结果：
- 企业微信群收到通知
- 通知内容包含「等待操作」和具体问题

Expected result:
- WeChat Work group receives notification
- Notification contains "waiting for operation" and the specific question

#### 测试场景 2: Agent 工作完成 / Agent Completes Work

触发方式：让 Agent 完成一个简单任务

How to trigger: Ask the agent to complete a simple task

示例对话：
```
用户：请创建一个 hello.txt 文件
Agent：[完成任务，触发 turn/end 事件]
```

预期结果：
- 企业微信群收到通知
- 通知内容包含「已完成」和 token 使用情况

Expected result:
- WeChat Work group receives notification
- Notification contains "completed" and token usage

#### 测试场景 3: Agent 遇到错误 / Agent Encounters Error

触发方式：让 Agent 执行一个会出错的操作

How to trigger: Ask the agent to perform an operation that will fail

示例对话：
```
用户：请读取不存在的文件 /path/to/nonexistent.txt
Agent：[出错，触发 turn/end 事件]
```

预期结果：
- 企业微信群收到通知
- 通知内容包含「出错了」和错误信息

Expected result:
- WeChat Work group receives notification
- Notification contains "error occurred" and error message

### 4. 边界测试 / Edge Case Test

#### 空 Webhook URL

1. 清空 Webhook URL 配置
2. 执行任意操作
3. 验证：不发送通知，不报错

Clear the Webhook URL. Perform any operation. Verify: no notification sent, no error.

#### 无效 Webhook URL

1. 填入无效 URL（例如：`http://invalid`）
2. 执行任意操作
3. 验证：发送失败，控制台有警告日志

Enter an invalid URL. Perform any operation. Verify: send fails, console shows warning.

#### 网络超时

1. 填入一个响应慢的 URL
2. 执行任意操作
3. 验证：5 秒后超时，不影响 Agent 运行

Enter a slow-responding URL. Perform any operation. Verify: timeout after 5 seconds, doesn't affect agent operation.

## 验证清单 / Verification Checklist

- [ ] 配置界面正确显示
- [ ] Webhook URL 可以保存
- [ ] Agent 提问时发送通知
- [ ] 工作完成时发送通知
- [ ] 出错时发送通知
- [ ] 通知内容格式正确
- [ ] 中英文显示正确
- [ ] 空配置不发送通知
- [ ] 发送失败不影响功能
- [ ] 控制台无异常错误

- [ ] Configuration UI displays correctly
- [ ] Webhook URL can be saved
- [ ] Notification sent when agent asks
- [ ] Notification sent when work completes
- [ ] Notification sent on error
- [ ] Notification content format is correct
- [ ] Chinese/English display correctly
- [ ] Empty config doesn't send notifications
- [ ] Send failure doesn't affect functionality
- [ ] No abnormal errors in console

## 调试技巧 / Debugging Tips

### 查看日志 / View Logs

在控制台搜索 `[petdex]` 可以看到相关日志：

Search for `[petdex]` in the console to see related logs:

```
[petdex] WeChat notification failed: 404
[petdex] WeChat notification error: timeout
[petdex] Failed to send WeChat notification: Error message
```

### 验证 Webhook / Verify Webhook

使用 curl 测试 Webhook 是否正常：

Use curl to test if the Webhook works:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"msgtype":"text","text":{"content":"测试消息"}}' \
  YOUR_WEBHOOK_URL
```

### 检查配置 / Check Configuration

配置保存在 `~/.dsh/pets/.petdex/ui.json` 文件中：

Configuration is saved in `~/.dsh/pets/.petdex/ui.json`:

```json
{
  "webhookUrl": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx",
  ...
}
```
