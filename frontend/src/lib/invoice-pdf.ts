import { jsPDF } from "jspdf";

export type InvoicePdfInput = {
  number: string;
  invoice_date: string;
  due_date?: string | null;
  customer_name?: string | null;
  gstin?: string | null;
  address?: string | null;
  billing_address?: string | null;
  shipping_address?: string | null;
  sales_order_id?: number | null;
  subtotal?: string | number;
  cgst?: string | number;
  sgst?: string | number;
  total: string | number;
  outstanding?: string | number;
  lines?: {
    product_name?: string;
    quantity: number;
    unit_price: number;
    gst_rate: number;
    line_total: number;
  }[];
};

export type InvoicePdfCompany = {
  name?: string;
  gst?: string | null;
  logoUrl?: string | null;
};

/** Helvetica has no ₹ — use ASCII-safe currency for PDF. */
function rs(n: string | number | null | undefined) {
  const v = Number(n || 0);
  return `Rs. ${v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function num(n: string | number | null | undefined) {
  return Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

async function loadLogoPngDataUrl(url: string): Promise<string | null> {
  try {
    const absolute =
      url.startsWith("http") || url.startsWith("data:") ? url : new URL(url, window.location.origin).href;
    return await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const max = 512;
          const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = absolute;
    });
  } catch {
    return null;
  }
}

/** Build a Tax Invoice PDF blob for preview / download / WhatsApp attach. */
export async function buildInvoicePdfBlob(inv: InvoicePdfInput, company?: InvoicePdfCompany): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const left = 14;
  const right = pageW - 14;
  const mid = pageW / 2 + 2;
  const colW = mid - left - 4;

  // Table column right-edges (aligned header + values)
  const cQty = 102;
  const cRate = 126;
  const cGst = 148;
  const cAmt = right;

  let y = 16;

  const logoData = company?.logoUrl ? await loadLogoPngDataUrl(company.logoUrl) : null;
  const logoW = 32;
  const logoH = 20;
  if (logoData) {
    try {
      doc.addImage(logoData, "PNG", right - logoW, 12, logoW, logoH);
    } catch {
      /* optional */
    }
  }

  // Company block (left of logo)
  const nameMaxW = logoData ? right - logoW - left - 6 : right - left;
  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  const companyName = doc.splitTextToSize(company?.name || "Avighna Foods", nameMaxW);
  doc.text(companyName, left, y);
  y += companyName.length * 5 + 1;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`GSTIN ${company?.gst || "-"}`, left, y);
  y = Math.max(y + 10, logoData ? 36 : y + 8);

  // Title + number + meta on one band
  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("TAX INVOICE", left, y);
  y += 6;
  doc.setFontSize(11);
  doc.text(inv.number, left, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  const metaBits = [
    `Date: ${inv.invoice_date}`,
    inv.due_date ? `Due: ${inv.due_date}` : null,
    inv.sales_order_id ? `SO-${inv.sales_order_id}` : null,
  ].filter(Boolean);
  doc.text(metaBits.join("  |  "), right, y, { align: "right" });
  y += 6;

  doc.setDrawColor(180);
  doc.setLineWidth(0.3);
  doc.line(left, y, right, y);
  y += 8;

  // Bill to / Ship to — same baseline, two equal columns
  const addrTop = y;
  doc.setTextColor(90);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("BILL TO", left, addrTop);
  doc.text("SHIP TO", mid, addrTop);

  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(inv.customer_name || "-", left, addrTop + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(70);
  let leftY = addrTop + 5;
  if (inv.gstin) {
    leftY += 4;
    doc.text(String(inv.gstin), left, leftY);
  }
  const billAddr = inv.billing_address || inv.address || "";
  if (billAddr) {
    const billLines = doc.splitTextToSize(billAddr, colW);
    leftY += 4;
    doc.text(billLines.slice(0, 4), left, leftY);
    leftY += Math.min(billLines.length, 4) * 3.6;
  }

  const shipAddr = inv.shipping_address || inv.address || "-";
  const shipLines = doc.splitTextToSize(shipAddr, colW);
  doc.setTextColor(20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(shipLines.slice(0, 5), mid, addrTop + 5);
  const rightY = addrTop + 5 + Math.min(shipLines.length, 5) * 3.8;

  y = Math.max(leftY, rightY) + 8;

  // Line items table
  const headerH = 7;
  doc.setFillColor(240, 240, 240);
  doc.rect(left, y, right - left, headerH, "F");
  doc.setTextColor(40);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const hy = y + 4.8;
  doc.text("Product", left + 2, hy);
  doc.text("Qty", cQty, hy, { align: "right" });
  doc.text("Rate", cRate, hy, { align: "right" });
  doc.text("GST %", cGst, hy, { align: "right" });
  doc.text("Amount", cAmt, hy, { align: "right" });
  y += headerH + 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(20);
  const lines = inv.lines || [];
  if (!lines.length) {
    doc.setTextColor(90);
    doc.text("No line items", left + 2, y + 3);
    y += 8;
  }
  for (const ln of lines) {
    if (y > 265) {
      doc.addPage();
      y = 20;
    }
    const nameLines = doc.splitTextToSize(ln.product_name || "Item", cQty - left - 10);
    const rowH = Math.max(6, nameLines.length * 4);
    doc.text(nameLines, left + 2, y + 3.5);
    doc.text(num(ln.quantity), cQty, y + 3.5, { align: "right" });
    doc.text(num(ln.unit_price), cRate, y + 3.5, { align: "right" });
    doc.text(num(ln.gst_rate), cGst, y + 3.5, { align: "right" });
    doc.text(num(ln.line_total), cAmt, y + 3.5, { align: "right" });
    y += rowH;
    doc.setDrawColor(230);
    doc.line(left, y, right, y);
    y += 2;
  }

  y += 4;
  doc.setDrawColor(180);
  doc.line(left, y, right, y);
  y += 8;

  // Totals — right-aligned block with fixed label/value columns
  const labelX = right - 62;
  const valueX = right;
  const totals: [string, string, boolean][] = [
    ["Taxable", rs(inv.subtotal || 0), false],
    ["CGST", rs(inv.cgst || 0), false],
    ["SGST", rs(inv.sgst || 0), false],
    ["Grand total", rs(inv.total), true],
  ];
  for (const [label, val, bold] of totals) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 11 : 9);
    doc.setTextColor(bold ? 20 : 80);
    doc.text(label, labelX, y);
    doc.setTextColor(20);
    doc.text(val, valueX, y, { align: "right" });
    y += bold ? 7 : 5.5;
  }

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text(`Pay by bank transfer / UPI / cheque. Outstanding ${rs(inv.outstanding || 0)}.`, left, y);

  return doc.output("blob");
}

export function downloadPdfBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
