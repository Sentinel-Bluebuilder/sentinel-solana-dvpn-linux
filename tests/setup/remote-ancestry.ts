// ─── Every test: the kill-switch-remote check sees a local login unless the test injects one ───
// src/shared/remote-ancestry.ts asks logind and walks this process's parents for sshd. The suite runs on ctl over
// SSH (nohup from an SSH login), so without this every daemon-set test would be refused as remote. Its own test
// imports the real module with vi.importActual.
import { vi } from 'vitest';

vi.mock('../../src/shared/remote-ancestry', () => ({ remoteAncestry: () => null }));
