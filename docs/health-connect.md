# Your phone as the data source (Health Connect)

Pulse can score what your Fitbit app writes to **Health Connect** on your Android phone, with no Google Cloud
project and no Google Health API. The free, open-source
[Life Dashboard Companion](https://github.com/owen282000/life-dashboard-companion-app) app (MIT) reads Health
Connect and posts the records to your Pulse server after every sync, signed with a secret the two share.

```
Fitbit band ──Bluetooth──▶ Fitbit app ──▶ Health Connect ──▶ Life Dashboard Companion ──HTTPS POST──▶ Pulse
```

This is the path for a server set up with `DATA_SOURCE=health-connect`. A `DATA_SOURCE=google` server offers it
too, as a second card under **Settings › Data source**: there the phone fills in what Google leaves empty (see
[Beside Google](#beside-google)).

## What arrives

Fitbit writes to Health Connect when its app syncs, which for a night's metrics is often an hour or more after you
wake. The companion app delivers them on its next sync (every 15 to 60 minutes, as you set it). Pulse reads:

| Health Connect record | Where it lands in Pulse |
|---|---|
| Heart rate samples | the band heart rate (strain, stress, Energy Bank, intraday charts) |
| Steps | per-minute steps (movement gating) and the day's total |
| Sleep sessions with stages | the night, its hypnogram, sleep performance |
| Heart rate variability (RMSSD, every 5 minutes at night) | the night's mean HRV: Recovery's main input |
| Resting heart rate, respiratory rate, SpO2, skin temperature | the night's values for Recovery and Health Monitor |
| Exercise sessions | activities (per-activity strain from the heart rate they cover) |
| Weight, body fat, VO2 max, height | the day's measurements |
| Distance, active calories, total calories (daily totals) | shown on Health › measurements |
| Blood glucose, body temperature | shown as extra metrics (the Dexcom path, phase 2) |

Blood pressure, nutrition, hydration, mindfulness and cycle tracking are not read yet.

Turn **Record metadata** off and keep the default **Data resolution** (every record) in the app: Pulse keeps
samples as they are. Bucketed series (1 m to 1 h) are accepted too, as one value per window.

## Set up

1. On the server, set `DATA_SOURCE=health-connect` (or keep `google`), `BETTER_AUTH_SECRET` and `APP_URL` in
   `.env`. `APP_URL` is the HTTPS address your phone reaches the server at: the pairing code points the app at it.
   Pulse must be reachable over HTTPS; the app refuses plain `http://` unless you allow it under its **Advanced**
   settings (fine on your own network, not beyond). [setup.md](setup.md) covers Tailscale, and
   [other-setups.md](other-setups.md) a reverse proxy; allow request bodies of at least 10 MB on the proxy.
2. Install the companion app on the phone that runs the Fitbit app, and give it Health Connect permissions for
   the data types above, including **background** and **history** access when asked.
3. In Pulse, open **Settings › Data source** and tap **Pair phone**. A QR code appears.
4. In the app, choose **Scan a pairing code** (in the setup wizard, or the Health tab's Webhook card) and scan it.
   The app sends a test ping; Pulse's card then reads "Paired, waiting for the first sync", and "Received x min
   ago" after the first real payload.
5. In the app, run a **Backfill** (Health tab) for 30, 90 or 365 days so Pulse has history to calibrate on.
   Recovery needs 14 nights of HRV for a trusted baseline; it says "calibrating" until then.

### Pulse Mobile as the collector instead

This fork of [Pulse Mobile](https://github.com/adityaongit/pulse-mobile) (branch `claude/health-app-architecture-7qbe4v`
on `Gwadaboy75/pulse-mobile`) can send to this same endpoint, so one app on the phone both scores locally and feeds
the site. In the app, open **Réglages › Mon serveur**, paste the pairing link shown under the QR code (or the URL and
the secret), and tap **Appairer**. The app then posts its Health Connect rows after every sync, in the format above,
as complete 7-day backfill windows; the first push covers its whole 180-day history. Pulse treats it like the
companion app (same signature, same `sequence` rule, same pruning on complete windows). The app's own scores and the
site's are computed by two different engines and may differ slightly for the same night; neither is sent to the other.

The code can be shown again (a second phone, a reinstall), the secret replaced (**New secret**: the phone must scan
again), or the phone unpaired. Unpairing stops the webhook; nothing the phone sent is deleted.

## How Pulse treats what it receives

- Every payload is checked against the HMAC signature, archived whole (gzipped, kept a week), and answered within
  the app's 10-second limit. The sync worker then applies the archived payloads in the app's `sequence` order, each
  in its own transaction; a payload that fails records its reason and the next one still applies.
- Records are deduplicated on Health Connect's own ids. A payload that waited in the phone's outbox and arrives
  after a newer one adds only what the newer ones did not already cover, and never resurrects a record the newer
  payload deleted. Fitbit revises a night by deleting and rewriting it under the same id: the rewrite wins.
- The night's HRV, respiratory rate, SpO2 and skin temperature are the means of the samples inside the main sleep
  session (18:00 to noon until the session itself arrives). Skin temperature is kept as Fitbit's delta from its
  baseline; Recovery uses the deviation, as with Google.
- A complete **backfill window** vouches for the records the phone still holds: a sleep session, workout or vital
  in that window that the backfill did not carry is removed. Heart-rate and steps samples are never pruned this
  way (the app sends them as deltas).
- Days a payload touches are marked for recompute, as with Google; scores update on the same worker run.

## Beside Google

On a `DATA_SOURCE=google` server a paired phone's role is **auto**: while the account holds a live Google grant,
the phone writes only the nightly vitals and body measurements, and only into days and columns Google left empty
(a night Google is late with, a reading Google's API does not expose). Heart rate, steps, sleep and workouts stay
Google's, so a night is never stored twice under two ids. With the grant revoked, or on a `health-connect` server,
the phone writes everything.

## Troubleshooting

| Settings says | What it means |
|---|---|
| Paired, waiting for the first sync | No request yet. In the app, check the address, that **Health** is on, and tap **Test ping**. |
| The phone sent something Pulse couldn't read | A request arrived that wasn't JSON (a proxy's error page?). Check the proxy in front of Pulse. |
| A payload failed to apply (...) | The worker could not map a payload; the server log names the payload id. The next payloads still apply. |
| The phone hasn't synced in a while | Nothing for 2 hours. Battery optimisation often stops the app's background sync: exempt it in Android's settings. |
| App answers 401 / "unauthorized" in its log | The secret differs. Tap **New secret** in Pulse and scan the new code. |
| App answers 413 | A proxy in front of Pulse caps request bodies; allow 10 MB or more. |
| App answers 404 | The address is wrong, or the phone was unpaired. Pair again. |

The companion app's own [webhook reference](https://github.com/owen282000/life-dashboard-companion-app/blob/main/docs/webhook.md)
documents every field Pulse reads.
