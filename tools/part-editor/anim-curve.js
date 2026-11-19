// The graph editor of a motion: the curve of the channel (the angle of the node
// or its offset in metres) over the time, the keyframes on it and the playhead.
//
// It works like the graph editor of Blender: the curve is the value of the
// channel, the points on it are the keyframes, and a point is dragged to move
// the keyframe. The evaluation is the same as the runtime driver
// (PartAnimationDriver), so the preview shows what the game will do.
//
// The types of the game are only the shapes of the curve:
//   spin   - a straight line, the speed is its slope
//   deploy - two poses, the motion from the one to the other
//   keys   - the keyframes of the author

const MARGIN = { left: 46, right: 14, top: 20, bottom: 24 };

// The length of the curve of a motion.
export function motionDuration(animation) {
  const duration = Number(animation?.duration);
  return duration > 0 ? duration : 2;
}

// The points of the curve: the poses of a spin and a deploy, the keyframes of
// a motion with keys. "index" is the number of the key in the part.json, -1
// when the point is a pose of a spin or a deploy.
export function motionPoints(animation) {
  if (!animation) return [];

  if (animation.type === 'deploy') {
    const duration = motionDuration(animation);
    return [
      { time: 0, value: Number(animation.stowed) || 0, smooth: true, index: -1, pose: 'stowed' },
      { time: duration, value: Number(animation.deployed) || 0, smooth: true, index: -1, pose: 'deployed' },
    ];
  }

  if (animation.type === 'keys') {
    const keys = Array.isArray(animation.keys) ? animation.keys : [];
    return keys.map((key, index) => ({
      time: Number(key.time) || 0,
      value: Number(key.angle) || 0,
      smooth: key.smooth !== false,
      index,
    }));
  }

  const duration = motionDuration(animation);
  const speed = Number(animation.speed) || 0;
  return [
    { time: 0, value: 0, smooth: true, index: -1 },
    { time: duration, value: speed * duration, smooth: true, index: -1 },
  ];
}

// The value of the curve at a time, the way the runtime driver reads it.
export function sampleMotion(animation, time) {
  if (!animation) return 0;

  if (animation.type === 'deploy') {
    const duration = motionDuration(animation);
    const t = Math.min(1, Math.max(0, time / duration));
    const smooth = t * t * (3 - 2 * t);
    const stowed = Number(animation.stowed) || 0;
    const deployed = Number(animation.deployed) || 0;
    return stowed + (deployed - stowed) * smooth;
  }

  if (animation.type === 'keys') {
    const keys = Array.isArray(animation.keys) ? animation.keys : [];
    if (!keys.length) return 0;
    if (keys.length === 1) return Number(keys[0].angle) || 0;
    if (time <= (Number(keys[0].time) || 0)) return Number(keys[0].angle) || 0;

    for (let i = 0; i < keys.length - 1; i++) {
      const from = keys[i];
      const to = keys[i + 1];
      const fromTime = Number(from.time) || 0;
      const toTime = Number(to.time) || 0;
      if (time > toTime) continue;
      const span = toTime - fromTime;
      let t = span <= 0.0001 ? 1 : (time - fromTime) / span;
      t = Math.min(1, Math.max(0, t));
      if (to.smooth !== false) t = t * t * (3 - 2 * t);
      return (Number(from.angle) || 0) + ((Number(to.angle) || 0) - (Number(from.angle) || 0)) * t;
    }

    return Number(keys[keys.length - 1].angle) || 0;
  }

  return (Number(animation.speed) || 0) * time;
}

export function createCurveEditor(root, options) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('anim-curve-svg');
  root.append(svg);

  let width = 320;
  let height = 190;
  let dragging = null;
  // The range of the value axis while a point is dragged: it stays as it was,
  // so the point follows the mouse and the value does not run away.
  let frozenRange = null;
  // The same for the axis of the time: the end of a motion can be dragged past
  // its length, so the axis grows with it.
  let frozenTime = null;

  const animation = () => options.getAnimation() || null;
  const unit = () => (animation()?.translate ? ' m' : '°');

  function plotWidth() {
    return Math.max(40, width - MARGIN.left - MARGIN.right);
  }

  function plotHeight() {
    return Math.max(40, height - MARGIN.top - MARGIN.bottom);
  }

  // The axis of the time: the length of the motion, a little more when a point
  // was dragged past the end.
  function timeRange() {
    if (frozenTime !== null) return frozenTime;

    const motion = animation();
    const duration = motionDuration(motion);
    if (motion?.type === 'keys') return duration;

    let biggest = duration;
    for (const point of motionPoints(motion)) biggest = Math.max(biggest, point.time);
    return biggest * 1.05;
  }

  function timeToX(time) {
    return MARGIN.left + (time / timeRange()) * plotWidth();
  }

  function xToTime(x) {
    const range = timeRange();
    return Math.max(0, Math.min(range, ((x - MARGIN.left) / plotWidth()) * range));
  }

  // The range of the value axis: the curve fits into it, the steps are round
  // numbers (like the view of the graph editor of Blender).
  function valueRange() {
    if (frozenRange !== null) return frozenRange;

    const motion = animation();
    let biggest = 0;
    for (const point of motionPoints(motion)) biggest = Math.max(biggest, Math.abs(point.value));
    if (!biggest) biggest = motion?.translate ? 0.5 : 15;

    const step = motion?.translate ? 0.25 : 15;
    return Math.max(step, Math.ceil(biggest / step) * step);
  }

  function valueToY(value) {
    const range = valueRange();
    const middle = MARGIN.top + plotHeight() / 2;
    return middle - (value / range) * (plotHeight() / 2);
  }

  function yToValue(y) {
    const range = valueRange();
    const middle = MARGIN.top + plotHeight() / 2;
    return ((middle - y) / (plotHeight() / 2)) * range;
  }

  function element(name, attributes) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes || {})) node.setAttribute(key, value);
    return node;
  }

  function render() {
    width = Math.max(220, root.clientWidth || 320);
    height = Math.max(150, root.clientHeight || 190);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.textContent = '';

    const motion = animation();
    const plot = element('rect', {
      x: MARGIN.left, y: MARGIN.top, width: plotWidth(), height: plotHeight(), class: 'ac-plot',
    });
    svg.append(plot);

    // The grid: the time in seconds and the value in steps.
    const timeRangeNow = timeRange();
    const duration = motionDuration(motion);
    const timeStep = timeRangeNow > 8 ? 2 : timeRangeNow > 4 ? 1 : 0.5;
    const values = valueRange();
    const valueStep = values / 4;

    for (let time = 0; time <= timeRangeNow + 0.0001; time += timeStep) {
      const x = timeToX(time);
      svg.append(element('line', { x1: x, x2: x, y1: MARGIN.top, y2: MARGIN.top + plotHeight(), class: 'ac-grid' }));
      const label = element('text', { x: x + 3, y: height - 8, class: 'ac-label' });
      label.textContent = `${Number(time.toFixed(2))}s`;
      svg.append(label);
    }

    for (let value = -values; value <= values + 0.0001; value += valueStep) {
      const y = valueToY(value);
      svg.append(element('line', { x1: MARGIN.left, x2: MARGIN.left + plotWidth(), y1: y, y2: y, class: value === 0 ? 'ac-grid ac-grid-zero' : 'ac-grid' }));
      const label = element('text', { x: 4, y: y + 4, class: 'ac-label' });
      label.textContent = `${Math.round(value * 10) / 10}${unit()}`;
      svg.append(label);
    }

    // The curve itself.
    const points = [];
    const steps = Math.max(24, Math.round(plotWidth() / 3));
    for (let i = 0; i <= steps; i++) {
      const time = (i / steps) * duration;
      points.push(`${timeToX(time)} ${valueToY(sampleMotion(motion, time))}`);
    }
    svg.append(element('path', { d: `M ${points.join(' L ')}`, class: 'ac-curve' }));

    // The keyframes.
    const selected = options.selectedKey();
    motionPoints(motion).forEach((point) => {
      const isSelected = selected && selected.track === options.getIndex() && selected.key === point.index;
      const dot = element('circle', {
        cx: timeToX(point.time),
        cy: valueToY(point.value),
        r: isSelected ? 6 : 4.5,
        class: point.index >= 0 ? 'ac-dot ac-key' : 'ac-dot',
      });
      const tip = element('title', {});
      tip.textContent = `${point.time.toFixed(2)} s, ${Math.round(point.value * 10) / 10}${unit()}`;
      dot.append(tip);
      dot.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        event.preventDefault();
        options.onSelectKey(point.index);
        dragging = { point, range: valueRange() };
        frozenRange = dragging.range;
        // The value of the key follows the pointer one to one in the scale of
        // the moment of the grab. Mapping every move through the live range
        // again would feed itself once the range grows (the value grows, the
        // range grows with it, the same pixel maps higher), so the scale is
        // frozen here and only the window grows in pointermove.
        dragging.unitsPerPixel = dragging.range / (plotHeight() / 2);
        dragging.startValue = point.value;
        dragging.startY = event.clientY;
        frozenTime = timeRange();
        try { svg.setPointerCapture(event.pointerId); } catch (e) { /* no capture, the drag still works */ }
      });
      dot.addEventListener('contextmenu', (event) => {
        if (point.index < 0) return;
        event.preventDefault();
        event.stopPropagation();
        options.onRemoveKey(point.index);
      });
      svg.append(dot);
    });

    updatePlayhead();
  }

  function updatePlayhead() {
    let line = svg.querySelector('.ac-playhead');
    if (!line) {
      line = element('line', { class: 'ac-playhead' });
      svg.append(line);
    }
    const x = timeToX(options.getTime());
    line.setAttribute('x1', x);
    line.setAttribute('x2', x);
    line.setAttribute('y1', MARGIN.top - 6);
    line.setAttribute('y2', MARGIN.top + plotHeight());
  }

  // The header of the graph: the current time, and it can be dragged to scrub.
  svg.addEventListener('pointerdown', (event) => {
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (y < MARGIN.top) {
      // The header scrubs the playhead.
      options.onScrub(xToTime(x));
      dragging = { scrub: true };
      try { svg.setPointerCapture(event.pointerId); } catch (e) { /* no capture */ }
      return;
    }

    // A click in the plot adds a keyframe (like the insert keyframe of
    // Blender). A click on the axes around the plot only moves the playhead:
    // a key from the margin would land outside the visible window.
    const motion = animation();
    const inPlot = x >= MARGIN.left && x <= MARGIN.left + plotWidth() &&
      y >= MARGIN.top && y <= MARGIN.top + plotHeight();
    if (motion?.type === 'keys' && inPlot) {
      options.onAddKey(xToTime(x), yToValue(y));
    } else {
      options.onScrub(xToTime(x));
    }
  });

  svg.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (dragging.scrub) {
      options.onScrub(xToTime(x));
      return;
    }

    if (!dragging.point) return;
    const time = xToTime(x);
    // The value follows the pointer one to one (the scale of the moment of the
    // grab), and the keyframe stays inside the window: past the top or the
    // bottom edge the axis of the value grows in round steps (the view zooms
    // out with the drag), so the point never leaves the plot and the numbers
    // cannot run away.
    let value = dragging.startValue + (dragging.startY - event.clientY) * dragging.unitsPerPixel;
    const step = animation()?.translate ? 0.25 : 15;
    if (Math.abs(value) > dragging.range) {
      dragging.range = frozenRange = Math.ceil((Math.abs(value) - dragging.range) / step) * step + dragging.range;
    }
    value = Math.max(-dragging.range, Math.min(dragging.range, value));
    options.onDragKey(dragging.point, time, value);
    render();
  });

  const endDrag = () => {
    dragging = null;
    frozenRange = null;
    frozenTime = null;
    options.onDragEnd?.();
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('contextmenu', (event) => event.preventDefault());

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => render());
    observer.observe(root);
  }

  return { render, updatePlayhead };
}
