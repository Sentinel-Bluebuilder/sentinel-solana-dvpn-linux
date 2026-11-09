# Protocol matrix — Devnet dVPN on Linux (#32)

Every cell is either **proven live** (a test that ran on a Linux VM against #31's six rig nodes on
devnet, evidence linked) or **red** (not offered, or known not to work, with the reason). Nothing
here is "should work". Evidence paths are under `docs/evidence/linux-cf4c372/`.

dvpnd: `cf4c372-ddv10` (= #31 `e4b7db2`, LF build), app = this repo's `main`.
Rig: client `ddv-linux-1` (Ubuntu 24.04, kernel 6.8) unless the row says otherwise.

## FINAL lock run (dvpnd `cf4c372-ddv16.30`, nodes dvpnd 18.28 → 18.31, rig `ddv-linux-r2`, 2026-10-24)

Rig: Ubuntu 24.04, NEW GCP project, wallet `HyiPh2…`, test node ddv-node-3. Package for T1/T2:
deb `babc31b0` (HEAD 5e645b3c). The final package `bb3d3e72` (HEAD 657d9b76) adds only the speed-test
cap and gap #95 (other-device revoke/settle), neither on the connect/pay/kill-switch path; it runs the
queue VM and edge tiers. Evidence: `docs/evidence/linux-cf4c372/final-16.30/rig/matrix-T1/`, `matrix-T2/`.
**Result: 0 product FAIL on all six protocols (incl. Xray).** The plan case is open for four protocols
(below).

| Case | Result | Notes |
|---|---|---|
| `ks-on` | ✅ 167 / 0 | T1 05:37Z |
| `pay-gb` | ✅ 62 / 0 | |
| `pay-hour` | ✅ 62 / 0 | |
| `topup` | ✅ 44 / 0 | |
| `adopt` | ✅ 46 / 0 | |
| `dns` | ✅ 49 / 0 | T2 06:31Z |
| `split-ks` | ✅ 61 / 0 | |
| `reconnect` | ✅ 38 / 0 | |
| `ks-persist` | ✅ 197 / 0 | |
| `plan` | ✅ WireGuard, AmneziaWG · ⏳ OpenVPN, Hysteria2, V2Ray, Xray | plan 8z7U383V allows **2 servers per wallet** (max_connections 2 over the wallet's unexpired 24 h tickets; the subscription address is fixed per wallet + plan). The 3rd–6th connects were refused by the app before any ticket request, "This plan gives access on 2 servers, and you already use them…" (#31: the limit is intended; the refusal passes the limit case). The four owed connects come from two more wallets: queue VM `AZUpnp…` (OpenVPN + Hysteria2), deb12 wallet `8e5rt…` on the rig (V2Ray + Xray). `matrix-T2/plan-first/`, `plan-rerun/README.md` |
| `settle` | ✅ | T2 + T2b: every deposit settled, SOL back on the device (0.0239 → 0.0369) |

## Final build run (dvpnd `cf4c372-ddv16.11`, package `3c6e4bd9`, matrix F2 on `ddv-linux-1`)

One case × all six protocols per row, run detached on the VM (`scripts/e2e/linux/matrix.sh`).
Evidence: `docs/evidence/linux-cf4c372/matrix-f2/<case>.tsv` (one PASS/FAIL row per check and protocol).
**Result: every case 0 FAIL on all six protocols** (the one plan failure was the provider, fixed and re-run).

| Case | Result | Notes |
|---|---|---|
| `ks-on` | ✅ 161 / 0 | kill switch incl. the inbound filter (patch 0013): egress = node, table up, VPN DNS; path lost / protocol process killed / dvpnd SIGKILL → no leak; disconnect releases |
| `ks-persist` | ✅ 191 / 0 | service restart + SIGKILL mid-session with persist → block re-applied, no leak; restore gives the internet back |
| `pay-gb` | ✅ 50 / 0 | |
| `pay-hour` | ✅ 50 / 0 | |
| `plan` (fresh subscription on #31's 6zKPsC) | ✅ 40 / 0 (P2) | first run 34/1: the 6th connect (Xray) refused because the provider reserved 1 GB per ticket on a 5 GB / 6-server plan (#31 gap #78). Provider fix live 18:48 UTC 10-22, re-run on a new subscription: all six |
| `topup` | ✅ 44 / 0 | `channels fund` on the live deposit, session keeps running, every protocol |
| `adopt` | ✅ 46 / 0 | session started by the CLI, adopted after an app restart; V2Ray/Xray proxy re-applied |
| `dns` | ✅ 49 / 0 | KS off: no lookup leaves on the NIC (tcpdump, positive control); KS on: VPN DNS on the tunnel |
| `split-ks` | ✅ 61 / 0 | split set + kill switch → full tunnel kept, status says why |
| `reconnect` | ✅ 38 / 0 | node API blocked mid-session → reconnect under a new id → disconnect still stops it |
| `settle` | ✅ | every deposit of the run settled, SOL back on the device |

Edge, installer, CLI and UI runs on the clean VMs: `docs/LINUX-PARITY.md` and the handoff STATE.
The per-protocol tables below predate this run; where they say "—", the F2 row above now covers it.

## Connect and pay

| | WireGuard | AmneziaWG | OpenVPN | Hysteria2 | V2Ray | Xray |
|---|---|---|---|---|---|---|
| Per GB deposit | ✅ `sweep/spend.tsv` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Per hour (stream) | ✅ `sweep/ledger-*.tsv` per_hour | ✅ | ✅ | ✅ | ✅ | ✅ |
| Plan (subscription ticket) | ✅ 18:16 UTC 10-21 | ✅ | ✅ | ✅ fresh 24.04 | ✅ fresh 24.04 | ✅ fresh 24.04 |
| `status` names the basis | ✅ per hour / per GB / plan | ✅ | ✅ | ✅ | ✅ | ✅ |
| Top-up the live session's deposit | ✅ `ledger` topup | — same code path | — | — | — | — |

## Coverage (what the session protects)

| | WireGuard | AmneziaWG | OpenVPN | Hysteria2 | V2Ray | Xray |
|---|---|---|---|---|---|---|
| Whole device (all apps) | ✅ | ✅ | ✅ | ✅ | 🟥 proxy only (no Linux TUN; Windows has it from ddv7/ddv11) | 🟥 same |
| Browsers / proxy-aware apps via desktop proxy | n/a | n/a | n/a | n/a | ✅ GNOME + KDE (`kde/`, `sweep/proxy-gnome.txt`) | ✅ |
| Browser window through the VPN | n/a | n/a | n/a | n/a | ✅ Chrome/Chromium | ✅ |
| Per-app split (some apps outside) | 🟥 not offered on Linux | 🟥 | 🟥 | 🟥 | ✅ by nature (only proxy users go through) | ✅ |
| Per-destination split | 🟥 not offered | 🟥 | 🟥 | 🟥 | 🟥 | 🟥 |

## Kill switch (nftables `inet dvpnd`)

| | WireGuard | AmneziaWG | OpenVPN | Hysteria2 | V2Ray | Xray |
|---|---|---|---|---|---|---|
| ON: egress = node, table up, VPN DNS set | ✅ `sweep/ksdns-ddv6.tsv` | ✅ | ✅ | ✅ | ✅ | ✅ |
| ON: path to the server lost → no direct leak | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ON: tunnel / protocol process killed → no leak, also 25 s later after the session ended (gap #41 fixed) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ON: dvpnd SIGKILL mid-session → no leak, block kept after systemd restart | ✅ `ledger` kill-on | — | — | ✅ | — | — |
| PERSIST: service restart + dvpnd SIGKILL mid-session → no leak | ✅ `ledger` persist | — | ✅ | — | — | — |
| Disconnect + Restore network → direct egress, nothing left | ✅ every case above | ✅ | ✅ | ✅ | ✅ | ✅ |

"—" = not run for that protocol; the behaviour is in protocol-independent daemon code
(firewall + recover), proven on the protocols marked.

## DNS

| | WireGuard | AmneziaWG | OpenVPN | Hysteria2 | V2Ray | Xray |
|---|---|---|---|---|---|---|
| KS off: no lookup for the name asked leaves on the NIC (tcpdump, positive control first) | ✅ `ledger` dns-off | ✅ | ✅ | ✅ | ✅ SOCKS-resolved | ✅ |
| KS on: names resolve, VPN DNS on the tunnel link | ✅ `ksdns` | ✅ | ✅ | ✅ | ✅ via SOCKS | ✅ |

**Linux limitation (documented, not fixed):** after an NXDOMAIN, glibc retries the name with the
physical NIC's search domains (`name.lan`, `name.c.<project>.internal`), and systemd-resolved
routes those to the NIC that owns the domain, i.e. the LAN DNS. Only names that do not exist are
affected, and only with the kill switch off (or on, for link-local resolvers). Windows avoids this
with an NRPT "." rule; the Linux equivalent would strip the NIC's domains during a session and
break local and cloud-internal names. Agreed with #31 2026-10-22.

## Distros (clean VM: install from the .deb → first run → every protocol → uninstall)

| | Ubuntu 24.04 (6.8) | Ubuntu 24.04 (7.0) | Ubuntu 22.04 (6.8) | Debian 12 |
|---|---|---|---|---|
| apt pulls every dependency | ✅ ddv-linux-1 | ✅ fresh, 70/72 (2 test bugs) | ✅ fresh | pending |
| AmneziaWG driver | ✅ PPA | ✅ source build + kernel-7 fix (session pending) | ✅ source build (PPA 503) (session pending) | pending |
| WG / OpenVPN / Hy2 / V2Ray / Xray | ✅ | ✅ | ✅ (WG after one public-RPC 429) | pending |
| Uninstall during a live kill-switch session restores the network | ✅ installer 22/22 | ✅ | ✅ | pending |

### rpm distros (run 5, ddv16.18; [`evidence/linux-cf4c372/EL-RUN5.md`](evidence/linux-cf4c372/EL-RUN5.md))

| | Fedora 44 (SELinux enforcing, firewalld, resolved) | Rocky 9.8 (EPEL, NM DNS, no resolved) |
|---|---|---|
| dnf pulls every dependency, clean / dirty | ✅ 65/0 · 20/0 | ✅ 66/0 · 22/0 |
| AmneziaWG driver | ✅ source build (DKMS) | ✅ source build (DKMS) |
| All six protocols: pay-gb, pay-hour, topup, adopt, dns, reconnect | ✅ 0 FAIL | ✅ 0 FAIL (dns in `resolvconf` mode) |
| Kill switch on / persist / split-ks | ✅ 167/0 · 197/0 · 61/0 | ✅ 167/0 · 196/1 (harness timing, fixed 4549027c; no leak) · 61/0 |
| CLI sweeps local / daemon / spend + cover | ✅ 0 FAIL, 0 missing | ✅ 0 FAIL, 0 missing |
| Edge (healthy-node cases) | ✅ see EL-RUN5 | ✅ see EL-RUN5 |
| Edge after 06:51 UTC, dhcprenew, soak, reboot, firewalld reload / SELinux AVC | pending (node outage) | pending (node outage) |

### rpm distros — run 6, FINAL lock ddv16.30 ([`evidence/linux-cf4c372/EL-RUN6.md`](evidence/linux-cf4c372/EL-RUN6.md)) — in progress
Run 5 above is history (old lock). Only these rows count for the final build. Test node `ddv-node-3`.

| | Fedora 44 | Rocky 9.8 |
|---|---|---|
| All six protocols: pay-gb, pay-hour, topup, adopt, dns | pending | ✅ 62 · 62 · 44 · 46 · 49, 0 FAIL |
| Kill switch on / persist / split-ks · reconnect | pending | ✅ 167/0 · 197/0 · 61/0 · 38/0 |
| firewalld reload/restart, NM re-apply, resolv.conf, SELinux 0 AVC, metadata stays on the card (L27), all six | pending | ✅ platform-el 108/0; WG restart repro 0 renames |
| UI dark + light | pending | ✅ 0 renderer errors |
| clean / dirty / installer / fingerprint · CLI sweeps + cover · split · plans · edge · dhcprenew · reboot · pkexec · soak 120 | pending | pending (lane A turns 3–7) |
