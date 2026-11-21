# Credits

Built on Sentinel. <https://sentinel.co>

The license in [`LICENSE`](LICENSE) (the Sentinel dVPN License) covers this app's own code. It
does not cover the third-party software the app bundles or depends on. That software keeps its
own license.

Third-party material in this app is attributed in:

- [`build/licenses/dvpnd-THIRD-PARTY-NOTICES.txt`](build/licenses/dvpnd-THIRD-PARTY-NOTICES.txt):
  the libraries inside the bundled Sentinel daemon `sentinel-dvpnd`.
- [`build/licenses/go-sqlite3-wasm.txt`](build/licenses/go-sqlite3-wasm.txt).
- `THIRD-PARTY-NOTICES.txt`, which every package installs. `scripts/fetch-deps.mjs` generates it
  from `build/deps.lock.json`. It covers the bundled programs and libraries: Hysteria 2, V2Ray,
  Xray, the three fonts under OFL-1.1, and rpc-websockets under LGPL-3.0.
- The README's [License](README.md#license) section.
