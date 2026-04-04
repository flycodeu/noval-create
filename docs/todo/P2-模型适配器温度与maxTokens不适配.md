# P2 - 模型适配器温度与 maxTokens 不适配不同模型

> 优先级：P2（中等问题）
> 影响范围：多模型生成质量差异
> 实现难度：中

---

## 问题

1. **所有适配器默认 `maxTokens=4096`**：对于需要生成 3000-5000 字中文正文的章节，4096 tokens 可能不够（3000 中文字 ≈ 3000-4500 tokens），导致输出被截断。用户不一定意识到需要手动调高。

2. **百度文心 `chat` 方法未传 `max_tokens`**：`BaiduAdapter` 的 `buildBody` 中没有 `max_output_tokens` 参数，完全依赖百度的默认值，可能导致输出提前结束。

3. **温度 0.85 对所有模型一视同仁**：不同模型对同一温度值的反应差别很大（DeepSeek 在 0.85 可能过于随机，Claude 在 0.85 可能偏保守）。小说创作需要的创造性和稳定性平衡点因模型而异。

## 原因

- 适配器设计时以 OpenAI 为模板，其他模型未做个性化参数调优
- `maxTokens` 默认值未考虑中文小说场景的实际需求

## 解决方式

1. 继续沿用 `model_configs.temperature` 和 `model_configs.max_tokens`，不新增重复字段；运行时统一按“用户配置优先，provider 默认兜底”解析参数
2. 将 provider 默认 `maxTokens` 提升到 `8192`，匹配中文长篇章节输出场景
3. 为不同 provider 提供差异化默认温度：`openai=0.8`、`anthropic=0.75`、`aliyun=0.85`、`baidu=0.8`、`deepseek=0.7`、`custom=0.8`
4. 各适配器统一改为读取运行时解析后的 `temperature/maxTokens`，不再硬编码 `0.85/4096`
5. 百度文心请求体补充 `max_output_tokens`
6. 增加迁移回填：把非 `custom` 且仍停留在旧默认值 `temperature=0.85`、`max_tokens=4096` 的配置自动升级到新的 provider 推荐值

## 是否解决

已解决

## 预期效果

- 长章节不再因 token 限制被截断
- 不同模型使用各自更合适的默认参数，减少质量差异
- 旧配置会自动脱离遗留默认值，不需要用户逐条手改
