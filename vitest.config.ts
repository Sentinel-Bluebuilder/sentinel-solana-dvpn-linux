import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Shared tests + this OS's own (tests/platform/<os>/); identical file in all four repos (all-OS port).
    include: ['tests/unit/**/*.test.ts', `tests/platform/${process.env.DVPN_TEST_PLATFORM ?? process.platform}/**/*.test.ts`, 'tests/devnet/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    // rc.10 KS-SUDO: tests never see the runner's own SSH login (tests/setup/remote-ancestry.ts).
    setupFiles: ['tests/setup/remote-ancestry.ts'],
  },
});
