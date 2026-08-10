import { useEffect, useState } from 'react';
import { Download, Eye, GitBranch, PhoneCall, RefreshCw, RotateCcw, Search, X, Upload, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { api } from '../api';
import { useBusinessUnit } from '../BusinessUnitContext';
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Select, Tabs, TabsList, TabsTrigger, TabsContent, Badge, Skeleton } from './ui';
import PageContainer from './PageContainer';

export default function BulkActionsPageModern() {
  const { selectedId } = useBusinessUnit();
  const [uploads, setUploads] = useState([]);
  const [operations, setOperations] = useState([]);
  const [dialerCampaigns, setDialerCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('uploads');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    setUploads([]);
    setOperations([]);
    setDialerCampaigns([]);
    setSelectedUpload(null);
    setLoading(true);
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [selectedId]);

  const loadData = async () => {
    try {
      const [uploadData, operationData, dialerData] = await Promise.all([
        api('/bulk-uploads'),
        api('/bulk-operations'),
        api('/callerdesk/campaigns').catch(() => ({ data: [] }))
      ]);
      setUploads((uploadData.data || []).map(item=>({
        ...item,type:item.type||'Lead import',
        totalRecords:Number(item.totalRecords||0),
        successCount:Number(item.successfulRecords||0),
        failureCount:Number(item.failedRecords||0),
        duplicateCount:Number(item.duplicateRecords||0),
      })));
      setOperations((operationData.data || [])
        .filter(item => item.operationType === 'stage_change')
        .map(item => ({
          ...item,
          type: 'Stage change',
          description: item.summary || 'Lead stage updated',
          affectedCount: Number(item.totalRecords || 0),
          successfulCount: Number(item.successfulRecords || 0),
          failureCount: Number(item.failedRecords || 0),
          details: item.details || {},
        })));
      setDialerCampaigns(dialerData.data || []);
    } catch (error) {
      console.error('Failed to load bulk operation history:', error);
    } finally {
      setLoading(false);
    }
  };

  const openDetails = async (upload) => {
    setDetailsLoading(true);
    try {
      const payload = await api(`/bulk-uploads/${upload.id}`);
      const detail=payload.upload||{};
      const failedRecords=(payload.records||[])
        .filter(record=>String(record.status).toLowerCase()==='failed')
        .map(record=>({rowNumber:Number(record.rowNumber),reasons:Array.isArray(record.validationErrors)?record.validationErrors:[record.validationErrors].filter(Boolean)}));
      setSelectedUpload({
        ...detail,totalRecords:Number(detail.totalRecords||0),successCount:Number(detail.successfulRecords||0),
        failureCount:Number(detail.failedRecords||failedRecords.length||0),duplicateCount:Number(detail.duplicateRecords||0),
        failedRecords,events:payload.events||[],
      });
    } catch (error) {
      console.error('Failed to load details:', error);
    } finally {
      setDetailsLoading(false);
    }
  };

  const closeDetails = () => setSelectedUpload(null);

  const exportAffectedLeads = async (row) => {
    try {
      const endpoint = activeTab === 'uploads'
        ? `/api/bulk-uploads/${row.id}/download-successful`
        : `/api/bulk-operations/${row.id}/export`;
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('crm_token')}`,
          'X-Business-Unit-Id': String(selectedId)
        }
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.message || 'Export failed');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = activeTab === 'uploads' ? `bulk-upload-${row.id}-leads.csv` : `bulk-${activeTab}-${row.id}-leads.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(error.message);
    }
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      'processing': { icon: Clock, color: 'warning', label: 'Processing' },
      'success': { icon: CheckCircle, color: 'success', label: 'Success' },
      'completed': { icon: CheckCircle, color: 'success', label: 'Completed' },
      'error': { icon: AlertCircle, color: 'danger', label: 'Error' },
      'failed': { icon: AlertCircle, color: 'danger', label: 'Failed' },
    };
    const config = statusMap[status?.toLowerCase()] || { icon: Clock, color: 'blue', label: status };
    const Icon = config.icon;
    return (
      <Badge variant={config.color} className="flex items-center gap-1">
        <Icon size={14} />
        {config.label}
      </Badge>
    );
  };

  const filteredData = {
    uploads: uploads.filter(item =>
      (!search || `${item.fileName} ${item.type}`.toLowerCase().includes(search.toLowerCase())) &&
      (!statusFilter || item.status === statusFilter)
    ),
    operations: operations.filter(item =>
      (!search || `${item.type} ${item.description}`.toLowerCase().includes(search.toLowerCase())) &&
      (!statusFilter || item.status === statusFilter)
    ),
    dialerCampaigns: dialerCampaigns.filter(item =>
      !search || `${item.campaignName} ${item.description}`.toLowerCase().includes(search.toLowerCase())
    )
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Content starts directly below the universal bar; page actions moved
          in beside the tabs. */}
      <PageContainer className="py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center gap-3 mb-8">
            <TabsList className="grid flex-1 grid-cols-3">
            <TabsTrigger value="uploads">
              <Upload size={18} className="mr-2" />
              <span>Uploads</span>
              <span className="ml-2 px-2 py-1 rounded-full bg-primary-100 text-primary-700 text-xs font-semibold">
                {uploads.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="operations">
              <GitBranch size={18} className="mr-2" />
              <span>Stage changes</span>
              <span className="ml-2 px-2 py-1 rounded-full bg-primary-100 text-primary-700 text-xs font-semibold">
                {operations.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="campaigns">
              <PhoneCall size={18} className="mr-2" />
              <span>Campaigns</span>
              <span className="ml-2 px-2 py-1 rounded-full bg-primary-100 text-primary-700 text-xs font-semibold">
                {dialerCampaigns.length}
              </span>
            </TabsTrigger>
            </TabsList>
            <div className="flex gap-2 flex-shrink-0">
              <Button onClick={loadData} variant="secondary">
                <RefreshCw size={16} />
                <span className="hidden sm:inline ml-2">Refresh</span>
              </Button>
              <Button onClick={() => { setSearch(''); setStatusFilter(''); }} variant="secondary">
                <RotateCcw size={16} />
                <span className="hidden sm:inline ml-2">Reset</span>
              </Button>
            </div>
          </div>

          {/* Search & Filters */}
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1 relative">
                  <Search size={16} className="absolute left-3 top-3 text-secondary-400 pointer-events-none" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search..."
                    className="pl-9"
                  />
                </div>
                <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="sm:w-40">
                  <option value="">All statuses</option>
                  <option value="processing">Processing</option>
                  <option value="completed">Completed</option>
                  <option value="success">Success</option>
                  <option value="error">Error</option>
                  <option value="failed">Failed</option>
                </Select>
              </div>
            </CardContent>
          </Card>

          <TabsContent value="uploads" className="space-y-4">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-1/4" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : filteredData.uploads.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Upload size={32} className="mx-auto mb-3 opacity-50 text-secondary-600" />
                  <p className="font-medium text-foreground">No uploads found</p>
                  <p className="text-secondary-600 text-sm">Your bulk uploads will appear here</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredData.uploads.map(upload => (
                  <Card key={upload.id} className="hover:border-primary-300 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="font-semibold text-foreground">{upload.fileName}</h3>
                            {getStatusBadge(upload.status)}
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm text-secondary-600">
                            <div>
                              <span className="block text-xs text-secondary-500">Type</span>
                              <span className="font-medium text-foreground">{upload.type}</span>
                            </div>
                            <div>
                              <span className="block text-xs text-secondary-500">Records</span>
                              <span className="font-medium text-foreground">{upload.totalRecords}</span>
                            </div>
                            <div>
                              <span className="block text-xs text-secondary-500">Uploaded</span>
                              <span className="font-medium text-foreground">{new Date(upload.createdAt).toLocaleDateString()}</span>
                            </div>
                            <div>
                              <span className="block text-xs text-secondary-500">Success</span>
                              <span className="font-medium text-emerald-600">{upload.successCount}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openDetails(upload)}
                          >
                            <Eye size={16} />
                          </Button>
                          {upload.totalRecords > 0 && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => exportAffectedLeads(upload)}
                            >
                              <Download size={16} />
                            </Button>
                          )}
                        </div>
                      </div>
                      {upload.errorMessage && (
                        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                          {upload.errorMessage}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="operations" className="space-y-4">
            {loading ? (
              <div className="space-y-3">
                {[1, 2].map(i => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-1/4" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : filteredData.operations.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <GitBranch size={32} className="mx-auto mb-3 opacity-50 text-secondary-600" />
                  <p className="font-medium text-foreground">No stage changes found</p>
                  <p className="text-secondary-600 text-sm">Bulk stage changes will appear here</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredData.operations.map(operation => (
                    <Card key={operation.id} className="hover:border-primary-300 transition-colors">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="font-semibold text-foreground">{operation.type}</h3>
                              {getStatusBadge(operation.status)}
                            </div>
                            <p className="text-sm text-secondary-600">{operation.description}</p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm text-secondary-600 mt-3">
                              <div>
                                <span className="block text-xs text-secondary-500">Total records</span>
                                <span className="font-medium text-foreground">{operation.affectedCount}</span>
                              </div>
                              <div>
                                <span className="block text-xs text-secondary-500">Changed to</span>
                                <span className="font-medium text-foreground">{[operation.details.stageName, operation.details.substageName].filter(Boolean).join(' / ') || '—'}</span>
                              </div>
                              <div>
                                <span className="block text-xs text-secondary-500">Changed by</span>
                                <span className="font-medium text-foreground">{operation.createdBy || '—'}</span>
                              </div>
                              <div>
                                <span className="block text-xs text-secondary-500">Changed on</span>
                                <span className="font-medium text-foreground">{new Date(operation.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {operation.affectedCount > 0 && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => exportAffectedLeads(operation)}
                              >
                                <Download size={16} />
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="campaigns" className="space-y-4">
            {loading ? (
              <div className="space-y-3">
                {[1, 2].map(i => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-1/4" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : filteredData.dialerCampaigns.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <PhoneCall size={32} className="mx-auto mb-3 opacity-50 text-secondary-600" />
                  <p className="font-medium text-foreground">No campaigns found</p>
                  <p className="text-secondary-600 text-sm">Your dialer campaigns will appear here</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredData.dialerCampaigns.map(campaign => (
                  <Card key={campaign.id} className="hover:border-primary-300 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <h3 className="font-semibold text-foreground mb-1">{campaign.campaignName}</h3>
                          <p className="text-sm text-secondary-600 mb-3">{campaign.description}</p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm text-secondary-600">
                            <div>
                              <span className="block text-xs text-secondary-500">Calls</span>
                              <span className="font-medium text-foreground">{campaign.callCount}</span>
                            </div>
                            <div>
                              <span className="block text-xs text-secondary-500">Success</span>
                              <span className="font-medium text-emerald-600">{campaign.successRate}%</span>
                            </div>
                            <div>
                              <span className="block text-xs text-secondary-500">Status</span>
                              <span className="font-medium text-foreground">{campaign.status}</span>
                            </div>
                            <div>
                              <span className="block text-xs text-secondary-500">Created</span>
                              <span className="font-medium text-foreground">{new Date(campaign.createdAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </PageContainer>

      {/* Details Modal */}
      {selectedUpload && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl max-h-[80vh] overflow-auto">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Upload Details</CardTitle>
                <CardDescription>{selectedUpload.fileName}</CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={closeDetails}>
                <X size={18} />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {detailsLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="block text-sm text-secondary-600">Total Records</span>
                      <span className="text-2xl font-bold text-foreground">{selectedUpload.totalRecords}</span>
                    </div>
                    <div>
                      <span className="block text-sm text-secondary-600">Success</span>
                      <span className="text-2xl font-bold text-emerald-600">{selectedUpload.successCount}</span>
                    </div>
                    <div>
                      <span className="block text-sm text-secondary-600">Failed</span>
                      <span className="text-2xl font-bold text-red-600">{selectedUpload.failureCount}</span>
                    </div>
                    <div>
                      <span className="block text-sm text-secondary-600">Success Rate</span>
                      <span className="text-2xl font-bold text-foreground">
                        {selectedUpload.totalRecords > 0
                          ? ((selectedUpload.successCount / selectedUpload.totalRecords) * 100).toFixed(1)
                          : '0'}
                        %
                      </span>
                    </div>
                  </div>
                  {selectedUpload.failedRecords && selectedUpload.failedRecords.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3">Failed Records</h4>
                      <div className="space-y-2 max-h-72 overflow-auto">
                        {selectedUpload.failedRecords.map((record, idx) => (
                          <div key={`${record.rowNumber}-${idx}`} className="p-3 bg-red-50 rounded text-sm text-red-700">
                            <p className="font-medium">CSV row {record.rowNumber}</p>
                            {record.reasons.length?<ul className="mt-1 list-disc pl-5 text-xs space-y-1">{record.reasons.map((reason,reasonIndex)=><li key={reasonIndex}>{reason}</li>)}</ul>:<p className="text-xs">No failure reason was recorded.</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedUpload.errorSummary&&<div className="p-3 rounded bg-red-50 text-sm text-red-700"><strong>Upload error</strong><p className="mt-1">{typeof selectedUpload.errorSummary==='string'?selectedUpload.errorSummary:JSON.stringify(selectedUpload.errorSummary)}</p></div>}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
