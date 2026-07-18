---
name: magazine-poster
description: 设计具有高级编辑气质的杂志封面、期刊主视觉与 editorial poster，并输出可直接用于生图的详细 JSON 文本提示词。用于用户要求创建或生成杂志封面、杂志海报、期刊封面、刊物主视觉、杂志感海报、magazine cover、editorial poster、fashion editorial cover，以及单张或系列化编辑视觉；不要用于分析现有封面、撰写杂志文章、网页杂志布局、内页排版或完整品牌全案。
---

# 杂志封面与编辑海报

## 目标

把用户的主题转化为具有真实杂志艺术指导、高级编辑气质和清晰文字层级的封面或海报。最终生图提示词必须是一个可被 `JSON.parse` 解析的 JSON 文本字符串，而不是普通描述段落。

## 核心原则

1. 先建立交付合同：确定交付类型、准确数量、共享编辑系统、变化维度、候选池和逐字约束。
2. 先形成编辑概念，再决定摄影、造型、场景、色彩和排版；不要用装饰堆砌替代概念。
3. 保持刊头、标题、封面线、主体和留白之间的明确层级，让摄影与排版共同构成画面。
4. 使用克制的色彩关系、真实材质、印刷颗粒和可执行的摄影语言建立高级感。
5. 保留用户给出的刊名、品牌名、人物名、产品名和准确文案，不翻译、不改写、不省略。
6. 用户未提供刊名或封面文案时，自动创作一个短刊名、一个主标题和一到三条简短 cover lines，不为此额外提问。
7. 不默认使用黑金、玻璃拟态、发光、奢华宫殿、无意义装饰或拥挤文字来表达高级感。
8. 清晰的生成请求直接执行；不要先提供多个方向让用户选择。

## 工作流

### 1. 解析交付关系

- 单张封面或海报：生成一个完整 JSON Prompt。
- “生成 N 张”但没有系列或不同版本语义：保持同一 Brief，生成 N 个随机变体。
- “系列、共 N 期、每期、不同版本、issues、volumes、editions”：生成 N 个共享视觉系统但内容独立的 JSON Prompt。
- 明确分配、编号或“依次为”表示有序映射。
- “可以是、例如、比如、等等、such as、including、and so on”表示可扩展候选池，顺序不强制；不足时自动补充协调且不重复的内容。
- 用户先完整描述一个参考封面，再要求“一套类似作品”时，把该封面作为艺术指导参考，不要机械复制所有场景元素。

### 2. 建立编辑系统

为当前任务确定：

- 编辑概念与封面故事
- 出版物性格和目标读者
- 刊头、主标题、cover lines 的层级
- 主体与文字的视觉权重
- 留白、网格、边距和安全区
- 摄影类型、镜头、光线和印刷质感
- 系列共享元素与每期变化元素

高级感来自判断和控制：减少无目的元素，使用清晰焦点、精确造型、受控对比和有意识的排版关系。

### 3. 编写 JSON Prompt

固定使用以下键结构。键名保持英文 snake_case；描述值优先使用精确英文，用户要求逐字呈现的文字保持原语言。不要添加注释、Markdown、尾随逗号或 JSON 之外的说明。

`deliverable` 根据任务使用 `magazine_cover` 或 `editorial_poster`；其余字段结构保持一致。

```json
{
  "deliverable": "magazine_cover",
  "issue": {
    "index": 1,
    "total": 1,
    "publication": "",
    "theme": "",
    "cover_story": ""
  },
  "editorial_direction": {
    "concept": "",
    "tone": [],
    "genre": "",
    "visual_narrative": ""
  },
  "subject": {
    "subject_key": "",
    "type": "",
    "count": 1,
    "description": "",
    "expression": "",
    "pose": "",
    "interaction": ""
  },
  "styling": {
    "wardrobe": [],
    "accessories": [],
    "materials": [],
    "hair_and_makeup": ""
  },
  "composition": {
    "orientation": "portrait",
    "shot": "",
    "camera_angle": "",
    "layout": "",
    "negative_space": "",
    "focal_hierarchy": []
  },
  "environment": {
    "location": "",
    "background": "",
    "architecture": [],
    "props": [],
    "atmosphere": ""
  },
  "typography": {
    "masthead": "",
    "headline": "",
    "cover_lines": [],
    "hierarchy": "",
    "placement": "",
    "copy_policy": ""
  },
  "lighting": {
    "setup": "",
    "quality": "",
    "direction": "",
    "contrast": "",
    "effects": []
  },
  "color_system": {
    "base": [],
    "accent": [],
    "contrast": "",
    "print_treatment": ""
  },
  "rendering": {
    "medium": "",
    "realism": "",
    "lens": "",
    "texture": "",
    "finish": "",
    "quality": ""
  },
  "series_consistency": {
    "shared": [],
    "variable": []
  },
  "constraints": {
    "must_preserve": [],
    "avoid": []
  }
}
```

### 4. 保证系列差异

- `subject.subject_key` 必须是简短、稳定的主体身份，例如 `rabbit`、`perfume-bottle`、`female-portrait` 或 `brutalist-architecture`。
- 动物候选池按物种给出时，`subject_key` 也使用物种层级：杜宾和灵缇都写作 `dog`，斯芬克斯猫和暹罗猫都写作 `cat`；只有用户明确要求不同犬种、猫种或品种系列时才使用品种身份。
- 不要把地点、服装、姿势或光线写进 `subject_key` 来伪装主体差异。
- 用户没有要求相同主体时，每期使用不同的主体键或内容方向。
- 用户明确要求同一主体时，允许主体键重复，但必须改变场景、构图、造型、封面故事或叙事关系。
- 每期都写完整 JSON，不使用“同上”“延续上一期”等引用。
- 每期默认是一张独立完整的封面，不得把多个期次排成四宫格、拼贴、contact sheet 或分屏；只有用户明确要求多宫格时才使用多画面布局。
- 系列共享刊头逻辑、网格、视觉语气、镜头标准和印刷质感；变化集中在主题、主体、造型、地点、色彩重点和封面故事。

### 5. 生成前检查

确认以下条件全部成立：

- JSON 可以被 `JSON.parse` 解析。
- 交付数量与用户要求完全一致。
- 每个 Prompt 都是独立完整的 JSON 文本。
- 用户提供的准确文案全部存在。
- 非同主体系列没有重复 `subject_key`。
- 没有随机乱码、过量 cover lines、模板化黑金或无目的装饰。
- 系列既能被识别为同一本刊物，又能清楚区分每一期。

## 动物杂志系列参考

用户描述一个 Vogue 风格封面：两只穿时尚西装的兔子，其中一只戴太阳镜，背景为埃菲尔铁塔和红色墙面；随后要求设计类似系列，共 5 期，动物可以是狗、兔子、猫、老虎等等。

正确理解：

- 交付数量为 5，模式为系列。
- 共享高级时尚编辑语气、双主体、西装造型、强镜头表现、刊头层级和印刷质感。
- 第一张描述是视觉原型，不要求其余四期都复制埃菲尔铁塔和红墙。
- 动物列表是候选池；使用兔子、狗、猫、老虎，并补充狐狸、熊猫等另一物种完成第五期，不能用第二个犬种代替第五种动物。
- 每期分别改变动物、服装语言、地点、背景色、姿态和封面故事。
- 五期全部重复兔子，即使更换地点或服装，也属于错误结果。

## 非动物主题参考

- 香水：以 `perfume-bottle` 为主体键，用材质、光线和空间表达香调，保留瓶身与品牌结构。
- 人物访谈：以人物身份或 `editorial-portrait` 为主体键，让面部、刊头和封面故事形成清晰优先级。
- 文化艺术：以展览、媒介或文化主题为主体键，把策展逻辑转化为实验性但可读的网格。
- 建筑：以建筑类型或项目身份为主体键，使用尺度、结构、光影和负空间组织标题。

需要扩展主题变化方式时，读取 `references/editorial-examples.md`。

## 工具执行

- 调用 `generate_image` 时，把完整 JSON 文本作为 prompt 字符串传入。
- 不要把 JSON 改写成普通英文段落。
- 不要在 prompt 外添加代码围栏、解释或前后缀。
- 批量确认、单批上限、失败补做和生成计时交由主 Agent 的现有流程处理。
