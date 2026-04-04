# P2 - 变体控制的 variation message 使用英文注入中文 prompt

> 优先级：P2（中等问题）
> 影响范围：重试时的变体质量
> 实现难度：低

---

## 问题

`variation-control.service.ts` 的 `buildVariationMessage()` 使用全英文指令注入到中文小说生成 prompt 中：

```typescript
const lines = [
  `This is attempt ${attemptNumber}.`,
  'The new output must be meaningfully different from prior attempts.',
  'Keep the same task facts, schema, and output format requirements...',
  ...
]
```

当 AI 模型正在处理完全中文的小说创作 prompt 时，突然收到一段英文指令，对于中文优化的模型（如文心、通义、DeepSeek）可能：
1. 降低指令遵循率（中文模型对英文指令的理解不如中文）
2. 导致输出风格突变（语言上下文切换）
3. 某些模型可能完全忽略英文指令部分

## 原因

`variation-control.service.ts` 编写时可能以英文模型为主要目标。

## 解决方式

将 `buildVariationMessage()` 中的英文指令改为中文：

```typescript
const lines = [
  `当前是第 ${attemptNumber} 次尝试。`,
  '新的输出必须与之前的尝试有本质区别，不能只是换几个词或轻微调整。',
  '保持相同的任务要求、数据格式和输出结构，但必须改变角度、结构、重点或表达方式。',
  ...
]
```

## 是否解决

已解决

## 预期效果

- 中文模型对变体指令的遵循率提升
- 重试输出的差异化更明显
