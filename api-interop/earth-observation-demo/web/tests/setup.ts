import { vi, beforeEach } from "vitest";
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "EventSource",
    class {
      onmessage = null;
      onerror = null;
      close() {}
    },
  );
});
Object.defineProperty(HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get() {
    return 1200;
  },
});
Object.defineProperty(HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get() {
    return 800;
  },
});
HTMLElement.prototype.getBoundingClientRect = function () {
  return {
    width: 1200,
    height: 800,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 800,
    right: 1200,
    toJSON() {
      return {};
    },
  };
};
HTMLElement.prototype.scrollTo = function () {};
