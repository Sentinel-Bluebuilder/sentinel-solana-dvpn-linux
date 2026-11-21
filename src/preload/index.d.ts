import type { IPC, EVENTS, IpcChannel } from '../shared/ipc';

declare global {
  interface Window {
    api: {
      IPC: typeof IPC;
      EVENTS: typeof EVENTS;
      /** Set by the Android WebView preload only; absent on the desktop apps (src/renderer/src/lib/platform.ts reads it). */
      platform?: 'android';
      /** Android WebView bridge (the Android app only); every screen calls it with `?.`, so it is a no-op on the desktop. */
      android?: { openVpnSettings(): void; notificationsAllowed(): boolean; openNotificationSettings(): void; vpnSystemState(): { alwaysOn?: boolean; lockdown?: boolean }; welcomed(): boolean; markWelcomed(): void; setSecure(on: boolean): void };
      invoke<T = unknown>(channel: IpcChannel, payload?: unknown): Promise<T>;
      on<T = unknown>(channel: string, cb: (payload: T) => void): () => void;
    };
  }
}

export {};
