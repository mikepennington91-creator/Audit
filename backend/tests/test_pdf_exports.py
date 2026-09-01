"""Exercise real PDF output, including content that previously caused export errors."""
import asyncio
import base64
import copy
import io
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from PIL import Image
from pypdf import PdfReader

os.environ.setdefault('DATABASE_URL', 'postgresql://test:test@localhost/test')
os.environ.setdefault('JWT_SECRET_KEY', 'test-secret')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from app_core import audit_reports, documents
from app_core.pdf_support import pdf_content_disposition
from test_audit_deadlines_activity import DB, Collection, user


def image_data():
    buffer = io.BytesIO()
    Image.new('RGB', (600, 200), '#dddddd').save(buffer, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()


def sample_run():
    return dict(id='r1', audit_id='a1', audit_name='Weekly GMP Audit – Main Production',
        auditor_id='starter', auditor_name='Starter', company_id='c1',
        started_at='2026-09-01T10:00:00+01:00', completed=True, completed_at='2026-09-01T11:00:00+01:00',
        completed_by_id='finisher', completed_by_name='Finisher', scoring_mode='non_conformances',
        max_non_conformances=5, non_conformance_count=1, total_score=None, pass_status='pass',
        answers=[dict(question_id='q1', response_value='Fail', response_label='Fail', is_negative=True,
            notes='Finding', action_required='Resolve this finding', action_taken='Resolved',
            action_due_date='2026-09-04', photos=[image_data()])],
        signoff_name='Finisher', signoff_email='finisher@example.test', signature=image_data())


def sample_document():
    return dict(id='doc1', company_id='c1', template_title='Monthly GMP – Test', document_reference='DOC087/1',
        completed=True, created_at='2026-09-01T10:00:00+01:00', completed_at='2026-09-01T11:00:00+01:00',
        completed_by='finisher', completed_by_name='Finisher', authorised_by='Admin', version=1,
        fields=[{'id':'header', 'label':'Literal <b> label', 'field_type':'text'},
                {'id':'qty', 'label':'Quantity', 'field_type':'number', 'section':'table', 'order':0},
                {'id':'date', 'label':'Delivery date', 'field_type':'date', 'section':'table', 'order':1},
                {'id':'comment', 'label':'Comment', 'field_type':'text', 'section':'table', 'order':2}],
        field_values=[{'field_id':'header','value':'Keep <b> as plain text & preserve this line'}],
        table_rows=[{'qty':0, 'date':'2026-09-01', 'comment':'TABLE VALUE RETAINED'}])


@pytest.fixture
def pdf_database(monkeypatch):
    db = DB(sample_run())
    db.audits.rows['a1']['questions'] = [{'id':'q1','text':'Are production areas clean?'}]
    db.companies = Collection([{'id':'c1','name':'Example Company','logo_data':image_data()}])
    db.traceability_documents = Collection([sample_document()])
    monkeypatch.setattr(server, 'db', db)
    return db


async def rendered(response):
    data = b''.join([chunk async for chunk in response.body_iterator])
    assert data.startswith(b'%PDF-')
    reader = PdfReader(io.BytesIO(data))
    return reader, '\n'.join(page.extract_text() for page in reader.pages)


@pytest.mark.parametrize('field', ['notes', 'action_required', 'action_taken', 'question'])
def test_long_audit_sections_paginate_without_losing_content(pdf_database, field):
    text = ('Detailed finding recorded for investigation and corrective action. ' * 300) + ' END OF LONG SECTION'
    if field == 'question': pdf_database.audits.rows['a1']['questions'][0]['text'] = text
    else: pdf_database.run_audits.rows['r1']['answers'][0][field] = text
    async def export():
        return await rendered(await audit_reports.export_audit_pdf('r1', user()))
    reader, content = asyncio.run(export())
    assert len(reader.pages) > 1
    assert 'END OF LONG SECTION' in content
    assert '04/09/2026' in content
    assert 'Sign Off' in content


def test_completed_audit_with_photos_signature_and_29_questions(pdf_database):
    answer = pdf_database.run_audits.rows['r1']['answers'][0]
    pdf_database.run_audits.rows['r1']['answers'] = [dict(answer, question_id=f'q{i}', photos=answer['photos'] if i == 0 else []) for i in range(29)]
    pdf_database.audits.rows['a1']['questions'] = [dict(id=f'q{i}', text=f'GMP check {i+1}') for i in range(29)]
    async def export(): return await rendered(await audit_reports.export_audit_pdf('r1', user()))
    reader, content = asyncio.run(export())
    assert 'GMP check 29' in content and 'Evidence Photo 1' in content
    assert 'Non-Conformances' in content and '01/09/2026' in content
    assert 'Finisher' in content and len(reader.pages) > 1


def test_unicode_document_filename_and_literal_markup_export(pdf_database):
    async def export():
        response = await documents.export_traceability_document_pdf('doc1', user('company_admin'))
        assert response.headers['content-disposition'].encode('ascii')
        assert '%E2%80%93' in response.headers['content-disposition']
        return await rendered(response)
    _, content = asyncio.run(export())
    assert 'Keep <b> as plain text & preserve this line' in content
    assert 'Literal <b> label' in content
    assert 'TABLE VALUE RETAINED' in content and '01/09/2026' in content


@pytest.mark.parametrize('batch', [False, True])
def test_document_table_long_cell_survives_single_and_combined_exports(pdf_database, batch):
    pdf_database.traceability_documents.rows['doc1']['table_rows'][0]['comment'] = 'Long production detail. ' * 800 + ' END OF TABLE CELL'
    async def export():
        response = (await documents.batch_export_traceability_pdf({'document_ids':['doc1']}, user('company_admin')) if batch
                    else await documents.export_traceability_document_pdf('doc1', user('company_admin')))
        return await rendered(response)
    reader, content = asyncio.run(export())
    assert len(reader.pages) > 1 and 'END OF TABLE CELL' in ' '.join(content.split())
    assert 'Delivery date' in content and '01/09/2026' in content


def test_pdf_company_boundary_still_enforced(pdf_database):
    with pytest.raises(HTTPException) as error:
        asyncio.run(audit_reports.export_audit_pdf('r1', user('company_admin', 'c2')))
    assert error.value.status_code == 404


def test_download_header_cannot_contain_raw_newlines_or_path_separators():
    value = pdf_content_disposition('DOC/001\\name\r\nInjected: bad – test.pdf')
    assert '\r' not in value and '\n' not in value and '\\' not in value
    assert value.encode('ascii')
    assert 'filename*=UTF-8' in value
