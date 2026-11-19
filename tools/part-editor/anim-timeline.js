// The timeline of the motions of a part: one track per motion, the keys of a
// track can be dragged, the playhead scrubs the preview in the viewport.
//
// The motions of the game are simple: a node spins around an axis or moves
// between two poses ("deploy"). A track with keys ("keys") describes the angle
// of the node over the time, the same way the runtime driver reads them
// (PartAnimationDriver.SampleKeys).
import { t } from './i18n.js';
import { motionDuration, motionPoints, sampleMotion } from './anim-curve.js';

const HEADER_WIDTH = 172;
const RULER_HEIGHT = 22;
const TRACK_HEIGHT = 46;
const MIN_DURATION = 2;
const MARGIN = 10;

export function createTimeline(root, options) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('anim-timeline-svg');
  root.append(svg);

  let width = 600;
  let dragging = null;
  // The last click on a lane: a second click adds a key.
  let lastClick = 0;
  let lastClickX = 0;

  const animations = () => options.animations() || [];

  // The length of the timeline: the longest motion of the part.
  function duration() {
    let longest = MIN_DURATION;
    for (const animation of animations()) {
      const value = Number(animation.duration);
      if (value > longest) longest = value;
    }
    return longest;
  }

  function laneWidth() {
    return Math.max(60, width - HEADER_WIDTH - MARGIN * 2);
  }

  function timeToX(time) {
    return HEADER_WIDTH + MARGIN + (time / duration()) * laneWidth();
  }

  function xToTime(x) {
    const t = ((x - HEADER_WIDTH - MARGIN) / laneWidth()) * duration();
    return Math.max(0, Math.min(duration(), t));
  }

  // The value axis of a track: the biggest angle of the track is the full height.
  // The range of a track with keys is rounded up, so the track does not jump
  // while a key is dragged (and the angle of the key does not run away).
  function trackRange(animation, index) {
    if (dragging && dragging.kind === 'key' && dragging.track === index && dragging.range) {
      // While a key is dragged the range stays as it was, so the key follows
      // the mouse and the angle does not run away.
      return dragging.range;
    }

    let biggest = 1;
    for (const point of motionPoints(animation)) biggest = Math.max(biggest, Math.abs(point.value));
    return Math.max(15, Math.ceil(biggest / 15) * 15);
  }

  function angleToY(animation, angle, index, top) {
    const topPad = 6;
    const bottom = TRACK_HEIGHT - 6;
    const range = trackRange(animation, index);
    // 0 degrees sits in the middle of the lane, the positive angles go up.
    // The y is absolute: the lane of the track begins at "top", and without
    // the offset the curve of every track would land in the first lane.
    const middle = top + (topPad + bottom) / 2;
    return middle - (angle / range) * ((bottom - topPad) / 2);
  }

  function yToAngle(animation, y, range, top) {
    const topPad = 6;
    const bottom = TRACK_HEIGHT - 6;
    const scale = range || trackRange(animation);
    const middle = top + (topPad + bottom) / 2;
    return ((middle - y) / ((bottom - topPad) / 2)) * scale;
  }

  function element(name, attributes) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes || {})) {
      node.setAttribute(key, value);
    }
    return node;
  }

  function render() {
    width = Math.max(320, root.clientWidth || 600);
    svg.setAttribute('width', width);
    svg.setAttribute('height', RULER_HEIGHT + animations().length * TRACK_HEIGHT + 8);
    svg.textContent = '';

    // the ruler
    const ruler = element('g', {});
    const seconds = duration();
    const step = seconds > 12 ? 2 : 1;
    for (let second = 0; second <= seconds + 0.001; second += step) {
      const x = timeToX(second);
      ruler.append(element('line', {
        x1: x, x2: x, y1: RULER_HEIGHT - 6, y2: RULER_HEIGHT, class: 'tl-tick',
      }));
      const label = element('text', { x: x + 3, y: 12, class: 'tl-label' });
      label.textContent = `${second}s`;
      ruler.append(label);
    }
    ruler.append(element('line', {
      x1: HEADER_WIDTH + MARGIN, x2: width - MARGIN, y1: RULER_HEIGHT, y2: RULER_HEIGHT, class: 'tl-axis',
    }));
    svg.append(ruler);

    // the tracks
    animations().forEach((animation, index) => {
      svg.append(renderTrack(animation, index));
    });

    updatePlayhead();
  }

  function renderTrack(animation, index) {
    const group = element('g', { class: 'tl-track' });
    const top = RULER_HEIGHT + index * TRACK_HEIGHT;

    const selected = options.selectedIndex() === index;
    const rowClass = selected ? 'tl-row tl-row-selected' : (index % 2 ? 'tl-row tl-row-odd' : 'tl-row');
    group.append(element('rect', {
      x: 0, y: top, width, height: TRACK_HEIGHT,
      class: rowClass,
    }));

    // the header: the type of the motion, the name of the node and the buttons
    const header = element('g', { class: 'tl-header' });
    const badge = element('text', { x: 8, y: top + 14, class: 'tl-badge' });
    badge.textContent = typeLabel(animation.type);
    header.append(badge);

    const name = element('text', { x: 8, y: top + 31, class: 'tl-name' });
    name.textContent = shortPath(animation.path);
    header.append(name);

    const solo = element('rect', {
      x: HEADER_WIDTH - 46, y: top + 8, width: 18, height: 18, class: 'tl-button', rx: 4,
    });
    solo.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      options.onSolo(index);
    });
    header.append(solo);
    const soloMark = element('text', { x: HEADER_WIDTH - 41, y: top + 21, class: 'tl-button-mark' });
    soloMark.textContent = options.soloIndex() === index ? '■' : '▶';
    header.append(soloMark);

    const remove = element('rect', {
      x: HEADER_WIDTH - 24, y: top + 8, width: 18, height: 18, class: 'tl-button', rx: 4,
    });
    remove.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      options.onRemove(index);
    });
    header.append(remove);
    const removeMark = element('text', { x: HEADER_WIDTH - 16, y: top + 19, class: 'tl-button-mark' });
    removeMark.textContent = '✕';
    header.append(removeMark);

    group.append(header);

    // the lane
    const lane = element('rect', {
      x: HEADER_WIDTH, y: top + 1, width: laneWidth(), height: TRACK_HEIGHT - 2, class: 'tl-lane',
    });
    lane.addEventListener('pointerdown', (event) => onLanePointerDown(event, animation, index, top));
    group.append(lane);

    // The curve of the motion and the points on it. The curve is the same as in
    // the graph editor (anim-curve.js), so both show the same thing.
    group.append(renderCurve(animation, index, top));

    return group;
  }

  // The curve of a motion: the value of the channel over the time, with the
  // points (the keyframes) on it.
  function renderCurve(animation, index, top) {
    const group = element('g', {});
    const seconds = Math.min(duration(), motionDuration(animation));
    const points = [];
    for (let i = 0; i <= 24; i++) {
      const time = (i / 24) * seconds;
      points.push(`${timeToX(time)} ${angleToY(animation, sampleMotion(animation, time), index, top)}`);
    }
    group.append(element('path', { d: `M ${points.join(' L ')}`, class: 'tl-curve' }));

    motionPoints(animation).forEach((point) => {
      const time = Math.min(Number(point.time) || 0, seconds);
      const value = Number(point.value) || 0;
      const selectedKey = options.selectedKey()?.track === index && options.selectedKey()?.key === point.index;
      const dot = element('circle', {
        cx: timeToX(time),
        cy: angleToY(animation, value, index, top),
        r: selectedKey ? 6 : 5,
        class: point.index >= 0 ? 'tl-dot tl-key' : 'tl-dot',
      });
      const tip = element('title', {});
      // A translation motion works in metres, a rotation in degrees.
      tip.textContent = `${time.toFixed(2)} s, ${value}${animation.translate ? ' m' : '°'}`;
      dot.append(tip);
      if (point.index >= 0) {
        dot.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
          options.onSelectKey(index, point.index);
          // The range of the track and the angle of the key are kept while the
          // key is dragged: the key follows the mouse and the angle does not run
          // away.
          dragging = {
            kind: 'key',
            track: index,
            key: point.index,
            range: trackRange(animation, index),
            startAngle: Number(point.value) || 0,
            startY: event.clientY,
          };
          // The angle follows the pointer one to one in the scale of the
          // moment of the grab: mapping every move through the live range
          // again would feed itself once the range grows (see pointermove).
          dragging.unitsPerPixel = dragging.range / ((TRACK_HEIGHT - 12) / 2);
          try { svg.setPointerCapture(event.pointerId); } catch (e) { /* no capture, the drag still works */ }
        });
      }
      group.append(dot);
    });

    return group;
  }

  function onLanePointerDown(event, animation, index, top) {
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (animation.type === 'keys') {
      // A second click right after the first one adds a key. The event of the
      // browser is not used for it: the lane is drawn again after every
      // click, so the browser would not see a double click.
      const now = Date.now();
      if (now - lastClick < 400 && Math.abs(x - lastClickX) < 16) {
        lastClick = 0;
        const range = trackRange(animation, index);
        const angle = Math.max(-range, Math.min(range, yToAngle(animation, y, range, top)));
        options.onAddKey(index, xToTime(x), angle);
        return;
      }

      lastClick = now;
      lastClickX = x;

      const keys = Array.isArray(animation.keys) ? animation.keys : [];
      for (let i = 0; i < keys.length; i++) {
        const time = Math.min(Number(keys[i].time) || 0, duration());
        const dx = x - timeToX(time);
        const dy = y - angleToY(animation, Number(keys[i].angle) || 0, index, top);
        if (dx * dx + dy * dy < 64) {
          options.onSelectKey(index, i);
          dragging = {
            kind: 'key',
            track: index,
            key: i,
            range: trackRange(animation, index),
            startAngle: Number(keys[i].angle) || 0,
            startY: event.clientY,
          };
          // The same frozen scale as the dot of the curve above.
          dragging.unitsPerPixel = dragging.range / ((TRACK_HEIGHT - 12) / 2);
          svg.setPointerCapture?.(event.pointerId);
          return;
        }
      }
    }

    options.onScrub(xToTime(x));
    dragging = { kind: 'scrub' };
    svg.setPointerCapture?.(event.pointerId);
  }

  svg.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left;

    if (dragging.kind === 'scrub') {
      options.onScrub(xToTime(x));
      return;
    }

    if (dragging.kind === 'key') {
      const animation = animations()[dragging.track];
      if (!animation) return;
      const key = animation.keys?.[dragging.key];
      if (!key) return;
      const seconds = Math.min(duration(), Number(animation.duration) || duration());
      key.time = Math.max(0, Math.min(seconds, xToTime(x)));

      // The angle follows the pointer one to one (the scale of the moment of
      // the grab), and the keyframe stays inside its lane: past the edge the
      // range of the track grows in round steps (the same way the graph
      // editor zooms), so the key never leaves the track and the numbers
      // cannot run away.
      let angle = dragging.startAngle + (dragging.startY - event.clientY) * dragging.unitsPerPixel;
      if (Math.abs(angle) > dragging.range) {
        dragging.range = Math.ceil((Math.abs(angle) - dragging.range) / 15) * 15 + dragging.range;
      }
      angle = Math.max(-dragging.range, Math.min(dragging.range, angle));
      key.angle = Math.round(angle * 10) / 10;
      options.onChange();
      render();
    }
  });

  const endDrag = () => { dragging = null; };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  function updatePlayhead() {
    const x = timeToX(options.time());
    let line = svg.querySelector('.tl-playhead-line');
    let head = svg.querySelector('.tl-playhead-head');
    if (!line || !head) {
      line = element('line', { class: 'tl-playhead-line' });
      head = element('path', { class: 'tl-playhead-head' });
      svg.append(line);
      svg.append(head);
    }
    line.setAttribute('x1', x);
    line.setAttribute('x2', x);
    line.setAttribute('y1', RULER_HEIGHT - 8);
    line.setAttribute('y2', RULER_HEIGHT + animations().length * TRACK_HEIGHT);
    head.setAttribute('d', `M ${x - 5} ${RULER_HEIGHT - 14} L ${x + 5} ${RULER_HEIGHT - 14} L ${x} ${RULER_HEIGHT - 5} Z`);
  }

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => render());
    observer.observe(root);
  }

  return { render, updatePlayhead };
}

function typeLabel(type) {
  if (type === 'deploy') return t('anim.typeDeploy');
  if (type === 'keys') return t('anim.typeKeys');
  return t('anim.typeSpin');
}

function shortPath(path) {
  const value = String(path || '');
  const parts = value.split('/');
  const name = parts[parts.length - 1] || value || '?';
  // The header of a track is narrow: a long name is cut with an ellipsis.
  return name.length > 16 ? name.slice(0, 15) + '…' : name;
}
