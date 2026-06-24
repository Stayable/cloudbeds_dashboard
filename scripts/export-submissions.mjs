// Read-only export: dump the submissions table to an IB-formatted xlsx in
// outputs/. Run:  node scripts/export-submissions.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import ExcelJS from "exceljs";

// load .env.local (no dep)
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error("No DATABASE_URL in .env.local"); process.exit(1); }

const sql = neon(url);
const rows = await sql`
  select id, created_at, source, name, role, team, metrics, notes
  from submissions order by created_at desc
`;

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Submissions", { views: [{ state: "frozen", ySplit: 1 }] });
ws.columns = [
  { header: "ID", key: "id", width: 6 },
  { header: "Submitted (UTC)", key: "created_at", width: 22 },
  { header: "Source", key: "source", width: 16 },
  { header: "Name", key: "name", width: 20 },
  { header: "Role", key: "role", width: 22 },
  { header: "Team", key: "team", width: 28 },
  { header: "Metrics", key: "metrics", width: 60 },
  { header: "Notes", key: "notes", width: 50 },
];
// IB-clean dark header
ws.getRow(1).eachCell((c) => {
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
  c.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
  c.alignment = { vertical: "middle", horizontal: "left" };
});
for (const r of rows) {
  ws.addRow({
    id: Number(r.id),
    created_at: new Date(r.created_at).toISOString().replace("T", " ").slice(0, 19),
    source: r.source,
    name: r.name ?? "",
    role: r.role ?? "",
    team: r.team ?? "",
    metrics: Array.isArray(r.metrics) ? r.metrics.join(", ") : (r.metrics ?? ""),
    notes: r.notes ?? "",
  });
}
ws.eachRow((row, i) => {
  row.eachCell((c) => {
    c.font = c.font?.bold ? c.font : { name: "Arial", size: 10 };
    c.alignment = { vertical: "top", wrapText: true, ...(c.alignment || {}) };
  });
  if (i > 1 && i % 2 === 0) row.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF1F6" } };
  });
});

// filename: Submissions_Stayable_<MMDDYY>
const d = new Date();
const mmddyy = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${String(d.getFullYear()).slice(-2)}`;
const out = new URL(`../outputs/Submissions_Stayable_${mmddyy}.xlsx`, import.meta.url);
await wb.xlsx.writeFile(out);
console.log("saved:", out.pathname, "| rows:", rows.length);
