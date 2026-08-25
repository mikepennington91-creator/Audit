import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ScrollArea } from '../components/ui/scroll-area';
import { Separator } from '../components/ui/separator';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { toast } from 'sonner';
import { Download, FileSpreadsheet, Loader2, PackageCheck, Pencil, Plus, Printer, Trash2, Upload } from 'lucide-react';

const STORAGE_KEY = 'traceabilityDataV1';
const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const defaultConfig = {
  itemTypes: ['Ingredient', 'Packaging', 'Additive'],
  packagingTypes: ['Bag', 'Box', 'Pallet'],
};

const emptyData = {
  rawIntakes: [],
  finishedBatches: [],
  materialUsage: [],
  config: defaultConfig,
};

const Traceability = () => {
  const { hasFeature } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [data, setData] = useState(emptyData);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [dispatches, setDispatches] = useState([]);
  const [dispatchForm, setDispatchForm] = useState({ customer: '', quantity: '', dispatchDate: '', reference: '', notes: '' });
  const [finishedFilter, setFinishedFilter] = useState('');
  const [finishedStatusFilter, setFinishedStatusFilter] = useState('all');
  const [editBatchOpen, setEditBatchOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState(null);
  const [editBatchForm, setEditBatchForm] = useState({});
  const [editReason, setEditReason] = useState('');
  const [editHistory, setEditHistory] = useState([]);
  const [selectedExportTypes, setSelectedExportTypes] = useState({ raw: true, finished: true, usage: true });
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');
  const [activeTab, setActiveTab] = useState('intake');
  const [itemTypeDraft, setItemTypeDraft] = useState('');
  const [packagingTypeDraft, setPackagingTypeDraft] = useState('');
  const [finishedTraceCode, setFinishedTraceCode] = useState('');
  const [rawTraceCode, setRawTraceCode] = useState('');
  const [dateTraceType, setDateTraceType] = useState('finished');
  const [dateTraceStart, setDateTraceStart] = useState('');
  const [dateTraceEnd, setDateTraceEnd] = useState('');
  const [rawForm, setRawForm] = useState({
    intakeDate: '',
    supplierName: '',
    materialName: '',
    bestBeforeDate: '',
    sweetdreamsBatchCode: '',
    supplierBatchCode: '',
    palletNumber: '',
    numberOfCases: '',
    totalWeightKg: '',
    itemType: '',
    packagingType: '',
    packagingSku: '',
    unitsPerPallet: '',
  });
  const [finishedForm, setFinishedForm] = useState({
    productionDate: '',
    finishedProduct: '',
    finishedBatchCode: '',
    unitsProduced: '',
    lineNumber: '',
    bestBeforeDate: '',
    releaseStatus: 'Quarantine',
    palletRange: '',
  });
  const [usageForm, setUsageForm] = useState({
    usageDate: '',
    sweetdreamsBatchCode: '',
    palletNumber: '',
    finishedBatchCode: '',
    quantityUsedKg: '',
    quantityWastedKg: '',
    unitsUsed: '',
    unitsWasted: '',
  });

  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      let legacyData = null;
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          legacyData = JSON.parse(stored);
        } catch (error) {
          console.error('Failed to parse legacy traceability data', error);
        }
      }
      try {
        const response = await axios.get(`${API}/traceability/records`);
        let sharedData = response.data;
        const sharedCount = sharedData.rawIntakes.length + sharedData.finishedBatches.length + sharedData.materialUsage.length;
        const legacyCount = legacyData
          ? (legacyData.rawIntakes?.length || 0) + (legacyData.finishedBatches?.length || 0) + (legacyData.materialUsage?.length || 0)
          : 0;
        if (sharedCount === 0 && legacyCount > 0) {
          const migration = await axios.post(`${API}/traceability/records/migrate-local`, legacyData);
          sharedData = migration.data;
          if (migration.data.migrated_count > 0) {
            toast.success(`${migration.data.migrated_count} existing traceability records moved to shared storage`);
          }
        }
        if (!cancelled) setData({ ...emptyData, ...sharedData });
      } catch (error) {
        console.error('Failed to load traceability data', error);
        if (!cancelled && legacyData) setData({ ...emptyData, ...legacyData });
        toast.error(error.response?.data?.detail || 'Failed to load shared traceability data');
      } finally {
        if (!cancelled) setDataLoaded(true);
      }
    };
    loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const hashValue = location.hash.replace('#', '');
    const validTabs = ['intake', 'finished', 'usage', 'reports', 'config'];
    if (hashValue && validTabs.includes(hashValue)) {
      setActiveTab(hashValue);
    }
  }, [location.hash]);

  useEffect(() => {
    if (dataLoaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data, dataLoaded]);

  const saveConfig = async config => {
    try {
      const response = await axios.put(`${API}/traceability/config`, config);
      setData(prev => ({ ...prev, config: response.data }));
      return true;
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save traceability configuration');
      return false;
    }
  };

  const handleAddItemType = async () => {
    const trimmed = itemTypeDraft.trim();
    if (!trimmed) return;
    if (data.config.itemTypes.includes(trimmed)) {
      toast.error('Item type already exists');
      return;
    }
    const saved = await saveConfig({ ...data.config, itemTypes: [...data.config.itemTypes, trimmed] });
    if (saved) setItemTypeDraft('');
  };

  const handleAddPackagingType = async () => {
    const trimmed = packagingTypeDraft.trim();
    if (!trimmed) return;
    if (data.config.packagingTypes.includes(trimmed)) {
      toast.error('Packaging type already exists');
      return;
    }
    const saved = await saveConfig({ ...data.config, packagingTypes: [...data.config.packagingTypes, trimmed] });
    if (saved) setPackagingTypeDraft('');
  };

  const removeConfigValue = async (field, value) => {
    await saveConfig({ ...data.config, [field]: data.config[field].filter(item => item !== value) });
  };

  const addRawIntake = async () => {
    if (!rawForm.intakeDate || !rawForm.materialName || !rawForm.sweetdreamsBatchCode) {
      toast.error('Intake date, material name, and Sweetdreams batch code are required');
      return;
    }
    try {
      const response = await axios.post(`${API}/traceability/records/raw`, rawForm);
      setData(prev => ({ ...prev, rawIntakes: [response.data, ...prev.rawIntakes] }));
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save raw material intake');
      return;
    }
    setRawForm({
      intakeDate: '',
      supplierName: '',
      materialName: '',
      bestBeforeDate: '',
      sweetdreamsBatchCode: '',
      supplierBatchCode: '',
      palletNumber: '',
      numberOfCases: '',
      totalWeightKg: '',
      itemType: '',
      packagingType: '',
      packagingSku: '',
      unitsPerPallet: '',
    });
    toast.success('Raw material intake saved');
  };

  const addFinishedBatch = async () => {
    if (!finishedForm.productionDate || !finishedForm.finishedProduct || !finishedForm.finishedBatchCode) {
      toast.error('Production date, finished product, and batch code are required');
      return;
    }
    try {
      const endpoint = finishedForm.palletRange.trim()
        ? `${API}/traceability/records/finished/pallets`
        : `${API}/traceability/records/finished`;
      const response = await axios.post(endpoint, finishedForm);
      const created = Array.isArray(response.data) ? response.data : [response.data];
      setData(prev => ({ ...prev, finishedBatches: [...created, ...prev.finishedBatches] }));
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save finished batch');
      return;
    }
    setFinishedForm({
      productionDate: '',
      finishedProduct: '',
      finishedBatchCode: '',
      unitsProduced: '',
      lineNumber: '',
      bestBeforeDate: '',
      releaseStatus: 'Quarantine',
      palletRange: '',
    });
    toast.success(finishedForm.palletRange.trim() ? 'Finished pallets saved' : 'Finished batch saved');
  };

  const updateBatchStatus = async (batch, releaseStatus) => {
    try {
      const response = await axios.put(`${API}/traceability/finished/${batch.id}/status`, { releaseStatus });
      setData(prev => ({
        ...prev,
        finishedBatches: prev.finishedBatches.map(item => item.id === batch.id ? response.data : item),
      }));
      toast.success(`Batch marked ${releaseStatus}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update batch status');
    }
  };

  const openDispatch = async (batch) => {
    setSelectedBatch(batch);
    setDispatchOpen(true);
    setDispatchForm({ customer: '', quantity: '', dispatchDate: '', reference: '', notes: '' });
    try {
      const response = await axios.get(`${API}/traceability/finished/${batch.id}/dispatches`);
      setDispatches(response.data);
    } catch (error) {
      setDispatches([]);
      toast.error(error.response?.data?.detail || 'Failed to load dispatch history');
    }
  };

  const addDispatch = async (event) => {
    event.preventDefault();
    try {
      const response = await axios.post(`${API}/traceability/finished/${selectedBatch.id}/dispatches`, {
        ...dispatchForm,
        quantity: Number(dispatchForm.quantity),
      });
      setDispatches(prev => [response.data, ...prev]);
      setDispatchForm({ customer: '', quantity: '', dispatchDate: '', reference: '', notes: '' });
      toast.success('Dispatch recorded');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to record dispatch');
    }
  };

  const openBatchEdit = async (batch) => {
    setEditingBatch(batch);
    setEditBatchForm({
      productionDate: batch.productionDate || '', finishedProduct: batch.finishedProduct || '',
      finishedBatchCode: batch.finishedBatchCode || '', palletLabel: batch.palletLabel || '',
      unitsProduced: batch.unitsProduced || '', lineNumber: batch.lineNumber || '',
      bestBeforeDate: batch.bestBeforeDate || '',
    });
    setEditReason('');
    setEditBatchOpen(true);
    try {
      const response = await axios.get(`${API}/traceability/finished/${batch.id}/history`);
      setEditHistory(response.data);
    } catch {
      setEditHistory([]);
    }
  };

  const saveBatchCorrection = async (event) => {
    event.preventDefault();
    try {
      const response = await axios.put(`${API}/traceability/finished/${editingBatch.id}`, { fields: editBatchForm, reason: editReason });
      setData(prev => ({ ...prev, finishedBatches: prev.finishedBatches.map(item => item.id === editingBatch.id ? response.data : item) }));
      toast.success('Finished batch corrected and recorded in history');
      setEditBatchOpen(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to correct finished batch');
    }
  };

  const addUsage = async () => {
    if (!usageForm.usageDate || !usageForm.sweetdreamsBatchCode || !usageForm.finishedBatchCode) {
      toast.error('Usage date, Sweetdreams batch, and finished batch are required');
      return;
    }
    try {
      const response = await axios.post(`${API}/traceability/records/usage`, usageForm);
      setData(prev => ({ ...prev, materialUsage: [response.data, ...prev.materialUsage] }));
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save material usage');
      return;
    }
    setUsageForm({
      usageDate: '',
      sweetdreamsBatchCode: '',
      palletNumber: '',
      finishedBatchCode: '',
      quantityUsedKg: '',
      quantityWastedKg: '',
      unitsUsed: '',
      unitsWasted: '',
    });
    toast.success('Material usage saved');
  };

  const removeRow = async (collection, id) => {
    const recordTypes = { rawIntakes: 'raw', finishedBatches: 'finished', materialUsage: 'usage' };
    try {
      await axios.delete(`${API}/traceability/records/${recordTypes[collection]}/${id}`);
      setData(prev => ({ ...prev, [collection]: prev[collection].filter(item => item.id !== id) }));
      toast.success('Traceability record deleted');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete traceability record');
    }
  };

  const downloadBulkWorkbook = async () => {
    const dataTypes = Object.entries(selectedExportTypes)
      .filter(([, selected]) => selected)
      .map(([type]) => type);
    if (dataTypes.length === 0) {
      toast.error('Select at least one traceability data type');
      return;
    }
    if (exportDateFrom && exportDateTo && exportDateFrom > exportDateTo) {
      toast.error('Start date cannot be after end date');
      return;
    }
    setDownloadBusy(true);
    try {
      const response = await axios.post(
        `${API}/traceability/bulk-export`,
        { data_types: dataTypes, date_from: exportDateFrom || null, date_to: exportDateTo || null },
        { responseType: 'blob' },
      );
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `traceability_bulk_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setDownloadOpen(false);
      toast.success('Excel workbook downloaded — use it as the bulk upload template');
    } catch (error) {
      let message = 'Failed to download traceability workbook';
      if (error.response?.data instanceof Blob) {
        try {
          const payload = JSON.parse(await error.response.data.text());
          message = payload.detail || message;
        } catch (_) {
          // Keep the generic message when a binary error body cannot be decoded.
        }
      }
      toast.error(message);
    } finally {
      setDownloadBusy(false);
    }
  };

  const uploadBulkWorkbook = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      toast.error('Choose an .xlsx Excel workbook');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Workbook must be 5 MB or smaller');
      return;
    }
    setUploadBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await axios.post(`${API}/traceability/bulk-import`, formData);
      setImportResult(response.data);
      const refreshed = await axios.get(`${API}/traceability/records`);
      setData({ ...emptyData, ...refreshed.data });
      toast.success(`${response.data.imported_total} records imported`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to upload traceability workbook');
    } finally {
      setUploadBusy(false);
    }
  };

  const exportCsv = (filename, rows) => {
    if (!rows.length) {
      toast.error('No data to export');
      return;
    }
    const header = Object.keys(rows[0]);
    const csv = [header.join(',')]
      .concat(
        rows.map(row =>
          header
            .map(key => `"${String(row[key] ?? '').replace(/"/g, '""')}"`)
            .join(','),
        ),
      )
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    toast.success('Export generated');
  };

  const exportIntakes = () => {
    const rows = data.rawIntakes.map(({ id, ...rest }) => rest);
    exportCsv('raw_material_intakes.csv', rows);
  };

  const printIntakes = () => {
    if (!data.rawIntakes.length) {
      toast.error('No intake entries to print');
      return;
    }

    const columns = [
      { label: 'Intake Date', key: 'intakeDate' },
      { label: 'Supplier Name', key: 'supplierName' },
      { label: 'Material Name', key: 'materialName' },
      { label: 'Best Before Date', key: 'bestBeforeDate' },
      { label: 'Sweetdreams Batch Code', key: 'sweetdreamsBatchCode' },
      { label: 'Supplier Batch Code', key: 'supplierBatchCode' },
      { label: 'Pallet Number', key: 'palletNumber' },
      { label: 'Number of Cases', key: 'numberOfCases' },
      { label: 'Total Weight KG', key: 'totalWeightKg' },
      { label: 'Item Type', key: 'itemType' },
      { label: 'Packaging Type', key: 'packagingType' },
      { label: 'Packaging SKU', key: 'packagingSku' },
      { label: 'Units per Pallet', key: 'unitsPerPallet' },
    ];

    const escapeHtml = value =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;');

    const tableRows = data.rawIntakes
      .map(row => {
        const cells = columns
          .map(column => `<td>${escapeHtml(row[column.key])}</td>`)
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');

    const tableHeader = columns.map(column => `<th>${column.label}</th>`).join('');

    const html = `
      <html>
        <head>
          <title>Raw Material Intake</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; }
            h1 { font-size: 20px; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
            th { background: #f5f5f5; }
          </style>
        </head>
        <body>
          <h1>Raw Material Intake</h1>
          <table>
            <thead>
              <tr>${tableHeader}</tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </body>
      </html>
    `;

    const printWindow = window.open('', 'PrintIntakes', 'width=900,height=700');
    if (!printWindow) {
      toast.error('Popup blocked. Please allow popups to print.');
      return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const finishedTraceRows = useMemo(() => {
    if (!finishedTraceCode.trim()) return [];
    const normalized = finishedTraceCode.trim().toLowerCase();
    const matchingUsage = data.materialUsage.filter(
      usage => usage.finishedBatchCode.toLowerCase() === normalized,
    );

    return matchingUsage.map(usage => {
      const intake = data.rawIntakes.find(
        item =>
          item.sweetdreamsBatchCode.toLowerCase() === usage.sweetdreamsBatchCode.toLowerCase() &&
          (item.palletNumber || '') === (usage.palletNumber || ''),
      );
      return {
        usageDate: usage.usageDate,
        sweetdreamsBatchCode: usage.sweetdreamsBatchCode,
        palletNumber: usage.palletNumber,
        materialName: intake?.materialName || 'Unknown',
        supplierName: intake?.supplierName || '-',
        itemType: intake?.itemType || '-',
        quantityUsedKg: usage.quantityUsedKg,
        quantityWastedKg: usage.quantityWastedKg,
        unitsUsed: usage.unitsUsed,
        unitsWasted: usage.unitsWasted,
      };
    });
  }, [data.materialUsage, data.rawIntakes, finishedTraceCode]);

  const rawTraceRows = useMemo(() => {
    if (!rawTraceCode.trim()) return [];
    const normalized = rawTraceCode.trim().toLowerCase();
    const matchingUsage = data.materialUsage.filter(
      usage => usage.sweetdreamsBatchCode.toLowerCase() === normalized,
    );

    return matchingUsage.map(usage => {
      const finished = data.finishedBatches.find(
        item => item.finishedBatchCode.toLowerCase() === usage.finishedBatchCode.toLowerCase(),
      );
      return {
        usageDate: usage.usageDate,
        finishedBatchCode: usage.finishedBatchCode,
        finishedProduct: finished?.finishedProduct || 'Unknown',
        productionDate: finished?.productionDate || '-',
        palletNumber: usage.palletNumber,
        quantityUsedKg: usage.quantityUsedKg,
        quantityWastedKg: usage.quantityWastedKg,
        unitsUsed: usage.unitsUsed,
        unitsWasted: usage.unitsWasted,
      };
    });
  }, [data.materialUsage, data.finishedBatches, rawTraceCode]);

  const dateTraceRows = useMemo(() => {
    if (!dateTraceStart || !dateTraceEnd) return [];
    const start = new Date(dateTraceStart);
    const end = new Date(dateTraceEnd);
    end.setHours(23, 59, 59, 999);

    if (dateTraceType === 'finished') {
      return data.finishedBatches
        .filter(batch => {
          const date = new Date(batch.productionDate);
          return date >= start && date <= end;
        })
        .map(batch => ({
          productionDate: batch.productionDate,
          finishedProduct: batch.finishedProduct,
          finishedBatchCode: batch.finishedBatchCode,
          unitsProduced: batch.unitsProduced,
          lineNumber: batch.lineNumber,
          bestBeforeDate: batch.bestBeforeDate,
        }));
    }

    return data.rawIntakes
      .filter(intake => {
        const date = new Date(intake.intakeDate);
        return date >= start && date <= end;
      })
      .map(intake => ({
        intakeDate: intake.intakeDate,
        materialName: intake.materialName,
        sweetdreamsBatchCode: intake.sweetdreamsBatchCode,
        palletNumber: intake.palletNumber,
        supplierName: intake.supplierName,
        itemType: intake.itemType,
        totalWeightKg: intake.totalWeightKg,
      }));
  }, [data.finishedBatches, data.rawIntakes, dateTraceEnd, dateTraceStart, dateTraceType]);

  const handleTabChange = value => {
    setActiveTab(value);
    navigate({ pathname: '/traceability', hash: `#${value}` }, { replace: true });
  };

  const filteredFinishedBatches = data.finishedBatches.filter(item => {
    const term = finishedFilter.trim().toLowerCase();
    const matchesText = !term || [
      item.productionDate, item.finishedProduct, item.finishedBatchCode,
      item.palletLabel, item.lineNumber, item.bestBeforeDate,
    ].some(value => String(value || '').toLowerCase().includes(term));
    const status = item.releaseStatus || 'Quarantine';
    return matchesText && (finishedStatusFilter === 'all' || status === finishedStatusFilter);
  });

  return (
    <div className="space-y-6" data-testid="traceability-page">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Traceability</h1>
          <p className="text-muted-foreground mt-1">
            Capture raw intake, production batches, and usage to generate traceability reports.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDownloadOpen(true)} disabled={!dataLoaded || downloadBusy}>
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Bulk Download
          </Button>
          {hasFeature('traceability_edit') && <>
            <Button onClick={() => fileInputRef.current?.click()} disabled={!dataLoaded || uploadBusy}>
              {uploadBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              {uploadBusy ? 'Uploading…' : 'Bulk Upload'}
            </Button>
            <input ref={fileInputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={uploadBulkWorkbook} />
          </>}
        </div>
      </div>

      <Dialog open={downloadOpen} onOpenChange={setDownloadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk download traceability</DialogTitle>
            <DialogDescription>
              Choose the records to include. The downloaded Excel workbook is also the template for bulk upload.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-3">
              {[
                ['raw', 'Raw Material Intake'],
                ['finished', 'Finished Batches'],
                ['usage', 'Material Usage'],
              ].map(([type, label]) => (
                <label key={type} className="flex items-center gap-3 rounded-md border p-3 cursor-pointer">
                  <Checkbox
                    checked={selectedExportTypes[type]}
                    onCheckedChange={checked => setSelectedExportTypes(prev => ({ ...prev, [type]: checked === true }))}
                  />
                  <span className="text-sm font-medium">{label}</span>
                </label>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="bulkDateFrom">From date (optional)</Label>
                <Input id="bulkDateFrom" type="date" value={exportDateFrom} onChange={event => setExportDateFrom(event.target.value)} />
              </div>
              <div>
                <Label htmlFor="bulkDateTo">To date (optional)</Label>
                <Input id="bulkDateTo" type="date" value={exportDateTo} onChange={event => setExportDateTo(event.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Existing rows keep their Record ID and will be skipped if uploaded again. Add new rows with a blank Record ID.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDownloadOpen(false)} disabled={downloadBusy}>Cancel</Button>
            <Button onClick={downloadBulkWorkbook} disabled={downloadBusy}>
              {downloadBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Download Excel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(importResult)} onOpenChange={open => !open && setImportResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk upload result</DialogTitle>
            <DialogDescription>
              Valid rows were imported. Existing exported records were safely skipped.
            </DialogDescription>
          </DialogHeader>
          {importResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-md border p-3"><div className="text-2xl font-semibold">{importResult.imported_total}</div><div className="text-xs text-muted-foreground">Imported</div></div>
                <div className="rounded-md border p-3"><div className="text-2xl font-semibold">{importResult.skipped}</div><div className="text-xs text-muted-foreground">Skipped</div></div>
                <div className="rounded-md border p-3"><div className="text-2xl font-semibold">{importResult.failed}</div><div className="text-xs text-muted-foreground">Failed</div></div>
              </div>
              {importResult.errors?.length > 0 && (
                <ScrollArea className="max-h-56 rounded-md border p-3">
                  <div className="space-y-2 text-sm">
                    {importResult.errors.map((error, index) => (
                      <div key={`${error.sheet}-${error.row}-${index}`}>
                        <span className="font-medium">{error.sheet}{error.row ? `, row ${error.row}` : ''}:</span>{' '}{error.message}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setImportResult(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList>
          <TabsTrigger value="intake">Raw Material Intake</TabsTrigger>
          <TabsTrigger value="finished">Finished Batches</TabsTrigger>
          <TabsTrigger value="usage">Material Usage</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          {hasFeature('traceability_edit') && <TabsTrigger value="config">Config</TabsTrigger>}
        </TabsList>

        <TabsContent value="intake" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Raw Material Intake</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="intakeDate">Intake Date</Label>
                  <Input
                    id="intakeDate"
                    type="date"
                    value={rawForm.intakeDate}
                    onChange={event => setRawForm(prev => ({ ...prev, intakeDate: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="supplierName">Supplier Name</Label>
                  <Input
                    id="supplierName"
                    value={rawForm.supplierName}
                    onChange={event => setRawForm(prev => ({ ...prev, supplierName: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="materialName">Material Name</Label>
                  <Input
                    id="materialName"
                    value={rawForm.materialName}
                    onChange={event => setRawForm(prev => ({ ...prev, materialName: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="bestBeforeDate">Best Before Date</Label>
                  <Input
                    id="bestBeforeDate"
                    type="date"
                    value={rawForm.bestBeforeDate}
                    onChange={event => setRawForm(prev => ({ ...prev, bestBeforeDate: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="sweetdreamsBatchCode">Sweetdreams Batch Code</Label>
                  <Input
                    id="sweetdreamsBatchCode"
                    value={rawForm.sweetdreamsBatchCode}
                    onChange={event => setRawForm(prev => ({ ...prev, sweetdreamsBatchCode: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="supplierBatchCode">Supplier Batch Code</Label>
                  <Input
                    id="supplierBatchCode"
                    value={rawForm.supplierBatchCode}
                    onChange={event => setRawForm(prev => ({ ...prev, supplierBatchCode: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="palletNumber">Pallet Number</Label>
                  <Input
                    id="palletNumber"
                    value={rawForm.palletNumber}
                    onChange={event => setRawForm(prev => ({ ...prev, palletNumber: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="numberOfCases">Number of Cases</Label>
                  <Input
                    id="numberOfCases"
                    type="number"
                    value={rawForm.numberOfCases}
                    onChange={event => setRawForm(prev => ({ ...prev, numberOfCases: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="totalWeightKg">Total Weight KG</Label>
                  <Input
                    id="totalWeightKg"
                    type="number"
                    value={rawForm.totalWeightKg}
                    onChange={event => setRawForm(prev => ({ ...prev, totalWeightKg: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="itemType">Item Type</Label>
                  <Select
                    value={rawForm.itemType}
                    onValueChange={value => setRawForm(prev => ({ ...prev, itemType: value }))}
                  >
                    <SelectTrigger id="itemType">
                      <SelectValue placeholder="Select item type" />
                    </SelectTrigger>
                    <SelectContent>
                      {data.config.itemTypes.map(type => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="packagingType">Packaging Type</Label>
                  <Select
                    value={rawForm.packagingType}
                    onValueChange={value => setRawForm(prev => ({ ...prev, packagingType: value }))}
                  >
                    <SelectTrigger id="packagingType">
                      <SelectValue placeholder="Select packaging type" />
                    </SelectTrigger>
                    <SelectContent>
                      {data.config.packagingTypes.map(type => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="packagingSku">Packaging SKU</Label>
                  <Input
                    id="packagingSku"
                    value={rawForm.packagingSku}
                    onChange={event => setRawForm(prev => ({ ...prev, packagingSku: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="unitsPerPallet">Units per Pallet</Label>
                  <Input
                    id="unitsPerPallet"
                    type="number"
                    value={rawForm.unitsPerPallet}
                    onChange={event => setRawForm(prev => ({ ...prev, unitsPerPallet: event.target.value }))}
                  />
                </div>
              </div>
              <div className="flex justify-end mt-4">
                <Button onClick={addRawIntake}>
                  <Plus className="w-4 h-4 mr-2" />
                  Save intake
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <CardTitle>Recent Intakes</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={exportIntakes}>
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
                <Button variant="outline" onClick={printIntakes}>
                  <Printer className="w-4 h-4 mr-2" />
                  Print
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="w-full">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>Sweetdreams Batch</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Pallet</TableHead>
                      <TableHead>Total Weight KG</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rawIntakes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground">
                          No intake entries yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.rawIntakes.map(item => (
                        <TableRow key={item.id}>
                          <TableCell>{item.intakeDate || '-'}</TableCell>
                          <TableCell>{item.materialName || '-'}</TableCell>
                          <TableCell>{item.sweetdreamsBatchCode || '-'}</TableCell>
                          <TableCell>{item.supplierName || '-'}</TableCell>
                          <TableCell>{item.palletNumber || '-'}</TableCell>
                          <TableCell>{item.totalWeightKg || '-'}</TableCell>
                          <TableCell className="text-right">
                            {hasFeature('traceability_edit') && (
                              <Button variant="ghost" size="sm" onClick={() => removeRow('rawIntakes', item.id)}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="finished" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Finished Product Batches</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="productionDate">Production Date</Label>
                  <Input
                    id="productionDate"
                    type="date"
                    value={finishedForm.productionDate}
                    onChange={event => setFinishedForm(prev => ({ ...prev, productionDate: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="finishedProduct">Finished Product</Label>
                  <Input
                    id="finishedProduct"
                    value={finishedForm.finishedProduct}
                    onChange={event => setFinishedForm(prev => ({ ...prev, finishedProduct: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="finishedBatchCode">Finished Batch Code</Label>
                  <Input
                    id="finishedBatchCode"
                    value={finishedForm.finishedBatchCode}
                    onChange={event => setFinishedForm(prev => ({ ...prev, finishedBatchCode: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="unitsProduced">Units Produced</Label>
                  <Input
                    id="unitsProduced"
                    type="number"
                    value={finishedForm.unitsProduced}
                    onChange={event => setFinishedForm(prev => ({ ...prev, unitsProduced: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="lineNumber">Line Number</Label>
                  <Input
                    id="lineNumber"
                    value={finishedForm.lineNumber}
                    onChange={event => setFinishedForm(prev => ({ ...prev, lineNumber: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="finishedBestBefore">Best Before Date</Label>
                  <Input
                    id="finishedBestBefore"
                    type="date"
                    value={finishedForm.bestBeforeDate}
                    onChange={event => setFinishedForm(prev => ({ ...prev, bestBeforeDate: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="palletRange">Pallet Labels (optional)</Label>
                  <Input id="palletRange" value={finishedForm.palletRange} onChange={event => setFinishedForm(prev => ({ ...prev, palletRange: event.target.value }))} placeholder="e.g. 1 - 7" />
                  <p className="text-xs text-muted-foreground mt-1">Leave blank for one normal finished-batch record.</p>
                </div>
                {hasFeature('traceability_release') && (
                  <div>
                    <Label>Initial Status</Label>
                    <Select value={finishedForm.releaseStatus} onValueChange={value => setFinishedForm(prev => ({ ...prev, releaseStatus: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Released">Released</SelectItem>
                        <SelectItem value="Quarantine">Quarantine</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              {!hasFeature('traceability_release') && <p className="text-sm text-muted-foreground mt-3">New finished batches will be placed in Quarantine until an authorised user releases them.</p>}
              <div className="flex justify-end mt-4">
                <Button onClick={addFinishedBatch}>
                  <Plus className="w-4 h-4 mr-2" />
                  Save batch
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Finished Batches ({filteredFinishedBatches.length})</CardTitle>
              <div className="grid sm:grid-cols-[1fr_220px] gap-3 pt-3">
                <Input value={finishedFilter} onChange={event => setFinishedFilter(event.target.value)} placeholder="Filter by product, batch, pallet, line or date..." />
                <Select value={finishedStatusFilter} onValueChange={setFinishedStatusFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="Released">Released</SelectItem><SelectItem value="Quarantine">Quarantine</SelectItem></SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="w-full max-h-[650px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Batch Code</TableHead>
                      <TableHead>Pallet</TableHead>
                      <TableHead>Units</TableHead>
                      <TableHead>Line</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Dispatch</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredFinishedBatches.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-muted-foreground">
                          No finished batches recorded yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredFinishedBatches.map(item => (
                        <TableRow key={item.id}>
                          <TableCell>{item.productionDate || '-'}</TableCell>
                          <TableCell>{item.finishedProduct || '-'}</TableCell>
                          <TableCell>{item.finishedBatchCode || '-'}</TableCell>
                          <TableCell>{item.palletLabel || '-'}</TableCell>
                          <TableCell>{item.unitsProduced || '-'}</TableCell>
                          <TableCell>{item.lineNumber || '-'}</TableCell>
                          <TableCell>
                            {hasFeature('traceability_release') ? (
                              <Select value={item.releaseStatus || 'Quarantine'} onValueChange={value => updateBatchStatus(item, value)}>
                                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="Released">Released</SelectItem><SelectItem value="Quarantine">Quarantine</SelectItem></SelectContent>
                              </Select>
                            ) : (
                              <Badge variant={(item.releaseStatus || 'Quarantine') === 'Released' ? 'default' : 'destructive'}>{item.releaseStatus || 'Quarantine'}</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button variant="outline" size="sm" onClick={() => openDispatch(item)}>
                              <PackageCheck className="w-4 h-4 mr-2" />Send / History
                            </Button>
                          </TableCell>
                          <TableCell className="text-right">
                            {hasFeature('traceability_edit') && <Button variant="ghost" size="sm" onClick={() => openBatchEdit(item)} title="Correct finished batch"><Pencil className="w-4 h-4" /></Button>}
                            {hasFeature('traceability_edit') && (
                              <Button variant="ghost" size="sm" onClick={() => removeRow('finishedBatches', item.id)}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <Dialog open={editBatchOpen} onOpenChange={setEditBatchOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Correct Finished Batch</DialogTitle><DialogDescription>Every change requires a reason and is permanently recorded.</DialogDescription></DialogHeader>
            <form onSubmit={saveBatchCorrection} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div><Label>Production Date</Label><Input type="date" value={editBatchForm.productionDate || ''} onChange={e => setEditBatchForm(prev => ({ ...prev, productionDate: e.target.value }))} /></div>
                <div><Label>Finished Product</Label><Input value={editBatchForm.finishedProduct || ''} onChange={e => setEditBatchForm(prev => ({ ...prev, finishedProduct: e.target.value }))} /></div>
                <div><Label>Batch Code</Label><Input value={editBatchForm.finishedBatchCode || ''} onChange={e => setEditBatchForm(prev => ({ ...prev, finishedBatchCode: e.target.value }))} /></div>
                <div><Label>Pallet Label</Label><Input value={editBatchForm.palletLabel || ''} onChange={e => setEditBatchForm(prev => ({ ...prev, palletLabel: e.target.value }))} /></div>
                <div><Label>Units Produced</Label><Input type="number" value={editBatchForm.unitsProduced || ''} onChange={e => setEditBatchForm(prev => ({ ...prev, unitsProduced: e.target.value }))} /></div>
                <div><Label>Line Number</Label><Input value={editBatchForm.lineNumber || ''} onChange={e => setEditBatchForm(prev => ({ ...prev, lineNumber: e.target.value }))} /></div>
                <div><Label>Best Before Date</Label><Input type="date" value={editBatchForm.bestBeforeDate || ''} onChange={e => setEditBatchForm(prev => ({ ...prev, bestBeforeDate: e.target.value }))} /></div>
              </div>
              <div><Label>Reason for Correction *</Label><Textarea value={editReason} onChange={e => setEditReason(e.target.value)} required placeholder="Explain why this record is being corrected..." /></div>
              <DialogFooter><Button type="submit">Save Correction</Button></DialogFooter>
            </form>
            <div className="space-y-3">
              <h3 className="font-semibold">Correction History</h3>
              {editHistory.length === 0 ? <p className="text-sm text-muted-foreground">No previous corrections.</p> : editHistory.map(entry => (
                <div key={entry.id} className="rounded-md border p-3 text-sm">
                  <div className="font-medium">{entry.reason}</div>
                  <div className="text-muted-foreground">{entry.edited_by_name} — {new Date(entry.edited_at).toLocaleString('en-GB')}</div>
                  <div className="mt-2 space-y-1">{Object.entries(entry.changes || {}).map(([field, change]) => <div key={field}><span className="font-medium">{field}:</span> {String(change.before ?? '-')} → {String(change.after ?? '-')}</div>)}</div>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Dispatch Finished Product</DialogTitle>
              <DialogDescription>{selectedBatch?.finishedProduct} — {selectedBatch?.finishedBatchCode}{selectedBatch?.palletLabel ? ` — Pallet ${selectedBatch.palletLabel}` : ''}</DialogDescription>
            </DialogHeader>
            {hasFeature('traceability_dispatch') && (selectedBatch?.releaseStatus || 'Quarantine') === 'Released' ? <form onSubmit={addDispatch} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div><Label>Customer / Destination</Label><Input value={dispatchForm.customer} onChange={e => setDispatchForm(prev => ({ ...prev, customer: e.target.value }))} required /></div>
                <div><Label>Quantity Sent</Label><Input type="number" min="0.01" step="0.01" value={dispatchForm.quantity} onChange={e => setDispatchForm(prev => ({ ...prev, quantity: e.target.value }))} required /></div>
                <div><Label>Dispatch Date</Label><Input type="date" value={dispatchForm.dispatchDate} onChange={e => setDispatchForm(prev => ({ ...prev, dispatchDate: e.target.value }))} required /></div>
                <div><Label>Delivery / Order Reference</Label><Input value={dispatchForm.reference} onChange={e => setDispatchForm(prev => ({ ...prev, reference: e.target.value }))} /></div>
              </div>
              <div><Label>Notes</Label><Textarea value={dispatchForm.notes} onChange={e => setDispatchForm(prev => ({ ...prev, notes: e.target.value }))} /></div>
              <DialogFooter><Button type="submit">Record Dispatch</Button></DialogFooter>
            </form> : <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              {(selectedBatch?.releaseStatus || 'Quarantine') !== 'Released' ? 'This batch is quarantined and cannot be dispatched.' : 'You can view dispatch history but do not have permission to record a dispatch.'}
            </p>}
            <div className="space-y-2">
              <h3 className="font-semibold">Dispatch History</h3>
              {dispatches.length === 0 ? <p className="text-sm text-muted-foreground">This batch has not been dispatched.</p> : (
                <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Quantity</TableHead><TableHead>Reference</TableHead></TableRow></TableHeader>
                  <TableBody>{dispatches.map(item => <TableRow key={item.id}><TableCell>{item.dispatchDate}</TableCell><TableCell>{item.customer}</TableCell><TableCell>{item.quantity}</TableCell><TableCell>{item.reference || '-'}</TableCell></TableRow>)}</TableBody>
                </Table>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <TabsContent value="usage" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Material Usage</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="usageDate">Usage Date</Label>
                  <Input
                    id="usageDate"
                    type="date"
                    value={usageForm.usageDate}
                    onChange={event => setUsageForm(prev => ({ ...prev, usageDate: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="usageSweetdreams">Sweetdreams Batch Code</Label>
                  <Input
                    id="usageSweetdreams"
                    value={usageForm.sweetdreamsBatchCode}
                    onChange={event => setUsageForm(prev => ({ ...prev, sweetdreamsBatchCode: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="usagePallet">Pallet Number</Label>
                  <Input
                    id="usagePallet"
                    value={usageForm.palletNumber}
                    onChange={event => setUsageForm(prev => ({ ...prev, palletNumber: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="usageFinishedBatch">Finished Batch Code</Label>
                  <Input
                    id="usageFinishedBatch"
                    value={usageForm.finishedBatchCode}
                    onChange={event => setUsageForm(prev => ({ ...prev, finishedBatchCode: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="quantityUsedKg">Quantity Used KG</Label>
                  <Input
                    id="quantityUsedKg"
                    type="number"
                    value={usageForm.quantityUsedKg}
                    onChange={event => setUsageForm(prev => ({ ...prev, quantityUsedKg: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="quantityWastedKg">Quantity Wasted KG</Label>
                  <Input
                    id="quantityWastedKg"
                    type="number"
                    value={usageForm.quantityWastedKg}
                    onChange={event => setUsageForm(prev => ({ ...prev, quantityWastedKg: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="unitsUsed">Units Used</Label>
                  <Input
                    id="unitsUsed"
                    type="number"
                    value={usageForm.unitsUsed}
                    onChange={event => setUsageForm(prev => ({ ...prev, unitsUsed: event.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="unitsWasted">Units Wasted</Label>
                  <Input
                    id="unitsWasted"
                    type="number"
                    value={usageForm.unitsWasted}
                    onChange={event => setUsageForm(prev => ({ ...prev, unitsWasted: event.target.value }))}
                  />
                </div>
              </div>
              <div className="flex justify-end mt-4">
                <Button onClick={addUsage}>
                  <Plus className="w-4 h-4 mr-2" />
                  Save usage
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Usage Entries</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="w-full">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Sweetdreams Batch</TableHead>
                      <TableHead>Pallet</TableHead>
                      <TableHead>Finished Batch</TableHead>
                      <TableHead>Used KG</TableHead>
                      <TableHead>Waste KG</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.materialUsage.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground">
                          No usage entries recorded yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.materialUsage.map(item => (
                        <TableRow key={item.id}>
                          <TableCell>{item.usageDate || '-'}</TableCell>
                          <TableCell>{item.sweetdreamsBatchCode || '-'}</TableCell>
                          <TableCell>{item.palletNumber || '-'}</TableCell>
                          <TableCell>{item.finishedBatchCode || '-'}</TableCell>
                          <TableCell>{item.quantityUsedKg || '-'}</TableCell>
                          <TableCell>{item.quantityWastedKg || '-'}</TableCell>
                          <TableCell className="text-right">
                            {hasFeature('traceability_edit') && (
                              <Button variant="ghost" size="sm" onClick={() => removeRow('materialUsage', item.id)}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Finished Goods Trace</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col md:flex-row gap-3 md:items-end">
                <div className="flex-1">
                  <Label htmlFor="finishedTrace">Finished Batch Code</Label>
                  <Input
                    id="finishedTrace"
                    value={finishedTraceCode}
                    onChange={event => setFinishedTraceCode(event.target.value)}
                    placeholder="Enter finished batch code"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={() => exportCsv('finished_goods_trace.csv', finishedTraceRows)}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
              </div>
              <Separator />
              <ScrollArea className="w-full">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Usage Date</TableHead>
                      <TableHead>Sweetdreams Batch</TableHead>
                      <TableHead>Pallet</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Item Type</TableHead>
                      <TableHead>Used KG</TableHead>
                      <TableHead>Waste KG</TableHead>
                      <TableHead>Units Used</TableHead>
                      <TableHead>Units Wasted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {finishedTraceRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-muted-foreground">
                          Enter a finished batch code to view results.
                        </TableCell>
                      </TableRow>
                    ) : (
                      finishedTraceRows.map((row, index) => (
                        <TableRow key={`${row.sweetdreamsBatchCode}-${index}`}>
                          <TableCell>{row.usageDate || '-'}</TableCell>
                          <TableCell>{row.sweetdreamsBatchCode || '-'}</TableCell>
                          <TableCell>{row.palletNumber || '-'}</TableCell>
                          <TableCell>{row.materialName || '-'}</TableCell>
                          <TableCell>{row.supplierName || '-'}</TableCell>
                          <TableCell>{row.itemType || '-'}</TableCell>
                          <TableCell>{row.quantityUsedKg || '-'}</TableCell>
                          <TableCell>{row.quantityWastedKg || '-'}</TableCell>
                          <TableCell>{row.unitsUsed || '-'}</TableCell>
                          <TableCell>{row.unitsWasted || '-'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Raw Material Trace</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col md:flex-row gap-3 md:items-end">
                <div className="flex-1">
                  <Label htmlFor="rawTrace">Sweetdreams Batch Code</Label>
                  <Input
                    id="rawTrace"
                    value={rawTraceCode}
                    onChange={event => setRawTraceCode(event.target.value)}
                    placeholder="Enter raw material batch code"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={() => exportCsv('raw_material_trace.csv', rawTraceRows)}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
              </div>
              <Separator />
              <ScrollArea className="w-full">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Usage Date</TableHead>
                      <TableHead>Finished Batch</TableHead>
                      <TableHead>Finished Product</TableHead>
                      <TableHead>Production Date</TableHead>
                      <TableHead>Pallet</TableHead>
                      <TableHead>Used KG</TableHead>
                      <TableHead>Waste KG</TableHead>
                      <TableHead>Units Used</TableHead>
                      <TableHead>Units Wasted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rawTraceRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-muted-foreground">
                          Enter a Sweetdreams batch code to view results.
                        </TableCell>
                      </TableRow>
                    ) : (
                      rawTraceRows.map((row, index) => (
                        <TableRow key={`${row.finishedBatchCode}-${index}`}>
                          <TableCell>{row.usageDate || '-'}</TableCell>
                          <TableCell>{row.finishedBatchCode || '-'}</TableCell>
                          <TableCell>{row.finishedProduct || '-'}</TableCell>
                          <TableCell>{row.productionDate || '-'}</TableCell>
                          <TableCell>{row.palletNumber || '-'}</TableCell>
                          <TableCell>{row.quantityUsedKg || '-'}</TableCell>
                          <TableCell>{row.quantityWastedKg || '-'}</TableCell>
                          <TableCell>{row.unitsUsed || '-'}</TableCell>
                          <TableCell>{row.unitsWasted || '-'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Date Trace</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <Label htmlFor="dateTraceStart">Start Date</Label>
                  <Input
                    id="dateTraceStart"
                    type="date"
                    value={dateTraceStart}
                    onChange={event => setDateTraceStart(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="dateTraceEnd">End Date</Label>
                  <Input
                    id="dateTraceEnd"
                    type="date"
                    value={dateTraceEnd}
                    onChange={event => setDateTraceEnd(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="dateTraceType">Trace Type</Label>
                  <Select value={dateTraceType} onValueChange={setDateTraceType}>
                    <SelectTrigger id="dateTraceType">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="finished">Finished Products</SelectItem>
                      <SelectItem value="raw">Raw Materials</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      exportCsv(
                        `date_trace_${dateTraceType}.csv`,
                        dateTraceRows,
                      )
                    }
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export
                  </Button>
                </div>
              </div>
              <Separator />
              <ScrollArea className="w-full">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {dateTraceType === 'finished' ? (
                        <>
                          <TableHead>Production Date</TableHead>
                          <TableHead>Finished Product</TableHead>
                          <TableHead>Batch Code</TableHead>
                          <TableHead>Units Produced</TableHead>
                          <TableHead>Line</TableHead>
                          <TableHead>Best Before</TableHead>
                        </>
                      ) : (
                        <>
                          <TableHead>Intake Date</TableHead>
                          <TableHead>Material</TableHead>
                          <TableHead>Sweetdreams Batch</TableHead>
                          <TableHead>Pallet</TableHead>
                          <TableHead>Supplier</TableHead>
                          <TableHead>Item Type</TableHead>
                          <TableHead>Total Weight KG</TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dateTraceRows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={dateTraceType === 'finished' ? 6 : 7}
                          className="text-center text-muted-foreground"
                        >
                          Select a date range to view results.
                        </TableCell>
                      </TableRow>
                    ) : dateTraceType === 'finished' ? (
                      dateTraceRows.map(row => (
                        <TableRow key={row.finishedBatchCode}>
                          <TableCell>{row.productionDate || '-'}</TableCell>
                          <TableCell>{row.finishedProduct || '-'}</TableCell>
                          <TableCell>{row.finishedBatchCode || '-'}</TableCell>
                          <TableCell>{row.unitsProduced || '-'}</TableCell>
                          <TableCell>{row.lineNumber || '-'}</TableCell>
                          <TableCell>{row.bestBeforeDate || '-'}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      dateTraceRows.map(row => (
                        <TableRow key={`${row.sweetdreamsBatchCode}-${row.palletNumber || ''}`}>
                          <TableCell>{row.intakeDate || '-'}</TableCell>
                          <TableCell>{row.materialName || '-'}</TableCell>
                          <TableCell>{row.sweetdreamsBatchCode || '-'}</TableCell>
                          <TableCell>{row.palletNumber || '-'}</TableCell>
                          <TableCell>{row.supplierName || '-'}</TableCell>
                          <TableCell>{row.itemType || '-'}</TableCell>
                          <TableCell>{row.totalWeightKg || '-'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Dropdown Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Label>Item Types</Label>
                  <div className="flex gap-2">
                    <Input
                      value={itemTypeDraft}
                      onChange={event => setItemTypeDraft(event.target.value)}
                      placeholder="Add item type"
                    />
                    <Button variant="outline" onClick={handleAddItemType}>
                      Add
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {data.config.itemTypes.map(type => (
                      <div
                        key={type}
                        className="flex items-center justify-between rounded-md border px-3 py-2"
                      >
                        <span>{type}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeConfigValue('itemTypes', type)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <Label>Packaging Types</Label>
                  <div className="flex gap-2">
                    <Input
                      value={packagingTypeDraft}
                      onChange={event => setPackagingTypeDraft(event.target.value)}
                      placeholder="Add packaging type"
                    />
                    <Button variant="outline" onClick={handleAddPackagingType}>
                      Add
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {data.config.packagingTypes.map(type => (
                      <div
                        key={type}
                        className="flex items-center justify-between rounded-md border px-3 py-2"
                      >
                        <span>{type}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeConfigValue('packagingTypes', type)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Traceability;
