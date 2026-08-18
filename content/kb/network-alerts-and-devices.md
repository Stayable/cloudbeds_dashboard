---
title: Network alerts — what to do when a device goes offline
source: Property Staff Guide SOP-PM-001 v1.0 (Aug 11 2026); SOP-IT-001 v2.0 Network Device Monitoring & Ticketing
sourceUrl: https://ops.rentstayable.com/network
snapshotDate: 2026-08-18
counties: [Polk, Osceola, Duval, St. Johns, Orange]
---

When a WiFi access point or a security camera goes offline, **StayCheck** opens a
ticket automatically and posts it to your property's Teams channel. This is the
property-staff half of that procedure: check the device, try one fix, call IT.
Nothing here asks you to diagnose a network.

## The five steps, in order

1. **Read the Teams message.** Note the device name and the ticket number
   (`TKT-YYYYMMDD-NNN`).
2. **Open the ticket** via the *View Ticket* link and set the status to
   **IN PROGRESS**. This is what stops IT from duplicating your work.
3. **Go and look at the device.** Match its LED against the tables below.
4. **Power cycle it.** Unplug from the wall or the PoE switch, wait 15 seconds,
   plug back in, wait 2–3 minutes. If it recovers, StayCheck closes the ticket
   itself.
5. **Still offline → call IT.** Stop there. **Do not attempt a factory reset.**

Log what you found in the ticket's *Add Note* panel — "checked the device in
room 215, no LED, reseated the cable, light came on, monitoring" is exactly the
right level of detail.

## Stop and call IT immediately if any of these are true

- No LED at all after a power cycle — the device has no power
- LED flashing white → blue → off — UniFi recovery mode
- LED solid red on an Aruba AP — hardware failure
- **Five or more devices went offline at once**
- The power cycle did not bring it back within 5 minutes
- The ticket has been In Progress for more than 2 hours
- You are unsure about anything

IT escalation is **Gerardo**, who handles recurring issues and every hardware
decision. **Kate and Kyle** own the app configuration and major outages.

## LED guide

**UniFi APs and cameras**

| LED | Meaning | Do this |
|---|---|---|
| No light | No power | Check the cable and the PoE port. Try a different port |
| Flashing white → blue → off | Recovery mode | **Do not touch. Call IT** |
| Blue, flashing off every 5 sec | No network | Check the cable, power cycle, call IT if still offline |
| Solid or flashing white | Normal | Working. Wait 2 minutes for the ticket to resolve itself |

**Aruba Instant On APs**

| LED | Meaning | Do this |
|---|---|---|
| No light | No power | Check the cable and the PoE port. Try a different port |
| Solid amber | Still booting | Wait 3–5 minutes |
| Blinking green and red | Cloud connection issue | Check the property internet first, then power cycle |
| Solid red | Hardware failure | Call IT. It likely needs replacing |
| Solid green but offline in the app | Cloud sync issue | Call IT. **Do not factory reset** |

## Mass outages — five or more devices at once

StayCheck raises a **single Mass Outage ticket** rather than one per device, with
no 5-minute wait.

1. **Check the property internet first.** If the internet is down every device
   shows offline, and that is normal, not eight separate faults.
2. Check the main switch or router — a switch reboot takes everything with it.
3. Call IT. Do not work individual devices.

**Your responsibility during a mass outage is communication, not diagnosis.** If
it is not resolved within an hour, post an update in your property Teams channel
saying what happened, what you tried, and where it stands — then keep posting
hourly until it clears.

## Ticket statuses

| Status | Meaning | Who sets it |
|---|---|---|
| OPEN | Just created, nobody investigating | System |
| IN PROGRESS | Someone is actively on it | **You**, when you start |
| RESOLVED | Device came back online | System |
| CLOSED | Confirmed fixed and documented | IT |

## What happens automatically, so you do not chase it

- A blip that clears **within 5 minutes** is logged but raises no ticket.
- A ticket still open after **4 hours** escalates to Gerardo on its own.
- Recovery posts a new Teams message with the down duration. If you see one, the
  issue resolved itself and there is nothing to do.
- **IT > General** gets the daily 9:00 AM portfolio status and escalations only,
  not individual tickets. Yours come to your property channel.

All eight properties are in scope. StayCheck lives at
`ops.rentstayable.com/network`; the full system reference is SOP-IT-001.
