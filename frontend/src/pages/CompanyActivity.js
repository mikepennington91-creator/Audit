import { useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { formatUKDateTime } from '../utils/dates';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const types = ['account', 'audit', 'audit_template', 'document', 'document_template', 'hold_notice', 'disposal_notice', 'company', 'distribution_list', 'disposal_route', 'response_group', 'audit_type', 'line_shift'];
const label = value => value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());

export default function CompanyActivity() {
  const [eventType, setEventType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ entries: [], total: 0 });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    axios.get(`${API}/company-activity`, { params: { event_type: eventType || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined, offset, limit: 50 } })
      .then(res => { if (active) setData(res.data); })
      .catch(() => { if (active) toast.error('Could not load company activity'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [eventType, dateFrom, dateTo, offset]);
  return <div className="space-y-6">
    <div><h1 className="text-3xl font-bold">Company Activity</h1><p className="text-muted-foreground mt-1">Read-only history of company changes. Entries cannot be edited or deleted. Audit starts and document completions are not recorded here.</p></div>
    <div className="flex gap-4 flex-wrap items-end">
      <label className="space-y-1">Change type<select aria-label="Change type" className="block border rounded-md p-2 bg-background" value={eventType} onChange={e => { setEventType(e.target.value); setOffset(0); }}><option value="">All changes</option>{types.flatMap(type => (type === 'audit' ? ['deleted'] : ['document', 'hold_notice', 'disposal_notice'].includes(type) ? ['created', 'deleted'] : ['created', 'updated', 'deleted']).map(action => <option key={`${type}_${action}`} value={`${type}_${action}`}>{label(`${type}_${action}`)}</option>))}</select></label>
      <label>From<Input aria-label="From date" type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setOffset(0); }} /></label>
      <label>To<Input aria-label="To date" type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setOffset(0); }} /></label>
    </div>
    <Card><CardContent className="pt-6 overflow-x-auto">{loading ? <p>Loading activity…</p> : <table className="w-full text-sm text-left"><thead><tr>{['Date & time (UK)', 'Change', 'Record', 'Changed by', 'Reason'].map(h => <th key={h} className="p-3 border-b">{h}</th>)}</tr></thead><tbody>{data.entries.map(entry => <tr key={entry.id}><td className="p-3 border-b whitespace-nowrap">{formatUKDateTime(entry.occurred_at)}</td><td className="p-3 border-b">{label(entry.event_type)}</td><td className="p-3 border-b break-words">{entry.resource_name}<span className="block text-xs text-muted-foreground">{entry.resource_id}</span></td><td className="p-3 border-b">{entry.actor_name}</td><td className="p-3 border-b whitespace-pre-wrap break-words">{entry.reason || '—'}</td></tr>)}{!data.entries.length && <tr><td colSpan={5} className="p-6 text-center">No company changes match these filters.</td></tr>}</tbody></table>}</CardContent></Card>
    <div className="flex items-center gap-4"><Button variant="outline" disabled={!offset || loading} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button><span>{data.total} changes</span><Button variant="outline" disabled={offset + 50 >= data.total || loading} onClick={() => setOffset(offset + 50)}>Next</Button></div>
  </div>;
}
