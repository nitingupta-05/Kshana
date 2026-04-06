type Listener = () => void;

const listeners: Set<Listener> = new Set();

export const emitAuthRequired = () => {
  listeners.forEach((fn) => fn());
};

export const subscribeAuthRequired = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
