import { pdfErrorMessage } from '../utils/pdfErrors';
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { AlertTriangle, Download, Eye, Mail, PackageX, Pencil, Plus, Save, Send, Settings, Trash2, Users } from 'lucide-react';

import { formatUKDate, formatUKDateTime, ukToday, ukNowTime } from '../utils/dates';
import { disposalRoutesForNotice } from '../utils/disposalRoutes';

const API = `${process.env.REACT_APP_BACKEND_URL}/api/hold-disposal`;

const blankNotice = () => ({
  reference: '',
  rm_number: '',
  our_batch: '',
  vendor_batch: '',
  date_delivered: '',
  quantity_delivered: '',
  quantity: '',
  ingredient_name: '',
  reason: '',
  action_required: '',
  event_date: ukToday(),
  event_time: ukNowTime(),
  line_area: '',
  disposal_route: '',
  company_id: '',
});

const NoticeForm = ({ type, companies, isSystemAdmin, disposalRoutes, onCreated, onUpdated, sourceHold, editNotice, onCancel }) => {
  const [form, setForm] = useState(() => editNotice ? { ...blankNotice(), ...editNotice } : sourceHold ? {
    ...blankNotice(), ...sourceHold, quantity: sourceHold.quantity_discarded || sourceHold.quantity, event_date: ukToday(), event_time: ukNowTime(), disposal_route: '',
  } : blankNotice());
  const [changeReason, setChangeReason] = useState('');
  const [saving, setSaving] = useState(false);
  const isDisposal = type === 'disposal';
  const isEditing = !!editNotice;

  const availableRoutes = useMemo(() => {
    if (!isDisposal) return [];
    return disposalRoutesForNotice(disposalRoutes, {
      isSystemAdmin,
      companyId: form.company_id,
      fromHold: !!sourceHold,
    });
  }, [isDisposal, isSystemAdmin, form.company_id, disposalRoutes, sourceHold]);

  const selectedRoute = availableRoutes.find((route) => route.key === form.disposal_route);
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const changeCompany = (value) => {
    setForm((current) => ({ ...current, company_id: value, disposal_route: '' }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (isSystemAdmin && !form.company_id && !sourceHold && !isEditing) {
      toast.error('Select a company for this notice');
      return;
    }
    if (isDisposal && !form.disposal_route) {
      toast.error('Select a disposal route');
      return;
    }
    setSaving(true);
    try {
      if (isEditing) {
        const endpoint = isDisposal ? 'disposal-notices' : 'hold-notices';
        const payload = {
          ...form,
          expected_version: editNotice.record_version || 0,
          change_reason: changeReason,
        };
        delete payload.company_id;
        const response = await axios.put(`${API}/${endpoint}/${editNotice.id}`, payload);
        toast.success(`${isDisposal ? 'Disposal' : 'Hold'} notice ${response.data.reference} updated`);
        onUpdated(response.data);
        return;
      }
      const endpoint = sourceHold ? `hold-notices/${sourceHold.id}/disposal` : isDisposal ? 'disposal-notices' : 'hold-notices';
      const payload = sourceHold ? {
        event_date: form.event_date, event_time: form.event_time, disposal_route: form.disposal_route,
        reason: form.reason, action_required: form.action_required, quantity: form.quantity,
      } : { ...form };
      if (!isDisposal) delete payload.disposal_route;
      if (!isSystemAdmin) delete payload.company_id;
      const response = await axios.post(`${API}/${endpoint}`, payload);
      toast.success(`${isDisposal ? 'Disposal' : 'Hold'} notice ${response.data.reference} created`);
      const keepCompany = form.company_id;
      setForm({ ...blankNotice(), company_id: keepCompany });
      onCreated(response.data);
    } catch (error) {
      const detail = error.response?.data?.detail;
      toast.error(Array.isArray(detail) ? detail.map((item) => item.msg).join('; ') : detail || 'Unable to create notice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={isDisposal ? 'border-blue-300' : 'border-red-300'}>
      <CardHeader>
        <div className={`mb-3 rounded-md px-4 py-3 text-center text-2xl font-black tracking-[0.2em] text-white ${isDisposal ? 'bg-blue-600' : 'bg-red-600'}`}>
          {isDisposal ? 'DISPOSAL' : 'HOLD'}
        </div>
        <CardTitle className="flex items-center gap-2">
          {isDisposal ? <PackageX className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5 text-red-600" />}
          {isEditing ? `Edit ${isDisposal ? 'Disposal' : 'Hold'} Notice ${editNotice.reference}` : sourceHold ? `Dispose Hold ${sourceHold.reference}` : `New ${isDisposal ? 'Disposal' : 'Hold'} Notice`}
        </CardTitle>
        <CardDescription>
          {isEditing ? 'Add or correct details below. Every change is retained in the notice history.' : sourceHold ? 'The hold reference and material details are retained. Confirm the quantity being discarded, disposal date, route, reason and action.' : 'Enter the information once; Infinit Audit stores the controlled record and generates the factory PDF from it.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          {isSystemAdmin && !sourceHold && !isEditing && (
            <div className="space-y-2">
              <Label>Company</Label>
              <Select value={form.company_id} onValueChange={changeCompany}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>{companies.map((company) => <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          <fieldset className="space-y-4 rounded-lg border p-4">
            <legend className="px-2 font-semibold">Notice Details</legend>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor={`${type}-reference`}>Notice Reference</Label>
                <Input id={`${type}-reference`} value={form.reference} onChange={(e) => update('reference', e.target.value)} maxLength={60} readOnly={!!sourceHold} placeholder="e.g. 12345" />
                <p className="text-xs text-muted-foreground">{sourceHold ? 'Same reference as the original hold.' : 'Leave blank to generate a reference.'}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${type}-date`}>{isDisposal ? 'Disposal Date' : 'Hold Date'}</Label>
                <Input id={`${type}-date`} type="date" value={form.event_date} onChange={(e) => update('event_date', e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${type}-time`}>Time</Label>
                <Input id={`${type}-time`} type="time" value={form.event_time} onChange={(e) => update('event_time', e.target.value)} required />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-4 rounded-lg border p-4">
            <legend className="px-2 font-semibold">Material &amp; Batch Details</legend>
            <div className="space-y-2">
              <Label htmlFor={`${type}-ingredient`}>Ingredient / Material Name</Label>
              <Input id={`${type}-ingredient`} readOnly={!!sourceHold} value={form.ingredient_name} onChange={(e) => update('ingredient_name', e.target.value)} maxLength={240} required />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {[
                ['rm_number', 'RM Number', 'e.g. RM26723'],
                ['our_batch', 'Our Batch', 'Our batch code'],
                ['vendor_batch', 'Vendor Batch', 'Supplier batch code'],
              ].map(([field, label, placeholder]) => <div key={field} className="space-y-2">
                <Label htmlFor={`${type}-${field}`}>{label}</Label>
                <Input id={`${type}-${field}`} readOnly={!!sourceHold} value={form[field] || ''} onChange={(e) => update(field, e.target.value)} placeholder={placeholder} maxLength={120} required={field === 'rm_number'} />
              </div>)}
            </div>
          </fieldset>

          <fieldset className="space-y-4 rounded-lg border p-4">
            <legend className="px-2 font-semibold">Delivery &amp; Quantity Details</legend>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${type}-date_delivered`}>Date Delivered</Label>
                <Input id={`${type}-date_delivered`} type="date" readOnly={!!sourceHold} value={form.date_delivered || ''} onChange={(e) => update('date_delivered', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${type}-quantity_delivered`}>Quantity Delivered</Label>
                <Input id={`${type}-quantity_delivered`} readOnly={!!sourceHold} value={form.quantity_delivered || ''} onChange={(e) => update('quantity_delivered', e.target.value)} maxLength={120} placeholder="e.g. 500 kg / 180 cases" />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${type}-quantity`}>{isDisposal ? 'Quantity for Disposal' : 'Quantity on Hold'}</Label>
                <Input id={`${type}-quantity`} value={form.quantity} onChange={(e) => update('quantity', e.target.value)} maxLength={120} placeholder="Include the unit, e.g. 50 kg" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${type}-area`}>Line / Factory Area</Label>
                <Input id={`${type}-area`} readOnly={!!sourceHold} value={form.line_area} onChange={(e) => update('line_area', e.target.value)} maxLength={240} placeholder="e.g. Line 3 / Warehouse" required />
              </div>
            </div>
          </fieldset>

          {isDisposal && (
            <div className="space-y-2">
              <Label>Disposal Route</Label>
              <Select
                value={form.disposal_route}
                onValueChange={(value) => update('disposal_route', value)}
                disabled={isSystemAdmin && !form.company_id && !sourceHold}
              >
                <SelectTrigger><SelectValue placeholder={isSystemAdmin && !form.company_id && !sourceHold ? 'Select company first' : 'Select disposal route'} /></SelectTrigger>
                <SelectContent>
                  {availableRoutes.map((route) => (
                    <SelectItem key={route.id || route.key} value={route.key}>
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-3 w-3 rounded-sm border" style={{ backgroundColor: route.color_hex }} />
                        {route.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedRoute && (
                <div
                  className="rounded-md border px-4 py-3 text-center font-bold"
                  style={{ backgroundColor: selectedRoute.color_hex, color: selectedRoute.text_color }}
                >
                  {selectedRoute.name}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={`${type}-reason`}>{isDisposal ? 'Disposal Reason' : 'Issue'}</Label>
            <Textarea id={`${type}-reason`} value={form.reason} onChange={(e) => update('reason', e.target.value)} rows={4} maxLength={3000} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${type}-action`}>Action Required</Label>
            <Textarea id={`${type}-action`} value={form.action_required} onChange={(e) => update('action_required', e.target.value)} rows={4} maxLength={3000} required />
          </div>

          {isEditing && (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-slate-900 dark:border-amber-800 dark:bg-amber-950 dark:text-slate-100">
              <Label htmlFor={`${type}-change-reason`}>Reason for Change *</Label>
              <Textarea id={`${type}-change-reason`} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={3} maxLength={1000} placeholder="Explain what was added or corrected and why" required />
              <p className="text-xs opacity-75">Your name, the date, reason and each changed field will be retained.</p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
            <Button type="submit" disabled={saving}>
              <Save className="mr-2 h-4 w-4" />{saving ? 'Saving...' : isEditing ? 'Save Changes' : `Create ${isDisposal ? 'Disposal' : 'Hold'} Notice`}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

const NoticeHistory = ({ type, notices, onView, onEdit, onDownload, onEmail, onDispose, onOutcome, disposals = [], user, isAdminUser }) => {
  const isDisposal = type === 'disposal';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent {isDisposal ? 'Disposal' : 'Hold'} Notices</CardTitle>
        <CardDescription>Open a notice in the website, or download and distribute its factory PDF.</CardDescription>
      </CardHeader>
      <CardContent>
        {notices.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No {isDisposal ? 'disposal' : 'hold'} notices have been raised yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Material</TableHead><TableHead>RM / Batches</TableHead><TableHead>{isDisposal ? 'Quantity for Disposal' : 'Quantity on Hold'}</TableHead><TableHead>Date / Time</TableHead><TableHead>Area</TableHead>{isDisposal && <TableHead>Route</TableHead>}<TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {notices.map((notice) => (
                  <TableRow key={notice.id}>
                    <TableCell className="font-medium">{notice.reference}{notice.source_hold_id && <p className="text-xs font-normal text-muted-foreground">From hold {notice.reference}</p>}</TableCell>
                    <TableCell>{notice.ingredient_name}</TableCell>
                    <TableCell>{notice.rm_number}<p className="text-xs text-muted-foreground">Our batch: {notice.our_batch || '-'}</p><p className="text-xs text-muted-foreground">Vendor batch: {notice.vendor_batch || '-'}</p></TableCell>
                    <TableCell>{notice.quantity}{!isDisposal && <div className="text-xs text-muted-foreground">Released: {notice.quantity_released || '-'}<br />Discarded: {notice.quantity_discarded || '-'}</div>}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatUKDate(notice.event_date)}<br /><span className="text-xs text-muted-foreground">{notice.event_time}</span></TableCell>
                    <TableCell>{notice.line_area}</TableCell>
                    {isDisposal && (
                      <TableCell>
                        <Badge
                          variant="outline"
                          style={{
                            backgroundColor: notice.disposal_route_color || 'transparent',
                            color: notice.disposal_route_text_color || undefined,
                            borderColor: notice.disposal_route_color || undefined,
                          }}
                        >
                          {notice.disposal_route_label}
                        </Badge>
                      </TableCell>
                    )}
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="outline" size="sm" onClick={() => onView(type, notice)}><Eye className="mr-1 h-4 w-4" />View</Button>
                      {(isAdminUser || notice.created_by_id === user?.id) && <Button variant="ghost" size="sm" onClick={() => onEdit(type, notice)} title="Edit notice"><Pencil className="h-4 w-4" /></Button>}
                      {!isDisposal && <Button variant="outline" size="sm" onClick={() => onOutcome(notice)}>Record Outcome</Button>}
                      {!isDisposal && (disposals.some((item) => item.source_hold_id === notice.id)
                        ? <Badge variant="secondary">Disposal notice raised</Badge>
                        : <Button variant="outline" size="sm" onClick={() => onDispose(notice)}><PackageX className="mr-1 h-4 w-4" />Create Disposal</Button>)}
                      <Button variant="ghost" size="sm" onClick={() => onDownload(type, notice)} title="Download PDF"><Download className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => onEmail(type, notice)} title="Email PDF"><Mail className="mr-1 h-4 w-4" />Email</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const NOTICE_FIELD_LABELS = {
  reference: 'Notice Reference', event_date: 'Date', event_time: 'Time', ingredient_name: 'Ingredient / Material',
  rm_number: 'RM Number', our_batch: 'Our Batch', vendor_batch: 'Vendor Batch', date_delivered: 'Date Delivered',
  quantity_delivered: 'Quantity Delivered', quantity: 'Notice Quantity', line_area: 'Line / Factory Area',
  disposal_route: 'Disposal Route', disposal_route_label: 'Disposal Route', reason: 'Issue / Reason', action_required: 'Action Required',
};

const DisposalFromHoldCard = ({ holds, disposals, onStart }) => {
  const [holdId, setHoldId] = useState('');
  const availableHolds = holds.filter((hold) => !disposals.some((notice) => notice.source_hold_id === hold.id));
  if (!availableHolds.length) return null;
  const selected = availableHolds.find((hold) => hold.id === holdId);
  return <Card className="border-amber-300 dark:border-amber-800">
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><PackageX className="h-5 w-5" />Start Disposal from a Hold Notice</CardTitle>
      <CardDescription>Select the hold reference. Its material, RM, batch, delivery, quantity and factory-area details will be copied automatically.</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1 space-y-2">
        <Label>Hold Reference</Label>
        <Select value={holdId} onValueChange={setHoldId}>
          <SelectTrigger><SelectValue placeholder="Select a hold notice" /></SelectTrigger>
          <SelectContent>{availableHolds.map((hold) => <SelectItem key={hold.id} value={hold.id}>{hold.reference} — {hold.ingredient_name} ({hold.quantity_discarded || hold.quantity})</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Button type="button" disabled={!selected} onClick={() => onStart(selected)}><PackageX className="mr-2 h-4 w-4" />Start Disposal</Button>
    </CardContent>
  </Card>;
};

const NoticeViewer = ({ type, notice, canEdit, onEdit, onDispose, onClose }) => {
  const isDisposal = type === 'disposal';
  const detailRows = [
    ['Reference', notice.reference],
    [isDisposal ? 'Disposal date' : 'Hold date', `${formatUKDate(notice.event_date)} ${notice.event_time || ''}`],
    ['Ingredient / Material', notice.ingredient_name],
    ['RM number', notice.rm_number],
    ['Our batch', notice.our_batch],
    ['Vendor batch', notice.vendor_batch],
    ['Delivered', `${notice.quantity_delivered || '-'}${notice.date_delivered ? ` on ${formatUKDate(notice.date_delivered)}` : ''}`],
    [isDisposal ? 'Quantity for disposal' : 'Quantity on hold', notice.quantity],
    ['Line / factory area', notice.line_area],
    ...(isDisposal ? [['Disposal route', notice.disposal_route_label || notice.disposal_route]] : []),
    ['Created by', notice.created_by_name],
    ['Created', formatUKDateTime(notice.created_at)],
  ];
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2">
      {detailRows.map(([label, value]) => <div key={label} className="rounded-md border bg-muted/30 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 whitespace-pre-wrap break-words font-medium">{value || '-'}</p>
      </div>)}
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-md border p-4"><p className="font-semibold">{isDisposal ? 'Disposal reason' : 'Issue / reason'}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{notice.reason}</p></div>
      <div className="rounded-md border p-4"><p className="font-semibold">Action required</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{notice.action_required}</p></div>
    </div>
    {!isDisposal && <div className="rounded-md border p-4">
      <p className="font-semibold">Hold outcome</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <p><span className="text-muted-foreground">Released:</span> {notice.quantity_released || '-'}</p>
        <p><span className="text-muted-foreground">Discarded:</span> {notice.quantity_discarded || '-'}</p>
        <p className="whitespace-pre-wrap break-words sm:col-span-2"><span className="text-muted-foreground">Root cause:</span> {notice.root_cause || '-'}</p>
        <p className="whitespace-pre-wrap break-words sm:col-span-2"><span className="text-muted-foreground">Corrective action:</span> {notice.corrective_action || '-'}</p>
      </div>
    </div>}
    {!!notice.edit_history?.length && <details className="rounded-md border p-4 text-sm">
      <summary className="cursor-pointer font-semibold">Notice edit history ({notice.edit_history.length})</summary>
      <div className="mt-3 space-y-4">{[...notice.edit_history].reverse().map((entry) => <div key={entry.id} className="border-t pt-3">
        <p className="font-medium">{entry.updated_by_name || 'User'} · {formatUKDateTime(entry.updated_at)}</p>
        <p className="mt-1 text-muted-foreground">Reason: {entry.reason}</p>
        <div className="mt-2 space-y-1">{Object.entries(entry.changes || {}).map(([field, change]) => <p key={field} className="whitespace-pre-wrap break-words"><strong>{NOTICE_FIELD_LABELS[field] || field}:</strong> {change.before || '(blank)'} → {change.after || '(blank)'}</p>)}</div>
      </div>)}</div>
    </details>}
    <DialogFooter>
      <Button variant="outline" onClick={onClose}>Close</Button>
      {!isDisposal && onDispose && <Button variant="outline" onClick={onDispose}><PackageX className="mr-2 h-4 w-4" />Start Disposal</Button>}
      {canEdit && <Button onClick={onEdit}><Pencil className="mr-2 h-4 w-4" />Edit Notice</Button>}
    </DialogFooter>
  </div>;
};

const OUTCOME_LABELS = {
  quantity_released: 'Quantity Released', quantity_discarded: 'Quantity Discarded',
  root_cause: 'Root Cause', corrective_action: 'Corrective Action',
};

const HoldOutcomeForm = ({ notice, onSaved, onCancel, onRefresh }) => {
  const [values, setValues] = useState(() => Object.fromEntries(Object.keys(OUTCOME_LABELS).map((field) => [field, notice[field] || ''])));
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await axios.put(`${API}/hold-notices/${notice.id}/outcome`, { ...values, expected_version: notice.outcome_version || 0 });
      toast.success('Hold outcome saved');
      onSaved(response.data);
    } catch (error) {
      const detail = error.response?.data?.detail;
      toast.error(Array.isArray(detail) ? detail.map((item) => item.msg).join('; ') : detail || 'Unable to save hold outcome');
      if (error.response?.status === 409) { setConflict(true); await onRefresh(); }
    } finally { setSaving(false); }
  };
  return <form onSubmit={save} className="space-y-5">
    <div className="rounded-md bg-muted p-3 text-sm">
      <p className="font-medium">{notice.ingredient_name} — {notice.rm_number}</p>
      <p>Our batch: {notice.our_batch || '-'} · Vendor batch: {notice.vendor_batch || '-'}</p>
      <p>Delivered: {notice.quantity_delivered || '-'} on {formatUKDate(notice.date_delivered)} · On hold: {notice.quantity}</p>
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      {Object.entries(OUTCOME_LABELS).map(([field, label]) => <div key={field} className={field.startsWith('quantity_') ? 'space-y-2' : 'space-y-2 md:col-span-2'}>
        <Label htmlFor={`outcome-${field}`}>{label}</Label>
        {field.startsWith('quantity_')
          ? <Input id={`outcome-${field}`} value={values[field]} onChange={(e) => setValues((current) => ({ ...current, [field]: e.target.value }))} maxLength={120} placeholder="e.g. 50 kg, or 0 if none" />
          : <Textarea id={`outcome-${field}`} value={values[field]} onChange={(e) => setValues((current) => ({ ...current, [field]: e.target.value }))} maxLength={3000} rows={4} />}
      </div>)}
    </div>
    {!!notice.outcome_history?.length && <details className="rounded-md border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Outcome History</summary>
      <div className="mt-3 space-y-3">{[...notice.outcome_history].reverse().map((entry) => <div key={entry.id} className="border-t pt-2">
        <p className="text-muted-foreground">{entry.updated_by_name} · {formatUKDateTime(entry.updated_at)}</p>
        {Object.entries(entry.changes || {}).map(([field, change]) => <p key={field} className="whitespace-pre-wrap break-words"><strong>{OUTCOME_LABELS[field]}:</strong> {change.before || '(blank)'} → {change.after || '(blank)'}</p>)}
      </div>)}</div>
    </details>}
    {conflict && <p role="alert" className="text-sm text-destructive">This hold has changed. Close and reopen it to see the latest outcome before saving.</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button type="submit" disabled={saving || conflict}>{saving ? 'Saving...' : 'Save Outcome'}</Button></div>
  </form>;
};

const DistributionLists = ({ lists, companies, isSystemAdmin, onChanged }) => {
  const [name, setName] = useState('');
  const [recipients, setRecipients] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [saving, setSaving] = useState(false);

  const parsedRecipients = useMemo(() => recipients.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean), [recipients]);

  const createList = async (event) => {
    event.preventDefault();
    if (isSystemAdmin && !companyId) return toast.error('Select a company');
    if (parsedRecipients.length === 0) return toast.error('Add at least one email address');
    setSaving(true);
    try {
      const response = await axios.post(`${API}/distribution-lists`, {
        name,
        recipients: parsedRecipients,
        ...(isSystemAdmin ? { company_id: companyId } : {}),
      });
      toast.success(`Distribution list “${response.data.name}” created`);
      setName('');
      setRecipients('');
      onChanged();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Unable to create distribution list');
    } finally {
      setSaving(false);
    }
  };

  const deleteList = async (list) => {
    if (!window.confirm(`Delete distribution list “${list.name}”?`)) return;
    try {
      await axios.delete(`${API}/distribution-lists/${list.id}`);
      toast.success('Distribution list deleted');
      onChanged();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Unable to delete distribution list');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" />New Distribution List</CardTitle><CardDescription>Create a reusable group once, then send future notices to the whole group in one click.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={createList} className="space-y-4">
            {isSystemAdmin && (
              <div className="space-y-2"><Label>Company</Label><Select value={companyId} onValueChange={setCompanyId}><SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger><SelectContent>{companies.map((company) => <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>)}</SelectContent></Select></div>
            )}
            <div className="space-y-2"><Label>List Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Technical + Warehouse + Production" required /></div>
            <div className="space-y-2"><Label>Email Addresses</Label><Textarea value={recipients} onChange={(e) => setRecipients(e.target.value)} rows={8} placeholder={'technical@example.com\nwarehouse@example.com\nproduction@example.com'} required /><p className="text-xs text-muted-foreground">Enter one per line, or separate addresses with commas or semicolons.</p></div>
            <Button type="submit" className="w-full" disabled={saving}><Users className="mr-2 h-4 w-4" />{saving ? 'Saving...' : 'Save Distribution List'}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Saved Distribution Lists</CardTitle><CardDescription>{lists.length} saved list{lists.length === 1 ? '' : 's'}</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {lists.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">No distribution lists yet.</div> : lists.map((list) => (
            <div key={list.id} className="rounded-lg border p-4 flex items-start justify-between gap-4">
              <div className="min-w-0"><p className="font-medium">{list.name}</p><p className="mt-1 text-sm text-muted-foreground">{list.recipients?.length || 0} recipient{list.recipients?.length === 1 ? '' : 's'}</p><p className="mt-2 text-xs text-muted-foreground break-words">{(list.recipients || []).join(' · ')}</p></div>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteList(list)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

const RouteEditor = ({ route, onChanged }) => {
  const [name, setName] = useState(route.name);
  const [colour, setColour] = useState(route.color_hex);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(route.name);
    setColour(route.color_hex);
  }, [route.name, route.color_hex]);

  const save = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/disposal-routes/${route.id}`, { name, color_hex: colour });
      toast.success('Disposal route updated');
      onChanged();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Unable to update disposal route');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete disposal route “${route.name}”?`)) return;
    try {
      await axios.delete(`${API}/disposal-routes/${route.id}`);
      toast.success('Disposal route deleted');
      onChanged();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Unable to delete disposal route');
    }
  };

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">{route.company_name || route.name}</p>
          {route.company_name && <p className="text-xs text-muted-foreground">{route.name}</p>}
        </div>
        {route.is_default && <Badge variant="secondary">Default</Badge>}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_145px]">
        <div className="space-y-1"><Label className="text-xs">Route Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1">
          <Label className="text-xs">Form Colour</Label>
          <div className="flex items-center gap-2">
            <Input type="color" value={colour} onChange={(e) => setColour(e.target.value.toUpperCase())} className="h-10 w-14 p-1" />
            <Input value={colour} onChange={(e) => setColour(e.target.value.toUpperCase())} className="font-mono text-xs" />
          </div>
        </div>
      </div>
      <div className="rounded-md border px-3 py-2 text-center font-bold" style={{ backgroundColor: colour, color: route.text_color }}>
        {name || 'Disposal Route'}
      </div>
      <div className="flex justify-end gap-2">
        {!route.is_default && <Button variant="ghost" className="text-destructive" onClick={remove}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>}
        <Button onClick={save} disabled={saving || !name.trim()}><Save className="mr-2 h-4 w-4" />{saving ? 'Saving...' : 'Save'}</Button>
      </div>
    </div>
  );
};

const DisposalRouteConfig = ({ routes, companies, isSystemAdmin, onChanged }) => {
  const [name, setName] = useState('');
  const [colour, setColour] = useState('#0EA5E9');
  const [companyId, setCompanyId] = useState('');
  const [saving, setSaving] = useState(false);

  const createRoute = async (event) => {
    event.preventDefault();
    if (isSystemAdmin && !companyId) return toast.error('Select a company');
    setSaving(true);
    try {
      await axios.post(`${API}/disposal-routes`, {
        name,
        color_hex: colour,
        ...(isSystemAdmin ? { company_id: companyId } : {}),
      });
      toast.success('Disposal route created');
      setName('');
      setColour('#0EA5E9');
      onChanged();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Unable to create disposal route');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)]">
      <Card>
        <CardHeader>
          <CardTitle>New Disposal Route</CardTitle>
          <CardDescription>Add another disposal category without changing code. The selected colour is used automatically on the factory PDF.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={createRoute} className="space-y-4">
            {isSystemAdmin && (
              <div className="space-y-2"><Label>Company</Label><Select value={companyId} onValueChange={setCompanyId}><SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger><SelectContent>{companies.map((company) => <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>)}</SelectContent></Select></div>
            )}
            <div className="space-y-2"><Label>Route Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Animal Feed" required /></div>
            <div className="space-y-2">
              <Label>Route Colour</Label>
              <div className="flex items-center gap-3">
                <Input type="color" value={colour} onChange={(e) => setColour(e.target.value.toUpperCase())} className="h-11 w-16 p-1" />
                <Input value={colour} onChange={(e) => setColour(e.target.value.toUpperCase())} className="font-mono" />
              </div>
            </div>
            <div className="rounded-md border px-4 py-4 text-center font-bold" style={{ backgroundColor: colour }}>PDF colour preview</div>
            <Button type="submit" className="w-full" disabled={saving || !name.trim()}><Plus className="mr-2 h-4 w-4" />{saving ? 'Creating...' : 'Create Route'}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Disposal Route Categories</CardTitle>
          <CardDescription>SugaRich, Return to Supplier, General Waste and Recycling are preloaded and can be recoloured or renamed. Default routes cannot be deleted.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {routes.map((route) => <RouteEditor key={route.id} route={route} onChanged={onChanged} />)}
        </CardContent>
      </Card>
    </div>
  );
};

const HoldDisposal = () => {
  const { user } = useAuth();
  const [holds, setHolds] = useState([]);
  const [disposals, setDisposals] = useState([]);
  const [distributionLists, setDistributionLists] = useState([]);
  const [disposalRoutes, setDisposalRoutes] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewTarget, setViewTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [outcomeTarget, setOutcomeTarget] = useState(null);
  const [sourceHold, setSourceHold] = useState(null);
  const [emailTarget, setEmailTarget] = useState(null);
  const [emailListId, setEmailListId] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailing, setEmailing] = useState(false);

  const isSystemAdmin = user?.role === 'system_admin';
  const isAdminUser = ['system_admin', 'company_admin', 'admin'].includes(user?.role);

  const fetchData = async () => {
    try {
      const calls = [
        axios.get(`${API}/hold-notices`),
        axios.get(`${API}/disposal-notices`),
        axios.get(`${API}/distribution-lists`),
        axios.get(`${API}/disposal-routes`),
      ];
      if (isSystemAdmin) calls.push(axios.get(`${process.env.REACT_APP_BACKEND_URL}/api/companies`));
      const [holdsRes, disposalsRes, listsRes, routesRes, companiesRes] = await Promise.all(calls);
      setHolds(holdsRes.data);
      setDisposals(disposalsRes.data);
      setDistributionLists(listsRes.data);
      setDisposalRoutes(routesRes.data);
      if (companiesRes) setCompanies(companiesRes.data);
    } catch (error) {
      toast.error('Failed to load hold and disposal records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const created = (type) => (notice) => {
    if (type === 'hold') setHolds((current) => [notice, ...current]);
    else setDisposals((current) => [notice, ...current]);
  };

  const updateNoticeInList = (type, notice) => {
    const setter = type === 'hold' ? setHolds : setDisposals;
    setter((current) => current.map((item) => item.id === notice.id ? notice : item));
  };

  const loadNotice = async (type, notice, mode) => {
    const endpoint = type === 'hold' ? 'hold-notices' : 'disposal-notices';
    try {
      const response = await axios.get(`${API}/${endpoint}/${notice.id}`);
      if (mode === 'edit') setEditTarget({ type, notice: response.data });
      else setViewTarget({ type, notice: response.data });
    } catch (error) {
      if (error.response?.status === 404 && notice?.id) {
        if (mode === 'edit') setEditTarget({ type, notice });
        else setViewTarget({ type, notice });
        toast.info('Opened the loaded notice while the server update completes');
        return;
      }
      toast.error(error.response?.data?.detail || 'Unable to open notice');
    }
  };

  const downloadPdf = async (type, notice) => {
    const endpoint = type === 'hold' ? 'hold-notices' : 'disposal-notices';
    try {
      const response = await axios.get(`${API}/${endpoint}/${notice.id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = notice.pdf_filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(await pdfErrorMessage(error, 'Failed to download notice PDF'));
    }
  };

  const openEmail = (type, notice) => {
    if (distributionLists.length === 0) {
      toast.error('Create a distribution list first');
      return;
    }
    setEmailTarget({ type, notice });
    setEmailListId('');
    setEmailMessage('');
  };

  const sendEmail = async () => {
    if (!emailTarget || !emailListId) return toast.error('Select a distribution list');
    setEmailing(true);
    try {
      const endpoint = emailTarget.type === 'hold' ? 'hold-notices' : 'disposal-notices';
      const response = await axios.post(`${API}/${endpoint}/${emailTarget.notice.id}/email`, {
        distribution_list_id: emailListId,
        message: emailMessage || null,
      });
      toast.success(response.data.message);
      setEmailTarget(null);
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Unable to email notice');
    } finally {
      setEmailing(false);
    }
  };

  if (loading) return <div className="py-16 text-center text-muted-foreground">Loading hold and disposal records...</div>;

  return (
    <div className="space-y-6" data-testid="hold-disposal-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Hold & Disposal</h1>
        <p className="mt-1 text-muted-foreground">Raise controlled hold/disposal notices, generate factory PDFs and distribute them by email.</p>
      </div>

      <Tabs defaultValue="hold" className="space-y-6">
        <TabsList className={`grid h-auto w-full grid-cols-2 gap-1 p-1 ${isAdminUser ? 'max-w-4xl sm:grid-cols-4' : 'max-w-2xl sm:grid-cols-3'}`}>
          <TabsTrigger value="hold" className="h-full min-w-0 whitespace-normal px-2 py-2 text-center leading-tight"><AlertTriangle className="mr-2 hidden h-4 w-4 shrink-0 sm:block" />Hold Notices</TabsTrigger>
          <TabsTrigger value="disposal" className="h-full min-w-0 whitespace-normal px-2 py-2 text-center leading-tight"><PackageX className="mr-2 hidden h-4 w-4 shrink-0 sm:block" />Disposal Notices</TabsTrigger>
          <TabsTrigger value="lists" className="h-full min-w-0 whitespace-normal px-2 py-2 text-center leading-tight"><Users className="mr-2 hidden h-4 w-4 shrink-0 sm:block" />Distribution Lists</TabsTrigger>
          {isAdminUser && <TabsTrigger value="routes" className="h-full min-w-0 whitespace-normal px-2 py-2 text-center leading-tight"><Settings className="mr-2 hidden h-4 w-4 shrink-0 sm:block" />Disposal Routes</TabsTrigger>}
        </TabsList>

        <TabsContent value="hold" className="space-y-6">
          <NoticeForm type="hold" companies={companies} isSystemAdmin={isSystemAdmin} disposalRoutes={disposalRoutes} onCreated={created('hold')} />
          <NoticeHistory type="hold" notices={holds} onView={(type, notice) => loadNotice(type, notice, 'view')} onEdit={(type, notice) => loadNotice(type, notice, 'edit')} onDownload={downloadPdf} onEmail={openEmail} onDispose={setSourceHold} onOutcome={setOutcomeTarget} disposals={disposals} user={user} isAdminUser={isAdminUser} />
        </TabsContent>

        <TabsContent value="disposal" className="space-y-6">
          <DisposalFromHoldCard holds={holds} disposals={disposals} onStart={setSourceHold} />
          <NoticeForm type="disposal" companies={companies} isSystemAdmin={isSystemAdmin} disposalRoutes={disposalRoutes} onCreated={created('disposal')} />
          <NoticeHistory type="disposal" notices={disposals} onView={(type, notice) => loadNotice(type, notice, 'view')} onEdit={(type, notice) => loadNotice(type, notice, 'edit')} onDownload={downloadPdf} onEmail={openEmail} user={user} isAdminUser={isAdminUser} />
        </TabsContent>

        <TabsContent value="lists">
          <DistributionLists lists={distributionLists} companies={companies} isSystemAdmin={isSystemAdmin} onChanged={fetchData} />
        </TabsContent>

        {isAdminUser && (
          <TabsContent value="routes">
            <DisposalRouteConfig routes={disposalRoutes} companies={companies} isSystemAdmin={isSystemAdmin} onChanged={fetchData} />
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={!!viewTarget} onOpenChange={(open) => !open && setViewTarget(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>{viewTarget?.type === 'disposal' ? 'Disposal' : 'Hold'} Notice — {viewTarget?.notice?.reference}</DialogTitle><DialogDescription>Complete controlled notice record. No download or email is required.</DialogDescription></DialogHeader>
          {viewTarget && <NoticeViewer
            type={viewTarget.type}
            notice={viewTarget.notice}
            canEdit={isAdminUser || viewTarget.notice.created_by_id === user?.id}
            onClose={() => setViewTarget(null)}
            onEdit={() => { setEditTarget(viewTarget); setViewTarget(null); }}
            onDispose={viewTarget.type === 'hold' && !disposals.some((notice) => notice.source_hold_id === viewTarget.notice.id) ? () => { setSourceHold(viewTarget.notice); setViewTarget(null); } : null}
          />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto p-0">
          <DialogHeader className="sr-only"><DialogTitle>Edit {editTarget?.type === 'disposal' ? 'Disposal' : 'Hold'} Notice</DialogTitle><DialogDescription>Update the controlled notice and record the reason for the change.</DialogDescription></DialogHeader>
          {editTarget && <NoticeForm
            key={`${editTarget.notice.id}-${editTarget.notice.record_version || 0}`}
            type={editTarget.type}
            editNotice={editTarget.notice}
            companies={companies}
            isSystemAdmin={isSystemAdmin}
            disposalRoutes={disposalRoutes}
            onCancel={() => setEditTarget(null)}
            onUpdated={(notice) => {
              updateNoticeInList(editTarget.type, notice);
              setEditTarget(null);
              setViewTarget({ type: editTarget.type, notice });
            }}
          />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!outcomeTarget} onOpenChange={(open) => !open && setOutcomeTarget(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Hold Outcome — {outcomeTarget?.reference}</DialogTitle><DialogDescription>Record quantities released or discarded and the investigation findings. Include units with each quantity.</DialogDescription></DialogHeader>
          {outcomeTarget && <HoldOutcomeForm key={outcomeTarget.id} notice={outcomeTarget} onCancel={() => setOutcomeTarget(null)} onRefresh={fetchData} onSaved={(notice) => {
            setHolds((current) => current.map((hold) => hold.id === notice.id ? notice : hold));
            setOutcomeTarget(null);
          }} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!sourceHold} onOpenChange={(open) => !open && setSourceHold(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create Disposal from Hold</DialogTitle><DialogDescription>The original hold is retained and linked to the disposal notice.</DialogDescription></DialogHeader>
          {sourceHold && <NoticeForm key={sourceHold.id} type="disposal" sourceHold={sourceHold} companies={companies} isSystemAdmin={isSystemAdmin} disposalRoutes={disposalRoutes} onCancel={() => setSourceHold(null)} onCreated={(notice) => { created('disposal')(notice); setSourceHold(null); }} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!emailTarget} onOpenChange={(open) => !open && setEmailTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email {emailTarget?.notice?.reference}</DialogTitle>
            <DialogDescription>The generated PDF will be sent separately to every address in the selected distribution list.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Distribution List</Label>
              <Select value={emailListId} onValueChange={setEmailListId}>
                <SelectTrigger><SelectValue placeholder="Select distribution list" /></SelectTrigger>
                <SelectContent>{distributionLists.map((list) => <SelectItem key={list.id} value={list.id}>{list.name} ({list.recipients?.length || 0})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Optional Email Message</Label><Textarea value={emailMessage} onChange={(e) => setEmailMessage(e.target.value)} rows={4} placeholder="Optional note to accompany the notice" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEmailTarget(null)}>Cancel</Button><Button onClick={sendEmail} disabled={emailing || !emailListId}><Send className="mr-2 h-4 w-4" />{emailing ? 'Sending...' : 'Send PDF'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default HoldDisposal;
