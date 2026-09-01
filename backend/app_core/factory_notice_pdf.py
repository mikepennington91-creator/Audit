from __future__ import annotations

import base64
import io
from xml.sax.saxutils import escape

from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, inch
from reportlab.platypus import Image as RLImage
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

import server as legacy
from app_core.disposal_routes import route_style_from_notice
from date_formats import format_uk_date


HOLD_RED = "#E30613"
BORDER = HexColor("#111111")
MUTED = HexColor("#5B616B")


def _paragraph(value, style):
    return Paragraph(escape(str(value or "-")), style)


def _company_mark(company: dict | None, styles):
    if company and company.get("logo_data"):
        try:
            encoded = company["logo_data"].split(",", 1)[-1]
            raw = base64.b64decode(encoded)
            image = RLImage(io.BytesIO(raw))
            max_width = 1.55 * inch
            max_height = 0.78 * inch
            scale = min(max_width / image.imageWidth, max_height / image.imageHeight)
            image.drawWidth = image.imageWidth * scale
            image.drawHeight = image.imageHeight * scale
            return image
        except Exception:
            pass

    name = (company or {}).get("name") or "Infinit Audit"
    return Paragraph(
        f"<b>{escape(name)}</b>",
        ParagraphStyle(
            "CompanyMark",
            parent=styles["Normal"],
            fontSize=15,
            leading=17,
            textColor=HexColor("#145B52"),
            alignment=TA_LEFT,
        ),
    )


def _banner(company: dict | None, notice_type: str, colour: str, text_colour: str, styles):
    is_hold = notice_type == "hold"
    title = "HOLD" if is_hold else "DISPOSAL"
    subtitle = "FORM"
    banner_style = ParagraphStyle(
        "FactoryBanner",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=34 if is_hold else 29,
        leading=32 if is_hold else 29,
        textColor=HexColor(text_colour),
        alignment=TA_CENTER,
    )
    banner_text = Paragraph(
        f"{title}<br/><font size=14>{subtitle}</font>",
        banner_style,
    )
    table = Table(
        [[_company_mark(company, styles), banner_text]],
        colWidths=[1.7 * inch, 5.0 * inch],
        rowHeights=[0.98 * inch],
    )
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (0, 0), "LEFT"),
        ("ALIGN", (1, 0), (1, 0), "CENTER"),
        ("BACKGROUND", (1, 0), (1, 0), HexColor(colour)),
        ("LEFTPADDING", (0, 0), (0, 0), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 10),
        ("LEFTPADDING", (1, 0), (1, 0), 8),
        ("RIGHTPADDING", (1, 0), (1, 0), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


def _reference_row(record: dict, styles):
    label = ParagraphStyle(
        "RefLabel", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=11
    )
    value = ParagraphStyle("RefValue", parent=styles["Normal"], fontSize=9, leading=11)
    date_time = f"{format_uk_date(record.get('event_date'), '-')}  {record.get('event_time') or ''}".strip()
    table = Table([
        [Paragraph("Reference Number:", label), _paragraph(record.get("reference"), value), Paragraph("Date / Time:", label), _paragraph(date_time, value)]
    ], colWidths=[1.25 * inch, 2.0 * inch, 1.05 * inch, 2.4 * inch])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (1, 0), (1, 0), 0.7, BORDER),
        ("LINEBELOW", (3, 0), (3, 0), 0.7, BORDER),
    ]))
    return table


def _details_table(record: dict, styles):
    label_style = ParagraphStyle(
        "DetailLabel", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=11
    )
    value_style = ParagraphStyle("DetailValue", parent=styles["Normal"], fontSize=10, leading=12)
    rows = [
        [Paragraph("Product / Material:", label_style), _paragraph(record.get("ingredient_name"), value_style)],
        [Paragraph("RM Number:", label_style), _paragraph(record.get("rm_number"), value_style)],
        [Paragraph("Our Batch:", label_style), _paragraph(record.get("our_batch"), value_style)],
        [Paragraph("Vendor Batch:", label_style), _paragraph(record.get("vendor_batch"), value_style)],
        [Paragraph("Date Delivered:", label_style), _paragraph(format_uk_date(record.get("date_delivered"), "-"), value_style)],
        [Paragraph("Quantity Delivered:", label_style), _paragraph(record.get("quantity_delivered"), value_style)],
        [Paragraph("Quantity for Disposal:" if record.get("notice_type") == "disposal" else "Quantity on Hold:", label_style), _paragraph(record.get("quantity"), value_style)],
        [Paragraph("Line / Factory Area:", label_style), _paragraph(record.get("line_area"), value_style)],
    ]
    table = Table(rows, colWidths=[1.62 * inch, 5.08 * inch])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (1, 0), (1, -1), 0.6, BORDER),
    ]))
    return table


def _boxed_section(label: str, value: str, styles, *, fill: str | None = None, text_colour: str = "#000000", min_height: float = 0.9 * inch):
    label_style = ParagraphStyle(
        f"{label}Label", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=11
    )
    value_style = ParagraphStyle(
        f"{label}Value",
        parent=styles["Normal"],
        fontSize=9.5,
        leading=12,
        textColor=HexColor(text_colour),
    )
    content = Table(
        [[Paragraph(label, label_style), _paragraph(value, value_style)]],
        colWidths=[1.62 * inch, 5.08 * inch],
        minRowHeights=[min_height],
        splitInRow=1,
    )
    commands = [
        ("BOX", (0, 0), (-1, -1), 1.0, BORDER),
        ("LINEAFTER", (0, 0), (0, 0), 0.8, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]
    if fill:
        commands.append(("BACKGROUND", (1, 0), (1, 0), HexColor(fill)))
    content.setStyle(TableStyle(commands))
    return content


def _signoff(record: dict, styles, notice_type: str):
    label_style = ParagraphStyle(
        "SignoffLabel", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=11
    )
    value_style = ParagraphStyle("SignoffValue", parent=styles["Normal"], fontSize=9.5, leading=11)
    first_label = "Authorised / Raised by" if notice_type == "disposal" else "Completed by"
    rows = [
        [Paragraph(first_label, label_style), _paragraph(record.get("created_by_name"), value_style)],
        [Paragraph("System record", label_style), _paragraph(legacy.format_uk_datetime(record.get("created_at")), value_style)],
    ]
    table = Table(rows, colWidths=[1.62 * inch, 5.08 * inch])
    table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


async def notice_pdf_bytes(record: dict) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=1.1 * cm,
        leftMargin=1.1 * cm,
        topMargin=0.8 * cm,
        bottomMargin=0.8 * cm,
    )
    styles = getSampleStyleSheet()
    normal = ParagraphStyle("FactoryNormal", parent=styles["Normal"], fontSize=9, leading=11)
    instruction = ParagraphStyle(
        "FactoryInstruction",
        parent=normal,
        fontSize=9,
        leading=12,
        alignment=TA_CENTER,
        textColor=HexColor("#222222"),
    )

    company = None
    if record.get("company_id"):
        company = await legacy.db.companies.find_one({"id": record["company_id"]}, {"_id": 0})

    notice_type = record.get("notice_type") or "hold"
    if notice_type == "hold":
        banner_colour = HOLD_RED
        banner_text_colour = "#FFFFFF"
        route_style = None
    else:
        route_style = route_style_from_notice(record)
        banner_colour = route_style["color_hex"]
        banner_text_colour = route_style["text_color"]

    story = [
        _banner(company, notice_type, banner_colour, banner_text_colour, styles),
        Spacer(1, 0.08 * inch),
        _reference_row(record, styles),
        Spacer(1, 0.08 * inch),
        _details_table(record, styles),
        Spacer(1, 0.14 * inch),
    ]

    if notice_type == "hold":
        story.extend([
            _boxed_section("ISSUE", record.get("reason"), styles, min_height=1.18 * inch),
            Spacer(1, 0.18 * inch),
            _boxed_section("ACTION REQUIRED / COMMENTS", record.get("action_required"), styles, min_height=1.18 * inch),
            Spacer(1, 0.24 * inch),
            _signoff(record, styles, notice_type),
        ])

    if notice_type == "hold" and (record.get("outcome_version") or any(record.get(field) for field in (
        "quantity_released", "quantity_discarded", "root_cause", "corrective_action"
    ))):
        story.extend([
            PageBreak(),
            _banner(company, "hold", HOLD_RED, "#FFFFFF", styles),
            Spacer(1, 0.08 * inch),
            _reference_row(record, styles),
            Paragraph("Hold Outcome &amp; Investigation", styles["Heading2"]),
            _boxed_section("QUANTITY RELEASED", record.get("quantity_released"), styles, min_height=0.48 * inch),
            Spacer(1, 0.12 * inch),
            _boxed_section("QUANTITY DISCARDED", record.get("quantity_discarded"), styles, min_height=0.48 * inch),
            Spacer(1, 0.12 * inch),
            _boxed_section("ROOT CAUSE", record.get("root_cause"), styles, min_height=1.18 * inch),
            Spacer(1, 0.12 * inch),
            _boxed_section("CORRECTIVE ACTION", record.get("corrective_action"), styles, min_height=1.18 * inch),
            Spacer(1, 0.24 * inch),
            _signoff({**record, "created_by_name": record.get("outcome_updated_by_name"),
                      "created_at": record.get("outcome_updated_at")}, styles, "hold"),
        ])
    if notice_type != "hold":
        story.extend([
            _boxed_section(
                "DISPOSAL ROUTE",
                (route_style or {}).get("name") or record.get("disposal_route_label") or "Disposal",
                styles,
                fill=(route_style or {}).get("color_hex"),
                text_colour=(route_style or {}).get("text_color", "#000000"),
                min_height=0.52 * inch,
            ),
            Spacer(1, 0.13 * inch),
            _boxed_section(
                "DISPOSAL REASON",
                record.get("reason"),
                styles,
                fill=(route_style or {}).get("color_hex"),
                text_colour=(route_style or {}).get("text_color", "#000000"),
                min_height=1.02 * inch,
            ),
            Spacer(1, 0.13 * inch),
            _boxed_section("ACTION REQUIRED / COMMENTS", record.get("action_required"), styles, min_height=0.82 * inch),
            Spacer(1, 0.24 * inch),
            Paragraph(
                "This notice must remain with the material to be disposed at all times. "
                "Where the material is already on hold, the disposal notice must be applied on the same side(s) as the hold notice.",
                instruction,
            ),
            Spacer(1, 0.24 * inch),
            _signoff(record, styles, notice_type),
        ])

    def page_reference(canvas, document):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        reference = str(record.get("reference") or "Factory notice")
        # Long user-entered references must not overlap the central footer.
        while canvas.stringWidth(reference, "Helvetica", 7) > 1.8 * inch:
            reference = reference[:-4] + "..."
        canvas.drawString(document.leftMargin, 10, reference)
        canvas.drawCentredString(A4[0] / 2, 10, "Generated by Infinit Audit · Controlled factory notice")
        canvas.drawRightString(A4[0] - document.rightMargin, 10, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=page_reference, onLaterPages=page_reference)
    buffer.seek(0)
    return buffer.read()
