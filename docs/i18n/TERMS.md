# Term sheets

The words that carry the app, fixed per language before any sentence is translated.
Rules per language (address, loan words, numbers, punctuation, direction) are in `RULES.md`.

- **Status**: `confirmed` = found in live use, in this sense, in at least two independent places.
  `unconfirmed` = fewer than two; the chosen word is the most likely one, not a proven one.
- **Examples**: how many independent live uses were found.
- **Reviewed**: no language here has been read by a native speaker. Every sheet says `reviewed: no`.
- **Never translated** (all languages): Devnet dVPN, Devnet, Sentinel, Solana, tDVPN, SOL,
  protocol names (WireGuard, OpenVPN, V2Ray and the rest), DNS, CSV, GB, addresses, commands,
  error codes.
- Where the system's wording and VPN apps' wording differ, the system's wording wins for system
  things (VPN, network, proxy, DNS, driver, settings); VPN apps' wording wins for kill switch and
  split tunnelling.

## English terms

| # | Term | Sense |
|---|---|---|
| 1 | Connect | button |
| 2 | Disconnect | button |
| 3 | Connected | state |
| 4 | Not connected | state, hero title |
| 5 | Connecting… | state |
| 6 | Reconnecting | state |
| 7 | Disconnecting | state |
| 8 | Protected | state |
| 9 | Internet blocked | by the kill switch |
| 10 | Server | a VPN server (never "node" on screen) |
| 11 | Location | where the server is |
| 12 | Country | |
| 13 | Quick connect | |
| 14 | Choose a server / All servers | |
| 15 | Favourites | |
| 16 | Recent | |
| 17 | Online / Offline | server status |
| 18 | Response | response time of a server |
| 19 | Protocol | VPN protocol |
| 20 | VPN | kept as the system writes it |
| 21 | VPN service | the background service on this device |
| 22 | Kill switch | |
| 23 | Allow local network | |
| 24 | Restore network | undo a blocked internet |
| 25 | Split tunnelling | |
| 26 | Whole computer / Which apps use the VPN | split tunnelling choices |
| 27 | IP address | "Sites see", "Your own IP" |
| 28 | Always-on VPN | system setting, phone |
| 29 | Block connections without VPN | system setting, phone |
| 30 | Switching server | state |
| 31 | Wallet | |
| 32 | Balance | |
| 33 | Address | wallet address |
| 34 | Recovery phrase | |
| 35 | Create a new wallet | |
| 36 | Import a wallet | |
| 37 | Sign out of this wallet | |
| 38 | Deposit | noun: money held for a session, unused part refunded |
| 39 | Refund | noun and verb |
| 40 | Claim | to collect refunds |
| 41 | Top up | add money |
| 42 | Spending limit | |
| 43 | Network fee | fee paid to the network per transaction |
| 44 | Protocol fee | fee kept by the protocol |
| 45 | Price per GB | |
| 46 | Price per hour | |
| 47 | Pay / You pay / Paid | |
| 48 | Test tokens | |
| 49 | Faucet | where free test tokens are given |
| 50 | Transaction | |
| 51 | Review | check before signing |
| 52 | Plan | a provider's paid plan |
| 53 | Subscribe | |
| 54 | Provider | who runs a plan |
| 55 | Your access | what a subscription gives |
| 56 | Settings | |
| 57 | Activity | history screen |
| 58 | Diagnostics | |
| 59 | Terminal | |
| 60 | Command line | |
| 61 | Speed test | |
| 62 | Run test | |
| 63 | Theme: System / Dark / Light | |
| 64 | Language | |
| 65 | Refresh | |
| 66 | Cancel | |
| 67 | Continue | |
| 68 | Back | |
| 69 | Copy | |
| 70 | Save | |
| 71 | Reset to defaults | |
| 72 | Export | |
| 73 | Search | |
| 74 | Open-source licences | |
| 75 | Source code | |
| 76 | Session | one paid connection |
| 77 | Downloaded / Uploaded | data amounts |
| 78 | Spent | |
| 79 | Refunds on the way | |
| 80 | Claim refunds | the button |
| 81 | Get test tokens | |
| 82 | Test tokens only | the Devnet strip |
| 83 | Built on | "Built on Sentinel" |
| 84 | Driver / Repair drivers | network driver |
| 85 | Install the VPN service | |
| 86 | Proxy / Send apps through the VPN | |
| 87 | AI agent | "An AI agent is using this app" |
| 88 | This computer / This phone | device word |
| 89 | Checking the connection… | |
| 90 | Nothing was paid | plain fact at the end of a refusal |
| 91 | Node test | the page's own name: a test of network servers |
| 92 | App | a program on the device |
| 93 | Device | this computer or phone |
| 94 | Private key | |
| 95 | Traffic | network traffic |
| 96 | Administrator | the system's admin rights |
| 97 | Permission | |
| 98 | Firewall | |
| 99 | Network adapter | |
| 100 | Tunnel | the encrypted connection |
| 101 | Encrypted | |
| 102 | Leak | traffic leaving outside the tunnel |
| 103 | Browser | |
| 104 | Endpoint | an RPC address |
| 105 | Install | |
| 106 | Update | |
| 107 | Restart | |
| 108 | Log | the app's log |
| 109 | Sign | sign a transaction |
| 110 | Funds | |
| 111 | Amount | |
| 112 | Data usage | |
| 113 | Operator | who runs a server |
| 114 | Certificate | |
| 115 | Version | |
| 116 | Account | an on-chain account |
| 117 | Key file | the stored wallet key |
| 118 | Exit address | the address sites see |
| 119 | Blockchain | "chain" |
| 120 | Unused | the unused part of a deposit |
| 121 | Price | |

Terms 92–121 were added from the app's own sentences: every meaning-carrying word used in three
or more of them that was not already listed.

## Sheets

One file per language in `terms/<code>.json`, every term numbered as above (`no`), read by the
term-check script. Per term: `word` (the chosen word), `forms` (every accepted spelling or
inflection, matched as a substring), `status`, `examples`, `ladder` (evidence steps tried:
`files` = the systems' and apps' shipped translation files, `search` = web search, `fetch-XX` =
pages read from inside country XX), `rejected` (alternatives with a plain reason). A term with no
live example still names a word, marked `unconfirmed`, 0.

Counts are for terms only. Phrases (`kind: phrase`, such as "Nothing was paid" or "Node test")
are built from confirmed words and the language rules and checked by translate-back like any
sentence; finding them elsewhere is not expected, so they are not counted as unconfirmed.

| Code | Language | Wave | Confirmed | Unconfirmed | Phrases | Reviewed |
|---|---|---|---|---|---|---|
<!-- index -->
| bn | Bengali | 1 | 25 | 72 | 24 | no |
| de | German | 1 | 24 | 73 | 24 | no |
| es | Spanish | 1 | 35 | 62 | 24 | no |
| fr | French | 1 | 31 | 66 | 24 | no |
| hi | Hindi | 1 | 31 | 66 | 24 | no |
| id | Indonesian | 1 | 19 | 78 | 24 | no |
| ja | Japanese | 1 | 23 | 74 | 24 | no |
| ko | Korean | 1 | 24 | 73 | 24 | no |
| pt | Portuguese (Brazil) | 1 | 23 | 74 | 24 | no |
| ru | Russian | 1 | 26 | 71 | 24 | no |
| tr | Turkish | 1 | 23 | 74 | 24 | no |
| uk | Ukrainian | 1 | 19 | 78 | 24 | no |
| vi | Vietnamese | 1 | 18 | 79 | 24 | no |
| zh-Hans | Chinese (Simplified) | 1 | 38 | 59 | 24 | no |
| zh-Hant | Chinese (Traditional) | 1 | 20 | 77 | 24 | no |
| ar | Arabic | 2 | 23 | 74 | 24 | no |
| ckb | Kurdish (Sorani) | 2 | 16 | 81 | 24 | no |
| fa | Persian | 2 | 25 | 72 | 24 | no |
| fil | Filipino | 2 | 27 | 70 | 24 | no |
| km | Khmer | 2 | 19 | 78 | 24 | no |
| ms | Malay | 2 | 21 | 76 | 24 | no |
| my | Burmese | 2 | 19 | 78 | 24 | no |
| ps | Pashto | 2 | 9 | 88 | 24 | no |
| th | Thai | 2 | 32 | 65 | 24 | no |
| ur | Urdu | 2 | 36 | 61 | 24 | no |
| gu | Gujarati | 3 | 10 | 87 | 24 | no |
| kn | Kannada | 3 | 23 | 74 | 24 | no |
| ml | Malayalam | 3 | 21 | 76 | 24 | no |
| mr | Marathi | 3 | 9 | 88 | 24 | no |
| ne | Nepali | 3 | 21 | 76 | 24 | no |
| or | Odia | 3 | 13 | 84 | 24 | no |
| pa | Punjabi | 3 | 7 | 90 | 24 | no |
| si | Sinhala | 3 | 33 | 64 | 24 | no |
| ta | Tamil | 3 | 29 | 68 | 24 | no |
| te | Telugu | 3 | 7 | 90 | 24 | no |
| am | Amharic | 4 | 16 | 81 | 24 | no |
| az | Azerbaijani | 4 | 23 | 74 | 24 | no |
| ha | Hausa | 4 | 9 | 88 | 24 | no |
| ig | Igbo | 4 | 3 | 94 | 24 | no |
| it | Italian | 4 | 20 | 77 | 24 | no |
| kmr | Kurdish (Kurmanji) | 4 | 14 | 83 | 24 | no |
| nl | Dutch | 4 | 17 | 80 | 24 | no |
| om | Oromo | 4 | 5 | 92 | 24 | no |
| pcm | Nigerian Pidgin | 4 | 1 | 96 | 24 | no |
| pl | Polish | 4 | 19 | 78 | 24 | no |
| ro | Romanian | 4 | 41 | 56 | 24 | no |
| sw | Swahili | 4 | 20 | 77 | 24 | no |
| uz | Uzbek | 4 | 29 | 68 | 24 | no |
| yo | Yoruba | 4 | 8 | 89 | 24 | no |
<!-- /index -->
