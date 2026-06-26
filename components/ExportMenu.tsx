"use client";

// Reusable export control for any table. Feed it the rows CURRENTLY IN VIEW
// (already property-filtered by the section's toggle) plus typed columns and a
// base filename — single property → that property only; "All" → everything.
// CSV is built from the pure lib helpers; Excel (exceljs) and PDF (jsPDF +
// autotable) libraries are dynamically imported only when the user picks them,
// so they never weigh down initial page load. Inventory/aggregate data only —
// no guest PII passes through here.
import { useEffect, useRef, useState } from "react";
import { toCSV } from "@/lib/export";

type Props = {
  filename: string; // without extension, e.g. OutOfService_44199_062726
  /** [header row, ...data rows] — build with buildMatrix(columns, rows). Plain
   *  arrays so this works from server components too (no functions crossing the
   *  server/client boundary). */
  matrix: (string | number)[][];
  /** Optional sheet/title label used inside the Excel sheet + PDF header. */
  title?: string;
  disabled?: boolean;
};

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ExportMenu({ filename, matrix, title, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // matrix[0] is the header row, so "empty" means no data rows.
  const isEmpty = disabled || matrix.length <= 1;

  async function run(kind: "csv" | "xlsx" | "pdf") {
    setOpen(false);
    if (isEmpty) return;
    setBusy(true);
    try {
      const [head, ...body] = matrix;

      if (kind === "csv") {
        download(new Blob([toCSV(matrix)], { type: "text/csv;charset=utf-8;" }), `${filename}.csv`);
      } else if (kind === "xlsx") {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet((title || "Export").slice(0, 31));
        ws.addRows(matrix);
        ws.getRow(1).font = { bold: true };
        ws.columns.forEach((col, i) => {
          const widths = matrix.map((r) => String(r[i] ?? "").length);
          col.width = Math.min(40, Math.max(10, ...widths) + 2);
        });
        const buf = await wb.xlsx.writeBuffer();
        download(
          new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
          `${filename}.xlsx`,
        );
      } else {
        const { jsPDF } = await import("jspdf");
        const autoTable = (await import("jspdf-autotable")).default;
        const doc = new jsPDF({ orientation: head.length > 5 ? "landscape" : "portrait" });
        if (title) doc.text(title, 14, 14);
        autoTable(doc, {
          head: [head.map(String)],
          body: body.map((r) => r.map(String)),
          startY: title ? 18 : 14,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [15, 23, 42] }, // ink
        });
        doc.save(`${filename}.pdf`);
      }
    } finally {
      setBusy(false);
    }
  }

  const item = "block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50";

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isEmpty || busy}
        className={
          "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 " +
          (isEmpty || busy ? "cursor-not-allowed opacity-50" : "")
        }
      >
        {busy ? "Exporting…" : "Export ▾"}
      </button>
      {open && !isEmpty && (
        <div className="absolute right-0 z-10 mt-1 w-32 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          <button type="button" className={item} onClick={() => run("csv")}>
            CSV (.csv)
          </button>
          <button type="button" className={item} onClick={() => run("xlsx")}>
            Excel (.xlsx)
          </button>
          <button type="button" className={item} onClick={() => run("pdf")}>
            PDF (.pdf)
          </button>
        </div>
      )}
    </div>
  );
}
