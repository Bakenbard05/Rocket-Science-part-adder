// The curve editor of the flame: the radius of the flame along its length.
//
// The game builds the flame out of a profile: the curve of the radius (the
// profile of the flame, evaluated over its length) and the length and the
// radius of the layer. The editor draws that curve, the loader writes it into
// a copy of the desc of the game, and the shader of the game makes the flame
// out of it.
import { t } from './i18n.js';

const PADDING = 12;
const HIT = 7;

export function createCurveEditor(canvas, options) {
  const context = canvas.getContext('2d');
  let dragging = -1;

  const points = () => (options.getPoints ? options.getPoints() : []);

  // The canvas is drawn in the pixels of the screen: the size of the picture
  // is the size of the field times the density of the pixels, so the dots land
  // exactly where the mouse is.
  function prepare() {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 300;
    const height = canvas.clientHeight || 160;
    const pictureWidth = Math.round(width * ratio);
    const pictureHeight = Math.round(height * ratio);
    if (canvas.width !== pictureWidth || canvas.height !== pictureHeight) {
      canvas.width = pictureWidth;
      canvas.height = pictureHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { width, height };
  }

  function layout() {
    const size = prepare();
    const left = PADDING;
    const right = size.width - PADDING;
    const top = PADDING;
    const bottom = size.height - PADDING;
    return { width: size.width, height: size.height, left, right, top, bottom };
  }

  // The biggest radius of the curve fits the height of the field.
  function maxRadius(box) {
    let biggest = 0.1;
    for (const point of points()) {
      biggest = Math.max(biggest, Number(point.r) || 0);
    }
    return biggest;
  }

  function toScreen(point, box, scale) {
    return {
      x: box.left + (Number(point.v) || 0) * (box.right - box.left),
      y: box.bottom - ((Number(point.r) || 0) / scale) * (box.bottom - box.top),
    };
  }

  function toModel(x, y, box, scale) {
    const v = (x - box.left) / (box.right - box.left);
    const r = ((box.bottom - y) / (box.bottom - box.top)) * scale;
    return {
      v: Math.max(0, Math.min(1, Math.round(v * 1000) / 1000)),
      r: Math.max(0, Math.round(r * 1000) / 1000),
    };
  }

  function draw() {
    const box = layout();
    const scale = maxRadius(box);
    context.clearRect(0, 0, box.width, box.height);

    // the field
    context.strokeStyle = 'rgba(255,255,255,0.12)';
    context.lineWidth = 1;
    context.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top);

    context.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let i = 1; i < 4; i++) {
      const x = box.left + ((box.right - box.left) * i) / 4;
      context.beginPath();
      context.moveTo(x, box.top);
      context.lineTo(x, box.bottom);
      context.stroke();
    }

    // the zero line of the radius
    context.strokeStyle = 'rgba(255,255,255,0.06)';
    const zero = box.bottom - (0 / scale) * (box.bottom - box.top);
    context.beginPath();
    context.moveTo(box.left, zero);
    context.lineTo(box.right, zero);
    context.stroke();

    const list = points();
    if (!list.length) {
      context.fillStyle = 'rgba(255,255,255,0.4)';
      context.font = '11px sans-serif';
      context.fillText(t('flame.curveEmpty'), box.left + 6, box.top + 16);
      return;
    }

    // the curve
    context.strokeStyle = '#ffb347';
    context.lineWidth = 2;
    context.beginPath();
    list.forEach((point, index) => {
      const screen = toScreen(point, box, scale);
      if (index === 0) context.moveTo(screen.x, screen.y);
      else context.lineTo(screen.x, screen.y);
    });
    context.stroke();

    // the points
    list.forEach((point, index) => {
      const screen = toScreen(point, box, scale);
      context.fillStyle = index === dragging ? '#ffffff' : '#ffb347';
      context.beginPath();
      context.arc(screen.x, screen.y, index === dragging ? 5 : 4, 0, Math.PI * 2);
      context.fill();
    });

    // the axes: the length of the flame along x, the radius along y.
    context.fillStyle = 'rgba(255,255,255,0.45)';
    context.font = '10px sans-serif';
    context.textAlign = 'left';
    context.fillText(t('flame.curveRadius', { value: scale.toFixed(2) }), box.left + 4, box.top + 12);
    context.textAlign = 'right';
    const length = options.getLength ? Number(options.getLength()) : 0;
    context.fillText(
      length > 0 ? t('flame.curveLength', { value: length.toFixed(2) }) : '',
      box.right - 4,
      box.bottom - 4,
    );
    context.textAlign = 'left';
  }

  function hitTest(x, y) {
    const box = layout();
    const scale = maxRadius(box);
    const list = points();
    let best = -1;
    let bestDistance = HIT * HIT;
    for (let i = 0; i < list.length; i++) {
      const screen = toScreen(list[i], box, scale);
      const distance = (screen.x - x) * (screen.x - x) + (screen.y - y) * (screen.y - y);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  // The place of the mouse in the model.
  function modelAt(event) {
    const rect = canvas.getBoundingClientRect();
    const box = layout();
    const scale = maxRadius(box);
    return toModel(event.clientX - rect.left, event.clientY - rect.top, box, scale);
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 2) {
      // The right button removes the point under the mouse.
      const rect = canvas.getBoundingClientRect();
      const index = hitTest(event.clientX - rect.left, event.clientY - rect.top);
      if (index >= 0) {
        const list = points().slice();
        list.splice(index, 1);
        options.onChange(list);
        draw();
      }
      return;
    }

    if (event.button !== 0) return;

    const rect = canvas.getBoundingClientRect();
    const index = hitTest(event.clientX - rect.left, event.clientY - rect.top);
    if (index >= 0) {
      dragging = index;
      try { canvas.setPointerCapture(event.pointerId); } catch (e) { /* без захвата тоже работает */ }
      draw();
      return;
    }

    // A new point.
    const model = modelAt(event);
    const list = points().slice();
    list.push({ v: model.v, r: model.r });
    list.sort((a, b) => a.v - b.v);
    options.onChange(list);

    // The new point is the one that was added: the list is sorted by the
    // place along the flame.
    dragging = list.findIndex((point) => point.v === model.v && point.r === model.r);
    try { canvas.setPointerCapture(event.pointerId); } catch (e) { /* без захвата тоже работает */ }
    draw();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (dragging < 0) return;
    const model = modelAt(event);
    const list = points().slice();
    if (dragging >= list.length) return;
    list[dragging] = { v: model.v, r: model.r };
    list.sort((a, b) => a.v - b.v);
    dragging = list.findIndex((point) => point.v === model.v && point.r === model.r);
    options.onChange(list);
    draw();
  });

  const stop = () => {
    if (dragging >= 0) {
      dragging = -1;
      draw();
    }
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  // The field is drawn again when its size changes.
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
  }

  return { draw };
}

// The default profile: the shape of the stock flame of the game (engine_0).
// The values are the radius in metres along the flame, so the flame opens up
// right at the nozzle and keeps its width further down.
export function defaultFlameProfile(radius = 0.12) {
  const shape = [
    [0.0, 0.0],
    [0.015, 0.316],
    [0.048, 0.555],
    [0.349, 0.915],
    [0.502, 0.966],
    [0.785, 0.991],
    [1.0, 1.0],
  ];

  return shape.map(([v, r]) => ({ v, r: Math.round(r * radius * 1000) / 1000 }));
}
