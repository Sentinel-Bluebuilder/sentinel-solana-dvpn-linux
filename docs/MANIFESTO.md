# Devnet dVPN — Manifesto

> A VPN you have to trust is just someone else's server.

## What we are building

A desktop app that connects you **directly** to any node on the Sentinel network running on
Solana. You pick the node. You pay the node. Nothing sits in the middle — no company account, no
login, no API key, no server of ours that can be seized, subpoenaed, or switched off.

It runs on **devnet** first, with test tokens, so every mechanism can be proven in the open
before real money touches it.

## What we believe

**Peer to peer, all the way down.** The node registry is on chain. Payment is an escrowed channel
between your wallet and the node, enforced by the program, not by us. If we disappeared tomorrow,
the app would keep working, because there is nothing of ours for it to talk to.

**Anyone can connect to any node, and subscribe to any plan.** No allowlist, no curated list, no
markup. If a node is listed and answers its signed health check, you can use it. If a provider
publishes a plan, you can buy it directly.

**You pay for what you agreed to, and you can see it.** The cost is shown before you pay. Unused
escrow comes back to you, and the app walks you through withdrawing it. We say plainly where the
protocol is imperfect: billing counts wire bytes, so you pay a little more than the bytes you
receive, and a subscription is not refundable.

**Privacy is a stack, not a feature.** An encrypted tunnel with a leaking DNS query is a locked
door with an open window. DNS defaults to Handshake resolvers, so name resolution is
decentralised too. The kill switch is on by default. The app sends nothing about you anywhere —
no telemetry, no analytics, and no third-party request the user has not been told about.

**Your keys stay yours.** Your wallet key never leaves the part of the app that signs with it, is
encrypted by your operating system, and can stay cold in your browser wallet if you prefer. The
key that pays for sessions is a separate device key with a spending limit you set and can revoke.

**Never take money for a connection that cannot work.** Every node is checked — signed identity,
pinned TLS, protocol support on your machine, enough balance — before a single token is
committed. A failed check costs nothing.

**Fail safe, and recover.** If the app or its daemon crashes, you will not be left with a dead
internet connection and no explanation. The app detects it and restores your network in one click.

**Proven, not claimed.** Every feature is tested on the live devnet with real sessions, real
traffic, a second attempt, and a crash in the middle. Green unit tests are not evidence that a
VPN works.

## How it fits together

- **Naming:** Handshake DNS by default.
- **Transport:** WireGuard, AmneziaWG, V2Ray, Xray, OpenVPN, Hysteria2 — chosen per node, run by
  the `dvpnd` daemon on your machine.
- **Bandwidth:** independent node operators who earn by serving it.
- **Settlement:** the Solana dvpn program — escrow, signed vouchers, on-chain redemption.

## Built from our own work

This app is assembled from what we have already built and proven on Solana: the Plan Manager's
chain and transaction layer, the Node Tester's discovery and verification, the Node Manager's
Electron shell and wallet, and the standards learned from every dVPN app before it. Other projects
inspired ideas; none of their code is used.

*Owned by no one. Paid peer to peer. Proven in the open.*
