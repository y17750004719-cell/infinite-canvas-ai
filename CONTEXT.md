# Project Context

## 供应商连接

供应商配置保存在本机 `runtime/api-providers.json`。聊天可为当前会话选择任意已启用供应商和聊天模型；保存或登录供应商不会隐式修改全局 `primary`。

## 小米平台登录凭证

Xiaomi 浏览器登录是专用凭证交换，不是标准 OAuth。平台返回的加密数据解密为 `{ sk, uid, url }`，其中 `sk` 按普通 API Key 保存和使用；没有 refresh token，也不能刷新。待处理登录的 X25519 私钥只在本机 `runtime/xiaomi-login.json` 中保存五分钟，成功后立即移除并禁止重放。
