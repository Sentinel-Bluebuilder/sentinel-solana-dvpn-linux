# Third-party assets

Every third-party image or mark bundled in the app: where it came from, the rule that lets us
use it, and what we changed. Files are bundled because the CSP (`img-src 'self' data:`) blocks
remote images, and fetching them would tell a third party the app is open.
`tests/unit/protocol-marks.test.ts` fails if a bundled logo file is missing from this page.

## Protocol logos — `src/renderer/src/assets/protocols/`
Shown by `ProtocolMark` / `ProtocolTag` (`src/renderer/src/components/ProtocolMark.tsx`). They
identify which protocol a server or session uses. They are not our branding and don't suggest
endorsement. Scaling is the only change, and Hysteria is split into its two official variants
(below). Downloaded 2026-10-22.

| File | Source | Licence / policy | Changes | sha256 |
|---|---|---|---|---|
| `wireguard.png` | wireguard.com → site icon (`/img/icons/favicon-256.png`, 256 × 256 RGBA): the dragon disc from the official logo | WireGuard trademark policy (see below); shown by owner decision | none | 92de3cf7… |
| `openvpn-on-dark.svg` | openvpn.net/branding → Icon (`/_assets/logo_light_28d3ba9fec.svg`) | OpenVPN brand page: follow padding, never stretch, add effects, recolour or rotate. Older community page: "free to use and modify … as long as the Registered Trademark (R) of OpenVPN, Inc. remains clearly recognizable". "OpenVPN" is a registered trademark of OpenVPN Inc. | none | b7dc2ca6… |
| `openvpn-on-light.svg` | openvpn.net/branding → Icon (`/_assets/logo_dark_98a890727a.svg`) | same | none | 66ece10d… |
| `xray-on-dark.svg` | github.com/XTLS/Xray-docs-next `docs/public/logo-dark.svg` | repo licence CC-BY-SA-4.0 (Project X) | none | 860d81a4… |
| `xray-on-light.svg` | same repo, `docs/public/logo-light.svg` | CC-BY-SA-4.0 | none | ab7b6a19… |
| `v2ray.png` | github.com/v2fly/v2fly-github-io `docs/.vuepress/public/readme-logo.png` | repo licence CC-BY-SA-4.0 (V2Fly community) | none | 28604d94… |
| `hysteria2-on-light.svg` | github.com/apernet/hysteria-website `docs/assets/logo.svg` | MIT (apernet) | removed the file's own `prefers-color-scheme: dark` block, so the app theme (not the OS) picks the variant | 206a0396… |
| `hysteria2-on-dark.svg` | same file | MIT | same, using the file's own dark-scheme fill (`#ffffff`) | 06b12968… |
| `amneziawg-on-dark.svg` | github.com/amnezia-vpn/amnezia-client `client/images/controls/amnezia.svg` (the app's own small mono icon) | repo licence GPL-3.0 (changes allowed). No published trademark policy found. Used only to identify the AmneziaWG protocol | none | 8af24104… |
| `amneziawg-on-light.svg` | same file | GPL-3.0 | fill `#CCCAC8` → `#45423F` so it reads on a light background (colour only) | 55689e71… |

The full-colour Amnezia mascot (`amneziaLogo.svg`) was tried first. At 14–16 px it is an
unreadable blob, so the project's own small icon is used instead.

Source hashes as downloaded (sha256): openvpn logo_light `b7dc2ca6…`, logo_dark `66ece10d…`,
xray logo-dark `860d81a4…`, logo-light `ab7b6a19…`, v2fly readme-logo `28604d94…`,
hysteria-website logo.svg `ae5cf14e…`, amnezia controls/amnezia.svg `8af24104…`.

### WireGuard and OpenVPN: official marks, owner decision (2026-10-22)
Until 2026-10-22 both showed as text badges. The
[WireGuard trademark policy](https://www.wireguard.com/trademark-policy/) asks for permission
(wireguard-trademark-usage [at] zx2c4.com, policy A.iv) before using the marks in an app that
provides a service, and OpenVPN Inc.'s brand page sets usage rules without granting a licence to
third-party apps. The owner reviewed this and chose to show both official marks, as other VPN
apps do ("we can use it its no problem all the vpn apps use it"). They identify the protocol a
server or session uses, are never recoloured or stretched, and sit next to the protocol's name.
If either holder objects, set its entry back to `null` in `PROTOCOL_LOGOS` and add badge text to
`PROTOCOL_BADGES`; the unit test then asks for this section to say why.

Attribution: "WireGuard" is a registered trademark of Jason A. Donenfeld. "OpenVPN" is a
registered trademark of OpenVPN Inc.

## Other bundled assets
- Country flags: `flag-icons` (MIT), via npm.
- Fonts: `@fontsource/*` (OFL), via npm.
- Solana mark: drawn inline in `components/ui.tsx` (`SolanaMark`).
