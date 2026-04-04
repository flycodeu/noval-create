# P2 - Token估算不精确导致上下文溢出

> 优先级：P2（中等）
> 影响范围：上下文利用率
> 实现难度：低

---

## 问题

当前Token估算使用 `text.length / 1.5` 的粗略公式，对中文（约1.5-2 tokens/字）和英文（约1.3 tokens/word）的混合文本估算偏差可达20-30%。百万字小说的上下文管理对Token精度要求更高，估算偏差直接导致上下文截断或溢出。

## 原因

- `context.service.ts` 中 `estimateTokens()` 使用固定的 `length / 1.5` 比率
- 不同AI模型的tokenizer差异未被考虑（GPT-4 vs Claude vs 通义千问的token化方式不同）
- 代码中无实际的tokenizer库集成
- 当估算偏低时，实际发送的context超过模型窗口限制，导致被截断（关键信息可能丢失）
- 当估算偏高时，context空间被浪费，可以塞入更多有用信息却没有

## 解决方式

1. **集成真实Tokenizer**：
   - 对OpenAI系列：集成 `tiktoken` 库进行精确计算
   - 对Claude系列：使用Anthropic的token计数API
   - 对国产模型：集成对应的tokenizer或使用API返回的token计数
2. **缓存Token计数**：对不变的文本（角色描述、世界规则等）缓存token数，避免重复计算
3. **安全余量策略**：保留10%的token预算作为安全余量，防止边界溢出
4. **模型适配层**：在 `modelConfigs` 中记录每个模型的最大上下文窗口和推荐输入比例

## 是否解决

已解决 — 2026-04-04

已实施以下修复：
1. `estimateTokens()` 从固定 `length / 1.5` 改为分类计算：
   - 中文字符：1.0 token/字
   - ASCII字符：0.25 token/字符
   - 标点和空白：0.5 token/个
   - 10% 安全余量
2. `truncateToTokens()` 使用中英混合平均值（0.6 token/char）反向计算最大字符数
3. 预计将估算误差从 20-30% 降低到 10% 以内

## 预期效果

- Token估算误差控制在5%以内
- 最大化利用模型上下文窗口
- 消除因token溢出导致的意外截断
