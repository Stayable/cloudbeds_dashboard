// Static catalog for the public /test intake form. NO Cloudbeds calls — these
// are the showable metrics from the data catalog (scripts/build-catalog.py) with
// deterministic SAMPLE values. Every value is fake and must be watermarked
// "SAMPLE" wherever rendered (spec §6).

export type CatalogMetric = {
  key: string;
  name: string;
  explanation: string;
  category: string;
  type: string;
  cadence: string;
  sample: string;
};

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()/.,&%-]/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

// Deterministic fake sample by type, with marquee overrides by name.
const OVERRIDES: Record<string, string> = {
  "Occupancy %": "82.4%",
  "Occupancy % (live)": "84.1%",
  "ADR - Average Daily Rate": "$118.50",
  "RevPAR - Revenue Per Available Room": "$97.30",
  "Total Revenue": "$48,250",
  "Total Room Revenue": "$41,800",
};

function sampleFor(type: string, name: string): string {
  if (OVERRIDES[name]) return OVERRIDES[name];
  switch (type) {
    case "Percent": return "76.0%";
    case "Count": return "37";
    case "Currency": return "$1,250.00";
    case "Number": return "12";
    case "Category": return "Retail";
    case "Flag": return "Yes";
    case "Timestamp": return "2:14 PM EDT";
    case "Date": return "Jun 24, 2026";
    case "Text": return "Sample text";
    default: return "—";
  }
}

// [name, explanation, category, type, cadence] — ported from build-catalog.py.
// source (5th) and on_now (last) columns dropped. Source order preserved.
// NOTE: "Out-of-Service Rooms" appears twice (once in live Rooms, once in
// occupancy/date-ranged Rooms). The second occurrence is renamed
// "Out-of-Service Rooms (range)" to ensure key uniqueness.
const RAW: [string, string, string, string, string][] = [
  // --- Live operational snapshot ---
  ["Occupancy % (live)", "Share of sellable rooms occupied right now.", "Occupancy", "Percent", "Live now"],
  ["Rooms Occupied (live)", "Number of rooms occupied right now.", "Occupancy", "Count", "Live now"],
  ["Sellable Capacity", "Total rooms available to sell (inventory).", "Occupancy", "Count", "Live now"],
  ["In-House Rooms", "Rooms with a currently checked-in guest.", "Activity", "Count", "Live now"],
  ["Guests In-House", "Headcount of guests currently in-house.", "Activity", "Count", "Live now"],
  ["Arrivals (expected today)", "Reservations due to check in today.", "Activity", "Count", "Live now"],
  ["Arrivals Confirmed", "Arrivals that have actually checked in.", "Activity", "Count", "Live now"],
  ["Departures (expected today)", "Reservations due to check out today.", "Activity", "Count", "Live now"],
  ["Departures Confirmed", "Departures that have actually checked out.", "Activity", "Count", "Live now"],
  ["Stayovers", "Guests staying through (not arriving or leaving today).", "Activity", "Count", "Live now"],
  ["New Bookings (today)", "Reservations created today.", "Activity", "Count", "Live now"],
  ["Cancellations (today)", "Reservations cancelled today.", "Activity", "Count", "Live now"],
  ["Rooms Blocked", "Rooms taken out of availability (blocks + OOS).", "Rooms", "Count", "Live now"],
  ["% Blocked", "Blocked rooms as a share of capacity.", "Rooms", "Percent", "Live now"],
  ["Date-Blocked Rooms", "Rooms blocked for date reasons (e.g., holds).", "Rooms", "Count", "Live now"],
  ["Out-of-Service Rooms", "Rooms unsellable (maintenance/renovation).", "Rooms", "Count", "Live now"],
  ["Property Local Time", "Current time and timezone at the property.", "Reference", "Timestamp", "Live now"],

  // --- Occupancy dataset (date-ranged) ---
  ["Occupancy %", "Rooms sold / capacity over the selected dates.", "Occupancy", "Percent", "Any date range"],
  ["Adjusted Occupancy %", "Occupancy after removing blocked/OOS rooms from the denominator.", "Occupancy", "Percent", "Any date range"],
  ["Rooms Sold", "Total room-nights sold over the range.", "Occupancy", "Count", "Any date range"],
  ["Rooms Available", "Room-nights available to sell over the range.", "Occupancy", "Count", "Any date range"],
  ["Capacity", "Total room-nights in inventory over the range.", "Occupancy", "Count", "Any date range"],
  ["Blocked Rooms", "Room-nights blocked over the range.", "Rooms", "Count", "Any date range"],
  ["Out-of-Service Rooms (range)", "Room-nights out of service over the range.", "Rooms", "Count", "Any date range"],
  ["Allotment-Blocked Rooms", "Room-nights held for group/allotment blocks.", "Rooms", "Count", "Any date range"],
  ["ADR - Average Daily Rate", "Average room revenue per occupied room-night.", "Revenue", "Currency", "Any date range"],
  ["RevPAR - Revenue Per Available Room", "Room revenue per available room-night.", "Revenue", "Currency", "Any date range"],
  ["Room Rate", "Base room charge before fees/taxes.", "Revenue", "Currency", "Any date range"],
  ["Total Room Revenue", "All room-charge revenue over the range.", "Revenue", "Currency", "Any date range"],
  ["Other (Non-Room) Revenue", "Revenue not from room charges (add-ons, items).", "Revenue", "Currency", "Any date range"],
  ["Total Other Revenue", "All non-room revenue, totaled.", "Revenue", "Currency", "Any date range"],
  ["Miscellaneous Income", "Income outside standard room/other buckets.", "Revenue", "Currency", "Any date range"],
  ["Total Revenue", "Room + other + misc revenue combined.", "Revenue", "Currency", "Any date range"],
  ["Room Fees", "Fees charged on room bookings.", "Revenue", "Currency", "Any date range"],
  ["Room Taxes", "Taxes collected on room bookings.", "Revenue", "Currency", "Any date range"],
  ["Other Room Revenue", "Additional room-related revenue adjustments.", "Revenue", "Currency", "Any date range"],
  ["Adults", "Adult guest count for the stays in range.", "Guests (aggregate)", "Count", "Any date range"],
  ["Children", "Children guest count for the stays in range.", "Guests (aggregate)", "Count", "Any date range"],
  ["Room Guest Count", "Total guests per room over the range.", "Guests (aggregate)", "Count", "Any date range"],
  ["Market Segment", "Business classification of the demand (e.g., retail, government).", "Segmentation", "Category", "Any date range"],
  ["Market Group", "High-level demand group (Transient, Group, Contract).", "Segmentation", "Category", "Any date range"],
  ["Room Type", "Room product sold (e.g., King, Double Queen).", "Segmentation", "Category", "Any date range"],
  ["Room Type Category", "Private vs. shared room classification.", "Segmentation", "Category", "Any date range"],

  // --- Reservations / booking pace ---
  ["Room Nights", "Total room-nights booked across reservations.", "Reservations", "Count", "Any date range"],
  ["Room Count", "Number of rooms per reservation.", "Reservations", "Count", "Any date range"],
  ["Booking Window (lead time)", "Days between booking and check-in (pace indicator).", "Reservations", "Number", "Any date range"],
  ["Reservation Grand Total", "Full value of a reservation.", "Reservations", "Currency", "Any date range"],
  ["Reservation Paid Amount", "Amount already paid on reservations.", "Reservations", "Currency", "Any date range"],
  ["Reservation Balance Due", "Outstanding amount owed on reservations.", "Reservations", "Currency", "Any date range"],
  ["Cancellation Fee", "Fees charged on cancellations.", "Reservations", "Currency", "Any date range"],
  ["No-Show Fee", "Fees charged on no-shows.", "Reservations", "Currency", "Any date range"],
  ["Channel Commission Amount", "Commission owed to booking channels/OTAs.", "Reservations", "Currency", "Any date range"],
  ["Commission Percent", "Commission rate applied by the channel.", "Reservations", "Percent", "Any date range"],
  ["Reservation Source (channel)", "Where the booking came from (Phone, Expedia, etc.).", "Channel mix", "Category", "Any date range"],
  ["Reservation Source Category", "Channel grouping (Direct, OTA, Travel Agent, etc.).", "Channel mix", "Category", "Any date range"],
  ["Reservation Status", "Confirmed / In-House / Checked-Out / Cancelled / No-Show.", "Reservations", "Category", "Any date range"],
  ["Rate Plan (public name)", "The customer-facing rate plan booked.", "Reservations", "Category", "Any date range"],
  ["Meal Plan Included", "Whether a meal plan is attached.", "Reservations", "Flag", "Any date range"],
  ["Total Reservation Taxes", "Taxes across reservations.", "Reservations", "Currency", "Any date range"],
  ["Total Reservation Fees", "Fees across reservations.", "Reservations", "Currency", "Any date range"],

  // --- Finances / revenue detail ---
  ["Debits (charges)", "Amounts charged to folios.", "Finance", "Currency", "Any date range"],
  ["Credits (payments/credits)", "Payments and credits applied to folios.", "Finance", "Currency", "Any date range"],
  ["Transaction Amount (net)", "Net of charges minus payments/credits.", "Finance", "Currency", "Any date range"],
  ["Benchmarking Transaction Type", "USALI revenue category for benchmarking.", "Finance", "Category", "Any date range"],
  ["Transaction Type", "Nature of the transaction (charge, payment, tax, fee...).", "Finance", "Category", "Any date range"],
  ["Fee Type", "Type of fee charged.", "Finance", "Category", "Any date range"],
  ["Tax Type", "Type of tax collected.", "Finance", "Category", "Any date range"],
  ["Add-on Item", "Extras sold with a reservation (e.g., parking).", "Finance", "Category", "Any date range"],
  ["Item & Service Category", "Grouping of sold items/services.", "Finance", "Category", "Any date range"],
  ["POS Charge Category", "Point-of-Sale charge grouping.", "Finance", "Category", "Any date range"],
  ["Payment Method", "How guests paid (card, cash, etc.).", "Finance", "Category", "Any date range"],
  ["Payment Type", "Classification of the payment.", "Finance", "Category", "Any date range"],
  ["General Ledger Name", "Custom GL account mapping (if configured).", "Finance", "Category", "Any date range"],

  // --- Payments / payouts ---
  ["Captured Amount", "Payment amount successfully captured.", "Payments", "Currency", "Any date range"],
  ["Refunded Amount", "Amount refunded to guests.", "Payments", "Currency", "Any date range"],
  ["Payment Net", "Payment net of processing fees.", "Payments", "Currency", "Any date range"],
  ["Payment Fee", "Processing fee on a payment.", "Payments", "Currency", "Any date range"],
  ["Payout Amount", "Amount paid out to the property.", "Payments", "Currency", "Any date range"],
  ["Payout Status", "Status of a payout (paid, pending, etc.).", "Payments", "Category", "Any date range"],
  ["Payment Gateway Status", "Result from the payment gateway.", "Payments", "Category", "Any date range"],

  // --- Invoices ---
  ["Invoice Grand Total", "Total value of an issued invoice.", "Invoices", "Currency", "Any date range"],
  ["Invoice Total Tax", "Tax portion of an invoice.", "Invoices", "Currency", "Any date range"],
  ["Invoice Balance Due", "Amount still owed on an invoice.", "Invoices", "Currency", "Any date range"],
  ["Invoice Status", "Open / paid / void, etc.", "Invoices", "Category", "Any date range"],
  ["Invoice Age", "Days since invoice / due date (aging).", "Invoices", "Number", "Any date range"],
  ["Reservation Room Nights (invoice)", "Room nights tied to the invoice.", "Invoices", "Count", "Any date range"],

  // --- Housekeeping & maintenance ---
  ["Room Condition", "Clean / dirty / inspected status of a room.", "Housekeeping", "Category", "Live / by date"],
  ["Room Status", "Occupancy/housekeeping status of a room.", "Housekeeping", "Category", "Live / by date"],
  ["Frontdesk Status", "Front-desk view of room state.", "Housekeeping", "Category", "Live / by date"],
  ["Do Not Disturb", "DND flag on a room.", "Housekeeping", "Flag", "Live / by date"],
  ["Housekeeper Assigned", "Staff member assigned to a room.", "Housekeeping", "Text", "Live / by date"],
  ["Room Count by Status", "Number of rooms in each status.", "Housekeeping", "Count", "Live / by date"],

  // --- Groups & events ---
  ["Allotment Block Count", "Rooms held in a group block.", "Groups", "Count", "Any date range"],
  ["Remaining Block Count", "Unsold rooms left in a block.", "Groups", "Count", "Any date range"],
  ["Rooms Sold (group)", "Rooms picked up from a group block.", "Groups", "Count", "Any date range"],
  ["Blocked Room Revenue", "Revenue tied to blocked group rooms.", "Groups", "Currency", "Any date range"],
  ["Group Total Room Revenue", "Total room revenue from a group/event.", "Groups", "Currency", "Any date range"],
  ["Allotment Block Status", "Status of the group block.", "Groups", "Category", "Any date range"],
  ["Event Name", "Name of the group/event.", "Groups", "Text", "Any date range"],
  ["Event Status", "Status of the event.", "Groups", "Category", "Any date range"],
];

export const CATALOG: CatalogMetric[] = RAW.map(([name, explanation, category, type, cadence]) => ({
  key: slug(name),
  name,
  explanation,
  category,
  type,
  cadence,
  sample: sampleFor(type, name),
}));

export const CATALOG_BY_CATEGORY: { category: string; metrics: CatalogMetric[] }[] = (() => {
  const order: string[] = [];
  const map = new Map<string, CatalogMetric[]>();
  for (const m of CATALOG) {
    if (!map.has(m.category)) {
      map.set(m.category, []);
      order.push(m.category);
    }
    map.get(m.category)!.push(m);
  }
  return order.map((category) => ({ category, metrics: map.get(category)! }));
})();
