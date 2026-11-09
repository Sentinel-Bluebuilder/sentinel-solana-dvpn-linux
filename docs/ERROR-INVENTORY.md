# Error inventory (generated — `node scripts/error-inventory.mjs`)

Every user-facing error, warning and refusal string in `src/`, found by pattern (thrown errors,
Result `error:`, `fail()`, toasts, Banners, copy tables). Input to E3 (`ERROR-STANDARDS.md`);
do not edit by hand, re-run the script.

Total 326: throw 147, copy 56, return 19, result 72, fail 11, toast 13, banner 8

| Where | Kind | Text | Action |
|---|---|---|---|
| `src/cli/args.ts:36` | throw | --${name} must be a number |  |
| `src/cli/args.ts:44` | throw | --${name} must be a whole number from ${min} to ${max} |  |
| `src/cli/commands.ts:65` | throw | --basis must be per_gb or per_hour |  |
| `src/cli/commands.ts:73` | throw | No wallet. Run "wallet create" or "wallet import <file>". |  |
| `src/cli/commands.ts:74` | throw | Could not read the balances of ${ownerAddress()} right now (network or RPC busy). Try again in a moment. |  |
| `src/cli/commands.ts:90` | throw | wallet import <keyfile.json \| -> (- reads stdin) |  |
| `src/cli/commands.ts:95` | throw | no wallet |  |
| `src/cli/commands.ts:105` | throw | wallet send --to <address> [--tdvpn N] [--sol N] --yes |  |
| `src/cli/commands.ts:107` | throw | "${to}" is not a Solana wallet address. |  |
| `src/cli/commands.ts:108` | throw | --${k} must be a positive number |  |
| `src/cli/commands.ts:109` | throw | Give --tdvpn N and/or --sol N. |  |
| `src/cli/commands.ts:115` | throw | unknown: wallet ${sub} |  |
| `src/cli/commands.ts:128` | throw | device register [device-pubkey] [--home <dir>] (wallet required) |  |
| `src/cli/commands.ts:141` | throw | This computer has no device key yet. Create it first with: devnet-dvpn daemon init. Then run device setup again. |  |
| `src/cli/commands.ts:163` | throw | no device recorded |  |
| `src/cli/commands.ts:168` | throw | unknown: device ${sub} |  |
| `src/cli/commands.ts:186` | throw | nodes ${sub} <node> |  |
| `src/cli/commands.ts:188` | throw | No such node. |  |
| `src/cli/commands.ts:193` | throw | nodes fav <node> |  |
| `src/cli/commands.ts:203` | throw | unknown: nodes ${sub} |  |
| `src/cli/commands.ts:209` | throw | cost <node> [--basis per_gb\|per_hour] [--units N] |  |
| `src/cli/commands.ts:217` | throw | connect <node> [--basis] [--units N] [--plan <subscription>] --yes |  |
| `src/cli/commands.ts:231` | throw | You do not hold that subscription. |  |
| `src/cli/commands.ts:236` | throw | No such node. |  |
| `src/cli/commands.ts:247` | throw | ${(err as Error).message}\n-> Another VPN (${rivals.join(', ')}) is on and is probably blocking this: turn it off, then connect again. |  |
| `src/cli/commands.ts:295` | throw | channels fund <channel> --tdvpn N --yes |  |
| `src/cli/commands.ts:318` | throw | plans roster <plan> |  |
| `src/cli/commands.ts:320` | throw | No plan ${a._[2]} on devnet. Run "plans list" to see the plans. |  |
| `src/cli/commands.ts:336` | throw | plans subscribe <plan> --yes |  |
| `src/cli/commands.ts:346` | throw | plans close <subscription> --yes |  |
| `src/cli/commands.ts:351` | throw | unknown: plans ${sub} |  |
| `src/cli/commands.ts:376` | throw | unknown: settle ${sub} |  |
| `src/cli/daemon-cmd.ts:47` | throw | create or import a wallet first |  |
| `src/cli/daemon-cmd.ts:52` | throw | Create or import a wallet, then run "device setup --yes": the service will not start without a funded, permitted device. |  |
| `src/cli/daemon-cmd.ts:62` | throw | Run "device setup --yes" first: the service will not start without a funded, permitted device. |  |
| `src/cli/daemon-cmd.ts:88` | throw | Service settings are not readable as this user. |  |
| `src/cli/daemon-cmd.ts:90` | throw | unknown DNS preset "${dns}": use ${Object.keys(DNS_PRESETS).join(', ')} or IP addresses |  |
| `src/cli/daemon-cmd.ts:111` | throw | Choosing apps works on Windows only. Here split tunnelling works by address range: use --split-routes CIDR,... (with --split-mode include or exclude). |  |
| `src/cli/daemon-cmd.ts:133` | throw | unknown DNS preset "${dns}": use ${Object.keys(DNS_PRESETS).join(', ')} or IP addresses |  |
| `src/cli/daemon-cmd.ts:143` | throw | unknown: daemon ${sub} |  |
| `src/cli/info-cmd.ts:45` | throw | Third-party checks are turned off in settings. |  |
| `src/cli/info-cmd.ts:64` | throw | rpc set <url> [url...] |  |
| `src/cli/info-cmd.ts:66` | throw | Not accepted (https only; http only for 127.0.0.1): ${bad.map(redactUrls).join(', ')} |  |
| `src/cli/info-cmd.ts:83` | throw | settings set key=value ... |  |
| `src/cli/info-cmd.ts:86` | throw | unknown setting "${k}". Known: ${Object.keys(DEFAULT_SETTINGS).join(', ')} |  |
| `src/cli/info-cmd.ts:93` | throw | The value for ${rejected.join(', ')} is not allowed, so it was left unchanged. |  |
| `src/cli/info-cmd.ts:106` | throw | unknown: settings ${a._[1]} |  |
| `src/cli/info-cmd.ts:129` | throw | --browser must be chrome, chromium or edge |  |
| `src/cli/info-cmd.ts:132` | throw | The current session has no SOCKS endpoint (only V2Ray/Xray sessions do). Nothing was opened. |  |
| `src/cli/info-cmd.ts:137` | throw | unknown: proxy ${sub} |  |
| `src/cli/info-cmd.ts:140` | throw | The current session has no SOCKS endpoint (only V2Ray/Xray sessions do). Nothing was changed. |  |
| `src/cli/keystore.ts:49` | throw | A --keyfile wallet is read-only. Unset DVPN_KEYFILE to import or create a wallet. |  |
| `src/cli/keystore.ts:50` | throw | A --keyfile wallet is never deleted by this CLI. |  |
| `src/cli/keystore.ts:63` | throw | The wallet is missing from the keyring (it was removed outside this app). Import it again, or use a key file. |  |
| `src/cli/keystore.ts:69` | throw | The keyring did not keep the wallet. Nothing was saved. |  |
| `src/cli/poll-cmd.ts:22` | throw | unknown job "${s}". Jobs: ${POLL_JOB_NAMES.join(', ')} |  |
| `src/cli/poll-cmd.ts:34` | throw | poll set <job>=<seconds> … |  |
| `src/cli/poll-cmd.ts:40` | throw | ${job} must be a whole number of seconds from ${POLL_JOBS[job].min} to ${POLL_JOBS[job].max} |  |
| `src/cli/poll-cmd.ts:56` | throw | ${runs.filter((r) => !r.ok).map((r) => r.name).join(', ')} failed. |  |
| `src/cli/poll-cmd.ts:59` | throw | --seconds must be 10 to 3600 |  |
| `src/cli/poll-cmd.ts:79` | throw | a job broke its cadence |  |
| `src/cli/poll-cmd.ts:80` | throw | unknown: poll ${sub} |  |
| `src/cli/split-cmd.ts:50` | throw | split status \| apps [--search TEXT] |  |
| `src/cli/test-cmd.ts:21` | throw | test run <node…> \| --online |  |
| `src/cli/test-cmd.ts:88` | throw | unknown: test ${sub} |  |
| `src/core/app/device-setup.ts:96` | throw | Disconnect first: this computer is using a deposit right now. Deposits still settle and refund to your wallet after you remove the device. |  |
| `src/core/app/device-setup.ts:98` | throw | This device has no spending permission to remove. |  |
| `src/core/app/wallet-status.ts:69` | copy | The device is low on SOL for fees. Top it up in Wallet. |  |
| `src/core/app/wallet-status.ts:70` | copy | Your wallet has under 1 tDVPN. Deposits will fail until you add more. |  |
| `src/core/app/wallet-status.ts:71` | copy | The device spending limit is almost used up. Raise it in Wallet. |  |
| `src/core/chain/amounts.ts:27` | throw | "${amount}" is not a tDVPN amount. Use a number like 2.5. |  |
| `src/core/chain/amounts.ts:29` | throw | A tDVPN amount has at most ${TOKEN_DECIMALS} decimals; "${amount}" has more. |  |
| `src/core/chain/amounts.ts:31` | throw | The tDVPN amount "${amount}" is too large. |  |
| `src/core/chain/amounts.ts:38` | throw | "${amount}" is not a SOL amount. Use a number like 0.05. |  |
| `src/core/chain/amounts.ts:40` | throw | SOL has 9 decimals, got "${amount}" |  |
| `src/core/chain/builders.ts:154` | throw | fund_channels: duplicate channel |  |
| `src/core/chain/errors.ts:94` | return | This would leave an account below Solana's minimum balance (about 0.001 SOL). Send a little less. |  |
| `src/core/chain/idl.ts:69` | throw | IDL has no account ${pascal} |  |
| `src/core/chain/program.ts:41` | throw | id must be 32 bytes, got ${buf.length} |  |
| `src/core/chain/program.ts:91` | throw | Config account ${addr.toBase58()} not found on ${PROGRAM_ID.toBase58()} |  |
| `src/core/chain/tx.ts:58` | throw | ${label}: no instructions |  |
| `src/core/chain/tx.ts:115` | copy | Transaction ${signature} failed. |  |
| `src/core/chain/tx.ts:120` | throw | ${label}: transaction ${signature} expired before confirmation. |  |
| `src/core/chain/tx.ts:130` | throw | ${label}: sent but not confirmed within ${CONFIRM_TIMEOUT_MS / 1000}s (signature ${signature}); it may still land, so check again before retrying${lastReadError ? |  |
| `src/core/chain/tx.ts:145` | throw | Signed transaction fee payer does not match your wallet. |  |
| `src/core/chain/tx.ts:148` | throw | Transaction calls a program the app does not accept: ${pid ? pid.toBase58() : '?'} |  |
| `src/core/chain/tx.ts:150` | throw | Address lookup tables are not accepted. |  |
| `src/core/daemon/config.ts:49` | throw | value contains a quote or newline: ${JSON.stringify(s)} |  |
| `src/core/daemon/config.ts:124` | throw | Kill switch must be off, on or persist. |  |
| `src/core/daemon/config.ts:125` | throw | Basis must be per_gb or per_hour. |  |
| `src/core/daemon/config.ts:126` | throw | DNS mode must be one of ${DNS_MODES.join(', ')} |  |
| `src/core/daemon/config.ts:127` | throw | DNS needs 1 to 4 servers. |  |
| `src/core/daemon/config.ts:128` | throw | ${d} is not an IP address. |  |
| `src/core/daemon/config.ts:131` | throw | The deposit must be a positive whole number. |  |
| `src/core/daemon/config.ts:133` | throw | ${k} must be a whole number (0 = the node's minimum) |  |
| `src/core/daemon/config.ts:140` | throw | ${k} has characters a URL cannot hold (spaces, quotes, backslashes) |  |
| `src/core/daemon/config.ts:145` | throw | ${k} is not a URL: ${(err as Error).message} |  |
| `src/core/daemon/config.ts:147` | throw | ${k} must use ${proto}//. |  |
| `src/core/daemon/config.ts:148` | throw | ${k} needs a real host name, got "${u.hostname}" |  |
| `src/core/daemon/config.ts:157` | throw | Split mode must be off, include or exclude. |  |
| `src/core/daemon/config.ts:158` | throw | Split apps and routes must be lists. |  |
| `src/core/daemon/config.ts:159` | throw | Too many split apps or routes (64 apps, 256 routes). |  |
| `src/core/daemon/config.ts:161` | throw | Split app path contains a quote or newline: ${JSON.stringify(a)} |  |
| `src/core/daemon/config.ts:163` | throw | Split app must be a full path: ${a} |  |
| `src/core/daemon/config.ts:164` | throw | Split app must be an .exe file: ${a} |  |
| `src/core/daemon/config.ts:166` | throw | Split route must be an IP address or range like 10.0.0.0/8, not a name (sites behind a CDN change addresses): ${r} |  |
| `src/core/daemon/config.ts:167` | throw | Split include/exclude needs at least one app or route. |  |
| `src/core/daemon/flags.ts:8` | throw | --escrow must be a positive tDVPN amount, e.g. 2.5 |  |
| `src/core/daemon/flags.ts:14` | throw | --${name} must be a whole number (0 = the node's minimum) |  |
| `src/core/daemon/flags.ts:22` | throw | --${name} must be true or false, got "${raw}" |  |
| `src/core/daemon/link-copy.ts:6` | return | This app is not allowed to talk to the VPN service. Log out and back in (setup added your account to the dvpn group), or set the service up again. |  |
| `src/core/daemon/link-copy.ts:8` | return | The VPN service did not answer in time. |  |
| `src/core/daemon/link-copy.ts:10` | return | The VPN service is not running. |  |
| `src/core/daemon/link-copy.ts:12` | return | The VPN service could not be reached. |  |
| `src/core/nodes/nodeapi.ts:17` | throw | domain ${tag} exceeds 32 bytes |  |
| `src/core/pricing/cost.ts:53` | return | Not enough tDVPN: this deposit needs ${tdvpn(p.escrow)}. |  |
| `src/core/pricing/cost.ts:55` | return | Your spending approval is lower than this deposit. Raise it in Wallet → Device. |  |
| `src/core/pricing/cost.ts:56` | return | This device's spending limit is lower than this deposit. Raise it in Wallet → Device. |  |
| `src/core/pricing/cost.ts:58` | return | This device needs a little SOL (0.005) for network fees and the deposit account. Top it up in Wallet → Device. |  |
| `src/core/quality/quality.ts:101` | result | No IP service answered (${errors.join('; ')}) |  |
| `src/core/quality/quality.ts:119` | result | Speed test failed (${errors.join('; ')}) |  |
| `src/core/quality/socks.ts:19` | fail | SOCKS ${endpoint}: no answer within ${timeoutMs} ms. |  |
| `src/core/quality/socks.ts:24` | fail | SOCKS ${endpoint}: not a no-auth SOCKS5 proxy. |  |
| `src/core/quality/socks.ts:32` | fail | SOCKS ${endpoint}: could not reach ${host}:${port} (reply ${buf[1]}) |  |
| `src/core/quality/socks.ts:34` | fail | SOCKS ${endpoint}: bad reply address type ${buf[3]} |  |
| `src/core/quality/socks.ts:43` | fail | SOCKS ${endpoint}: ${err.message} |  |
| `src/core/session/setup-gate.ts:18` | return | This device needs a little SOL for transaction fees (has ${sol(lamports)}, needs ${sol(DEVICE_MIN_LAMPORTS)}). |  |
| `src/core/session/state.ts:59` | copy | Disconnected. | Add funds and reconnect |
| `src/core/session/state.ts:60` | copy | Your deposit ran out. | Add funds and reconnect |
| `src/core/session/state.ts:61` | copy | Connection to the server was lost. | Reconnect |
| `src/core/session/state.ts:62` | copy | The server ended the session. | Pick another server |
| `src/core/session/state.ts:63` | copy | The payment channel was closed. | Reconnect with a new deposit |
| `src/core/session/state.ts:64` | copy | Your deposit is closing, so the session ended. | Connect with a new deposit |
| `src/core/session/state.ts:65` | copy | The channel's closing period ended. | View plans |
| `src/core/session/state.ts:66` | copy | Disconnected. | View plans |
| `src/core/session/state.ts:68` | copy | You've used this plan's data. | View plans |
| `src/core/session/state.ts:69` | copy | Your plan access expired. Connect again to renew it. | Reconnect |
| `src/core/session/state.ts:70` | copy | This server is no longer on your plan right now. | Pick another server |
| `src/core/session/state.ts:71` | copy | This session was replaced by a newer one. | Pick another server |
| `src/core/session/state.ts:72` | copy | The server counted more data than this device did, so the app stopped paying it. | Pick another server |
| `src/core/session/state.ts:73` | copy | The tunnel stopped responding, so the session ended. The unused deposit comes back when it closes. | Reconnect |
| `src/core/session/state.ts:74` | copy | The VPN service restarted. | Reconnect |
| `src/core/session/state.ts:75` | copy | The VPN service is stopping. |  |
| `src/core/session/state.ts:85` | copy | Not enough credit left on this plan or deposit. | Add funds |
| `src/core/session/state.ts:86` | copy | Your plan allows a limited number of devices at once, or the server is full. Disconnect one first. | Pick another server |
| `src/core/session/state.ts:87` | copy | This server isn't available on your plan right now. | Pick another server |
| `src/core/session/state.ts:88` | copy | Your plan doesn't include this server, or it expired. | Pick another server |
| `src/core/session/state.ts:91` | copy | Your plan couldn't give this server access. Its data may already be shared out to the servers you use, or the plan provider is not answering. | Pick a server you already use |
| `src/core/session/state.ts:92` | copy | This device is not allowed to spend for your wallet yet. | Set up device |
| `src/core/session/state.ts:93` | copy | Deposit too small for this server's minimum. | Increase deposit |
| `src/core/session/state.ts:94` | copy | Deposit too small for this server's minimum. | Increase deposit |
| `src/core/session/state.ts:95` | copy | The server restarted since your deposit was made. | Reconnect with a new deposit |
| `src/core/session/state.ts:96` | copy | The server refused the payment terms. | Pick another server |
| `src/core/session/state.ts:97` | copy | The server is busy. | Retry later |
| `src/core/session/state.ts:98` | copy | The app could not sign the payment. Send a problem report from Diagnostics. | Report |
| `src/core/session/state.ts:99` | copy | The server expects a different payment mode. Send a problem report from Diagnostics. | Report |
| `src/core/session/state.ts:100` | copy | The server expects a different payment mode. Send a problem report from Diagnostics. | Report |
| `src/core/session/state.ts:122` | copy | Connecting stopped because you disconnected. If a deposit was already sent, its unused part comes back when it closes (settle). | Connect again |
| `src/core/session/state.ts:125` | copy | A VPN session is already running (started from the command line or another window). Disconnect it first, then connect again. Nothing was paid. | Disconnect |
| `src/core/session/state.ts:129` | copy | Another program on this computer is using ${busy[1] ? | Try another protocol |
| `src/core/session/state.ts:134` | copy | This server's protocol isn't installed on this computer. | Pick another server |
| `src/core/session/state.ts:138` | copy | This server failed its identity check: its signed details don't match its listing. It may run an older version. Nothing was paid. | Pick another server |
| `src/core/session/state.ts:143` | copy | This server billed more than this device measured, so the app won't pay it again from this deposit. Nothing more was paid. Pick another server; settling returns what is left of this deposit. | Pick another server |
| `src/core/session/state.ts:144` | copy | This server's price changed since you paid the deposit. Nothing more was paid. Pick another server, or settle and reconnect at the new price. | Pick another server |
| `src/core/session/state.ts:145` | copy | The VPN service could not turn on the kill switch for this connection, so it stopped. Try again, or turn the kill switch off in Settings. | Retry |
| `src/core/session/state.ts:148` | copy | Hysteria2 couldn't reach this server. The server may be down, or this network may block UDP or allow only small packets; a server with another protocol usually works. The unused deposit comes back when it closes. | Try another protocol |
| `src/core/session/state.ts:149` | copy | The server accepted the deposit but the tunnel didn't come up. The server may be down, or your network may block this protocol (WireGuard, AmneziaWG and Hysteria2 need UDP). The unused deposit comes back when it closes. | Try another server or protocol |
| `src/core/session/state.ts:150` | copy | This device is out of SOL for network fees. | Top up device |
| `src/core/session/state.ts:153` | copy | Your deposit with this server is still being confirmed by the network. Try again in a few minutes; you will not pay twice. Or pick another server now. | Pick another server |
| `src/core/session/state.ts:157` | copy | This network intercepted the connection to the Solana network (a login page, proxy or filter). Nothing was paid. Try another network, or set your own RPC endpoint in Settings. | Retry |
| `src/core/session/state.ts:162` | copy | The Solana network endpoint didn't answer in time, so nothing was paid. Try again in a minute, or add your own RPC endpoint in Settings. | Retry |
| `src/core/session/state.ts:166` | copy | This server isn't answering right now, so nothing was paid. Pick another server, or try again in a few minutes. | Pick another server |
| `src/core/session/state.ts:167` | copy | The server didn't answer in time. | Retry |
| `src/core/session/state.ts:168` | copy | The payment transaction was rejected by the network program. | Try stream payment |
| `src/core/session/state.ts:171` | copy | The VPN service's Solana RPC endpoint has run out of credit. Set another endpoint in Settings → VPN service → RPC. | Open settings |
| `src/core/session/state.ts:172` | copy | The Solana network endpoint is rate-limiting requests. Wait a minute and try again, or add your own RPC endpoint in Settings. | Retry |
| `src/core/session/state.ts:175` | copy | The server had a problem starting your session. Your deposit with it is kept and will be used when you try again. Try again in a minute, or pick another server. | Retry |
| `src/core/session/state.ts:176` | copy | The VPN service is not running. | Open diagnostics |
| `src/core/session/state.ts:177` | copy | Something went wrong. Retry. | Retry |
| `src/core/session/state.ts:254` | return | Split tunnelling works with the kill switch off on this version. Every app uses the VPN. |  |
| `src/core/session/state.ts:256` | return | Split tunnelling needs a newer VPN service. Every app uses the VPN. |  |
| `src/core/session/state.ts:258` | return | V2Ray and Xray work as a proxy here: only apps that use the proxy go through the VPN, so split tunnelling does not apply. Use WireGuard, AmneziaWG, OpenVPN or Hysteria2 to split by address range. |  |
| `src/core/session/state.ts:259` | return | Turn on "Whole computer" for V2Ray and Xray to use split tunnelling. Until then only apps set to use the proxy use the VPN. |  |
| `src/core/session/state.ts:268` | return | Split tunnelling needs a newer VPN service. Every app uses the VPN. |  |
| `src/core/session/state.ts:271` | return | Split tunnelling is not available for this server. Every app uses the VPN. |  |
| `src/core/session/state.ts:277` | return | The kill switch does not work with ${name} on Windows yet: it blocks the VPN itself. Turn the kill switch off in Settings, or pick a Hysteria2, V2Ray or Xray server. Nothing was paid. |  |
| `src/core/wallet/keys.ts:44` | throw | The derivation path "${path}" must start with m/, like m/44'/501'/0'/0'. |  |
| `src/core/wallet/keys.ts:47` | throw | Every derivation path segment must be hardened (end with '), unlike "${seg}". |  |
| `src/core/wallet/keys.ts:71` | throw | That key file is not valid JSON: ${(err as Error).message} |  |
| `src/core/wallet/keys.ts:74` | throw | That key file is not a Solana key (expected a JSON array of 64 numbers, as written by solana-keygen). |  |
| `src/core/wallet/keys.ts:100` | throw | Paste a recovery phrase, a key file, or a private key. |  |
| `src/core/wallet/keys.ts:103` | throw | That recovery phrase is not valid. Check the words and their order. |  |
| `src/core/wallet/keys.ts:110` | throw | That private key is not valid base58: ${(err as Error).message} |  |
| `src/core/wallet/keys.ts:114` | throw | A private key is 64 bytes (got ${raw.length}). |  |
| `src/main/daemon/manager.ts:237` | throw | doctor output is not a list |  |
| `src/main/daemon/manager.ts:290` | result | The VPN service is missing from this install. Reinstall the app. |  |
| `src/main/daemon/manager.ts:293` | result | A half-finished setup exists. Remove it from Settings → Advanced and start again. |  |
| `src/main/daemon/manager.ts:303` | result | Could not set up the VPN service. Try again, or send the log from Diagnostics (${(err?.message ?? String(stderr)).slice(0, 300)}). |  |
| `src/main/daemon/manager.ts:310` | result | Could not set up the VPN service. Try again, or send the log from Diagnostics (unreadable output: ${(parseErr as Error).message}). |  |
| `src/main/daemon/manager.ts:325` | result | Initialise the device first. |  |
| `src/main/daemon/manager.ts:413` | result | The VPN service is missing from this install. Reinstall the app. |  |
| `src/main/daemon/manager.ts:418` | result | Could not read the service's device key (${(err?.message ?? String(stderr)).trim().slice(0, 160)}). Enter its address instead. |  |
| `src/main/daemon/manager.ts:422` | result | The service home has no device key. |  |
| `src/main/daemon/manager.ts:424` | result | Could not read the service's device key (unreadable output: ${(parseErr as Error).message}). Enter its address instead. |  |
| `src/main/daemon/manager.ts:432` | throw | The device must be a Solana address (base58). |  |
| `src/main/daemon/settings.ts:98` | result | This app cannot read the VPN service settings on this account. Log out and back in (setup added you to the dvpn group), or re-run setup. |  |
| `src/main/host.ts:31` | throw | host not initialised |  |
| `src/main/ipc.ts:56` | result | Confirm first. |  |
| `src/main/ipc.ts:69` | throw | invalid input |  |
| `src/main/ipc.ts:78` | throw | only https links open externally |  |
| `src/main/ipc.ts:95` | throw | Unknown server. |  |
| `src/main/ipc.ts:120` | result | That is not a device address. |  |
| `src/main/ipc.ts:124` | result | This device can still pay for sessions. Remove its permission first; then its deposits can be settled here. |  |
| `src/main/ipc.ts:147` | result | Third-party checks are off in Settings. |  |
| `src/main/ipc.ts:148` | result | Third-party checks are off in Settings. |  |
| `src/main/ipc.ts:167` | result | Cancelled. |  |
| `src/main/ipc.ts:174` | result | This session has no SOCKS endpoint (only V2Ray/Xray sessions do). Nothing was changed. |  |
| `src/main/ipc.ts:180` | result | This session has no SOCKS endpoint (only V2Ray/Xray sessions do). Nothing was opened. |  |
| `src/main/ipc.ts:188` | result | Cancelled. |  |
| `src/main/ipc.ts:199` | result | Cancelled. |  |
| `src/main/ipc.ts:200` | result | That file is too large to be a key file. |  |
| `src/main/ipc.ts:213` | result | Enter the full endpoint URL, including its API key, or leave it unchanged. |  |
| `src/main/ipc.ts:220` | result | Set up a wallet first. |  |
| `src/main/ipc.ts:235` | result | Finish device setup first: the service will not start without it. |  |
| `src/main/ipc.ts:254` | result | That is not a device address. |  |
| `src/main/ipc.ts:266` | throw | invalid spend limit |  |
| `src/main/ipc.ts:274` | throw | invalid server list |  |
| `src/main/scheduler.ts:190` | throw | No background job "${name}" (the session poll runs only during a session). |  |
| `src/main/services/activity.ts:50` | result | The VPN service is not running. |  |
| `src/main/services/activity.ts:96` | result | Set up a wallet first. |  |
| `src/main/services/activity.ts:99` | result | Enter an amount. |  |
| `src/main/services/activity.ts:102` | result | That deposit was not found on the network (it may already be closed). |  |
| `src/main/services/activity.ts:103` | result | That deposit is not yours. |  |
| `src/main/services/activity.ts:104` | result | That deposit is closing; it cannot be topped up. |  |
| `src/main/services/cli-exec.ts:110` | result | Could not prepare the terminal: ${(err as Error).message} |  |
| `src/main/services/cli-exec.ts:125` | result | No terminal program was found. Run devnet-dvpn from your own terminal. |  |
| `src/main/services/connect-checks.ts:49` | result | Disconnect the current session first. |  |
| `src/main/services/connect-checks.ts:51` | result | That server is not on the network any more. | Pick another server |
| `src/main/services/connect-checks.ts:52` | result | That server has not checked in recently. Pick another. | Pick another server |
| `src/main/services/connect-checks.ts:54` | result | ${probe.error ?? 'Server check failed'}. Nothing was paid. | Pick another server |
| `src/main/services/connect-checks.ts:61` | result | The OpenVPN network adapter is missing and could not be added back (${fixed.detail}). Repair drivers, then connect again. Nothing was paid. | Open diagnostics |
| `src/main/services/connect-checks.ts:66` | result | This server does not sell ${req.basis === 'per_gb' ? 'per GB' : 'per hour'}. |  |
| `src/main/services/connection.ts:90` | throw | cancelled |  |
| `src/main/services/connection.ts:146` | result | Confirm the cost first. |  |
| `src/main/services/connection.ts:148` | fail | Set up a wallet first. |  |
| `src/main/services/connection.ts:162` | fail | The VPN service is not running. |  |
| `src/main/services/connection.ts:165` | fail | Finish device setup first. |  |
| `src/main/services/connection.ts:182` | fail | You left the old server, but your internet has not come back yet, so nothing was paid for the new one. Wait a moment and connect again. |  |
| `src/main/services/connection.ts:192` | fail | This plan gives access on ${servers}, and you already use ${limit.max === 1 ? 'it' : 'them'}. Connect to one of those, or get another plan. |  |
| `src/main/services/connection.ts:252` | fail | ${copy.message} Another VPN (${rivals.join(', ')}) is on and is probably blocking this: turn it off, then connect again. |  |
| `src/main/services/connection.ts:316` | toast | Cancel came too late: the connection is up. Press Disconnect to end it. |  |
| `src/main/services/connection.ts:411` | result | DNS could not be restored. | Restore network |
| `src/main/services/connection.ts:417` | result | Your internet may not work. | Restore network |
| `src/main/services/connection.ts:496` | result | DNS could not be restored. Reconnect your network or restart the computer. |  |
| `src/main/services/connection.ts:527` | result | The VPN service is not answering. Restart it with "sudo systemctl restart dvpnd-client" (or restart the computer), then press Restore network again. |  |
| `src/main/services/device-topup.ts:25` | toast | Sent this device ${sol(lamports)} SOL from your wallet for network fees. |  |
| `src/main/services/node-test.ts:114` | result | Pick at least one server. |  |
| `src/main/services/node-test.ts:115` | result | At most ${MAX_NODES_PER_RUN} servers per run. |  |
| `src/main/services/node-test.ts:127` | result | Confirm the spend limit first. |  |
| `src/main/services/node-test.ts:128` | result | A test run is already going. |  |
| `src/main/services/node-test.ts:129` | result | Disconnect first: a test uses the VPN service, which runs one session at a time. |  |
| `src/main/services/node-test.ts:131` | result | Set up a wallet first. |  |
| `src/main/services/node-test.ts:135` | result | These servers can lock up to ${plan.data.estimateText} in deposits, over your limit of ${tdvpn(req.maxSpend)} tDVPN. Raise the limit or pick fewer servers. |  |
| `src/main/services/node-test.ts:171` | throw | That server is not on the network any more. |  |
| `src/main/services/node-test.ts:176` | throw | This server sells neither per GB nor per hour. |  |
| `src/main/services/nodes.ts:63` | throw | "${address}" is not a server address. |  |
| `src/main/services/plans.ts:45` | throw | This plan's provider is not answering right now, so its server list can't be shown. Try again later or pick another plan. |  |
| `src/main/services/plans.ts:47` | throw | Could not read this plan's server list: ${msg.split('\n')[0]} |  |
| `src/main/services/plans.ts:52` | result | Confirm the price first. |  |
| `src/main/services/plans.ts:54` | result | Set up a wallet first. |  |
| `src/main/services/plans.ts:56` | result | That plan is not listed any more. |  |
| `src/main/services/plans.ts:57` | result | This plan's provider is not active. |  |
| `src/main/services/plans.ts:71` | result | Set up a wallet first. |  |
| `src/main/services/plans.ts:73` | result | Subscription not found. |  |
| `src/main/services/settlement.ts:55` | throw | That is this computer's device: leave out --device. |  |
| `src/main/services/settlement.ts:95` | result | Settlement is already running. |  |
| `src/main/services/settlement.ts:100` | result | Set up a wallet first. |  |
| `src/main/services/settlement.ts:131` | toast | Settlement: ${sigs.length} transaction${sigs.length > 1 ? 's' : ''} confirmed. |  |
| `src/main/services/settlement.ts:180` | result | Set up a wallet first. |  |
| `src/main/services/settlement.ts:182` | result | Nothing to refund. |  |
| `src/main/services/wallet.ts:52` | result | Create or import a wallet first (wallet create / wallet import). |  |
| `src/main/services/wallet.ts:53` | result | This computer has no device key yet. Create it on the Welcome screen first. |  |
| `src/main/services/wallet.ts:63` | result | The VPN service has no device key yet. |  |
| `src/main/services/wallet.ts:81` | result | No device is set up. |  |
| `src/main/services/wallet.ts:99` | result | That is not a device address. |  |
| `src/main/services/wallet.ts:100` | result | That is this computer's device: run device revoke without --device. |  |
| `src/main/services/wallet.ts:122` | result | Confirm the transfer first. |  |
| `src/main/services/wallet.ts:123` | result | That is not a Solana wallet address. |  |
| `src/main/services/wallet.ts:126` | result | Enter an amount. |  |
| `src/main/store.ts:14` | throw | store not initialised |  |
| `src/main/system/autostart.ts:67` | return | Start when I log in takes effect the next time the app opens (this command line is not running from the installed app). |  |
| `src/main/system/browser.ts:36` | throw | "${endpoint}" is not a local SOCKS endpoint. |  |
| `src/main/system/browser.ts:105` | throw | ${BROWSER_TITLES[name]} closed right after starting (${early}). Nothing is using the VPN proxy. |  |
| `src/main/system/dns-probe.ts:66` | return | None of these DNS servers answered from this computer (${rows.map((r) => r.server).join(', ')}): names may not resolve in a session. Choose another, e.g. "daemon set --dns cloudflare --yes". |  |
| `src/main/system/elevate.ts:25` | throw | unknown elevated step ${step} |  |
| `src/main/system/elevate.ts:28` | throw | bad parameter name ${k} |  |
| `src/main/system/elevate.ts:29` | throw | refusing unsafe argument for elevated step: ${v} |  |
| `src/main/system/proxy.ts:121` | throw | The KDE settings tool (kreadconfig) is missing. Nothing was changed. |  |
| `src/main/system/proxy.ts:131` | throw | The KDE settings tool (kwriteconfig) is missing. Nothing was changed. |  |
| `src/main/system/proxy.ts:163` | throw | refusing non-loopback proxy endpoint ${endpoint} |  |
| `src/main/system/proxy.ts:166` | throw | The VPN's SOCKS proxy is not answering on this computer (${live.reason}). Nothing was changed. |  |
| `src/main/system/proxy.ts:168` | throw | This desktop has no system proxy setting this app can change (GNOME or KDE). Set SOCKS5 127.0.0.1 port ${endpoint.split(':')[1]} in your apps instead. Nothing was changed. |  |
| `src/main/system/proxy.ts:178` | throw | The desktop did not accept the proxy setting. Nothing else was changed. |  |
| `src/main/wallet/electron-keystore.ts:27` | throw | This computer has no unlocked keyring to protect your wallet key (GNOME Keyring or KWallet). Sign in to your desktop session so the keyring unlocks, then try again. |  |
| `src/main/wallet/electron-keystore.ts:40` | throw | Your stored wallet could not be unlocked with this account's keyring. |  |
| `src/main/wallet/vault.ts:30` | throw | Set up a wallet first. |  |
| `src/main/wallet/vault.ts:40` | throw | A wallet is already set up on this computer (${cur}). Back up its recovery phrase, log out, then try again. Nothing was changed. |  |
| `src/preload/index.ts:17` | throw | blocked event ${channel} |  |
| `src/renderer/src/App.tsx:163` | banner | The VPN service is set up for a different network than this app. Connecting is blocked until it is re-installed for Solana devnet. |  |
| `src/renderer/src/components/PollSettings.tsx:16` | toast | ${j.label}: use a whole number of seconds from ${j.min} to ${j.max}. |  |
| `src/renderer/src/components/PollSettings.tsx:42` | toast | Refresh cadences back to defaults. |  |
| `src/renderer/src/lib/use-daemon-settings.ts:31` | toast | VPN service settings applied. |  |
| `src/renderer/src/screens/Cli.tsx:113` | toast | Copied. |  |
| `src/renderer/src/screens/Home.tsx:65` | banner | Internet may be blocked by the kill switch. Restore network releases it. |  |
| `src/renderer/src/screens/KillSwitch.tsx:60` | banner | The VPN service settings can&apos;t be read yet. Install the service first. |  |
| `src/renderer/src/screens/NodeTest.tsx:45` | toast | Test run finished. |  |
| `src/renderer/src/screens/NodeTest.tsx:69` | banner | Disconnect first: the VPN service runs one session at a time, so testing waits until you are off the VPN. |  |
| `src/renderer/src/screens/NodeTest.tsx:137` | toast | Run copied as JSON. |  |
| `src/renderer/src/screens/Onboarding.tsx:237` | banner | Your balance could not be read yet (the network is busy). Check again in a moment. |  |
| `src/renderer/src/screens/Settings.tsx:101` | toast | Device spending limit: use a positive tDVPN amount, e.g. 50. |  |
| `src/renderer/src/screens/Settings.tsx:145` | banner | The VPN service settings can&apos;t be read yet. Install the service first. |  |
| `src/renderer/src/screens/Settings.tsx:188` | toast | VPN service settings applied. |  |
| `src/renderer/src/screens/Settings.tsx:208` | toast | App settings restored to defaults. |  |
| `src/renderer/src/screens/SplitTunnel.tsx:147` | banner | Apps you leave out use your normal connection and show your real IP address. |  |
| `src/renderer/src/screens/Wallet.tsx:87` | banner | This device can&apos;t pay nodes yet. Run device setup below. |  |
| `src/renderer/src/screens/Wallet.tsx:104` | toast | The device is already set up with this limit. |  |
