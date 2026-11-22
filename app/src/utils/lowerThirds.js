// Lower third styles for Live Studio, drawn straight onto the 1280x720 program canvas.
// The name and second line stay text, so one style works for any speaker.
//
// A lower third is { title, subtitle, style, frame }. "style" is one of LOWER_THIRD_STYLES;
// "frame" adds that style's border around the whole picture (only styles with hasFrame).
// A " | " in the second line is drawn in the style's accent color.

export const LOWER_THIRD_STYLES = [
  { id: 'classic', label: 'Classic' },
  { id: 'cream', label: 'Cream & serif', hasFrame: true },
  { id: 'gold', label: 'Navy & gold' },
  { id: 'teal', label: 'Teal tech', hasFrame: true },
  { id: 'slate', label: 'Clean slate' }
];

export const styleHasFrame = (style) => !!LOWER_THIRD_STYLES.find((s) => s.id === style)?.hasFrame;

const WIDTH = 1280;
const HEIGHT = 720;
const SANS_BASE = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const SANS = `Montserrat, ${SANS_BASE}`;
const SERIF = '"Playfair Display", Georgia, "Times New Roman", serif';

// The fonts come from the site's Google Fonts link; a canvas only uses a web font once it has
// loaded, so ask for them up front.
export const loadLowerThirdFonts = () => {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  return Promise.all([
    '400 40px "Playfair Display"', '700 40px "Playfair Display"',
    '400 40px Montserrat', '600 40px Montserrat', '700 40px Montserrat'
  ].map((f) => document.fonts.load(f).catch(() => {})));
};

const roundedRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// A closed shape through the points, with corners rounded by r (0 for sharp)
const polygon = (ctx, pts, r = 0) => {
  ctx.beginPath();
  const n = pts.length;
  if (!r) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    return;
  }
  const a = pts[n - 1];
  const b = pts[0];
  ctx.moveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    ctx.arcTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, r);
  }
  ctx.closePath();
};

// Shrinks the font until the text fits; leaves ctx.font set and returns the width
const fitText = (ctx, text, weight, size, family, maxWidth) => {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 14 && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return { size: s, width: ctx.measureText(text).width, font: ctx.font };
};

// Draws text with any " | " in the accent color (ctx.font and textBaseline already set)
const drawWithPipes = (ctx, text, x, y, color, pipeColor) => {
  const parts = text.split(/\s*\|\s*/);
  if (parts.length === 1 || !pipeColor) {
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    return;
  }
  const gap = ' | ';
  let cx = x;
  parts.forEach((part, i) => {
    if (i > 0) {
      const lead = ctx.measureText(' ').width;
      ctx.fillStyle = pipeColor;
      ctx.fillText('|', cx + lead, y);
      cx += ctx.measureText(gap).width;
    }
    ctx.fillStyle = color;
    ctx.fillText(part, cx, y);
    cx += ctx.measureText(part).width;
  });
};

// Measures what drawWithPipes will draw
const pipesWidth = (ctx, text) => {
  const parts = text.split(/\s*\|\s*/);
  return parts.length === 1 ? ctx.measureText(text).width : ctx.measureText(parts.join(' | ')).width;
};

const measure = (ctx, title, subtitle, t, s, maxWidth) => {
  const tm = fitText(ctx, title, t.weight, t.size, t.family, maxWidth);
  let sm = { size: 0, width: 0, font: '' };
  if (subtitle) {
    const shown = subtitle.split(/\s*\|\s*/).join(' | ');
    sm = fitText(ctx, shown, s.weight, s.size, s.family, maxWidth);
    sm.width = pipesWidth(ctx, subtitle);
  }
  return { tm, sm, contentW: Math.max(tm.width, sm.width) };
};

// ---------- the styles: each draws with its bottom edge at "bottom" and returns its height ----------

const classic = (ctx, title, subtitle, bottom) => {
  const { tm, sm, contentW } = measure(ctx, title, subtitle,
    { weight: 700, size: 36, family: SANS_BASE }, { weight: 400, size: 26, family: SANS_BASE }, WIDTH - 240);
  const h = subtitle ? 104 : 72;
  const w = contentW + 72;
  const x = 48;
  const y = bottom - h;
  ctx.fillStyle = 'rgba(11, 29, 68, 0.92)';
  roundedRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.fillStyle = '#e6252e';
  ctx.fillRect(x, y + 14, 6, h - 28);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = tm.font;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, x + 32, subtitle ? y + 36 : y + h / 2);
  if (subtitle) {
    ctx.font = sm.font;
    drawWithPipes(ctx, subtitle, x + 32, y + 74, 'rgba(255,255,255,0.82)', 'rgba(255,255,255,0.82)');
  }
  return h;
};

// Cream card on the right, dark green serif name, orange rule
const cream = (ctx, title, subtitle, bottom) => {
  const { tm, sm, contentW } = measure(ctx, title, subtitle,
    { weight: 700, size: 48, family: SERIF }, { weight: 400, size: 25, family: SANS }, 620);
  const h = subtitle ? 132 : 96;
  const padL = 64;
  const w = contentW + padL + 44;
  const right = WIDTH - 20;
  const x = right - w;
  const y = bottom - h;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#f8f2e7';
  polygon(ctx, [[x + 30, y], [right, y], [right, y + h], [x, y + h]], 14);
  ctx.fill();
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const tx = x + padL;
  ctx.font = tm.font;
  ctx.fillStyle = '#12332e';
  const nameY = subtitle ? y + 48 : y + h / 2 - 6;
  ctx.fillText(title, tx, nameY);
  ctx.fillStyle = '#e07a45';
  ctx.fillRect(tx, nameY + tm.size * 0.62, contentW, 3);
  if (subtitle) {
    ctx.font = sm.font;
    drawWithPipes(ctx, subtitle, tx, y + 104, '#2c3a38', '#2c3a38');
  }
  return h;
};

const goldGradient = (ctx, x0, x1) => {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, '#b8893b');
  g.addColorStop(0.45, '#f3d58c');
  g.addColorStop(1, '#c4953f');
  return g;
};

// Navy bar from the left edge, gold serif name, gold and teal slashes, gold line across
const gold = (ctx, title, subtitle, bottom) => {
  const { tm, sm, contentW } = measure(ctx, title, subtitle,
    { weight: 400, size: 50, family: SERIF }, { weight: 400, size: 27, family: SERIF }, 720);
  const h = subtitle ? 120 : 86;
  const tx = 92;
  const w = tx + contentW + 56;
  const slant = 34;
  const y = bottom - h;

  // Gold line across the frame
  const line = ctx.createLinearGradient(w, 0, WIDTH, 0);
  line.addColorStop(0, '#e3c27a');
  line.addColorStop(0.75, 'rgba(214,176,98,0.9)');
  line.addColorStop(1, 'rgba(214,176,98,0)');
  ctx.fillStyle = line;
  ctx.fillRect(w - slant, y + h - 8, WIDTH - (w - slant) - 12, 3);

  // The bar
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 18;
  const bg = ctx.createLinearGradient(0, y, 0, y + h);
  bg.addColorStop(0, '#11284a');
  bg.addColorStop(1, '#06142a');
  ctx.fillStyle = bg;
  polygon(ctx, [[0, y], [w, y], [w - slant, y + h], [0, y + h]]);
  ctx.fill();
  ctx.restore();

  // Gold edge along the top and the slant
  ctx.strokeStyle = goldGradient(ctx, 0, w);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, y + 1.5);
  ctx.lineTo(w, y + 1.5);
  ctx.lineTo(w - slant, y + h);
  ctx.stroke();

  // Teal and gold slashes past the slant
  ctx.fillStyle = '#2fb3ad';
  polygon(ctx, [[w + 12, y], [w + 24, y], [w + 24 - slant, y + h], [w + 12 - slant, y + h]]);
  ctx.fill();
  ctx.fillStyle = goldGradient(ctx, w, w + 40);
  polygon(ctx, [[w + 30, y + 10], [w + 36, y + 10], [w + 36 - slant * 0.9, y + h - 2], [w + 30 - slant * 0.9, y + h - 2]]);
  ctx.fill();

  // Gold and teal sweep on the left
  ctx.fillStyle = goldGradient(ctx, 0, 60);
  polygon(ctx, [[38, y + 10], [56, y + 10], [24, y + h - 10], [6, y + h - 10]]);
  ctx.fill();
  ctx.fillStyle = '#2fb3ad';
  polygon(ctx, [[60, y + 10], [64, y + 10], [32, y + h - 10], [28, y + h - 10]]);
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = tm.font;
  const nameY = subtitle ? y + 44 : y + h / 2;
  const tg = ctx.createLinearGradient(0, nameY - tm.size / 2, 0, nameY + tm.size / 2);
  tg.addColorStop(0, '#f8e1a0');
  tg.addColorStop(1, '#c99a46');
  ctx.fillStyle = tg;
  ctx.fillText(title, tx, nameY);
  if (subtitle) {
    ctx.font = sm.font;
    drawWithPipes(ctx, subtitle, tx, y + 92, '#f4efe4', '#d9b46a');
  }
  return h;
};

// The Knott Alone lightbulb with a K, centered on (cx, cy)
const bulbIcon = (ctx, cx, cy, color) => {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = 4;
  const r = 24;
  const by = cy - 6;
  ctx.beginPath();
  ctx.arc(cx, by, r, Math.PI * 0.72, Math.PI * 2.28);
  ctx.stroke();
  // Base of the bulb
  ctx.beginPath();
  ctx.moveTo(cx - 11, by + r + 6); ctx.lineTo(cx + 11, by + r + 6);
  ctx.moveTo(cx - 9, by + r + 13); ctx.lineTo(cx + 9, by + r + 13);
  ctx.moveTo(cx - 5, by + r + 20); ctx.lineTo(cx + 5, by + r + 20);
  ctx.stroke();
  // Rays
  ctx.lineWidth = 3.5;
  [-150, -120, -90, -60, -30].forEach((deg) => {
    const a = (deg * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r + 7), by + Math.sin(a) * (r + 7));
    ctx.lineTo(cx + Math.cos(a) * (r + 15), by + Math.sin(a) * (r + 15));
    ctx.stroke();
  });
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 28px ${SANS}`;
  ctx.fillText('K', cx, by + 2);
  ctx.restore();
};

const TEAL = '#38d3c9';
const BLUE = '#2f6fe8';

// Navy tab with the lightbulb, white name, teal slash
const teal = (ctx, title, subtitle, bottom) => {
  const { tm, sm, contentW } = measure(ctx, title, subtitle,
    { weight: 700, size: 46, family: SANS }, { weight: 600, size: 25, family: SANS }, 680);
  const h = subtitle ? 120 : 90;
  const x = 28;
  const iconW = 112;
  const tx = x + iconW + 30;
  const w = tx - x + contentW + 74;
  const slant = 42;
  const y = bottom - h;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 18;
  const bg = ctx.createLinearGradient(x, 0, x + w, 0);
  bg.addColorStop(0, '#0d2c70');
  bg.addColorStop(1, '#0a2158');
  ctx.fillStyle = bg;
  polygon(ctx, [[x, y], [x + w, y], [x + w - slant, y + h], [x, y + h]], 20);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = TEAL;
  polygon(ctx, [[x + w + 6, y + 4], [x + w + 22, y + 4], [x + w + 22 - slant, y + h], [x + w + 6 - slant, y + h]]);
  ctx.fill();

  bulbIcon(ctx, x + iconW / 2 + 8, y + h / 2, TEAL);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(x + iconW + 8, y + 20, 3, h - 40);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = tm.font;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, tx, subtitle ? y + 44 : y + h / 2);
  if (subtitle) {
    ctx.font = sm.font;
    drawWithPipes(ctx, subtitle, tx, y + 88, 'rgba(255,255,255,0.94)', TEAL);
  }
  return h;
};

// Dark gray bar, orange square, cyan underline
const slate = (ctx, title, subtitle, bottom) => {
  const { tm, sm, contentW } = measure(ctx, title, subtitle,
    { weight: 700, size: 46, family: SANS }, { weight: 400, size: 25, family: SANS }, 700);
  const h = subtitle ? 118 : 84;
  const tx = 88;
  const w = tx + contentW + 54;
  const y = bottom - h;
  ctx.fillStyle = 'rgba(40, 46, 54, 0.9)';
  polygon(ctx, [[0, y], [w + 22, y], [w, y + h], [0, y + h]]);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const nameY = subtitle ? y + 40 : y + h / 2 - 4;
  ctx.fillStyle = '#f07a62';
  ctx.fillRect(34, nameY - 6, 24, 24);
  ctx.font = tm.font;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, tx, nameY);
  ctx.fillStyle = '#5fd4ea';
  ctx.fillRect(tx - 10, nameY + tm.size * 0.6, contentW + 24, 4);
  if (subtitle) {
    ctx.font = sm.font;
    drawWithPipes(ctx, subtitle, tx, y + 92, '#e4e7eb', '#e4e7eb');
  }
  return h;
};

const DRAW = { classic, cream, gold, teal, slate };

// Draws the lower third with its bottom edge at "bottom"; returns the height used (0 if none)
export const drawLowerThird = (ctx, lt, bottom) => {
  const title = (lt?.title || '').trim();
  if (!title) return 0;
  const subtitle = (lt.subtitle || '').trim();
  ctx.save();
  const h = (DRAW[lt.style] || classic)(ctx, title, subtitle, bottom);
  ctx.restore();
  return h;
};

// ---------- frames around the whole picture ----------

// Orange corner brackets that fade out along each edge
const creamFrame = (ctx) => {
  const inset = 26;
  const armX = 260;
  const armY = 170;
  const color = '#d9773f';
  const corners = [
    [inset, inset, 1, 1], [WIDTH - inset, inset, -1, 1],
    [inset, HEIGHT - inset, 1, -1], [WIDTH - inset, HEIGHT - inset, -1, -1]
  ];
  corners.forEach(([cx, cy, dx, dy]) => {
    const gx = ctx.createLinearGradient(cx, 0, cx + dx * armX, 0);
    gx.addColorStop(0, color);
    gx.addColorStop(1, 'rgba(217,119,63,0)');
    ctx.fillStyle = gx;
    ctx.fillRect(dx > 0 ? cx : cx - armX, dy > 0 ? cy : cy - 3, armX, 3);
    const gy = ctx.createLinearGradient(0, cy, 0, cy + dy * armY);
    gy.addColorStop(0, color);
    gy.addColorStop(1, 'rgba(217,119,63,0)');
    ctx.fillStyle = gy;
    ctx.fillRect(dx > 0 ? cx : cx - 3, dy > 0 ? cy : cy - armY, 3, armY);
  });
};

const slashes = (ctx, x, y, colors) => {
  colors.forEach((c, i) => {
    const sx = x + i * 30;
    ctx.fillStyle = c;
    polygon(ctx, [[sx + 10, y], [sx + 30, y], [sx + 20, y + 16], [sx, y + 16]]);
    ctx.fill();
  });
};

// Thin teal border with cut corners, and slashes at the corners
const tealFrame = (ctx) => {
  const i = 18;
  const c = 26;
  ctx.strokeStyle = 'rgba(56, 211, 201, 0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(i + c, i);
  ctx.lineTo(WIDTH - i - c, i);
  ctx.lineTo(WIDTH - i, i + c);
  ctx.lineTo(WIDTH - i, HEIGHT - i - c);
  ctx.lineTo(WIDTH - i - c, HEIGHT - i);
  ctx.lineTo(i + c, HEIGHT - i);
  ctx.lineTo(i, HEIGHT - i - c);
  ctx.lineTo(i, i + c);
  ctx.closePath();
  ctx.stroke();
  slashes(ctx, WIDTH - 130, 8, [TEAL, TEAL, BLUE]);
  slashes(ctx, WIDTH - 160, HEIGHT - 26, [TEAL, TEAL, BLUE, BLUE]);
  slashes(ctx, 10, 34, [BLUE]);
};

const FRAMES = { cream: creamFrame, teal: tealFrame };

// Draws the style's border around the whole picture, if the lower third has one turned on
export const drawLowerThirdFrame = (ctx, lt) => {
  if (!lt?.title || !lt.frame || !FRAMES[lt.style]) return;
  ctx.save();
  FRAMES[lt.style](ctx);
  ctx.restore();
};

// A sample picture for the style picker: a dark stand-in for the camera with the lower third on it
export const drawLowerThirdSample = (canvas, lt) => {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, '#5b6f8c');
  bg.addColorStop(1, '#2b3647');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc(WIDTH / 2, 300, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(WIDTH / 2, 640, 260, 200, 0, Math.PI, 0);
  ctx.fill();
  drawLowerThirdFrame(ctx, lt);
  drawLowerThird(ctx, lt, HEIGHT - 32);
};
