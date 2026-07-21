Subject: RE: EliseAI Data Share — Reader Account request

Hi Alison,

Thanks — and yes, the Data Share documentation covers what we need. The funnel and lifecycle tables map directly to the leasing metrics we're building:

- **`events_leasing`** — the leads → engaged → tours booked/attended → applications → leases-signed funnel (the doc's sample query is exactly what we're after).
- **`prospects`** — lifecycle status counts and lead source.
- **`calendar_events`** — tours scheduled / attended / no-show / cancelled.

We'll be aggregating to counts by property and period, so we won't be pulling resident/lead PII into our system.

The Reader Account is the right fit for us (we're not on Snowflake), so please go ahead and set one up. When it's ready, could you send:

- Account locator / identifier (and region)
- Username + temporary password (and login link)
- Database name of the share
- Warehouse to run queries against

Appreciate the help.

Best,
Kyle Estocapio
RISE8 Companies / Stayable
