# Error inventory (generated — `node scripts/error-inventory.mjs`)

Every user-facing error, warning and refusal string in `src/`, found by pattern (thrown errors,
Result `error:`, `fail()`, toasts, Banners, copy tables). Input to E3 (`ERROR-STANDARDS.md`);
do not edit by hand, re-run the script.

Total 440: copy 87, throw 157, return 47, fail 27, result 99, toast 20, banner 3

| Where | Kind | Text | Action |
|---|---|---|---|
| `src/cli/agent-cmd.ts:143` | copy | No wallet. |  |
| `src/cli/agent-cmd.ts:145` | copy | No wallet. |  |
| `src/cli/agent-cmd.ts:248` | throw | --basis must be per_gb or per_hour |  |
| `src/cli/agent-cmd.ts:251` | throw | --protocol must be any, ${PROTOCOLS.join(', ')} |  |
| `src/cli/agent-cmd.ts:253` | throw | --country must be a two-letter country code, e.g. DE |  |
| `src/cli/agent-cmd.ts:257` | throw | --max-price: ${(err as Error).message} |  |
| `src/cli/agent-cmd.ts:338` | return | This computer's spending limit (${tdvpn(allowanceBase)} tDVPN) is below this deposit. It is raised only with --raise-limit: then --yes raises it to ${tdvpn(want.toString())} tDVPN. |  |
| `src/cli/agent-cmd.ts:365` | copy | Spending limit ${tdvpn(allowanceBase)} tDVPN is below this deposit (${deposit} tDVPN). Nothing was paid. next sets the limit to this deposit (${deposit} tDVPN); alsoNext raises it to ${tdvpn(want.toString())} tDVPN with --raise-limit. |  |
| `src/cli/agent-cmd.ts:402` | fail | Another agent up on this computer is still connecting (waited ${UP_LOCK_WAIT_MS / 1000} s). Nothing was paid. |  |
| `src/cli/agent-cmd.ts:420` | fail | ${keyfileModeText(kfm)} Nothing was paid. |  |
| `src/cli/agent-cmd.ts:459` | fail | You do not hold an active subscription ${inp.plan}. |  |
| `src/cli/agent-cmd.ts:479` | fail | No server answered its check, and this computer has no internet: the kill switch is holding the block. Nothing was paid. |  |
| `src/cli/agent-cmd.ts:501` | fail | No online node matches${atCap}.${refused ? |  |
| `src/cli/agent-cmd.ts:505` | fail | No node in ${inp.country} answers its check${atCap} right now; ${nodesWord(elsewhere)} elsewhere ${elsewhere === 1 ? 'does' : 'do'}. Nothing was paid. |  |
| `src/cli/agent-cmd.ts:507` | fail | No ${inp.protocol} node answers its check${inp.country ? |  |
| `src/cli/agent-cmd.ts:509` | fail | No ${inp.protocol} node in ${inp.country} answers its check${atCap} right now; ${nodesWord(neither)} elsewhere with another protocol ${neither === 1 ? 'does' : 'do'}. Nothing was paid. |  |
| `src/cli/agent-cmd.ts:526` | fail | Node ${inp.node} is not picked: ${why}. Nothing was paid. |  |
| `src/cli/agent-cmd.ts:528` | fail | No online node matches these filters. |  |
| `src/cli/agent-cmd.ts:553` | fail | This deposit (${tdvpn(c.escrow)} tDVPN) is above the default cap of ${tdvpn(cap.toString())} tDVPN (${dflt?.source === 'market' ? 'sized from the market' : 'your spending limit / 10'}). Nothing was paid. The cheapest matching node above the cap: ${tdvpn(inp.basis === 'per_gb' ? node!.pricePerGb ?? '0' : node!.pricePerHour ?? '0')} tDVPN/${inp.basis === 'per_gb' ? 'GB' : 'hour'}; add --max-price ${tdvpn(inp.basis === 'per_gb' ? node!.pricePerGb ?? '0' : node!.pricePerHour ?? '0')} to accept it. |  |
| `src/cli/agent-cmd.ts:565` | fail | Not enough funds for this deposit (${tdvpn(c.escrow)} tDVPN). |  |
| `src/cli/agent-cmd.ts:571` | throw | --raise-limit-to needs a number of tDVPN (got "${raiseTo}"). |  |
| `src/cli/agent-cmd.ts:573` | fail | The limit asked with --raise-limit-to (${raiseTo} tDVPN) is below this deposit (${tdvpn(c.escrow)} tDVPN). Nothing was paid. |  |
| `src/cli/agent-cmd.ts:590` | fail | The spending limit was not set to ${raiseTo} tDVPN: ${rs.error ?? 'device setup failed'}. Nothing was paid. |  |
| `src/cli/agent-cmd.ts:635` | fail | No wallet, so the deposits cannot be read or closed. |  |
| `src/cli/agent-cmd.ts:664` | fail | The session stopped, but this computer's DNS could not be put back. No deposit was closed yet. ${reason} |  |
| `src/cli/agent-cmd.ts:666` | fail | Could not disconnect, so no deposit was closed (a per-hour deposit keeps billing). ${reason} |  |
| `src/cli/agent-cmd.ts:672` | fail | Disconnected, but another refund run was busy, so the deposits were not closed. |  |
| `src/cli/agent-cmd.ts:873` | throw | unknown: agent ${sub} (up \| down \| status) |  |
| `src/cli/android/split-android-cmd.ts:29` | throw | split routes all\|include\|exclude [address\|network…] |  |
| `src/cli/android/split-android-cmd.ts:40` | throw | unknown: split ${sub} |  |
| `src/cli/android/split-android-cmd.ts:42` | throw | split set all\|include\|exclude [package…] |  |
| `src/cli/args.ts:41` | throw | --${n} needs a value (nothing was run) |  |
| `src/cli/args.ts:49` | throw | --${name} must be a whole number from ${min} to ${max} |  |
| `src/cli/commands.ts:76` | throw | --basis must be per_gb or per_hour |  |
| `src/cli/commands.ts:152` | throw | wallet import <keyfile.json \| -> (- reads stdin) |  |
| `src/cli/commands.ts:157` | throw | no wallet |  |
| `src/cli/commands.ts:167` | throw | wallet send --to <address> [--tdvpn N] [--sol N] --yes |  |
| `src/cli/commands.ts:169` | throw | "${to}" is not a Solana wallet address. |  |
| `src/cli/commands.ts:170` | throw | --${k} must be a positive number |  |
| `src/cli/commands.ts:175` | throw | --${k}: the amount must be more than 0. |  |
| `src/cli/commands.ts:192` | throw | unknown: wallet ${sub} |  |
| `src/cli/commands.ts:205` | throw | device register [device-pubkey] [--home <dir>] (wallet required) |  |
| `src/cli/commands.ts:246` | throw | --max-price needs a number of tDVPN per GB or per hour (got "${mpFlag}"). |  |
| `src/cli/commands.ts:286` | throw | no device recorded |  |
| `src/cli/commands.ts:308` | throw | unknown: device ${sub} |  |
| `src/cli/commands.ts:333` | throw | nodes list --limit N (N = a whole number, 1 or more) |  |
| `src/cli/commands.ts:339` | throw | nodes ${sub} <node> |  |
| `src/cli/commands.ts:346` | throw | nodes fav <node> |  |
| `src/cli/commands.ts:356` | throw | unknown: nodes ${sub} |  |
| `src/cli/commands.ts:362` | throw | cost <node> [--basis per_gb\|per_hour] [--units N] |  |
| `src/cli/commands.ts:370` | throw | connect <node> [--basis] [--units N] [--plan <subscription>] --yes |  |
| `src/cli/commands.ts:490` | throw | channels fund <channel> --tdvpn N --yes |  |
| `src/cli/commands.ts:514` | throw | plans roster <plan> |  |
| `src/cli/commands.ts:532` | throw | plans subscribe <plan> --yes |  |
| `src/cli/commands.ts:543` | throw | plans close <subscription> --yes |  |
| `src/cli/commands.ts:548` | throw | unknown: plans ${sub} |  |
| `src/cli/commands.ts:585` | throw | unknown: settle ${sub} |  |
| `src/cli/daemon-cmd.ts:85` | return | Some drivers are missing: run "daemon repair-drivers --yes". |  |
| `src/cli/daemon-cmd.ts:86` | return | Some drivers are missing: ${names.join(', ')}. No server can be used until it is fixed: run "daemon repair-drivers --yes". |  |
| `src/cli/daemon-cmd.ts:88` | return | Some drivers are missing: ${names.join(', ')}. Only ${list} servers need it; the others work now. To fix it: "daemon repair-drivers --yes". |  |
| `src/cli/daemon-cmd.ts:218` | throw | --${k} is for the desktop app; on Android use: split set / split routes |  |
| `src/cli/daemon-cmd.ts:232` | throw | unknown DNS preset "${dns}": use ${Object.keys(DNS_PRESETS).join(', ')} or IP addresses |  |
| `src/cli/daemon-cmd.ts:256` | throw | --split-apps: separate apps with ";", not commas (for example "<app 1>;<app 2>"). |  |
| `src/cli/daemon-cmd.ts:299` | throw | unknown DNS preset "${dns}": use ${Object.keys(DNS_PRESETS).join(', ')} or IP addresses |  |
| `src/cli/daemon-cmd.ts:317` | throw | unknown: daemon ${sub} |  |
| `src/cli/info-cmd.ts:74` | throw | rpc set <url> [url...] |  |
| `src/cli/info-cmd.ts:76` | throw | Not accepted (https only; http only for 127.0.0.1): ${bad.map(redactUrls).join(', ')}. Nothing was changed. |  |
| `src/cli/info-cmd.ts:94` | throw | settings set key=value ... |  |
| `src/cli/info-cmd.ts:97` | throw | unknown setting "${k}". Known: ${Object.keys(DEFAULT_SETTINGS).join(', ')} |  |
| `src/cli/info-cmd.ts:123` | throw | unknown: settings ${a._[1]} |  |
| `src/cli/info-cmd.ts:149` | throw | --browser must be ${BROWSERS.join(' or ')} |  |
| `src/cli/info-cmd.ts:156` | throw | The current session has no SOCKS endpoint (only V2Ray/Xray sessions do). Nothing was opened. |  |
| `src/cli/info-cmd.ts:162` | throw | unknown: proxy ${sub} |  |
| `src/cli/info-cmd.ts:165` | throw | The current session has no SOCKS endpoint (only V2Ray/Xray sessions do). Nothing was changed. |  |
| `src/cli/payer.ts:13` | return | Paid by ${shortAddr(payer)}, not the loaded wallet ${shortAddr(loaded)}. |  |
| `src/cli/payer.ts:14` | return | Paid from ${shortAddr(payer)}. |  |
| `src/cli/poll-cmd.ts:22` | throw | unknown job "${s}". Jobs: ${POLL_JOB_NAMES.join(', ')} |  |
| `src/cli/poll-cmd.ts:34` | throw | poll set <job>=<seconds> … |  |
| `src/cli/poll-cmd.ts:40` | throw | ${job} must be a whole number of seconds from ${POLL_JOBS[job].min} to ${POLL_JOBS[job].max} |  |
| `src/cli/poll-cmd.ts:56` | throw | ${runs.filter((r) => !r.ok).map((r) => r.name).join(', ')} failed. |  |
| `src/cli/poll-cmd.ts:78` | throw | a job broke its cadence |  |
| `src/cli/poll-cmd.ts:79` | throw | unknown: poll ${sub} |  |
| `src/cli/send-check.ts:58` | copy | This wallet holds ${TD(i.ownerTdvpnBase)} tDVPN; the send asks for ${TD(i.tdvpnBase)}. Nothing was sent or signed. |  |
| `src/cli/send-check.ts:59` | copy | This wallet holds ${SOL(i.ownerLamports)} SOL; ${costWords} ${SOL(i.lamports + cost)}. Nothing was sent or signed. |  |
| `src/cli/send-check.ts:63` | copy | This send leaves ${SOL(after)} SOL, less than the ${SOL(MIN_SOL_AFTER_LAMPORTS)} SOL the wallet needs for fees. Send less, or add --allow-empty to empty it. Nothing was sent or signed. |  |
| `src/cli/send-check.ts:77` | copy | The allowance ${TD(allowanceBase)} tDVPN is above this wallet's ${TD(ownerTdvpnBase)} tDVPN. Use a lower --allowance, or add --force. Nothing was sent or signed. |  |
| `src/cli/server-stopped.ts:32` | return | No deposit is open. |  |
| `src/cli/server-stopped.ts:36` | return | Your deposit is safe: ${CLI} agent down --yes closes it and the unused ${tdvpn(total)} tDVPN is refunded (${when}). |  |
| `src/cli/split-cmd.ts:57` | throw | split status \| apps [--search TEXT] |  |
| `src/cli/test-cmd.ts:35` | throw | test run <server…> \| --online [--country C] [--protocol P] [--failed-last] [--never-tested] \| --resume |  |
| `src/cli/test-cmd.ts:148` | throw | unknown: test ${sub} |  |
| `src/core/app/device-setup.ts:77` | return | This wallet is this computer's own device key ({device}), so it cannot give itself a spending limit. Use your own wallet (the one holding your tDVPN), not the VPN service's key file. Nothing was signed. |  |
| `src/core/app/device-setup.ts:141` | return | Add devnet SOL to your wallet first: setting up this computer to pay servers needs about {needLamports} SOL for fees. |  |
| `src/core/app/device-setup.ts:160` | throw | Disconnect first: this computer is using a deposit right now. Deposits are still refunded to your wallet after you remove the device. |  |
| `src/core/app/device-setup.ts:162` | throw | This device has no spending limit to remove. |  |
| `src/core/app/wallet-status.ts:74` | copy | The device is low on SOL for fees. Top it up in Wallet. |  |
| `src/core/app/wallet-status.ts:75` | copy | Your wallet has under 1 tDVPN. Deposits will fail until you add more. |  |
| `src/core/app/wallet-status.ts:76` | copy | The device spending limit is almost used up. Raise it in Wallet. |  |
| `src/core/chain/amounts.ts:28` | throw | "{amount}" is not a tDVPN amount. Use a number like 2.5. |  |
| `src/core/chain/amounts.ts:30` | throw | A tDVPN amount has at most {decimals} decimals; "{amount}" has more. |  |
| `src/core/chain/amounts.ts:32` | throw | The tDVPN amount "{amount}" is too large. |  |
| `src/core/chain/amounts.ts:39` | throw | "{amount}" is not a SOL amount. Use a number like 0.05. |  |
| `src/core/chain/amounts.ts:41` | throw | SOL has 9 decimals, got "{amount}" |  |
| `src/core/chain/builders.ts:158` | throw | fund_channels: duplicate channel |  |
| `src/core/chain/errors.ts:96` | return | This would leave an account below Solana's minimum balance (about 0.001 SOL). Send a little less. |  |
| `src/core/chain/errors.ts:99` | return | The transaction expired before it landed. Try again. |  |
| `src/core/chain/errors.ts:104` | return | A tDVPN token account this transaction needs does not exist yet. |  |
| `src/core/chain/idl.ts:70` | throw | IDL has no account ${pascal} |  |
| `src/core/chain/program.ts:41` | throw | id must be 32 bytes, got ${buf.length} |  |
| `src/core/chain/program.ts:91` | throw | Config account ${addr.toBase58()} not found on ${PROGRAM_ID.toBase58()} |  |
| `src/core/chain/tx.ts:74` | throw | ${label}: no instructions |  |
| `src/core/chain/tx.ts:141` | copy | Transaction {signature} failed. |  |
| `src/core/chain/tx.ts:153` | copy | Transaction {signature} failed. |  |
| `src/core/chain/tx.ts:182` | throw | Signed transaction fee payer does not match your wallet. |  |
| `src/core/chain/tx.ts:185` | throw | Transaction calls a program the app does not accept: {program} |  |
| `src/core/chain/tx.ts:187` | throw | Address lookup tables are not accepted. |  |
| `src/core/daemon/config.ts:77` | throw | A setting value contains a quote or newline: {value}. |  |
| `src/core/daemon/config.ts:180` | throw | Kill switch must be off, on or persist. |  |
| `src/core/daemon/config.ts:181` | throw | Basis must be per_gb or per_hour. |  |
| `src/core/daemon/config.ts:182` | throw | Whole device must be true or false. |  |
| `src/core/daemon/config.ts:183` | throw | DNS mode must be one of {modes}. |  |
| `src/core/daemon/config.ts:184` | throw | DNS needs 1 to 4 servers. |  |
| `src/core/daemon/config.ts:185` | throw | The DNS server {address} is not an IP address. |  |
| `src/core/daemon/config.ts:188` | throw | The deposit must be a positive whole number. |  |
| `src/core/daemon/config.ts:190` | throw | The {setting} must be a whole number (0 = the server's minimum). |  |
| `src/core/daemon/config.ts:202` | throw | The {setting} has characters a URL cannot hold (spaces, quotes, backslashes). |  |
| `src/core/daemon/config.ts:207` | throw | The {setting} is not a URL: {reason}. |  |
| `src/core/daemon/config.ts:211` | throw | The {setting} needs a real host name, got "{host}". |  |
| `src/core/daemon/config.ts:220` | throw | Split mode must be off, include or exclude. |  |
| `src/core/daemon/config.ts:221` | throw | Split apps and routes must be lists. |  |
| `src/core/daemon/config.ts:222` | throw | Too many split apps or routes (64 apps, 256 routes). |  |
| `src/core/daemon/config.ts:224` | throw | Split app path contains a quote or newline: {path}. |  |
| `src/core/daemon/config.ts:226` | throw | Split app must be a full path: {path}. |  |
| `src/core/daemon/config.ts:227` | throw | Split app must be an .exe file: {path}. |  |
| `src/core/daemon/config.ts:231` | throw | Split app must be an app's own program, like {example} (pick it from the app list): {path}. |  |
| `src/core/daemon/config.ts:234` | throw | Safari can’t be chosen: its pages load in shared system processes. Use address ranges, or a browser like Chrome or Firefox. |  |
| `src/core/daemon/config.ts:236` | throw | Split route must be an IP address or range like {example}, not a name (sites behind a CDN change addresses): {route}. |  |
| `src/core/daemon/config.ts:237` | throw | Split include/exclude needs at least one app or route. |  |
| `src/core/daemon/flags.ts:8` | throw | --escrow must be a positive tDVPN amount, e.g. 2.5 |  |
| `src/core/daemon/flags.ts:14` | throw | --${name} must be a whole number (0 = the node's minimum) |  |
| `src/core/daemon/flags.ts:23` | throw | --${name} must be true or false, got "${raw}" |  |
| `src/core/daemon/layout.ts:61` | throw | not an instance tag: ${tag} |  |
| `src/core/daemon/link-copy.ts:34` | copy | This wallet's spending approval for this computer was revoked, so nothing was paid. Set it up again (device setup) from your wallet. | devnet-dvpn device setup --yes |
| `src/core/daemon/link-copy.ts:37` | copy | Your wallet doesn't have enough tDVPN for this deposit, so nothing was paid. Add tDVPN or pick a smaller deposit. |  |
| `src/core/daemon/link-copy.ts:42` | copy | A session is already active; disconnect it first. | devnet-dvpn agent status --json |
| `src/core/daemon/link-copy.ts:48` | copy | The VPN service is starting up or stopping. Try again in a moment. |  |
| `src/core/daemon/link-copy.ts:52` | copy | The VPN service is off. |  |
| `src/core/nodes/nodeapi.ts:21` | throw | domain ${tag} exceeds 32 bytes |  |
| `src/core/nodetest/stages.ts:104` | return | Nothing was paid. |  |
| `src/core/nodetest/stages.ts:105` | return | The deposit was closed and the unused part is back in your wallet. |  |
| `src/core/nodetest/stages.ts:106` | return | The refund of the unused deposit has started and takes about 2 hours. |  |
| `src/core/nodetest/stages.ts:107` | return | The deposit is still open. The app will close it. |  |
| `src/core/pricing/cost.ts:68` | return | Not enough tDVPN: this deposit needs {escrow}. |  |
| `src/core/pricing/cost.ts:69` | return | Your spending approval is lower than this deposit. Raise it in Wallet → Device. |  |
| `src/core/pricing/cost.ts:70` | return | This device's spending limit is lower than this deposit. Raise it in Wallet → Device. |  |
| `src/core/pricing/cost.ts:71` | return | This device needs a little SOL (0.005) for network fees and the deposit account. Top it up in Wallet → Device. |  |
| `src/core/quality/quality.ts:57` | throw | No tunnel to measure through right now (reconnecting) |  |
| `src/core/quality/quality.ts:149` | result | No IP service answered ({join}) |  |
| `src/core/quality/quality.ts:177` | throw | Left out of the VPN by split tunnelling. |  |
| `src/core/quality/quality.ts:198` | result | Speed test failed ({join}) |  |
| `src/core/quality/socks.ts:22` | fail | SOCKS {endpoint}: no answer within {timeoutMs} ms. |  |
| `src/core/quality/socks.ts:27` | fail | SOCKS {endpoint}: not a no-auth SOCKS5 proxy. |  |
| `src/core/quality/socks.ts:35` | fail | SOCKS {endpoint}: could not reach {host}:{port} (reply {buf}) |  |
| `src/core/quality/socks.ts:37` | fail | SOCKS {endpoint}: bad reply address type {buf} |  |
| `src/core/quality/socks.ts:46` | fail | SOCKS ${endpoint}: ${err.message} |  |
| `src/core/session/setup-gate.ts:29` | return | This device needs a little SOL for transaction fees (has {lamports}, needs {DEVICE_MIN_LAMPORTS}). |  |
| `src/core/session/state.ts:107` | copy | Disconnected. | Add funds and reconnect |
| `src/core/session/state.ts:108` | copy | Your deposit ran out. | Add funds and reconnect |
| `src/core/session/state.ts:110` | copy | The connection to this server stopped working. | Pick another server |
| `src/core/session/state.ts:113` | copy | Connected to the server, but no traffic gets through it. Try another server or protocol. | Pick another server |
| `src/core/session/state.ts:114` | copy | This network drops large packets, so this server's tunnel can't carry traffic. A server with V2Ray or Xray usually works. | Try another protocol |
| `src/core/session/state.ts:115` | copy | Connection to the server was lost. | Reconnect |
| `src/core/session/state.ts:116` | copy | The server ended the session. | Pick another server |
| `src/core/session/state.ts:117` | copy | The deposit for this session was closed. | Reconnect with a new deposit |
| `src/core/session/state.ts:118` | copy | Your deposit is being refunded, so the session ended. | Connect with a new deposit |
| `src/core/session/state.ts:119` | copy | Your deposit was refunded, so the session ended. | View plans |
| `src/core/session/state.ts:120` | copy | Disconnected. | View plans |
| `src/core/session/state.ts:122` | copy | You've used this plan's data. | View plans |
| `src/core/session/state.ts:123` | copy | Your plan access expired. Connect again to renew it. | Reconnect |
| `src/core/session/state.ts:124` | copy | This server is no longer on your plan right now. | Pick another server |
| `src/core/session/state.ts:125` | copy | This session was replaced by a newer one. |  |
| `src/core/session/state.ts:128` | copy | The connection to this server is losing data, so the app stopped paying for data this device did not receive. | Pick another server |
| `src/core/session/state.ts:129` | copy | The server counted more data than this device did, so the app stopped paying it. | Pick another server |
| `src/core/session/state.ts:130` | copy | The tunnel stopped responding, so the session ended. Your unused deposit is refunded automatically. | Reconnect |
| `src/core/session/state.ts:132` | copy | The VPN service restarted with your new settings, so the session ended. | Reconnect |
| `src/core/session/state.ts:133` | copy | The VPN service restarted. | Reconnect |
| `src/core/session/state.ts:135` | copy | The VPN service stopped and has not started again. | Restore network |
| `src/core/session/state.ts:138` | copy | The VPN service restarted, so the session ended. | Reconnect |
| `src/core/session/state.ts:148` | copy | Not enough credit left on this plan or deposit. | Add funds |
| `src/core/session/state.ts:149` | copy | Your plan allows a limited number of devices at once, or the server is full. Disconnect one first. | Pick another server |
| `src/core/session/state.ts:150` | copy | This server isn't available on your plan right now. | Pick another server |
| `src/core/session/state.ts:151` | copy | Your plan doesn't include this server, or it expired. | Pick another server |
| `src/core/session/state.ts:155` | copy | This device's clock is wrong by more than a minute, so the plan provider refused the request. Set the date and time to automatic, then connect again. Nothing was paid. | Fix the clock |
| `src/core/session/state.ts:157` | copy | The plan's provider is not answering, so this server can't check your plan. Nothing was paid. | Retry later |
| `src/core/session/state.ts:160` | copy | Your plan couldn't give this server access. Its data may already be shared out to the servers you use, or the plan provider is not answering. | Pick a server you already use |
| `src/core/session/state.ts:161` | copy | This device is not allowed to spend for your wallet yet. | Set up device |
| `src/core/session/state.ts:162` | copy | Deposit too small for this server's minimum. | Increase deposit |
| `src/core/session/state.ts:163` | copy | Deposit too small for this server's minimum. | Increase deposit |
| `src/core/session/state.ts:164` | copy | The server restarted since your deposit was made. | Reconnect with a new deposit |
| `src/core/session/state.ts:165` | copy | The server refused the payment terms. | Pick another server |
| `src/core/session/state.ts:166` | copy | The server is busy. | Retry later |
| `src/core/session/state.ts:167` | copy | The app could not sign the payment. Send a problem report from Diagnostics. | Report |
| `src/core/session/state.ts:168` | copy | The server expects a different payment mode. Send a problem report from Diagnostics. | Report |
| `src/core/session/state.ts:169` | copy | The server expects a different payment mode. Send a problem report from Diagnostics. | Report |
| `src/core/session/state.ts:193` | copy | Connecting stopped because you disconnected. If a deposit was already sent, its unused part is refunded automatically. | Connect again |
| `src/core/session/state.ts:198` | copy | Waiting for the network. The VPN service started before this device was online and is still trying to reach the Solana network. Nothing was paid. | Retry in a moment |
| `src/core/session/state.ts:201` | copy | A VPN session is already running (started from the command line or another window). Disconnect it first, then connect again. Nothing was paid. | Disconnect |
| `src/core/session/state.ts:204` | copy | This plan access belongs to another wallet than the one this computer's VPN service uses. Switch back to that wallet, or set up this computer again with the current wallet. Nothing was paid. | Set up device |
| `src/core/session/state.ts:214` | copy | The connection to the previous server is still closing, so nothing was paid. Connect again in a few seconds. | Retry |
| `src/core/session/state.ts:216` | copy | The VPN service stopped while connecting. If the kill switch is on, it is still blocking the internet: connect again, or press Restore network. | Retry |
| `src/core/session/state.ts:217` | copy | The kill switch is still blocking the internet and lets through only the server you were on, so this server cannot be reached. Press Restore network, then connect. Nothing was paid. | Restore network |
| `src/core/session/state.ts:226` | copy | The VPN couldn't change this computer's DNS settings (often a container or a locked /etc/resolv.conf). In Settings, turn off Use the VPN's DNS, then connect again. Your unused deposit is refunded automatically. | Open settings |
| `src/core/session/state.ts:231` | copy | This server's protocol isn't installed on this computer. | Pick another server |
| `src/core/session/state.ts:235` | copy | This server failed its identity check: its signed details don't match its listing. It may run an older version. Nothing was paid. | Pick another server |
| `src/core/session/state.ts:240` | copy | This server billed more than this device measured, so the app won't pay it again from this deposit. Nothing more was paid. Pick another server; what is left of this deposit is refunded automatically. | Pick another server |
| `src/core/session/state.ts:241` | copy | This server's price changed since you paid the deposit. Nothing more was paid. Pick another server, or refund it and reconnect at the new price. | Pick another server |
| `src/core/session/state.ts:242` | copy | The VPN service could not turn on the kill switch for this connection, so it stopped. Try again, or turn the kill switch off in Settings. | Retry |
| `src/core/session/state.ts:245` | copy | Hysteria2 couldn't reach this server. The server may be down, or this network may block UDP or allow only small packets; a server with another protocol usually works. Your unused deposit is refunded automatically. | Try another protocol |
| `src/core/session/state.ts:248` | copy | This network drops large packets, so this server's tunnel can't carry traffic. A server with V2Ray or Xray usually works. Your unused deposit is refunded automatically. | Try another protocol |
| `src/core/session/state.ts:249` | copy | The tunnel came up but no traffic passes through it. The server may be misconfigured, or this network may block it. Your unused deposit is refunded automatically. | Try another server or protocol |
| `src/core/session/state.ts:254` | copy | The VPN service on this computer could not start the program this server's protocol needs ({tool}). Your deposit with this server is kept and is used the next time you connect to it. Open Diagnostics and repair the VPN service, or pick a server with another protocol. | Open diagnostics |
| `src/core/session/state.ts:255` | copy | The server accepted the deposit but the tunnel didn't come up. The server may be down, or your network may block this protocol (WireGuard, AmneziaWG and Hysteria2 need UDP). Your unused deposit is refunded automatically. | Try another server or protocol |
| `src/core/session/state.ts:258` | copy | This deposit is larger than this computer's spending limit allows. Raise the limit in Wallet, then connect again. Nothing was paid. | Open Wallet |
| `src/core/session/state.ts:259` | copy | This device is out of SOL for network fees. | Top up device |
| `src/core/session/state.ts:262` | copy | Your deposit with this server is still being confirmed by the network. Try again in a few minutes; you will not pay twice. Or pick another server now. | Pick another server |
| `src/core/session/state.ts:266` | copy | This network intercepted the connection to the Solana network (a login page, proxy or filter). Nothing was paid. Try another network, or set your own RPC endpoint in Settings. | Retry |
| `src/core/session/state.ts:268` | copy | This server isn't answering right now, so nothing was paid. Pick another server, or try again in a few minutes. | Pick another server |
| `src/core/session/state.ts:270` | copy | The Solana network endpoint didn't answer in time, so nothing was paid. Try again in a minute, or add your own RPC endpoint in Settings. | Retry |
| `src/core/session/state.ts:271` | copy | The server didn't answer in time. | Retry |
| `src/core/session/state.ts:272` | copy | The payment transaction was rejected by the network program. | Try stream payment |
| `src/core/session/state.ts:275` | copy | The VPN service's Solana connection has run out of credit. Set another address in Settings, under Solana connection for the VPN service. | Open settings |
| `src/core/session/state.ts:276` | copy | The Solana network endpoint is rate-limiting requests. Wait a minute and try again, or add your own RPC endpoint in Settings. | Retry |
| `src/core/session/state.ts:279` | copy | The server had a problem starting your session. Your deposit with it is kept and will be used when you try again. Try again in a minute, or pick another server. | Retry |
| `src/core/session/state.ts:282` | copy | The Solana network is busy right now, so nothing was paid. Wait a minute and try again, or add your own RPC endpoint in Settings. | Retry |
| `src/core/session/state.ts:286` | copy | Something went wrong. Retry. | Retry |
| `src/core/session/state.ts:447` | return | Split tunnelling works with the kill switch off on this version. Every app uses the VPN. |  |
| `src/core/session/state.ts:449` | return | Split tunnelling needs a newer VPN service. Every app uses the VPN. |  |
| `src/core/session/state.ts:451` | return | V2Ray and Xray work as a proxy here: only apps that use the proxy go through the VPN, so split tunnelling does not apply. Use WireGuard, AmneziaWG, OpenVPN or Hysteria2 to split by address. |  |
| `src/core/session/state.ts:452` | return | Turn on "Whole computer" for V2Ray and Xray to use split tunnelling. Until then only apps set to use the proxy use the VPN. |  |
| `src/core/session/state.ts:459` | return | Choosing apps on this server needs a newer VPN service. Every app uses the VPN. |  |
| `src/core/session/state.ts:464` | return | Split tunnelling needs a newer VPN service. Every app uses the VPN. |  |
| `src/core/session/state.ts:467` | return | Split tunnelling is not available for this server. Every app uses the VPN. |  |
| `src/core/session/state.ts:473` | return | The kill switch does not work with {name} on Windows yet: it blocks the VPN itself. Turn the kill switch off in Settings, or pick a Hysteria2, V2Ray or Xray server. Nothing was paid. |  |
| `src/core/session/status-card.ts:50` | return | Install the VPN service on the Connect page. |  |
| `src/core/session/status-card.ts:51` | return | Start the VPN service on the Connect page. |  |
| `src/core/session/status-card.ts:52` | return | Finish setup on the Connect page. |  |
| `src/core/session/status-card.ts:53` | return | Reinstall the VPN service on the Connect page. |  |
| `src/core/session/status-card.ts:54` | return | Repair on the Connect page. |  |
| `src/core/session/status-card.ts:55` | return | One moment. |  |
| `src/core/wallet/keys.ts:45` | throw | The derivation path "{path}" must start with m/, like {example}. |  |
| `src/core/wallet/keys.ts:48` | throw | Every derivation path segment must be hardened (end with {mark}), unlike "{segment}". |  |
| `src/core/wallet/keys.ts:72` | throw | That key file is not valid JSON: {reason} |  |
| `src/core/wallet/keys.ts:75` | throw | That key file is not a Solana key (expected a JSON array of 64 numbers, as written by solana-keygen). |  |
| `src/core/wallet/keys.ts:101` | throw | Paste a recovery phrase, a key file, or a private key. |  |
| `src/core/wallet/keys.ts:104` | throw | That recovery phrase is not valid. Check the words and their order. |  |
| `src/core/wallet/keys.ts:111` | throw | That private key is not valid base58: {reason} |  |
| `src/core/wallet/keys.ts:115` | throw | A private key is 64 bytes (got {count}). |  |
| `src/core/wallet/new-keyfile.ts:38` | throw | No SID in the whoami /user output. |  |
| `src/core/wallet/new-keyfile.ts:48` | throw | Other users can still read it (${m[1]}:${m[2]}). |  |
| `src/core/wallet/new-keyfile.ts:68` | throw | Could not write the key file ${abs}: ${(err as Error).message} |  |
| `src/core/wallet/new-keyfile.ts:77` | throw | Could not write the key file ${abs}: ${(err as Error).message} |  |
| `src/main/android/android-bridge.ts:18` | throw | The Android app bridge is not available (DVPN_APP_BRIDGE unset): run this CLI from the app. |  |
| `src/main/android/android-bridge.ts:63` | throw | Android app bridge sent an unreadable reply: ${(err as Error).message} |  |
| `src/main/android/android-bridge.ts:70` | throw | Android Keystore could not encrypt the wallet: {reason} |  |
| `src/main/android/android-bridge.ts:76` | throw | Android Keystore could not decrypt the wallet (was the app reinstalled?): {reason} |  |
| `src/main/android/split-apps.ts:45` | throw | Split mode must be one of ${SPLIT_MODES.join(', ')}. |  |
| `src/main/android/split-apps.ts:48` | throw | Not an IP address or network (like 10.0.0.0/8): {join} |  |
| `src/main/android/split-apps.ts:49` | throw | At most {count} addresses. |  |
| `src/main/android/split-apps.ts:50` | throw | "Only these addresses" needs at least one address; otherwise everything would use the VPN. |  |
| `src/main/android/split-apps.ts:66` | throw | Split mode must be one of ${SPLIT_MODES.join(', ')}. |  |
| `src/main/android/split-apps.ts:68` | throw | Not an Android package name: {join} |  |
| `src/main/android/split-apps.ts:70` | throw | At most {count} apps. |  |
| `src/main/android/split-apps.ts:71` | throw | "Only these apps" needs at least one app; otherwise every app would use the VPN. |  |
| `src/main/daemon/manager.ts:511` | throw | doctor output is not a list |  |
| `src/main/daemon/manager.ts:592` | result | A switch to another wallet (${have.owner.slice(0, 4)}…${have.owner.slice(-4)}) was started and not finished. Load that wallet to finish it, or remove the half-finished setup (Diagnostics, or: devnet-dvpn device discard-setup --yes). Nothing was paid. |  |
| `src/main/daemon/manager.ts:594` | result | The VPN service is missing from this install. Reinstall the app. |  |
| `src/main/daemon/manager.ts:603` | result | Could not set up the VPN service for this wallet. Try again, or send the log from Diagnostics (${(err?.message ?? String(stderr)).slice(0, 300)}). |  |
| `src/main/daemon/manager.ts:615` | result | Could not set up the VPN service for this wallet. Try again, or send the log from Diagnostics (unreadable output: ${(parseErr as Error).message}). |  |
| `src/main/daemon/manager.ts:775` | result | The VPN service is missing from this install. Reinstall the app. |  |
| `src/main/daemon/manager.ts:778` | result | A half-finished setup exists. Remove it in Diagnostics (or: devnet-dvpn device discard-setup --yes), then try again. Nothing was paid. |  |
| `src/main/daemon/manager.ts:787` | result | Could not set up the VPN service. Try again, or send the log from Diagnostics (${(err?.message ?? String(stderr)).slice(0, 300)}). |  |
| `src/main/daemon/manager.ts:796` | result | Could not set up the VPN service. Try again, or send the log from Diagnostics (unreadable output: ${(parseErr as Error).message}). |  |
| `src/main/daemon/manager.ts:848` | result | The VPN service is already installed on this computer and nothing new is staged for it, so there is nothing to install. Nothing was paid. |  |
| `src/main/daemon/manager.ts:853` | result | Initialise the device first. |  |
| `src/main/daemon/manager.ts:857` | result | No wallet switch is waiting. Connect again to start it. Nothing was paid. |  |
| `src/main/daemon/manager.ts:985` | result | The VPN service is missing from this install. Reinstall the app. |  |
| `src/main/daemon/manager.ts:991` | result | Could not prepare the VPN service update (${(err.message \|\| String(stderr)).slice(0, 300)}). |  |
| `src/main/daemon/manager.ts:1001` | result | Could not prepare the VPN service update (${(readErr as Error).message}). |  |
| `src/main/daemon/manager.ts:1094` | result | The VPN service did not start. Open Diagnostics and run the check to see why. |  |
| `src/main/daemon/manager.ts:1152` | result | The VPN service is missing from this install. Reinstall the app. |  |
| `src/main/daemon/manager.ts:1157` | result | Could not read the service's device key (${(err?.message ?? String(stderr)).trim().slice(0, 160)}). Enter its address instead. |  |
| `src/main/daemon/manager.ts:1161` | result | The service home has no device key. |  |
| `src/main/daemon/manager.ts:1163` | result | Could not read the service's device key (unreadable output: ${(parseErr as Error).message}). Enter its address instead. |  |
| `src/main/daemon/manager.ts:1171` | throw | The device must be a Solana address (base58). |  |
| `src/main/daemon/manager.ts:1181` | result | Only the Android app restarts its own VPN engine. |  |
| `src/main/daemon/settings.ts:123` | result | This app cannot read the VPN service settings on this account. Log out and back in (setup added you to the sentinel-dvpn group), or re-run setup. |  |
| `src/main/host.ts:35` | throw | host not initialised |  |
| `src/main/ipc.ts:61` | result | Confirm first. |  |
| `src/main/ipc.ts:74` | throw | invalid input |  |
| `src/main/ipc.ts:83` | throw | only https links open externally |  |
| `src/main/ipc.ts:106` | throw | Unknown server. |  |
| `src/main/ipc.ts:140` | result | That is not a device address. |  |
| `src/main/ipc.ts:144` | result | That computer can still pay for sessions. Remove its spending limit first; then its deposits can be refunded here. |  |
| `src/main/ipc.ts:167` | result | Third-party checks are off in Settings. |  |
| `src/main/ipc.ts:168` | result | Third-party checks are off in Settings. |  |
| `src/main/ipc.ts:191` | result | Cancelled. |  |
| `src/main/ipc.ts:198` | result | This session has no SOCKS endpoint (only V2Ray/Xray sessions do). Nothing was changed. |  |
| `src/main/ipc.ts:204` | result | This session has no SOCKS endpoint (only V2Ray/Xray sessions do). Nothing was opened. |  |
| `src/main/ipc.ts:214` | result | Cancelled. |  |
| `src/main/ipc.ts:229` | result | Cancelled. |  |
| `src/main/ipc.ts:230` | result | That file is too large to be a key file. |  |
| `src/main/ipc.ts:243` | result | Enter the full endpoint URL, including its API key, or leave it unchanged. |  |
| `src/main/ipc.ts:251` | result | Set up a wallet first. |  |
| `src/main/ipc.ts:257` | result | Finish device setup first: the service will not start without it. |  |
| `src/main/ipc.ts:277` | result | Finish device setup first: the service will not start without it. |  |
| `src/main/ipc.ts:307` | result | That is not a device address. |  |
| `src/main/ipc.ts:311` | result | Those are not deposit addresses. |  |
| `src/main/ipc.ts:337` | throw | invalid server list |  |
| `src/main/scheduler.ts:256` | throw | No background job "${name}" (the session poll runs only during a session). |  |
| `src/main/services/activity.ts:119` | result | Enter an amount. |  |
| `src/main/services/activity.ts:122` | result | That deposit was not found on the network (it may already be closed). |  |
| `src/main/services/activity.ts:123` | result | That deposit is not yours. |  |
| `src/main/services/activity.ts:124` | result | That deposit is closing; it cannot be topped up. |  |
| `src/main/services/cli-exec.ts:125` | result | Could not prepare the terminal: {message} |  |
| `src/main/services/cli-exec.ts:134` | result | Terminal could not be opened. Run devnet-dvpn from your own terminal. |  |
| `src/main/services/cli-exec.ts:150` | result | Could not prepare the terminal: {message} |  |
| `src/main/services/cli-exec.ts:154` | result | PowerShell is Windows-only; run the CLI from your terminal. |  |
| `src/main/services/connect-checks.ts:103` | result | Disconnect the current session first. |  |
| `src/main/services/connect-checks.ts:114` | result | That server is not on the network any more. |  |
| `src/main/services/connect-checks.ts:115` | result | That server has not checked in recently. Pick another. |  |
| `src/main/services/connect-checks.ts:127` | result | The OpenVPN network adapter is missing and could not be added back ({detail}). Repair drivers, then connect again. Nothing was paid. | Open diagnostics |
| `src/main/services/connection.ts:313` | throw | cancelled |  |
| `src/main/services/connection.ts:481` | result | DNS could not be restored. | Restore network |
| `src/main/services/connection.ts:487` | result | Your internet may not work. | Restore network |
| `src/main/services/connection.ts:494` | result | Confirm the cost first. |  |
| `src/main/services/connection.ts:496` | fail | A server test is running and uses the VPN service. Stop the test first, or wait for it to finish. |  |
| `src/main/services/connection.ts:594` | fail | Finish device setup first. |  |
| `src/main/services/connection.ts:642` | fail | You left the old server, but your internet has not come back yet, so nothing was paid for the new one. Wait a moment and connect again. |  |
| `src/main/services/connection.ts:762` | fail | ${copy.message} Another VPN (${rivals.join(', ')}) is on and is probably blocking this: turn it off, then connect again. |  |
| `src/main/services/connection.ts:834` | toast | Cancel came too late: the connection is up. Press Disconnect to end it. |  |
| `src/main/services/connection.ts:1197` | result | DNS could not be restored. | Restore network |
| `src/main/services/connection.ts:1203` | result | Your internet may not work. | Restore network |
| `src/main/services/connection.ts:1718` | result | The VPN service is not answering. {osWord}, then press Restore network again. |  |
| `src/main/services/device-topup.ts:42` | toast | Sent this device {lamports} SOL from your wallet for network fees. |  |
| `src/main/services/node-test.ts:150` | result | Pick at least one server. |  |
| `src/main/services/node-test.ts:268` | result | Confirm the deposit limit first. |  |
| `src/main/services/node-test.ts:269` | result | A test run is already going. |  |
| `src/main/services/node-test.ts:270` | result | Disconnect first: a test uses the VPN service, which runs one session at a time. |  |
| `src/main/services/node-test.ts:278` | result | The VPN service on this computer is set up for a different wallet, so a test would pay from that wallet. Connect once with this wallet (that sets the service up for it), disconnect, then run the test again. Nothing was paid. |  |
| `src/main/services/node-test.ts:284` | result | There is no unfinished test run to continue. |  |
| `src/main/services/node-test.ts:287` | result | Pick at least one server. |  |
| `src/main/services/node-test.ts:288` | result | Set the deposit limit first. |  |
| `src/main/services/node-test.ts:290` | result | None of those servers is on the network. |  |
| `src/main/services/node-test.ts:293` | result | Each of these servers needs a deposit over your limit of {maxSpend} tDVPN. The smallest limit that tests any of them is {smallestLimit} tDVPN. |  |
| `src/main/services/node-test.ts:299` | result | This run pays {needs} tDVPN in deposits, one server after another, and this computer's spending limit has {left} tDVPN left. A closed deposit does not give the limit back. Raise the spending limit in Wallet to at least {needs} tDVPN, then start again. Nothing was paid. |  |
| `src/main/services/node-test.ts:310` | result | Your open deposits could not be read from the Solana network, so a test could not tell them from its own. Try again in a minute. Nothing was paid. |  |
| `src/main/services/node-test.ts:449` | result | The test run stopped on a problem of its own. Deposits it opened are closed when you continue the run. |  |
| `src/main/services/nodes.ts:81` | throw | "{address}" is not a server address. |  |
| `src/main/services/plans.ts:82` | return | This plan's provider is not answering right now, so its server list can't be shown. Try again later or pick another plan. |  |
| `src/main/services/plans.ts:115` | result | Confirm the price first. |  |
| `src/main/services/plans.ts:117` | result | Set up a wallet first. |  |
| `src/main/services/plans.ts:119` | result | That plan is not listed any more. |  |
| `src/main/services/plans.ts:120` | result | This plan's provider is not active. |  |
| `src/main/services/plans.ts:138` | result | Set up a wallet first. |  |
| `src/main/services/plans.ts:140` | result | Subscription not found. |  |
| `src/main/services/settlement.ts:103` | throw | That is ${isAndroid() ? 'this phone' : 'this computer'}'s device: leave out --device. |  |
| `src/main/services/settlement.ts:207` | result | A refund is already running. |  |
| `src/main/services/settlement.ts:313` | result | The VPN service stopped during the refund. Nothing was lost; it runs again shortly. |  |
| `src/main/services/settlement.ts:360` | result | Nothing to refund. |  |
| `src/main/services/wallet.ts:102` | result | This computer has no spending limit, so it cannot pay for a connection. Turn on "Set up payments on first connect" in Settings, or set a spending limit in Wallet. | Open Settings |
| `src/main/services/wallet.ts:103` | result | Set up this computer's spending limit in Wallet first. | Open Wallet |
| `src/main/services/wallet.ts:129` | result | Could not set up payments for this computer: {lastAutoError} | Retry |
| `src/main/services/wallet.ts:164` | result | Set up this computer's spending limit in Wallet first. | Open Wallet |
| `src/main/services/wallet.ts:170` | result | Could not read this wallet's balances, so nothing was changed or paid ({errText}). | Retry |
| `src/main/services/wallet.ts:182` | result | Could not set up payments for this wallet: {errText} | Retry |
| `src/main/services/wallet.ts:186` | result | ${inst.error ?? tr('The VPN service could not be switched to this wallet.')} This computer stays set up for the other wallet; the next Connect finishes the switch. | Retry |
| `src/main/services/wallet.ts:215` | result | Create or import a wallet first (wallet create / wallet import). |  |
| `src/main/services/wallet.ts:216` | result | ${isAndroid() ? tr('This phone') : tr('This computer')} has no device key yet. Create it on the Welcome screen first. |  |
| `src/main/services/wallet.ts:229` | result | The VPN service has no device key yet. |  |
| `src/main/services/wallet.ts:242` | toast | Permission saved, but the VPN service did not start. Start it with one admin prompt: {command} |  |
| `src/main/services/wallet.ts:253` | result | No device is set up. |  |
| `src/main/services/wallet.ts:273` | result | That is not a device address. |  |
| `src/main/services/wallet.ts:312` | result | Confirm the transfer first. |  |
| `src/main/services/wallet.ts:313` | result | That is not a Solana wallet address. |  |
| `src/main/services/wallet.ts:316` | result | Enter an amount. |  |
| `src/main/store.ts:14` | throw | store not initialised |  |
| `src/main/system/apps.ts:50` | result | Choosing apps does not work on Linux. Split by address range instead. |  |
| `src/main/system/autostart.ts:67` | return | Start when I log in takes effect the next time the app opens (this command line is not running from the installed app). |  |
| `src/main/system/browser.ts:37` | throw | "${endpoint}" is not a local SOCKS endpoint. |  |
| `src/main/system/browser.ts:40` | throw | the page to open is not an http(s) web address |  |
| `src/main/system/browser.ts:110` | throw | ${BROWSER_TITLES[name]} closed right after starting (${early}). Nothing is using the VPN proxy. |  |
| `src/main/system/cli-shell.ts:39` | result | No terminal program was found. Run devnet-dvpn from your own terminal. |  |
| `src/main/system/dns-probe.ts:66` | return | None of these DNS servers answered from this computer (${rows.map((r) => r.server).join(', ')}): names may not resolve in a session. Choose another, e.g. "daemon set --dns cloudflare --yes". |  |
| `src/main/system/elevate.ts:25` | throw | unknown elevated step ${step} |  |
| `src/main/system/elevate.ts:28` | throw | bad parameter name ${k} |  |
| `src/main/system/elevate.ts:29` | throw | refusing unsafe argument for elevated step: ${v} |  |
| `src/main/system/proxy.ts:139` | throw | The KDE settings tool (kreadconfig) is missing. Nothing was changed. |  |
| `src/main/system/proxy.ts:149` | throw | The KDE settings tool (kwriteconfig) is missing. Nothing was changed. |  |
| `src/main/system/proxy.ts:181` | throw | refusing non-loopback proxy endpoint ${endpoint} |  |
| `src/main/system/proxy.ts:184` | throw | The VPN's SOCKS proxy is not answering on this computer (${live.reason}). Nothing was changed. |  |
| `src/main/system/proxy.ts:186` | throw | This desktop has no system proxy setting this app can change (GNOME or KDE). Set SOCKS5 127.0.0.1 port ${endpoint.split(':')[1]} in your apps instead. Nothing was changed. |  |
| `src/main/system/proxy.ts:199` | throw | The desktop did not accept the proxy setting. Nothing else was changed. |  |
| `src/main/wallet/electron-keystore.ts:34` | throw | This computer has no unlocked keyring to protect your wallet key (GNOME Keyring or KWallet). Sign in to your desktop session so the keyring unlocks, then try again. |  |
| `src/main/wallet/electron-keystore.ts:49` | throw | Your stored wallet could not be unlocked with this account's keyring. |  |
| `src/main/wallet/vault.ts:40` | result | The key file {path} is missing: restore it from your backup. Nothing was paid. |  |
| `src/main/wallet/vault.ts:42` | result | Set up a wallet first. |  |
| `src/main/wallet/vault.ts:47` | throw | Set up a wallet first. |  |
| `src/main/wallet/vault.ts:57` | throw | A wallet is already set up on this computer ({address}). Back up its recovery phrase, log out, then try again. Nothing was changed. |  |
| `src/preload/index.ts:17` | throw | blocked event ${channel} |  |
| `src/renderer/src/components/gallery-fixtures.ts:60` | copy | The Solana network did not answer in time, so nothing was paid. Try again in a moment. | Try again |
| `src/renderer/src/components/Gallery.tsx:174` | banner | The VPN service is starting. This takes a few seconds. |  |
| `src/renderer/src/components/Gallery.tsx:175` | banner | Your deposit ran out. |  |
| `src/renderer/src/components/Gallery.tsx:176` | banner | Your internet may be blocked. Restore network releases it. |  |
| `src/renderer/src/components/Gallery.tsx:233` | toast | 12.4 tDVPN is back in your wallet. |  |
| `src/renderer/src/components/Gallery.tsx:234` | toast | About 10 minutes left at this rate. |  |
| `src/renderer/src/components/Gallery.tsx:235` | toast | The Solana network did not answer. Nothing was paid. |  |
| `src/renderer/src/components/Gallery.tsx:237` | toast | Address copied. |  |
| `src/renderer/src/components/Gallery.tsx:255` | throw | The Solana network did not answer. Nothing was changed. |  |
| `src/renderer/src/components/PollSettings.tsx:17` | toast | ${j.label}: use a whole number of seconds from ${j.min} to ${j.max}. |  |
| `src/renderer/src/components/PollSettings.tsx:43` | toast | Refresh cadences back to defaults. |  |
| `src/renderer/src/components/SidebarFooter.tsx:37` | toast | Create or import a wallet first. |  |
| `src/renderer/src/components/SidebarFooter.tsx:41` | toast | Your address is copied. Paste it into the {what} faucet page. |  |
| `src/renderer/src/components/SidebarFooter.tsx:43` | toast | Your address is copied. Have {what} sent to it; it shows in Wallet. |  |
| `src/renderer/src/screens/android/AboutAndroid.tsx:17` | throw | Notices: http ${r.status} |  |
| `src/renderer/src/screens/android/AboutAndroid.tsx:19` | toast | The licence notices could not be opened. |  |
| `src/renderer/src/screens/Cli.tsx:123` | toast | Command copied. |  |
| `src/renderer/src/screens/Cli.tsx:125` | toast | Instructions copied. Paste them to your agent. |  |
| `src/renderer/src/screens/Cli.tsx:152` | toast | Copied. |  |
| `src/renderer/src/screens/Diagnostics.tsx:57` | return | A check found a problem: see the rows marked with a cross. |  |
| `src/renderer/src/screens/Diagnostics.tsx:58` | return | Items with a warning mark are advice: a connection type works only once its program is installed. |  |
| `src/renderer/src/screens/Diagnostics.tsx:59` | return | Every check passed. |  |
| `src/renderer/src/screens/Home.tsx:158` | toast | Your address is copied. Paste it into the faucet page. |  |
| `src/renderer/src/screens/NodeTest.tsx:294` | toast | Results copied. |  |
| `src/renderer/src/screens/Settings.tsx:374` | toast | App settings restored to defaults. |  |
| `src/renderer/src/screens/SplitTunnel.tsx:29` | return | Measured: the address sites see through the VPN is still being checked. Apps on your normal connection show your own IP. |  |
| `src/renderer/src/screens/Wallet.tsx:107` | toast | This limit is already set. |  |
| `src/shared/money-toast.ts:7` | return | Topped up {amountTdvpn} tDVPN. |  |
| `src/shared/money-toast.ts:13` | return | No refund is ready yet. Each one arrives automatically when its 2-hour wait ends. |  |
| `src/shared/money-toast.ts:18` | return | Added {amountTdvpn} tDVPN of refunds to your wallet. |  |
| `src/shared/money-toast.ts:22` | return | Sent {amount} {asset} to {address}. |  |
