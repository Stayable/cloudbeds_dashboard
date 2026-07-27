**Subject:** Reconciling our Snowflake data-share numbers vs. the in-app lease dashboard

Hi [name],

Our internal leasing dashboard — built on the Snowflake Reader Account you
provisioned — isn't matching the lease dashboard in app.meetelise.com for the same
properties. I've attached side-by-side comparison screenshots for two windows:
**6/01–6/30** and **7/01–7/22 (current)**.

So you can point us to where our method differs, here is exactly what we query
(read-only, aggregate-only — we never select name/email/phone/transcript columns):

- **Access:** Reader Account `ihpsnqz-rise8_reader`, database `RISE8_DATA`, schema
  `DA`, warehouse `RISE8_WAREHOUSE`.

- **Funnel** — from `RISE8_DATA.DA.PROSPECT_EVENTS_RISE8`:
  ```sql
  SELECT BUILDING_ID, EVENT_DATETIME::DATE AS DAY, EVENT_TYPE, COUNT(*) AS N
  FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
  WHERE BUILDING_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL AND EVENT_TYPE IS NOT NULL
  GROUP BY BUILDING_ID, EVENT_DATETIME::DATE, EVENT_TYPE
  ```
  Stage mapping: `prospect` → Leads · `prospect_engaged` → Engaged · `tour_booked`
  → Tours booked · `tour_attended` → Tours attended · `application_started` → Apps
  started · `application_approved` → Apps approved · `lease_completed` → Leased ·
  `prospect_canceled` → Cancelled.

- **Current pipeline** — from `RISE8_DATA.DA.PROSPECTS_RISE8`:
  ```sql
  SELECT ELISE_PROPERTY_ID AS BUILDING_ID, PROSPECT_STATUS, COUNT(*) AS N
  FROM RISE8_DATA.DA.PROSPECTS_RISE8
  WHERE ELISE_PROPERTY_ID IS NOT NULL AND PROSPECT_STATUS IS NOT NULL
  GROUP BY ELISE_PROPERTY_ID, PROSPECT_STATUS
  ```

- **Method notes:** we `COUNT(*)` raw events (no de-duplication, no
  `is_interest`/`is_ignored`/spam filtering); we bucket by `EVENT_DATETIME::DATE`
  (a `TIMESTAMP_NTZ`, not converted to Eastern); building → property via a fixed map;
  refreshed nightly.

**See our view live:** you can view exactly what our dashboard shows from your
share at **https://dashboard.rentstayable.com/elise** (PIN: **ELISE**) — an
isolated, read-only page of just this leasing funnel + pipeline.

**One request:** could you also provide a Snowflake login our CEO (Rob) can sign
into directly? The current reader account cannot be logged into the Snowflake web
UI (Snowsight). A read-only reader account is completely fine — he just needs to be
able to sign in and view the data.

Could you tell us how the in-app lease dashboard computes the same funnel — the
source view, stage definitions, de-dup key, any filters, and the time zone used for
day bucketing — so we can reconcile? Happy to screen-share.

Thanks,
[Your name]
RISE8 Companies / Stayable
