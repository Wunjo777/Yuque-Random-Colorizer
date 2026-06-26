# Yuque 画板随机着色 — Edge 浏览器扩展

在语雀文档的画板（draw.io）中对图形元素自动随机着色。

## 功能

- **框选区域**：在画板上拖拽选择要着色的区域
- **元素类型过滤**：可选矩形、椭圆、圆角矩形、文本、连线，或全部
- **色彩梯度**：预设暖色/冷色/彩虹/粉彩/霓虹/灰度
- **候选颜色**：自定义颜色列表，随机着色从中选取
- **梯度+候选色组合**：同时指定时，候选颜色映射到梯度色空间
- **空间距离着色**：相邻元素尽量使用不同颜色
- **撤销**：一键回退上次着色

## 安装

1. 打开 Edge，访问 `edge://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展」
4. 选择 `yuque-random-colorizer` 文件夹

> **注意**：`icons/` 文件夹中需要放入图标文件（icon16.png, icon48.png, icon128.png）。
> 可以用任意 PNG 图标，或删除 manifest.json 中的 icons 字段使用默认图标。

## 使用

1. 打开包含画板的语雀文档
2. 点击工具栏中的扩展图标，或点击弹窗中的「激活着色工具」
3. 在画板上拖拽框选要着色的区域
4. 在右侧面板中配置：
   - 选择元素类型
   - 选择色彩梯度（可选）
   - 添加/删除候选颜色（可选）
5. 点击「应用着色」
6. 可随时点击「撤销」回退

## 技术架构

```
yuque-random-colorizer/
  manifest.json           # MV3 配置
  background.js           # Service Worker，处理图标点击
  popup.html / popup.js   # 弹窗 UI
  content/
    content.js            # 入口：发现 draw.io iframe，注入脚本
    main.js               # 框选 + 浮动面板 + 着色编排 + 撤销
    color-engine.js       # 色彩算法：梯度生成、空间着色
```

## 兼容性

- Edge (Chromium) 88+
- 语雀画板基于 draw.io (mxGraph)，通过 mxGraph API 操作元素样式
