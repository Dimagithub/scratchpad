export {};

declare global {
  interface Window {
    __TEST_EMIT__: (event: string, payload: unknown) => void;
    __TEST_RESET__: () => void;
  }
}
