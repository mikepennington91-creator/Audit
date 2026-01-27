import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ScrollArea } from '../components/ui/scroll-area';
import { Separator } from '../components/ui/separator';
import { toast } from 'sonner';
import { Download, Plus, Printer, Trash2 } from 'lucide-react';

const STORAGE_KEY = 'traceabilityDataV1';

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
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState(emptyData);
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
    ravendaleBatchCode: '',
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
  });
  const [usageForm, setUsageForm] = useState({
    usageDate: '',
    ravendaleBatchCode: '',
    palletNumber: '',
    finishedBatchCode: '',
    quantityUsedKg: '',
    quantityWastedKg: '',
    unitsUsed: '',
    unitsWasted: '',
  });

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setData({ ...emptyData, ...parsed });
      } catch (error) {
        console.error('Failed to parse traceability data', error);
      }
    }
  }, []);

  useEffect(() => {
    const hashValue = location.hash.replace('#', '');
    const validTabs = ['intake', 'finished', 'usage', 'reports', 'config'];
    if (hashValue && validTabs.includes(hashValue)) {
      setActiveTab(hashValue);
    }
  }, [location.hash]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  const handleAddItemType = () => {
    const trimmed = itemTypeDraft.trim();
    if (!trimmed) return;
    if (data.config.itemTypes.includes(trimmed)) {
      toast.error('Item type already exists');
      return;
    }
    setData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        itemTypes: [...prev.config.itemTypes, trimmed],
      },
    }));
    setItemTypeDraft('');
  };

  const handleAddPackagingType = () => {
    const trimmed = packagingTypeDraft.trim();
    if (!trimmed) return;
    if (data.config.packagingTypes.includes(trimmed)) {
      toast.error('Packaging type already exists');
      return;
    }
    setData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        packagingTypes: [...prev.config.packagingTypes, trimmed],
      },
    }));
    setPackagingTypeDraft('');
  };

  const removeConfigValue = (field, value) => {
    setData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        [field]: prev.config[field].filter(item => item !== value),
      },
    }));
  };

  const addRawIntake = () => {
    if (!rawForm.intakeDate || !rawForm.materialName || !rawForm.ravendaleBatchCode) {
      toast.error('Intake date, material name, and Ravendale batch code are required');
      return;
    }
    setData(prev => ({
      ...prev,
      rawIntakes: [
        {
          ...rawForm,
          id: crypto.randomUUID(),
        },
        ...prev.rawIntakes,
      ],
    }));
    setRawForm({
      intakeDate: '',
      supplierName: '',
      materialName: '',
      bestBeforeDate: '',
      ravendaleBatchCode: '',
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

  const addFinishedBatch = () => {
    if (!finishedForm.productionDate || !finishedForm.finishedProduct || !finishedForm.finishedBatchCode) {
      toast.error('Production date, finished product, and batch code are required');
      return;
    }
    setData(prev => ({
      ...prev,
      finishedBatches: [
        {
          ...finishedForm,
          id: crypto.randomUUID(),
        },
        ...prev.finishedBatches,
      ],
    }));
    setFinishedForm({
      productionDate: '',
      finishedProduct: '',
      finishedBatchCode: '',
      unitsProduced: '',
      lineNumber: '',
      bestBeforeDate: '',
    });
    toast.success('Finished batch saved');
  };

  const addUsage = () => {
    if (!usageForm.usageDate || !usageForm.ravendaleBatchCode || !usageForm.finishedBatchCode) {
      toast.error('Usage date, Ravendale batch, and finished batch are required');
      return;
    }
    setData(prev => ({
      ...prev,
      materialUsage: [
        {
          ...usageForm,
          id: crypto.randomUUID(),
        },
        ...prev.materialUsage,
      ],
    }));
    setUsageForm({
      usageDate: '',
      ravendaleBatchCode: '',
      palletNumber: '',
      finishedBatchCode: '',
      quantityUsedKg: '',
      quantityWastedKg: '',
      unitsUsed: '',
      unitsWasted: '',
    });
    toast.success('Material usage saved');
  };

  const removeRow = (collection, id) => {
    setData(prev => ({
      ...prev,
      [collection]: prev[collection].filter(item => item.id !== id),
    }));
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
      { label: 'Ravendale Batch Code', key: 'ravendaleBatchCode' },
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
          item.ravendaleBatchCode.toLowerCase() === usage.ravendaleBatchCode.toLowerCase() &&
          (item.palletNumber || '') === (usage.palletNumber || ''),
      );
      return {
        usageDate: usage.usageDate,
        ravendaleBatchCode: usage.ravendaleBatchCode,
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
      usage => usage.ravendaleBatchCode.toLowerCase() === normalized,
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
        ravendaleBatchCode: intake.ravendaleBatchCode,
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

  return (
    <div className="space-y-6" data-testid="traceability-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Traceability</h1>
        <p className="text-muted-foreground mt-1">
          Capture raw intake, production batches, and usage to generate traceability reports.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList>
          <TabsTrigger value="intake">Raw Material Intake</TabsTrigger>
          <TabsTrigger value="finished">Finished Batches</TabsTrigger>
          <TabsTrigger value="usage">Material Usage</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
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
                  <Label htmlFor="ravendaleBatchCode">Ravendale Batch Code</Label>
                  <Input
                    id="ravendaleBatchCode"
                    value={rawForm.ravendaleBatchCode}
                    onChange={event => setRawForm(prev => ({ ...prev, ravendaleBatchCode: event.target.value }))}
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
                      <TableHead>Ravendale Batch</TableHead>
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
                          <TableCell>{item.ravendaleBatchCode || '-'}</TableCell>
                          <TableCell>{item.supplierName || '-'}</TableCell>
                          <TableCell>{item.palletNumber || '-'}</TableCell>
                          <TableCell>{item.totalWeightKg || '-'}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeRow('rawIntakes', item.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
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
              </div>
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
              <CardTitle>Recent Finished Batches</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="w-full">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Batch Code</TableHead>
                      <TableHead>Units</TableHead>
                      <TableHead>Line</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.finishedBatches.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          No finished batches recorded yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.finishedBatches.map(item => (
                        <TableRow key={item.id}>
                          <TableCell>{item.productionDate || '-'}</TableCell>
                          <TableCell>{item.finishedProduct || '-'}</TableCell>
                          <TableCell>{item.finishedBatchCode || '-'}</TableCell>
                          <TableCell>{item.unitsProduced || '-'}</TableCell>
                          <TableCell>{item.lineNumber || '-'}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeRow('finishedBatches', item.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
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
                  <Label htmlFor="usageRavendale">Ravendale Batch Code</Label>
                  <Input
                    id="usageRavendale"
                    value={usageForm.ravendaleBatchCode}
                    onChange={event => setUsageForm(prev => ({ ...prev, ravendaleBatchCode: event.target.value }))}
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
                      <TableHead>Ravendale Batch</TableHead>
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
                          <TableCell>{item.ravendaleBatchCode || '-'}</TableCell>
                          <TableCell>{item.palletNumber || '-'}</TableCell>
                          <TableCell>{item.finishedBatchCode || '-'}</TableCell>
                          <TableCell>{item.quantityUsedKg || '-'}</TableCell>
                          <TableCell>{item.quantityWastedKg || '-'}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeRow('materialUsage', item.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
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
                      <TableHead>Ravendale Batch</TableHead>
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
                        <TableRow key={`${row.ravendaleBatchCode}-${index}`}>
                          <TableCell>{row.usageDate || '-'}</TableCell>
                          <TableCell>{row.ravendaleBatchCode || '-'}</TableCell>
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
                  <Label htmlFor="rawTrace">Ravendale Batch Code</Label>
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
                          Enter a Ravendale batch code to view results.
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
                          <TableHead>Ravendale Batch</TableHead>
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
                        <TableRow key={`${row.ravendaleBatchCode}-${row.palletNumber || ''}`}>
                          <TableCell>{row.intakeDate || '-'}</TableCell>
                          <TableCell>{row.materialName || '-'}</TableCell>
                          <TableCell>{row.ravendaleBatchCode || '-'}</TableCell>
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
