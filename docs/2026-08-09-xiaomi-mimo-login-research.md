# Xiaomi MiMo 浏览器登录研究

- [MiMo-Code 登录协议](https://github.com/XiaomiMiMo/MiMo-Code/blob/e8bbc899cec44db12ac57896d7fdfb5e1033cf6c/packages/opencode/src/plugin/mimo.ts#L75-L192)：X25519、SHA-256 派生、AES-256-GCM，以及 `kn=mimocode` / `mimocode-cli`。
- [凭证以 API Key 保存](https://github.com/XiaomiMiMo/MiMo-Code/blob/e8bbc899cec44db12ac57896d7fdfb5e1033cf6c/packages/opencode/src/provider/auth.ts#L203-L224)：解密后的 `sk` 进入 API Key 凭证存储。
- [Continue 的 API Key 接入](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/Mimo.ts#L5-L10)：使用 OpenAI 兼容 Base URL 与 API Key。
- 截至本记录，OpenCode、Cline、Roo Code 未发现 Xiaomi 账号浏览器登录实现。

本项目采用 clean-room 重写，只参考协议行为和公开接口，不复制实现结构。
