**To:** [EliseAI Account Manager / Partnerships]
**From:** Kyle Estocapio — RISE8 Companies (Stayable)
**Subject:** API access request — read-only leasing data, per property (Stayable portfolio)

---

Hi [Name],

RISE8 Companies operates the **Stayable** extended-stay brand across 8 Florida
properties. We're building an internal, view-only operations dashboard that
consolidates per-property data for our leadership and operations teams, and we'd
like to pull the leasing data EliseAI manages for us directly via API rather than
exporting manually.

**What we're asking for**

Read-only, programmatic (API) access to the following, **scoped per property**:

- **Leases** — active leases, lease terms/dates, lease status
- **Prospects** — current prospect pipeline / leads
- **Prospect data** — stage, source, and status of each prospect (funnel)
- **Active vs. inactive / renewals / move-outs** — current occupancy-side counts
- Any related leasing-activity or conversion metrics EliseAI exposes (tours,
  applications, conversions, response times, etc.)

**How we intend to use it**

- **Read-only.** The dashboard never writes back to EliseAI.
- **Server-side only.** Credentials live in server environment variables and are
  never exposed to the browser.
- **Per-property scoping** preferred — either one credential per property or a
  single credential that returns property-segmented data, whichever you support.
- We aggregate for display; where individual records carry tenant/prospect PII,
  we handle them under our existing data-security controls and surface only what's
  needed.

**What we need from you to scope the build**

1. Is read-only API access available on our account, and how is it enabled?
2. **API documentation** — base URL, endpoints, and the objects/fields available
   for Leases, Prospects, and leasing activity.
3. **Authentication method** — API key, OAuth, etc. — and how credentials are
   scoped (per property vs. org-wide).
4. Rate limits and any sandbox/test environment.
5. Any data-sharing or DPA paperwork required before we're granted access.

**Properties (Stayable portfolio)**

| Property            | Property ID | County     |
|---------------------|-------------|------------|
| Lakeland            | 4645        | Polk       |
| Kissimmee East      | 2295        | Osceola    |
| Kissimmee West      | 5399        | Osceola    |
| Jacksonville West   | 6802        | Duval      |
| Jacksonville North  | 812         | Duval      |
| St. Augustine       | 2535        | St. Johns  |
| Davenport           | 44199       | Polk       |
| Orlando OBT         | 8700        | Orange     |

> Note: these are our internal Stayable property IDs. If EliseAI uses different
> property identifiers on its side, please include a mapping so we can align them.

Happy to get our technical lead on a short call if that's easier than email.
Thanks for the help.

Best,
**Kyle Estocapio**
RISE8 Companies — Stayable
bke@rise8companies.com

---

*Draft — review before sending. Placeholders to fill: recipient name, and
confirm the property-ID mapping note above. Per TODO, the EliseAI integration is
parked until read-only API access + docs are received.*
