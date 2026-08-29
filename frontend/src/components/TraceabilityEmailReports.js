import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { FileSpreadsheet, Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const REPORTS = {
  bulk_excel: { label: 'Bulk traceability Excel', endpoint: '/reports/traceability/email' },
  raw_intakes: { label: 'Raw Material Intake CSV', endpoint: '/reports/traceability/csv/email' },
  finished_goods_trace: { label: 'Finished Goods Trace CSV', endpoint: '/reports/traceability/csv/email' },
  raw_material_trace: { label: 'Raw Material Trace CSV', endpoint: '/reports/traceability/csv/email' },
  date_trace_finished: { label: 'Finished Product Date Trace CSV', endpoint: '/reports/traceability/csv/email' },
  date_trace_raw: { label: 'Raw Material Date Trace CSV', endpoint: '/reports/traceability/csv/email' },
};

const TraceabilityEmailReports = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reportType, setReportType] = useState('bulk_excel');
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [lookupCode, setLookupCode] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedTypes, setSelectedTypes] = useState({ raw: true, finished: true, usage: true });
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) setRecipient(user?.email || '');
  }, [open, user?.email]);

  const report = REPORTS[reportType];
  const needsLookup = ['finished_goods_trace', 'raw_material_trace'].includes(reportType);
  const needsDateRange = ['date_trace_finished', 'date_trace_raw'].includes(reportType);
  const isBulk = reportType === 'bulk_excel';
  const selectedDataTypes = useMemo(() => Object.entries(selectedTypes).filter(([, enabled]) => enabled).map(([type]) => type), [selectedTypes]);

  const reset = () => {
    setReportType('bulk_excel');
    setMessage('');
    setLookupCode('');
    setDateFrom('');
    setDateTo('');
    setSelectedTypes({ raw: true, finished: true, usage: true });
  };

  const validate = () => {
    if (!recipient.trim()) return 'Enter a recipient email address';
    if (isBulk && selectedDataTypes.length === 0) return 'Select at least one traceability data type';
    if (needsLookup && !lookupCode.trim()) return reportType === 'finished_goods_trace' ? 'Enter a finished batch code' : 'Enter a Sweetdreams batch code';
    if (needsDateRange && (!dateFrom || !dateTo)) return 'Select a start and end date';
    if ((isBulk || needsDateRange) && dateFrom && dateTo && dateFrom > dateTo) return 'Start date cannot be after end date';
    return null;
  };

  const send = async () => {
    const validationError = validate();
    if (validationError) return toast.error(validationError);
    setSending(true);
    try {
      const base = { recipient: recipient.trim(), message: message.trim() || null };
      const payload = isBulk
        ? { ...base, data_types: selectedDataTypes, date_from: dateFrom || null, date_to: dateTo || null }
        : {
            ...base,
            report_type: reportType,
            lookup_code: needsLookup ? lookupCode.trim() : null,
            date_from: needsDateRange ? dateFrom : null,
            date_to: needsDateRange ? dateTo : null,
          };
      await axios.post(`${API}${report.endpoint}`, payload);
      toast.success(`Report emailed to ${recipient.trim()}`);
      setOpen(false);
      reset();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to email the report');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="traceability-email-reports"><Mail className="w-4 h-4 mr-2" />Email Report</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" />Email traceability report</DialogTitle>
          <DialogDescription>Choose any of the downloadable traceability reports and send the generated file as an attachment.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Report</Label>
            <Select value={reportType} onValueChange={(value) => { setReportType(value); setLookupCode(''); setDateFrom(''); setDateTo(''); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(REPORTS).map(([key, item]) => <SelectItem key={key} value={key}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {isBulk && (
            <div className="space-y-2">
              <Label>Data to include</Label>
              <div className="grid gap-2">
                {[['raw', 'Raw Material Intake'], ['finished', 'Finished Batches'], ['usage', 'Material Usage']].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-3 rounded-md border p-3 cursor-pointer">
                    <Checkbox checked={selectedTypes[key]} onCheckedChange={(checked) => setSelectedTypes((current) => ({ ...current, [key]: checked === true }))} />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {needsLookup && (
            <div className="space-y-2">
              <Label>{reportType === 'finished_goods_trace' ? 'Finished Batch Code' : 'Sweetdreams Batch Code'}</Label>
              <Input value={lookupCode} onChange={(event) => setLookupCode(event.target.value)} placeholder="Enter the batch code" />
            </div>
          )}

          {(isBulk || needsDateRange) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2"><Label>From date {isBulk && '(optional)'}</Label><Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></div>
              <div className="space-y-2"><Label>To date {isBulk && '(optional)'}</Label><Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div>
            </div>
          )}

          <div className="space-y-2"><Label>Recipient email</Label><Input type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} required /></div>
          <div className="space-y-2"><Label>Message (optional)</Label><Textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={3} maxLength={2000} placeholder="Add a short message..." /></div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={sending}>Cancel</Button>
          <Button onClick={send} disabled={sending}>{sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}{sending ? 'Sending...' : 'Send Report'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TraceabilityEmailReports;
