"""Plain-text PDF fields and safe download headers shared by document exports."""
import re
import unicodedata
from urllib.parse import quote
from xml.sax.saxutils import escape

from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle
from date_formats import format_uk_date


def plain_text(value, missing='-'):
    text = str(value) if value is not None and value != '' else missing
    return escape(text).replace('\r\n', '\n').replace('\r', '\n').replace('\n', '<br/>')


def pdf_content_disposition(filename):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f]', '_', str(filename or 'document.pdf'))
    name = name[:180].removesuffix('.pdf') + '.pdf'
    ascii_name = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode('ascii')
    ascii_name = ascii_name.strip()
    if ascii_name.strip(' .').lower() in {'', 'pdf'}:
        ascii_name = 'document.pdf'
    return f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(name, safe="")}'


def _field_value(field, value):
    if field.get('field_type') == 'checkbox':
        return 'Yes' if value else 'No'
    if field.get('field_type') == 'date':
        return format_uk_date(value, '-')
    return value


def document_fields_story(document, heading_style, value_style):
    """Use the same fields/table rendering for single and combined PDFs."""
    story = []
    fields = document.get('fields') or []
    field_map = {field['id']: field for field in fields}
    for entry in document.get('field_values') or []:
        field = field_map.get(entry.get('field_id'), {})
        if field.get('section') == 'table':
            continue
        label = field.get('label') or entry.get('field_id') or ''
        value = _field_value(field, entry.get('value'))
        story.extend([Paragraph(f'<b>{plain_text(label)}</b>', heading_style),
                      Paragraph(plain_text(value), value_style)])

    columns = sorted([f for f in fields if f.get('section') == 'table'], key=lambda f: f.get('order', 0))
    if columns and document.get('table_rows'):
        story.extend([Spacer(1, 0.3 * inch), Paragraph('<b>Production Data</b>', heading_style), Spacer(1, 0.1 * inch)])
        cell_style = ParagraphStyle('DocumentCell', parent=value_style, fontSize=8, leading=10, spaceBefore=0, spaceAfter=0)
        header_style = ParagraphStyle('DocumentColumn', parent=cell_style, fontName='Helvetica-Bold', textColor=white)
        rows = [[Paragraph('#', header_style)] + [Paragraph(plain_text(f.get('label')), header_style) for f in columns]]
        for index, row in enumerate(document['table_rows'], 1):
            rows.append([Paragraph(str(index), cell_style)] + [Paragraph(plain_text(_field_value(f, row.get(f['id']))), cell_style) for f in columns])
        table = Table(rows, colWidths=[0.4 * inch] + [6 * inch / len(columns)] * len(columns),
                      repeatRows=1, splitByRow=1, splitInRow=1)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), HexColor('#1a7a6e')),
            ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#cccccc')),
            ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4),
            ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor('#f8f8f8')]),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        story.append(table)
    return story
