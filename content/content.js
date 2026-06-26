// content.js — 全功能：SVG 检测 + 框选 + 面板 + 着色 + 撤销
// content script 可直接操作页面 DOM，无需 MAIN world 注入

(function () {
  'use strict';
  if (window.__yuqueColorizerInjected) return;
  window.__yuqueColorizerInjected = true;

  // ==================== 状态 ====================
  let isActive = false;
  let coloringMode = false; // 框选着色模式 vs 普通模式
  let isDragging = false;
  let startX = 0, startY = 0;
  let endX = 0, endY = 0;
  let selectedElements = []; // 选中的 SVG shape 元素
  let undoStack = [];
  let candidateColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];

  // 元素类型过滤：从画板动态扫描，格式 { key, label, count }
  let boardTypes = [];
  let enabledTypeKeys = new Set();

  // ==================== SVG 工具 ====================

  /** 找画板 SVG（大尺寸 + 含 g/path） */
  function findBoardSvg() {
    const svgs = document.querySelectorAll('svg');
    let best = null, bestScore = 0;
    for (const svg of svgs) {
      const rect = svg.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 200) continue;
      const gs = svg.querySelectorAll('g[transform]');
      const paths = svg.querySelectorAll('path');
      const score = gs.length * 3 + paths.length * 2;
      if (score > bestScore) { bestScore = score; best = svg; }
    }
    return best;
  }

  /** 获取 g 元素内的所有子元素 */
  function getShapesInGroup(g) {
    return g.querySelectorAll('path, rect, ellipse, circle, polygon, line, text');
  }

  /**
   * 判定单个 SVG 元素的类型 key
   * 返回用户可读的 key，用于分组和过滤
   */
  function classifyElement(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'text') return 'text';
    if (tag === 'rect') {
      const rx = parseFloat(el.getAttribute('rx') || 0);
      return rx > 2 ? 'rounded-rect' : 'rect';
    }
    if (tag === 'ellipse') return 'ellipse';
    if (tag === 'circle') return 'circle';
    if (tag === 'polygon') return 'polygon';
    if (tag === 'line') return 'line';
    if (tag === 'path') {
      const markerEnd = el.getAttribute('marker-end') || el.getAttribute('marker-start') || '';
      const markerMid = el.getAttribute('marker-mid') || '';
      const dashArray = el.getAttribute('stroke-dasharray') || '';
      const fill = getFill(el);
      const stroke = el.getAttribute('stroke') || '';
      const sw = parseFloat(el.getAttribute('stroke-width') || 0);
      // 有箭头标记 → 连线
      if (markerEnd || markerMid) return 'connector';
      // 虚线 → 虚线连线
      if (dashArray) return 'dashed-line';
      // 无填充 + 有描边 → 连线/线条
      if ((!fill || fill === 'none' || fill === 'transparent') && (stroke || sw > 0)) return 'connector';
      return 'path';
    }
    return 'other';
  }

  /**
   * 扫描画板，获取所有 group 的元素类型分布
   * 返回 [{ key, label, count }] 按数量降序
   */
  function scanBoardTypes() {
    const svg = findBoardSvg();
    if (!svg) return [];
    const groups = svg.querySelectorAll('g[transform]');
    const typeMap = new Map(); // key → count

    for (const g of groups) {
      if (g.querySelector('g[transform]')) continue;
      const shapes = getShapesInGroup(g);
      if (shapes.length === 0) continue;
      // 取第一个有效 shape 的类型作为该 group 的类型
      const typeKey = classifyElement(shapes[0]);
      typeMap.set(typeKey, (typeMap.get(typeKey) || 0) + 1);
    }

    const TYPE_LABELS = {
      'rect': '矩形',
      'rounded-rect': '圆角矩形',
      'ellipse': '椭圆',
      'circle': '圆形',
      'polygon': '多边形',
      'path': '图形',
      'connector': '连线',
      'dashed-line': '虚线',
      'line': '线段',
      'text': '文本',
      'other': '其他',
    };

    const result = [];
    for (const [key, count] of typeMap) {
      result.push({ key, label: TYPE_LABELS[key] || key, count });
    }
    result.sort((a, b) => b.count - a.count);
    return result;
  }

  /** 获取元素的包围盒（viewport 坐标） */
  function getElRect(el) {
    try { return el.getBoundingClientRect(); }
    catch (e) { return null; }
  }

  /** 读取 fill 属性（优先 style 属性，再查 SVG attribute） */
  function getFill(el) {
    const style = el.getAttribute('style') || '';
    const m = style.match(/fill\s*:\s*([^;]+)/);
    if (m) return m[1].trim();
    return el.getAttribute('fill') || '';
  }

  /** 设置 fill（同时更新 style 和 attribute） */
  function setFill(el, color) {
    let style = el.getAttribute('style') || '';
    style = style.replace(/fill\s*:[^;]+;?\s*/g, '');
    if (style.trim()) {
      el.setAttribute('style', style);
    } else {
      el.removeAttribute('style');
    }
    el.setAttribute('fill', color);
  }

  // ==================== HSV 颜色工具 ====================
  function hsvToHex(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    let r, g, b;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    const toHex = n => Math.round((n + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  }

  function hexToHsv(hex) {
    hex = hex.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return { h, s: max === 0 ? 0 : d / max, v: max };
  }

  // 色彩梯度预设：同色调，亮度从浅到深
  const GRADIENT_PRESETS = {
    warm:      { h: 10,  s: 0.75 },
    cool:      { h: 210, s: 0.6  },
    rainbow:   { h: -1,  s: 0.7  }, // 特殊：多种色调
    pastel:    { h: -1,  s: 0.35 },
    neon:      { h: -1,  s: 1.0  },
    grayscale: { h: 0,   s: 0    },
  };

  /**
   * 生成色彩梯度：同一种颜色，亮度从浅到深
   * rainbow/pastel/neon：每个元素独立随机色调，但都做亮度梯度
   */
  function generateLightnessGradient(preset, count) {
    if (count <= 0) return [];
    const colors = [];
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const v = 0.95 - t * 0.6; // 0.95(浅) → 0.35(深)
      const s = preset.s * (0.7 + t * 0.3);
      const h = preset.h >= 0 ? preset.h : (i / count) * 360;
      colors.push(hsvToHex(h, s, v));
    }
    return colors;
  }

  /**
   * 对候选颜色做亮度梯度：
   * 随机选一个候选色，生成该色从浅到深的变体
   */
  function generateCandidatesLightnessGradient(candidates, count) {
    if (!candidates.length || count <= 0) return [];
    // 随机选一个候选色作为基色
    const baseHex = candidates[Math.floor(Math.random() * candidates.length)];
    const base = hexToHsv(baseHex);
    const colors = [];
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const vMin = Math.max(0.2, base.v - 0.4);
      const vMax = Math.min(1.0, base.v + 0.15);
      const v = vMax - t * (vMax - vMin);
      const s = base.s * (0.65 + t * 0.35);
      colors.push(hsvToHex(base.h, s, v));
    }
    return colors;
  }

  // ==================== 空间着色 ====================
  function spatialColoring(elements, palette) {
    if (!elements.length || !palette.length) return new Map();
    const centers = elements.map((el, i) => {
      const r = getElRect(el) || { left: 0, top: 0, width: 0, height: 0 };
      return { idx: i, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of centers) {
      minX = Math.min(minX, c.cx); minY = Math.min(minY, c.cy);
      maxX = Math.max(maxX, c.cx); maxY = Math.max(maxY, c.cy);
    }
    const diag = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
    const radius = diag / Math.sqrt(centers.length) * 0.8 || 100;
    const radiusSq = radius * radius;

    const gridSize = radius;
    const grid = new Map();
    const gk = (x, y) => `${Math.floor(x / gridSize)},${Math.floor(y / gridSize)}`;

    const sorted = [...centers].sort((a, b) => {
      const il = n => { n = Math.floor(n / 10); n = (n | (n << 8)) & 0x00FF00FF; n = (n | (n << 4)) & 0x0F0F0F0F; n = (n | (n << 2)) & 0x33333333; n = (n | (n << 1)) & 0x55555555; return n; };
      return (il(a.cx) | (il(a.cy) << 1)) - (il(b.cx) | (il(b.cy) << 1));
    });

    const result = new Map();
    for (const c of sorted) {
      const gx = Math.floor(c.cx / gridSize), gy = Math.floor(c.cy / gridSize);
      const used = new Set();
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const cell = grid.get(`${gx + dx},${gy + dy}`);
          if (!cell) continue;
          for (const n of cell) {
            const ddx = c.cx - n.cx, ddy = c.cy - n.cy;
            if (ddx * ddx + ddy * ddy <= radiusSq && n.color) used.add(n.color);
          }
        }
      }
      let available = palette.filter(cl => !used.has(cl));
      if (!available.length) available = palette;
      const color = available[Math.floor(Math.random() * available.length)];
      result.set(c.idx, color);
      const key = gk(c.cx, c.cy);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push({ cx: c.cx, cy: c.cy, color });
    }
    return result;
  }

  // ==================== Overlay（Shadow DOM） ====================
  let overlayHost = null, overlayShadow = null, selBox = null, counterEl = null, panelEl = null;
  let modeToggle = null;

  function createOverlay() {
    if (overlayHost) return;
    overlayHost = document.createElement('div');
    overlayHost.id = 'yuque-colorizer-overlay';
    overlayShadow = overlayHost.attachShadow({ mode: 'closed' });
    overlayShadow.innerHTML = `
      <style>
        :host { all:initial!important; position:fixed!important; top:0!important; left:0!important; width:100vw!important; height:100vh!important; z-index:2147483647!important; pointer-events:none!important; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
        .sel { position:absolute; border:2px solid #1890ff; background:rgba(24,144,255,.12); pointer-events:none; display:none; border-radius:2px; }
        .cnt { position:absolute; top:-28px; left:0; background:#1890ff; color:#fff; padding:3px 10px; border-radius:4px; font-size:12px; white-space:nowrap; pointer-events:none; box-shadow:0 2px 8px rgba(0,0,0,.15); }
        .pnl { position:fixed; top:50%; right:20px; transform:translateY(-50%); width:280px; background:#fff; border-radius:8px; box-shadow:0 4px 24px rgba(0,0,0,.18); pointer-events:auto!important; display:none; overflow:hidden; font-size:13px; color:#333; z-index:2147483647; }
        .pnl-h { padding:14px 16px 10px; background:#fafafa; border-bottom:1px solid #f0f0f0; font-weight:600; font-size:14px; display:flex; align-items:center; justify-content:space-between; }
        .pnl-b { padding:12px 16px; max-height:60vh; overflow-y:auto; }
        .pnl-f { padding:10px 16px; border-top:1px solid #f0f0f0; display:flex; gap:8px; }
        .f { margin-bottom:12px; }
        .fl { font-size:12px; color:#666; margin-bottom:6px; display:block; }
        .fr { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
        .cb { display:inline-flex; align-items:center; gap:4px; font-size:12px; cursor:pointer; padding:3px 8px; border:1px solid #d9d9d9; border-radius:4px; user-select:none; transition:all .2s; }
        .cb:hover { border-color:#1890ff; }
        .cb.on { background:#e6f7ff; border-color:#1890ff; color:#1890ff; }
        .cb input { margin:0; accent-color:#1890ff; }
        select { border:1px solid #d9d9d9; border-radius:4px; padding:4px 8px; font-size:12px; outline:none; width:100%; background:#fff; }
        select:focus { border-color:#1890ff; }
        input[type=color] { width:32px; height:28px; padding:2px; border:1px solid #d9d9d9; border-radius:4px; cursor:pointer; }
        .cl { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
        .cs { width:24px; height:24px; border-radius:4px; border:2px solid #e8e8e8; cursor:pointer; position:relative; transition:border-color .2s; }
        .cs:hover { border-color:#ff4d4f; }
        .cs:hover::after { content:'×'; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); color:#ff4d4f; font-size:14px; font-weight:bold; }
        .acr { display:flex; gap:6px; margin-top:6px; align-items:center; }
        .ba { padding:4px 12px; background:#52c41a; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px; }
        .ba:hover { background:#73d13d; }
        .btn { flex:1; padding:8px 0; border:none; border-radius:4px; cursor:pointer; font-size:13px; font-weight:500; transition:all .2s; }
        .bp { background:#1890ff; color:#fff; } .bp:hover { background:#40a9ff; }
        .bs { background:#f5f5f5; color:#666; border:1px solid #d9d9d9; } .bs:hover { background:#fafafa; }
        .bu { background:#fff7e6; color:#fa8c16; border:1px solid #ffd591; } .bu:hover { background:#fff1d6; }
        .hint { font-size:11px; color:#999; margin-top:8px; text-align:center; }
        /* 模式切换开关 */
        .mode-sw { display:flex; align-items:center; gap:6px; }
        .mode-sw .track { width:36px; height:20px; background:#d9d9d9; border-radius:10px; position:relative; cursor:pointer; transition:background .2s; flex-shrink:0; }
        .mode-sw .track.on { background:#1890ff; }
        .mode-sw .thumb { width:16px; height:16px; background:#fff; border-radius:50%; position:absolute; top:2px; left:2px; transition:left .2s; box-shadow:0 1px 3px rgba(0,0,0,.2); }
        .mode-sw .track.on .thumb { left:18px; }
        .mode-sw .label { font-size:12px; color:#666; }
        .mode-sw .label.active { color:#1890ff; font-weight:500; }
        /* 元素类型过滤 */
        .type-grid { display:flex; flex-wrap:wrap; gap:4px; }
        .type-tag { font-size:11px; padding:2px 8px; border:1px solid #d9d9d9; border-radius:12px; cursor:pointer; user-select:none; transition:all .15s; }
        .type-tag.on { background:#e6f7ff; border-color:#1890ff; color:#1890ff; }
        .type-tag:hover { border-color:#1890ff; }
        .type-tag .tc { font-size:10px; color:#999; margin-left:2px; }
        .type-empty { font-size:12px; color:#999; }
        /* 刷新按钮 */
        .refresh-btn { font-size:11px; padding:2px 8px; border:1px solid #d9d9d9; border-radius:4px; cursor:pointer; background:#fafafa; color:#666; margin-left:6px; }
        .refresh-btn:hover { border-color:#1890ff; color:#1890ff; }
      </style>
      <div class="sel"><span class="cnt"></span></div>
      <div class="pnl">
        <div class="pnl-h">
          <span>🎨 随机着色</span>
          <div class="mode-sw">
            <span class="label" id="modeLabel">普通</span>
            <div class="track" id="modeTrack"><div class="thumb"></div></div>
            <span class="label" id="modeLabel2">着色</span>
          </div>
        </div>
        <div class="pnl-b">
          <div class="f">
            <span class="fl">元素类型 <button class="refresh-btn" id="refreshTypes">刷新</button></span>
            <div class="type-grid" id="typeGrid">
              <span class="type-empty">点击「着色」后自动扫描</span>
            </div>
          </div>
          <div class="f">
            <span class="fl">色彩梯度</span>
            <select id="gPreset">
              <option value="">不使用</option>
              <option value="warm">暖色（浅→深）</option>
              <option value="cool">冷色（浅→深）</option>
              <option value="rainbow">彩虹（浅→深）</option>
              <option value="pastel">粉彩（浅→深）</option>
              <option value="neon">霓虹（浅→深）</option>
              <option value="grayscale">灰度（浅→深）</option>
            </select>
          </div>
          <div class="f">
            <span class="fl">候选颜色 (点击删除)</span>
            <div class="cl" id="cList"></div>
            <div class="acr">
              <input type="color" id="nColor" value="#1890ff">
              <button class="ba" id="addC">添加</button>
            </div>
          </div>
        </div>
        <div class="pnl-f">
          <button class="btn bu" id="undoBtn">撤销</button>
          <button class="btn bs" id="cancelBtn">取消</button>
          <button class="btn bp" id="applyBtn">应用着色</button>
        </div>
        <div class="hint">开启「着色」模式后框选元素，ESC 取消</div>
      </div>
    `;
    document.body.appendChild(overlayHost);
    selBox = overlayShadow.querySelector('.sel');
    counterEl = overlayShadow.querySelector('.cnt');
    panelEl = overlayShadow.querySelector('.pnl');
    modeToggle = overlayShadow.querySelector('#modeTrack');
    bindPanelEvents();
  }

  // ==================== 元素类型 UI ====================
  function refreshTypeGrid() {
    boardTypes = scanBoardTypes();
    // 默认全选
    enabledTypeKeys = new Set(boardTypes.map(t => t.key));
    renderTypeGrid();
  }

  function renderTypeGrid() {
    const grid = overlayShadow.querySelector('#typeGrid');
    if (!grid) return;
    grid.innerHTML = '';
    if (boardTypes.length === 0) {
      grid.innerHTML = '<span class="type-empty">未检测到元素</span>';
      return;
    }
    for (const t of boardTypes) {
      const tag = document.createElement('span');
      tag.className = 'type-tag' + (enabledTypeKeys.has(t.key) ? ' on' : '');
      tag.dataset.type = t.key;
      tag.innerHTML = t.label + '<span class="tc">(' + t.count + ')</span>';
      tag.addEventListener('click', () => {
        if (enabledTypeKeys.has(t.key)) {
          enabledTypeKeys.delete(t.key);
          tag.classList.remove('on');
        } else {
          enabledTypeKeys.add(t.key);
          tag.classList.add('on');
        }
      });
      grid.appendChild(tag);
    }
  }

  // ==================== 面板 ====================
  function bindPanelEvents() {
    overlayShadow.querySelector('#addC').addEventListener('click', () => {
      const c = overlayShadow.querySelector('#nColor').value.toUpperCase();
      if (!candidateColors.includes(c)) { candidateColors.push(c); renderColors(); }
    });
    overlayShadow.querySelector('#applyBtn').addEventListener('click', applyColoring);
    overlayShadow.querySelector('#undoBtn').addEventListener('click', undoColoring);
    overlayShadow.querySelector('#cancelBtn').addEventListener('click', deactivate);
    modeToggle.addEventListener('click', toggleColoringMode);
    overlayShadow.querySelector('#refreshTypes').addEventListener('click', refreshTypeGrid);
    renderColors();
  }

  function toggleColoringMode() {
    coloringMode = !coloringMode;
    modeToggle.classList.toggle('on', coloringMode);
    const labelNormal = overlayShadow.querySelector('#modeLabel');
    const labelColoring = overlayShadow.querySelector('#modeLabel2');
    labelNormal.classList.toggle('active', !coloringMode);
    labelColoring.classList.toggle('active', coloringMode);

    if (coloringMode) {
      // 进入着色模式：扫描画板元素类型
      refreshTypeGrid();
      // overlay 拦截事件，阻止画板拖动
      overlayHost.style.pointerEvents = 'auto';
      document.body.style.cursor = 'crosshair';
      bindSelectionEvents();
    } else {
      // 退出着色模式
      overlayHost.style.pointerEvents = 'none';
      document.body.style.cursor = '';
      unbindSelectionEvents();
      clearHighlight();
      selBox.style.display = 'none';
    }
  }

  function renderColors() {
    const el = overlayShadow.querySelector('#cList');
    el.innerHTML = '';
    candidateColors.forEach((c, i) => {
      const s = document.createElement('div');
      s.className = 'cs'; s.style.background = c; s.title = c;
      s.onclick = () => { candidateColors.splice(i, 1); renderColors(); };
      el.appendChild(s);
    });
  }

  // ==================== 框选 ====================
  const DRAG_TH = 5;
  let onKey = null;

  function activate() {
    if (isActive) return;
    isActive = true;
    createOverlay();
    panelEl.style.display = 'block';
    overlayHost.style.pointerEvents = 'none';
    coloringMode = false;
    if (modeToggle) modeToggle.classList.remove('on');
    const labelNormal = overlayShadow.querySelector('#modeLabel');
    const labelColoring = overlayShadow.querySelector('#modeLabel2');
    if (labelNormal) labelNormal.classList.add('active');
    if (labelColoring) labelColoring.classList.remove('active');
    onKey = e => { if (e.key === 'Escape') deactivate(); };
    document.addEventListener('keydown', onKey, true);
  }

  function deactivate() {
    isActive = false; coloringMode = false;
    if (overlayHost) overlayHost.style.pointerEvents = 'none';
    document.body.style.cursor = '';
    if (selBox) selBox.style.display = 'none';
    if (panelEl) panelEl.style.display = 'none';
    if (modeToggle) modeToggle.classList.remove('on');
    clearHighlight();
    unbindSelectionEvents();
    if (onKey) { document.removeEventListener('keydown', onKey, true); onKey = null; }
  }

  /**
   * 绑定框选事件（着色模式下）
   * 使用 stopPropagation + preventDefault 阻止画板处理事件
   * panelEl 判断用 target.closest 或 shadow root 内检测
   */
  function bindSelectionEvents() {
    unbindSelectionEvents();

    const onMD = e => {
      if (e.button !== 0) return;
      // 判断是否点在面板区域内
      // e.target 在 shadow DOM 内，直接检查是否在 panelEl 内
      const target = e.target;
      if (panelEl && (target === panelEl || panelEl.contains(target))) return;
      e.stopPropagation();
      e.preventDefault();
      startX = e.clientX; startY = e.clientY;
      endX = e.clientX; endY = e.clientY;
      isDragging = false;
    };

    const onMM = e => {
      if (startX === undefined) return;
      if (!isDragging && (Math.abs(e.clientX - startX) > DRAG_TH || Math.abs(e.clientY - startY) > DRAG_TH)) {
        isDragging = true; selBox.style.display = 'block'; panelEl.style.display = 'none';
      }
      if (isDragging) {
        endX = e.clientX; endY = e.clientY;
        updateSelBox(startX, startY, endX, endY);
        highlightInRect(startX, startY, endX, endY);
      }
    };

    const onMU = e => {
      if (isDragging) {
        endX = e.clientX; endY = e.clientY;
        finalizeSelection(startX, startY, endX, endY);
      }
      isDragging = false; startX = undefined;
    };

    document.addEventListener('mousedown', onMD, true);
    document.addEventListener('mousemove', onMM, true);
    document.addEventListener('mouseup', onMU, true);

    // 保存引用以便解绑
    window.__yc_onMD = onMD;
    window.__yc_onMM = onMM;
    window.__yc_onMU = onMU;
  }

  function unbindSelectionEvents() {
    if (window.__yc_onMD) { document.removeEventListener('mousedown', window.__yc_onMD, true); window.__yc_onMD = null; }
    if (window.__yc_onMM) { document.removeEventListener('mousemove', window.__yc_onMM, true); window.__yc_onMM = null; }
    if (window.__yc_onMU) { document.removeEventListener('mouseup', window.__yc_onMU, true); window.__yc_onMU = null; }
  }

  function updateSelBox(x1, y1, x2, y2) {
    selBox.style.left = Math.min(x1, x2) + 'px';
    selBox.style.top = Math.min(y1, y2) + 'px';
    selBox.style.width = Math.abs(x2 - x1) + 'px';
    selBox.style.height = Math.abs(y2 - y1) + 'px';
  }

  // ==================== 元素碰撞 ====================
  function rectsOverlap(a, b) {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  }

  function getGroupsInRect(x1, y1, x2, y2) {
    const svg = findBoardSvg();
    if (!svg) return [];
    const selRect = { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
    const groups = svg.querySelectorAll('g[transform]');
    const result = [];
    for (const g of groups) {
      if (g.querySelector('g[transform]')) continue;
      const shapes = getShapesInGroup(g);
      if (shapes.length === 0) continue;

      // 按元素类型过滤
      const firstShape = shapes[0];
      const typeKey = classifyElement(firstShape);
      if (!enabledTypeKeys.has(typeKey)) continue;

      const r = getElRect(firstShape);
      if (!r || r.width === 0 || r.height === 0) continue;
      if (rectsOverlap(selRect, r)) result.push({ group: g, shapes });
    }
    return result;
  }

  let highlightedEls = [];

  function highlightInRect(x1, y1, x2, y2) {
    clearHighlight();
    const items = getGroupsInRect(x1, y1, x2, y2);
    for (const { shapes } of items) {
      for (const s of shapes) {
        s._origFilter = s.style.filter;
        s.style.filter = 'drop-shadow(0 0 3px #1890ff)';
        highlightedEls.push(s);
      }
    }
    counterEl.textContent = items.length + ' 个元素';
  }

  function clearHighlight() {
    for (const s of highlightedEls) {
      s.style.filter = s._origFilter || '';
    }
    highlightedEls = [];
  }

  // ==================== 完成框选 ====================
  function finalizeSelection(x1, y1, x2, y2) {
    selectedElements = getGroupsInRect(x1, y1, x2, y2);
    clearHighlight();
    if (!selectedElements.length) {
      selBox.style.display = 'none';
      panelEl.style.display = 'block';
      return;
    }
    // 框选完成后退出着色模式，显示面板
    coloringMode = false;
    modeToggle.classList.remove('on');
    const labelNormal = overlayShadow.querySelector('#modeLabel');
    const labelColoring = overlayShadow.querySelector('#modeLabel2');
    if (labelNormal) labelNormal.classList.add('active');
    if (labelColoring) labelColoring.classList.remove('active');
    overlayHost.style.pointerEvents = 'none';
    document.body.style.cursor = '';
    unbindSelectionEvents();
    panelEl.style.display = 'block';
    selBox.style.display = 'none';
  }

  // ==================== 着色 ====================
  function applyColoring() {
    if (!selectedElements.length) return;
    const preset = overlayShadow.querySelector('#gPreset').value;
    const gradient = preset ? GRADIENT_PRESETS[preset] : null;
    const n = selectedElements.length;

    let palette;
    if (candidateColors.length > 0 && gradient) {
      // 候选颜色 + 色彩梯度：随机选一个候选色，做亮度梯度
      palette = generateCandidatesLightnessGradient(candidateColors, Math.min(n, 20));
    } else if (candidateColors.length > 0) {
      palette = [...candidateColors];
    } else if (gradient) {
      palette = generateLightnessGradient(gradient, Math.min(n, 20));
    } else {
      palette = generateLightnessGradient(GRADIENT_PRESETS.rainbow, Math.min(n, 20));
    }

    const shapes = selectedElements.map(item => item.shapes[0]);
    const colorMap = spatialColoring(shapes, palette);

    const snapshot = shapes.map(s => ({ el: s, fill: getFill(s) }));
    undoStack.push(snapshot);

    colorMap.forEach((color, idx) => {
      if (shapes[idx]) setFill(shapes[idx], color);
    });
  }

  function undoColoring() {
    if (!undoStack.length) return;
    const snapshot = undoStack.pop();
    for (const { el, fill } of snapshot) {
      if (fill) setFill(el, fill);
      else el.removeAttribute('fill');
    }
  }

  // ==================== 消息监听 ====================
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'ACTIVATE_COLORIZER') activate();
  });
  window.addEventListener('message', e => {
    if (e.data?.source === 'yuque-colorizer' && e.data.type === 'ACTIVATE_SELECTION') activate();
  });

  console.log('[Colorizer] Loaded. Click extension icon to activate.');
})();
