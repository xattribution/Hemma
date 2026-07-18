# Coord relay — self-hostable federation rendezvous

The relay lets two families' Coord servers find each other and exchange
**end-to-end encrypted** messages when they can't connect directly. It is
deliberately blind: it carries only sealed ciphertext blobs addressed to
random mailbox ids, holds everything in RAM with short TTLs, writes nothing
to disk, and logs nothing. Restarting it wipes it. It cannot read, inspect,
or replay anyone's data — the encryption keys never leave the families'
own servers.

## Run your own (one command)

Any small VPS works (256 MB is plenty). With a domain pointed at it:

```bash
git clone https://github.com/xattribution/Sett.git
cd Sett/deploy/relay
RELAY_DOMAIN=relay.yourdomain.com docker compose up -d --build
curl https://relay.yourdomain.com/health   # → {"ok":true,"service":"coord-relay"}
```

Then in Coord: **Settings → Family connections → connection server URL** —
point it at your relay. Both families must use the same relay to pair
remotely (already-paired families keep working through whichever relay the
pairing used).

Without Docker: `PORT=8790 node apps/relay/src/index.mjs` behind any TLS
proxy.

## Protocol (4 endpoints, all JSON)

- `POST /pair/offer` `{code, pubkey, mailbox}` — park a one-time pairing code (10 min TTL)
- `POST /pair/claim` `{code}` — claim it (burns the code)
- `POST /mail/send` `{to, body}` — drop sealed mail in a mailbox
- `POST /mail/collect` `{mailbox}` — collect & clear a mailbox

Mailbox ids are unguessable 128-bit secrets known only to the paired
families. Undelivered mail expires after 7 days (RAM only).
