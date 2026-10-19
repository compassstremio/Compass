type BackHandler = () => boolean;

const handlers: BackHandler[] = [];
const listeners = new Set<() => void>();

export function subscribeBackHandlers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyBackHandlers(): void {
  listeners.forEach((listener) => listener());
}

export function hasBackHandlers(): boolean {
  return handlers.length > 0;
}

export function pushBackHandler(handler: BackHandler): () => void {
  handlers.push(handler);
  notifyBackHandlers();
  return () => {
    const i = handlers.lastIndexOf(handler);
    if (i >= 0) {
      handlers.splice(i, 1);
      notifyBackHandlers();
    }
  };
}

export function consumeBack(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]()) return true;
  }
  return false;
}
