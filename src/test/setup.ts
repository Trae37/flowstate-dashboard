import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock Electron APIs for testing
global.window = global.window || {};
(global.window as any).electron = {
  ipcRenderer: {
    send: () => {},
    on: () => {},
    invoke: async () => ({}),
  },
};
