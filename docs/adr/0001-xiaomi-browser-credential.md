# ADR 0001: Xiaomi 专用浏览器凭证引导

## Decision

使用 Xiaomi MiMo-Code 的专用 X25519 + AES-256-GCM 凭证交换，并将解密所得 `sk` 作为现有 OpenAI 兼容 Provider 的 API Key。不开通用 OAuth、PKCE、refresh token 或多用户会话层。

## Rationale

平台返回的是 API Key 及账号元数据，不是可刷新的 OAuth token。复用现有 Provider registry、模型探测和 `/chat/completions` 请求链路，改动更小，也准确反映凭证生命周期。

## Limits

仅支持本机单用户和单个待处理登录。`kn=mimocode` 与 `X-Mimo-Source: mimocode-cli` 用于兼容现有官方客户端；对外分发前必须确认 Xiaomi 允许第三方使用这些客户端身份标识。
