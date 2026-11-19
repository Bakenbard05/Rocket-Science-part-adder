// The undo history of the editor: every change stores a snapshot of the part, so
// Ctrl+Z walks back through them. The snapshots are the JSON of the part, the
// flame and the saved flames, so nothing of the editor is lost by accident.

export function createHistory({ limit = 80, capture, restore, onChange }) {
  const stack = [];
  let index = -1;
  let last = null;
  let timer = null;

  // Stores the state as it is now. Two changes in a row without a difference
  // (a click on a button that changed nothing) do not fill the history.
  function push() {
    const text = capture();
    if (text === last) return;
    last = text;
    stack.length = index + 1;      // the redo entries are gone
    stack.push(text);
    while (stack.length > limit) stack.shift();
    index = stack.length - 1;
    notify();
  }

  // The change is written a moment after the last keystroke, so a word does not
  // become a dozen steps.
  function schedule(delay = 400) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      push();
    }, delay);
  }

  function reset() {
    stack.length = 0;
    index = -1;
    last = null;
    push();
  }

  function undo() {
    if (index <= 0) return false;
    index--;
    last = stack[index];
    restore(stack[index]);
    notify();
    return true;
  }

  function redo() {
    if (index >= stack.length - 1) return false;
    index++;
    last = stack[index];
    restore(stack[index]);
    notify();
    return true;
  }

  function notify() {
    if (onChange) onChange();
  }

  return {
    push,
    schedule,
    reset,
    undo,
    redo,
    canUndo: () => index > 0,
    canRedo: () => index < stack.length - 1,
  };
}
