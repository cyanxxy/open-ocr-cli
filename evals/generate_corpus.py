from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.pdfgen.canvas import Canvas


ROOT = Path(__file__).resolve().parent
CORPUS_DIR = ROOT / "corpus"
CORPUS_DIR.mkdir(parents=True, exist_ok=True)

styles = getSampleStyleSheet()
title_style = ParagraphStyle(
    "EvalTitle",
    parent=styles["Heading1"],
    fontName="Helvetica-Bold",
    fontSize=18,
    leading=22,
    textColor=colors.HexColor("#1C1917"),
)
meta_style = ParagraphStyle(
    "EvalMeta",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=10.5,
    leading=14,
    textColor=colors.HexColor("#44403C"),
)
body_style = ParagraphStyle(
    "EvalBody",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=11,
    leading=15,
    textColor=colors.HexColor("#292524"),
)


def build_invoice():
    path = CORPUS_DIR / "invoice.pdf"
    doc = SimpleDocTemplate(path.as_posix(), pagesize=A4, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54, invariant=1)
    rows = [
        ["Description", "Qty", "Unit Price", "Line Total"],
        ["Monthly retainer", "1", "1200.00", "1200.00"],
        ["Support hours", "3", "50.00", "150.00"],
    ]
    table = Table(rows, colWidths=[220, 45, 95, 95])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E7E5E4")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1C1917")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D6D3D1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAF9")]),
        ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
        ("PADDING", (0, 0), (-1, -1), 8),
    ]))

    story = [
        Paragraph("Northwind Supply Co.", title_style),
        Spacer(1, 0.12 * inch),
        Paragraph("Invoice INV-2026-0142", meta_style),
        Paragraph("Invoice Date: 2026-02-18", meta_style),
        Paragraph("Due Date: 2026-03-20", meta_style),
        Paragraph("Bill To: Acme Logistics", meta_style),
        Spacer(1, 0.18 * inch),
        table,
        Spacer(1, 0.18 * inch),
        Paragraph("Currency: USD", body_style),
        Paragraph("Subtotal: 1350.00", body_style),
        Paragraph("Tax: 121.50", body_style),
        Paragraph("Total: 1471.50", body_style),
    ]
    doc.build(story)


def build_receipt():
    path = CORPUS_DIR / "receipt.pdf"
    doc = SimpleDocTemplate(path.as_posix(), pagesize=letter, leftMargin=60, rightMargin=60, topMargin=60, bottomMargin=60, invariant=1)
    rows = [
        ["Item", "Qty", "Price"],
        ["Apples", "2", "4.00"],
        ["Milk", "1", "3.50"],
        ["Granola", "1", "7.25"],
    ]
    table = Table(rows, colWidths=[240, 60, 90])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F5F5F4")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Courier"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D6D3D1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAF9")]),
        ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
        ("PADDING", (0, 0), (-1, -1), 7),
    ]))

    story = [
        Paragraph("Market Street Grocer", title_style),
        Spacer(1, 0.1 * inch),
        Paragraph("Receipt R-44219", meta_style),
        Paragraph("2026-01-12 14:22", meta_style),
        Paragraph("Paid with Visa", meta_style),
        Spacer(1, 0.18 * inch),
        table,
        Spacer(1, 0.2 * inch),
        Paragraph("Subtotal: 14.75", body_style),
        Paragraph("Tax: 1.25", body_style),
        Paragraph("Total: 16.00", body_style),
    ]
    doc.build(story)


def build_resume():
    path = CORPUS_DIR / "resume.pdf"
    doc = SimpleDocTemplate(path.as_posix(), pagesize=A4, leftMargin=56, rightMargin=56, topMargin=56, bottomMargin=56, invariant=1)
    story = [
        Paragraph("Jordan Lee", title_style),
        Paragraph("Senior Product Designer", meta_style),
        Paragraph("Amsterdam, NL", meta_style),
        Paragraph("jordan@example.com", meta_style),
        Paragraph("+31 6 12345678", meta_style),
        Spacer(1, 0.2 * inch),
        Paragraph("Summary", styles["Heading2"]),
        Paragraph("Product designer with 8 years of experience building conversion-focused experiences for SaaS products.", body_style),
        Spacer(1, 0.1 * inch),
        Paragraph("Skills", styles["Heading2"]),
        Paragraph("Figma, Design Systems, Research, Product Strategy", body_style),
        Spacer(1, 0.1 * inch),
        Paragraph("Experience Highlights", styles["Heading2"]),
        Paragraph("Led a redesign that increased activation by 18 percent.", body_style),
        Paragraph("Built a shared design system across 4 products.", body_style),
        Spacer(1, 0.1 * inch),
        Paragraph("Education", styles["Heading2"]),
        Paragraph("BSc Industrial Design", body_style),
    ]
    doc.build(story)


def build_business_card():
    path = CORPUS_DIR / "business-card.pdf"
    width, height = 3.5 * inch, 2 * inch
    canvas = Canvas(path.as_posix(), pagesize=(width, height), invariant=1)
    canvas.setFillColor(colors.HexColor("#1C1917"))
    canvas.setFont("Helvetica-Bold", 15)
    canvas.drawString(18, height - 27, "Nina Patel")
    canvas.setFont("Helvetica", 8.5)
    canvas.setFillColor(colors.HexColor("#44403C"))
    canvas.drawString(18, height - 42, "Account Executive | Orbit Partners")
    canvas.setStrokeColor(colors.HexColor("#D6D3D1"))
    canvas.line(18, height - 50, width - 18, height - 50)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#292524"))
    details = [
        "nina@orbitpartners.com",
        "+1 555 123 9876",
        "https://orbitpartners.com",
        "12 Harbor Ave, Boston, MA",
    ]
    for index, detail in enumerate(details):
        canvas.drawString(18, height - 66 - (index * 13), detail)
    canvas.showPage()
    canvas.save()


def build_operations_note():
    path = CORPUS_DIR / "operations-note.pdf"
    doc = SimpleDocTemplate(path.as_posix(), pagesize=A4, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54, invariant=1)
    story = [
        Paragraph("Operations Update", title_style),
        Paragraph("March 11, 2026", meta_style),
        Spacer(1, 0.18 * inch),
        Paragraph("Highlights", styles["Heading2"]),
        Paragraph("Dock audit moved to Friday at 14:00.", body_style),
        Paragraph("Email the revised vendor schedule before April 4.", body_style),
        Spacer(1, 0.12 * inch),
        Paragraph("Next Steps", styles["Heading2"]),
        Paragraph("1. Confirm dock access badges for the temp crew.", body_style),
        Paragraph("2. Archive Q1 invoices after reconciliation.", body_style),
        Paragraph("3. Share the updated receiving checklist with finance.", body_style),
    ]
    doc.build(story)


def main():
    build_invoice()
    build_receipt()
    build_resume()
    build_business_card()
    build_operations_note()


if __name__ == "__main__":
    main()
