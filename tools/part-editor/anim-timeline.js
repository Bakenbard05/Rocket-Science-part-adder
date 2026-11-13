// The timeline of the motions of a part: one track per motion, the keys of a
// track can be dragged, the playhead scrubs the preview in the viewport.
//
// The motions of the game are simple: a node spins around an axis or moves
// between two poses ("deploy"). A track with keys ("keys") describes the angle
// of the node over the time, the same way the runtime driver reads them
// (PartAnimationDriver.SampleKeys).
import { t } from './i18n.js';

const HEADER_WIDTH = 156;
const RULER_HEIGHT = 22;
const TRACK_HEIGHT = 40;
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
    if (animation.type === 'keys' && Array.isArray(animation.keys)) {
      for (const key of animation.keys) biggest = Math.max(biggest, Math.abs(Number(key.angle) || 0));
      biggest = Math.max(15, Math.ceil(biggest / 15) * 15);
    } else if (animation.type === 'deploy') {
      biggest = Math.max(Math.abs(Number(animation.stowed) || 0), Math.abs(Number(animation.deployed) || 0), 1);
    } else {
      biggest = Math.max(1, Math.abs(Number(animation.speed) || 0) * duration());
    }
    return biggest;
  }

  function angleToY(animation, angle, index) {
    const top = 6;
    const bottom = TRACK_HEIGHT - 6;
    const range = trackRange(animation, index);
    // 0 degrees sits in the middle, the positive angles go up.
    const middle = (top + bottom) / 2;
    return middle - (angle / range) * ((bottom - top) / 2);
  }

  function yToAngle(animation, y, range) {
    const top = 6;
    const bottom = TRACK_HEIGHT - 6;
    const scale = range || trackRange(animation);
    const middle = (top + bottom) / 2;
    return ((middle - y) / ((bottom - top) / 2)) * scale;
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
    group.append(element('rect', {
      x: 0, y: top, width, height: TRACK_HEIGHT,
      class: selected ? 'tl-row tl-row-selected' : 'tl-row',
    }));

    // the header: the name of the motion and the buttons
    const header = element('g', { class: 'tl-header' });
    const badge = element('text', { x: 8, y: top + 15, class: 'tl-badge' });
    badge.textContent = typeLabel(animation.type);
    header.append(badge);

    const name = element('text', { x: 34, y: top + 15, class: 'tl-name' });
    name.textContent = shortPath(animation.path);
    header.append(name);

    const solo = element('rect', {
      x: HEADER_WIDTH - 42, y: top + 6, width: 16, height: 16, class: 'tl-button', rx: 3,
    });
    solo.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      options.onSolo(index);
    });
    header.append(solo);
    const soloMark = element('text', { x: HEADER_WIDTH - 38, y: top + 19, class: 'tl-button-mark' });
    soloMark.textContent = options.soloIndex() === index ? '■' : '▶';
    header.append(soloMark);

    const remove = element('rect', {
      x: HEADER_WIDTH - 20, y: top + 6, width: 16, height: 16, class: 'tl-button', rx: 3,
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

    if (animation.type === 'keys') {
      group.append(renderKeys(animation, index, top));
    } else if (animation.type === 'deploy') {
      group.append(renderDeploy(animation, top));
    } else {
      group.append(renderSpin(animation, top));
    }

    return group;
  }

  // The spin: the angle grows with the speed.
  function renderSpin(animation, top) {
    const group = element('g', {});
    const speed = Number(animation.speed) || 0;
    const range = trackRange(animation);
    const y0 = angleToY(animation, 0);
    const y1 = angleToY(animation, speed * duration());
    group.append(element('path', {
      d: `M ${timeToX(0)} ${y0} L ${timeToX(duration())} ${y1}`,
      class: 'tl-curve',
    }));
    group.append(element('circle', {
      cx: timeToX(0), cy: y0, r: 3, class: 'tl-dot',
    }));
    return group;
  }

  // The deploy: the pose change over the duration of the motion.
  function renderDeploy(animation, top) {
    const group = element('g', {});
    const seconds = Math.min(duration(), Number(animation.duration) || duration());
    const stowed = Number(animation.stowed) || 0;
    const deployed = Number(animation.deployed) || 0;
    const points = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const smooth = t * t * (3 - 2 * t);
      const angle = stowed + (deployed - stowed) * smooth;
      points.push(`${timeToX(t * seconds)} ${angleToY(animation, angle)}`);
    }
    group.append(element('path', { d: `M ${points.join(' L ')}`, class: 'tl-curve' }));
    group.append(element('circle', {
      cx: timeToX(0), cy: angleToY(animation, stowed), r: 3, class: 'tl-dot',
    }));
    group.append(element('circle', {
      cx: timeToX(seconds), cy: angleToY(animation, deployed), r: 3, class: 'tl-dot',
    }));
    return group;
  }

  // The keys: the curve through the keyframes and the dots of the keys.
  function renderKeys(animation, index, top) {
    const group = element('g', {});
    const keys = Array.isArray(animation.keys) ? animation.keys : [];
    if (!keys.length) {
      const hint = element('text', { x: timeToX(0) + 6, y: top + 24, class: 'tl-hint' });
      hint.textContent = t('anim.noKeys');
      group.append(hint);
      return group;
    }

    const seconds = Math.min(duration(), Number(animation.duration) || duration());
    const points = [];
    for (const key of keys) {
      const time = Math.min(Number(key.time) || 0, seconds);
      points.push(`${timeToX(time)} ${angleToY(animation, Number(key.angle) || 0, index)}`);
    }
    group.append(element('path', { d: `M ${points.join(' L ')}`, class: 'tl-curve' }));

    keys.forEach((key, keyIndex) => {
      const time = Math.min(Number(key.time) || 0, seconds);
      const dot = element('circle', {
        cx: timeToX(time),
        cy: angleToY(animation, Number(key.angle) || 0, index),
        r: options.selectedKey()?.track === index && options.selectedKey()?.key === keyIndex ? 5 : 4,
        class: 'tl-dot tl-key',
      });
      dot.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        options.onSelectKey(index, keyIndex);
        // The range of the track and the angle of the key are kept while the
        // key is dragged: the key follows the mouse and the angle does not run
        // away.
        dragging = {
          kind: 'key',
          track: index,
          key: keyIndex,
          range: trackRange(animation, index),
          startAngle: Number(key.angle) || 0,
          startY: event.clientY,
        };
        try { svg.setPointerCapture(event.pointerId); } catch (e) { /* no capture, the drag still works */ }
      });
      group.append(dot);
    });

    return group;
  }

  function onLanePointerDown(event, animation, index, top) {
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top - top;

    if (animation.type === 'keys') {
      // A second click right after the first one adds a key. The event of the
      // browser is not used for it: the lane is drawn again after every
      // click, so the browser would not see a double click.
      const now = Date.now();
      if (now - lastClick < 400 && Math.abs(x - lastClickX) < 16) {
        lastClick = 0;
        options.onAddKey(index, xToTime(x), yToAngle(animation, y, trackRange(animation, index)));
        return;
      }

      lastClick = now;
      lastClickX = x;

      const keys = Array.isArray(animation.keys) ? animation.keys : [];
      for (let i = 0; i < keys.length; i++) {
        const time = Math.min(Number(keys[i].time) || 0, duration());
        const dx = x - timeToX(time);
        const dy = y - angleToY(animation, Number(keys[i].angle) || 0, index);
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

      // The angle follows the mouse with the scale of the track as it was when
      // the drag began.
      const scale = (TRACK_HEIGHT - 12) / 2;
      const angle = dragging.startAngle + ((dragging.startY - event.clientY) / scale) * dragging.range;
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
  return parts[parts.length - 1] || value || '?';
}
