export {};

declare global {
  interface Window {
    __TEST_EMIT__: (event: string, payload: unknown) => void;
    __TEST_RESET__: () => void;
    __TEST_LAST_EXPORT__: { path: string; content: string } | null;
  }
}
