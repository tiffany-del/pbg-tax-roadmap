import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, API_BASE, getUploadBase } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Plus, Trash2, CheckCircle, XCircle, FileDown, RefreshCw, ChevronDown, ChevronUp, PencilLine, Building2, User, Upload, FileText, Loader2, X, CheckCircle2, AlertCircle } from "lucide-react";
import type { Client, Entity, StrategySelection, UploadedFile } from "@shared/schema";
import { STRATEGIES, autoSuggestStrategies, type EntityType, type TriggerKey, type Strategy } from "@/lib/strategies";

// =================== STEP INDICATOR ===================
function StepBar({ step, total }: { step: number; total: number }) {
  const labels = ["Client Info", "Entities & Data", "Strategies", "Review & Export"];
  return (
    <div className="flex items-center gap-0">
      {labels.map((label, i) => (
        <div key={i} className="flex items-center">
          <div className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-sm ${i + 1 === step ? "bg-primary text-primary-foreground" : i + 1 < step ? "text-primary" : "text-muted-foreground"}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs border ${i + 1 === step ? "bg-white text-primary border-white" : i + 1 < step ? "bg-primary text-primary-foreground border-primary" : "border-current"}`}>
              {i + 1 < step ? "✓" : i + 1}
            </span>
            {label}
          </div>
          {i < labels.length - 1 && <div className="w-6 border-t border-muted-foreground/30" />}
        </div>
      ))}
    </div>
  );
}

// =================== DOCUMENT UPLOAD PANEL ===================
function DocumentUploadPanel({ entity, onFieldsExtracted }: { entity: Entity; onFieldsExtracted: () => void }) {
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);
  const [selectedFileType, setSelectedFileType] = useState<string>(() => {
    // Default doc type based on entity type
    if (entity.entityType === "1040") return "1040";
    if (entity.entityType === "1120S") return "1120S";
    if (entity.entityType === "1065") return "1065";
    return "financials";
  });

  const { data: files = [], refetch: refetchFiles } = useQuery<UploadedFile[]>({
    queryKey: ["/api/entities", entity.id, "files"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/entities/${entity.id}/files`);
      return res.json();
    },
  });

  // Poll processing files every 3s
  const hasProcessing = files.some(f => f.extractionStatus === "processing");
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(() => {
      refetchFiles();
    }, 3000);
    return () => clearInterval(timer);
  }, [hasProcessing, refetchFiles]);

  // When a file transitions from processing → done, refresh entity fields
  const prevFiles = useState(files)[0];
  useEffect(() => {
    const newlyDone = files.filter(f =>
      f.extractionStatus === "done" &&
      prevFiles.find(pf => pf.id === f.id && pf.extractionStatus === "processing")
    );
    if (newlyDone.length > 0) {
      onFieldsExtracted();
      toast({ title: "Fields extracted — form has been pre-filled. Review before saving." });
    }
  }, [files]);

  const deleteFile = useMutation({
    mutationFn: (id: number) => fetch(`${API_BASE}/api/files/${id}`, { method: "DELETE" }),
    onSuccess: () => refetchFiles(),
  });

  async function uploadFile(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("fileType", selectedFileType);
    try {
      const res = await fetch(`${getUploadBase()}/api/entities/${entity.id}/upload`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      refetchFiles();
      toast({ title: `"${file.name}" uploaded — extracting fields...` });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(uploadFile);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    files.forEach(uploadFile);
    e.target.value = "";
  }

  const docTypeLabels: Record<string, string> = {
    "1040": "1040 (Individual)",
    "1120S": "1120-S (S-Corp)",
    "1065": "1065 (Partnership)",
    "C-Corp": "1120 (C-Corp)",
    "financials": "P&L / Balance Sheet",
  };

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-[#1b2951] flex items-center gap-1.5">
          <Upload className="w-3.5 h-3.5" /> Upload Documents
        </h4>
        <Select value={selectedFileType} onValueChange={setSelectedFileType}>
          <SelectTrigger className="h-7 text-xs w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1040">1040 (Individual)</SelectItem>
            <SelectItem value="1120S">1120-S (S-Corp)</SelectItem>
            <SelectItem value="1065">1065 (Partnership)</SelectItem>
            <SelectItem value="C-Corp">1120 (C-Corp)</SelectItem>
            <SelectItem value="financials">P&amp;L / Balance Sheet</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Drop zone */}
      <label
        className={`flex flex-col items-center justify-center gap-2 w-full border-2 border-dashed rounded-lg py-5 cursor-pointer transition-colors ${
          dragging
            ? "border-[#1b2951] bg-[#1b2951]/5"
            : "border-gray-300 hover:border-[#b5cc42] hover:bg-[#b5cc42]/5"
        }`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.tiff"
          multiple
          className="sr-only"
          onChange={handleFileInput}
        />
        <Upload className="w-6 h-6 text-gray-400" />
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700">Drop files here or click to browse</p>
          <p className="text-xs text-gray-400 mt-0.5">PDF, PNG, JPG, TIFF · max 20MB · AI will extract fields automatically</p>
        </div>
      </label>

      {/* File list */}
      {files.length > 0 && (
        <div className="mt-3 space-y-2">
          {files.map(f => (
            <div
              key={f.id}
              className="flex items-center gap-3 bg-white border border-gray-100 rounded-lg px-3 py-2"
              data-testid={`uploaded-file-${f.id}`}
            >
              <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{f.filename}</p>
                <p className="text-xs text-gray-400">{docTypeLabels[f.fileType] ?? f.fileType}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {f.extractionStatus === "processing" && (
                  <span className="flex items-center gap-1 text-xs text-blue-600">
                    <Loader2 className="w-3 h-3 animate-spin" /> Reading...
                  </span>
                )}
                {f.extractionStatus === "done" && (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <CheckCircle2 className="w-3 h-3" /> Fields filled
                  </span>
                )}
                {f.extractionStatus === "error" && (
                  <span className="flex items-center gap-1 text-xs text-red-500" title={f.errorMessage ?? ""}>
                    <AlertCircle className="w-3 h-3" /> Error
                  </span>
                )}
                <button
                  onClick={() => deleteFile.mutate(f.id)}
                  className="text-gray-300 hover:text-red-400 transition-colors"
                  data-testid={`delete-file-${f.id}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =================== ENTITY FINANCIAL FORM ===================
function EntityDataForm({ entity, inputMode, onSave }: { entity: Entity; inputMode: string; onSave: (updates: Partial<Entity>) => void }) {
  const [data, setData] = useState<Partial<Entity>>(entity);
  const set = (k: keyof Entity, v: any) => setData(d => ({ ...d, [k]: v }));
  const num = (v: any) => (v === "" || v === null || v === undefined) ? null : Number(v);

  const isIndividual = entity.entityType === "1040";

  return (
    <div className="space-y-4">
      {/* Entity type + name header */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Entity Name</Label>
          <Input data-testid={`input-entity-name-${entity.id}`} value={data.name || ""} onChange={e => set("name", e.target.value)} />
        </div>
        <div>
          <Label>Entity Type</Label>
          <Select value={data.entityType || ""} onValueChange={v => set("entityType", v)}>
            <SelectTrigger data-testid={`select-entity-type-${entity.id}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1040">Individual (1040)</SelectItem>
              <SelectItem value="1120S">S Corporation (1120-S)</SelectItem>
              <SelectItem value="1065">Partnership (1065)</SelectItem>
              <SelectItem value="C-Corp">C Corporation (1120)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Core income */}
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Income</h4>
        <div className="grid grid-cols-2 gap-3">
          {isIndividual ? (
            <>
              <div><Label>AGI</Label><Input type="number" data-testid={`input-agi-${entity.id}`} placeholder="0" value={data.agi ?? ""} onChange={e => set("agi", num(e.target.value))} /></div>
              <div><Label>Total Income</Label><Input type="number" placeholder="0" value={data.totalIncome ?? ""} onChange={e => set("totalIncome", num(e.target.value))} /></div>
              <div><Label>W-2 Wages (earned)</Label><Input type="number" data-testid={`input-wages-${entity.id}`} placeholder="0" value={data.w2Wages ?? ""} onChange={e => set("w2Wages", num(e.target.value))} /></div>
              <div><Label>IRA Distributions</Label><Input type="number" placeholder="0" value={data.iraDistributions ?? ""} onChange={e => set("iraDistributions", num(e.target.value))} /></div>
              <div><Label>Net Capital Gains</Label><Input type="number" placeholder="0" value={data.capitalGains ?? ""} onChange={e => set("capitalGains", num(e.target.value))} /></div>
              <div><Label>Rental Income</Label><Input type="number" placeholder="0" value={data.rentalIncome ?? ""} onChange={e => set("rentalIncome", num(e.target.value))} /></div>
              <div><Label>Partnership / Pass-through Income</Label><Input type="number" placeholder="0" value={data.partnershipIncome ?? ""} onChange={e => set("partnershipIncome", num(e.target.value))} /></div>
            </>
          ) : (
            <>
              <div><Label>Gross Revenue</Label><Input type="number" data-testid={`input-revenue-${entity.id}`} placeholder="0" value={data.grossRevenue ?? ""} onChange={e => set("grossRevenue", num(e.target.value))} /></div>
              <div><Label>Net Profit / (Loss)</Label><Input type="number" data-testid={`input-net-profit-${entity.id}`} placeholder="0" value={data.netProfit ?? ""} onChange={e => set("netProfit", num(e.target.value))} /></div>
              <div><Label>Owner Compensation (W-2 / Guaranteed Payments)</Label><Input type="number" placeholder="0" value={data.ownerCompensation ?? ""} onChange={e => set("ownerCompensation", num(e.target.value))} /></div>
              <div><Label>W-2 Wages Paid to Employees</Label><Input type="number" placeholder="0" value={data.w2Wages ?? ""} onChange={e => set("w2Wages", num(e.target.value))} /></div>
            </>
          )}
        </div>
      </div>

      {/* Deductions / expenses — business */}
      {!isIndividual && (
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Expenses</h4>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Meals Expenses</Label><Input type="number" placeholder="0" value={data.mealExpenses ?? ""} onChange={e => set("mealExpenses", num(e.target.value))} /></div>
            <div><Label>Travel Expenses</Label><Input type="number" placeholder="0" value={data.travelExpenses ?? ""} onChange={e => set("travelExpenses", num(e.target.value))} /></div>
            <div><Label>Vehicle Expenses</Label><Input type="number" placeholder="0" value={data.vehicleExpenses ?? ""} onChange={e => set("vehicleExpenses", num(e.target.value))} /></div>
            <div><Label>Home Office Expense</Label><Input type="number" placeholder="0" value={data.homeOfficeExpenses ?? ""} onChange={e => set("homeOfficeExpenses", num(e.target.value))} /></div>
            <div><Label>Depreciation</Label><Input type="number" placeholder="0" value={data.depreciation ?? ""} onChange={e => set("depreciation", num(e.target.value))} /></div>
          </div>
        </div>
      )}

      {/* Individual deductions */}
      {isIndividual && (
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Deductions</h4>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Mortgage Interest Paid</Label><Input type="number" placeholder="0" value={data.mortgageInterest ?? ""} onChange={e => set("mortgageInterest", num(e.target.value))} /></div>
            <div><Label>State & Local Taxes (SALT)</Label><Input type="number" placeholder="0" value={data.stateLocalTaxes ?? ""} onChange={e => set("stateLocalTaxes", num(e.target.value))} /></div>
            <div><Label>Charitable Donations</Label><Input type="number" placeholder="0" value={data.charitableDonations ?? ""} onChange={e => set("charitableDonations", num(e.target.value))} /></div>
            <div><Label>Medical Expenses</Label><Input type="number" placeholder="0" value={data.medicalExpenses ?? ""} onChange={e => set("medicalExpenses", num(e.target.value))} /></div>
          </div>
        </div>
      )}

      {/* Qualifiers */}
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Qualifiers</h4>
        <div className="grid grid-cols-2 gap-2">
          {!isIndividual && <>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><Checkbox checked={!!data.hasEmployees} onCheckedChange={v => set("hasEmployees", !!v)} data-testid={`check-employees-${entity.id}`} />Has W-2 employees</label>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><Checkbox checked={!!data.hasNonOwnerEmployees} onCheckedChange={v => set("hasNonOwnerEmployees", !!v)} />Has non-owner employees</label>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><Checkbox checked={!!data.hasBusinessVehiclePurchase} onCheckedChange={v => set("hasBusinessVehiclePurchase", !!v)} />Purchased vehicle for business</label>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><Checkbox checked={!!data.alreadyHasRetirementPlan} onCheckedChange={v => set("alreadyHasRetirementPlan", !!v)} />Already has retirement plan</label>
          </>}
          {isIndividual && <>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><Checkbox checked={!!data.hasHealthInsurancePersonal} onCheckedChange={v => set("hasHealthInsurancePersonal", !!v)} />Pays health insurance personally</label>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><Checkbox checked={!!data.hasRealProperty} onCheckedChange={v => set("hasRealProperty", !!v)} />Owns real estate / investment property</label>
          </>}
          <div className="flex items-center gap-2 text-sm col-span-2">
            <Label>Number of Dependents</Label>
            <Input type="number" className="w-20" min={0} placeholder="0" value={data.numberOfDependents ?? ""} onChange={e => set("numberOfDependents", num(e.target.value))} />
          </div>
          {(data.numberOfDependents ?? 0) > 0 && (
            <label className="flex items-center gap-2 text-sm cursor-pointer col-span-2">
              <Checkbox checked={!!data.dependentsHaveEarnedIncome} onCheckedChange={v => set("dependentsHaveEarnedIncome", !!v)} />
              Dependents have earned income (W-2 or self-employment)
            </label>
          )}
        </div>
      </div>

      <div>
        <Label>Notes (optional)</Label>
        <Textarea placeholder="Any additional context..." value={data.notes || ""} onChange={e => set("notes", e.target.value)} rows={2} />
      </div>

      <Button className="w-full" data-testid={`button-save-entity-${entity.id}`} onClick={() => onSave(data)}>
        Save Entity Data
      </Button>
    </div>
  );
}

// =================== STRATEGY CARD ===================
function StrategyCard({
  strategy, selection, onToggle, onUpdateSavings, onUpdateRationale
}: {
  strategy: Strategy;
  selection?: StrategySelection;
  onToggle: (id: string, newStatus: string) => void;
  onUpdateSavings: (id: string, min: number, max: number) => void;
  onUpdateRationale: (id: string, text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = selection?.status || "excluded";
  const isSuggested = status === "suggested" || status === "manual_add";
  const isExcluded = status === "excluded" || status === "manual_remove";
  const savingsMin = selection?.savingsMin ?? strategy.savingsMin;
  const savingsMax = selection?.savingsMax ?? strategy.savingsMax;
  const rationale = selection?.rationale ?? "";

  const fmt = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : `$${n}`;

  return (
    <div className={`border rounded-lg overflow-hidden mb-2 ${isSuggested ? "border-green-300 bg-green-50" : "border-gray-200 bg-gray-50 opacity-75"}`}>
      <div
        className="flex items-center gap-3 p-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        data-testid={`strategy-card-${strategy.id}`}
      >
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${isSuggested ? "bg-green-600" : "bg-gray-400"}`}>
          {isSuggested ? "+" : "×"}
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm">{strategy.name}</span>
          <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">{strategy.shortDescription}</span>
        </div>
        <div className="text-right flex-shrink-0">
          {isSuggested ? (
            <span className="text-sm font-semibold text-green-700">
              {fmt(savingsMin)} – {fmt(savingsMax)}
            </span>
          ) : (
            <span className="text-sm text-gray-400">$0</span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </div>

      {expanded && (
        <div className="border-t p-3 space-y-3 bg-white">
          <p className="text-sm text-muted-foreground">{strategy.longDescription}</p>
          <p className="text-xs text-muted-foreground bg-gray-50 p-2 rounded">{strategy.irsRefs}</p>

          {/* Toggle include/exclude */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={isSuggested ? "default" : "outline"}
              onClick={() => onToggle(strategy.id, isSuggested ? "manual_remove" : "manual_add")}
              data-testid={`button-toggle-${strategy.id}`}
            >
              {isSuggested ? <><XCircle className="w-3.5 h-3.5 mr-1" />Exclude</> : <><CheckCircle className="w-3.5 h-3.5 mr-1" />Include</>}
            </Button>
            <Badge variant="outline" className="text-xs">{strategy.category}</Badge>
          </div>

          {isSuggested && (
            <>
              {/* Savings range */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Min Savings</Label>
                  <Input
                    type="number"
                    className="h-8 text-sm"
                    data-testid={`input-savings-min-${strategy.id}`}
                    value={savingsMin}
                    onChange={e => onUpdateSavings(strategy.id, Number(e.target.value), savingsMax)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Max Savings</Label>
                  <Input
                    type="number"
                    className="h-8 text-sm"
                    value={savingsMax}
                    onChange={e => onUpdateSavings(strategy.id, savingsMin, Number(e.target.value))}
                  />
                </div>
              </div>
              {/* Rationale */}
              <div>
                <Label className="text-xs">Why Recommended (appears in PDF)</Label>
                <Textarea
                  rows={3}
                  className="text-sm"
                  data-testid={`textarea-rationale-${strategy.id}`}
                  value={rationale}
                  onChange={e => onUpdateRationale(strategy.id, e.target.value)}
                  placeholder="Explain specifically why this strategy applies to this client..."
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// =================== ENTITY STRATEGIES TAB ===================
function EntityStrategiesPanel({ entity, clientName }: { entity: Entity; clientName: string }) {
  const { toast } = useToast();
  const [selections, setSelections] = useState<Record<string, StrategySelection>>({});
  const [loaded, setLoaded] = useState(false);

  const { data: savedSelections = [] } = useQuery<StrategySelection[]>({
    queryKey: ["/api/entities", entity.id, "selections"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/entities/${entity.id}/selections`);
      return res.json();
    },
  });

  // Compute triggers from entity data
  function computeTriggers(e: Entity): Set<TriggerKey> {
    const t = new Set<TriggerKey>();
    if ((e.w2Wages ?? 0) > 0) t.add("has_wages");
    if ((e.netProfit ?? 0) > 0 || (e.grossRevenue ?? 0) > 0) t.add("has_business_income");
    if ((e.netProfit ?? 0) > 0) t.add("has_net_profit");
    if ((e.netProfit ?? 0) > 100000) t.add("business_net_profit_over_100k");
    if ((e.netProfit ?? 0) > 50000) t.add("business_net_profit_over_50k");
    if ((e.netProfit ?? 0) < 0) t.add("business_has_loss");
    if (e.hasEmployees) t.add("has_employees");
    if (e.hasNonOwnerEmployees) t.add("has_non_owner_employees");
    if ((e.mortgageInterest ?? 0) > 0) t.add("has_mortgage_interest");
    if ((e.iraDistributions ?? 0) > 0) t.add("has_ira_distributions");
    if ((e.capitalGains ?? 0) > 0) t.add("has_capital_gains");
    if ((e.capitalGains ?? 0) > 0) t.add("has_long_term_capital_gains");
    if ((e.charitableDonations ?? 0) > 0) t.add("has_charitable_donations");
    const agi = e.agi ?? (e.netProfit ?? 0) + (e.w2Wages ?? 0);
    if (agi > 150000) t.add("agi_over_150k");
    if (agi > 400000) t.add("agi_over_400k");
    if ((e.numberOfDependents ?? 0) > 0) t.add("has_dependents");
    if (e.dependentsHaveEarnedIncome) t.add("dependents_have_earned_income");
    if ((e.vehicleExpenses ?? 0) > 0) t.add("has_vehicle_expense");
    if ((e.travelExpenses ?? 0) > 0) t.add("has_travel_expense");
    if ((e.mealExpenses ?? 0) > 0) t.add("has_meals_expense");
    if ((e.homeOfficeExpenses ?? 0) > 0) t.add("has_home_office_expense");
    if ((e.rentalIncome ?? 0) > 0) t.add("has_rental_income");
    if ((e.partnershipIncome ?? 0) > 0) t.add("has_passive_income");
    if ((e.stateLocalTaxes ?? 0) >= 10000) t.add("salt_at_limit");
    if ((e.medicalExpenses ?? 0) > 0) t.add("has_medical_expenses");
    if (e.hasRealProperty) { t.add("has_real_property"); t.add("has_real_estate"); }
    if (e.hasBusinessVehiclePurchase) t.add("has_business_vehicle_purchase");
    if (e.hasHealthInsurancePersonal) t.add("has_health_insurance_personal");
    if (e.entityType === "1065") t.add("is_partnership_or_schedule_c");
    if (e.entityType === "1120S") t.add("is_s_corp");
    if (e.entityType === "C-Corp") t.add("is_c_corp");
    return t;
  }

  const triggers = computeTriggers(entity);
  const { suggested, excluded } = autoSuggestStrategies(entity.entityType as EntityType, triggers);

  // Initialize selections from saved data or auto-suggest
  useEffect(() => {
    if (savedSelections.length > 0 && !loaded) {
      const map: Record<string, StrategySelection> = {};
      savedSelections.forEach(s => { map[s.strategyId] = s; });
      setSelections(map);
      setLoaded(true);
    } else if (!loaded && savedSelections.length === 0) {
      // Auto-init
      const map: Record<string, StrategySelection> = {};
      let order = 0;
      suggested.forEach(s => {
        map[s.id] = {
          id: 0, entityId: entity.id, strategyId: s.id,
          status: "suggested", savingsMin: s.savingsMin, savingsMax: s.savingsMax,
          rationale: "", sortOrder: order++
        };
      });
      excluded.forEach(s => {
        map[s.id] = {
          id: 0, entityId: entity.id, strategyId: s.id,
          status: "excluded", savingsMin: null, savingsMax: null,
          rationale: "", sortOrder: order++
        };
      });
      setSelections(map);
      setLoaded(true);
    }
  }, [savedSelections, loaded]);

  const saveBulk = useMutation({
    mutationFn: () => apiRequest("POST", `/api/entities/${entity.id}/selections/bulk`, {
      selections: Object.values(selections).map(s => ({
        strategyId: s.strategyId,
        status: s.status,
        savingsMin: s.savingsMin,
        savingsMax: s.savingsMax,
        rationale: s.rationale,
        sortOrder: s.sortOrder,
      }))
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/entities", entity.id, "selections"] });
      toast({ title: "Strategies saved" });
    },
  });

  const handleToggle = (stratId: string, newStatus: string) => {
    setSelections(prev => {
      const cur = prev[stratId];
      const strat = STRATEGIES.find(s => s.id === stratId)!;
      return { ...prev, [stratId]: {
        ...cur,
        status: newStatus,
        savingsMin: newStatus === "manual_add" ? strat.savingsMin : null,
        savingsMax: newStatus === "manual_add" ? strat.savingsMax : null,
      }};
    });
  };

  const handleUpdateSavings = (stratId: string, min: number, max: number) => {
    setSelections(prev => ({ ...prev, [stratId]: { ...prev[stratId], savingsMin: min, savingsMax: max } }));
  };

  const handleUpdateRationale = (stratId: string, text: string) => {
    setSelections(prev => ({ ...prev, [stratId]: { ...prev[stratId], rationale: text } }));
  };

  const activeSelections = Object.values(selections).filter(s => s.status === "suggested" || s.status === "manual_add");
  const totalMin = activeSelections.reduce((sum, s) => sum + (s.savingsMin ?? 0), 0);
  const totalMax = activeSelections.reduce((sum, s) => sum + (s.savingsMax ?? 0), 0);
  const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  const allStrategies = [...suggested, ...excluded];

  return (
    <div>
      {/* Totals bar */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Potential Savings for {entity.name}</p>
          <p className="text-2xl font-bold text-primary" data-testid={`text-savings-${entity.id}`}>
            {fmt(totalMin)} – {fmt(totalMax)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">{activeSelections.length} strategies</p>
          <Button size="sm" onClick={() => saveBulk.mutate()} disabled={saveBulk.isPending} data-testid={`button-save-strategies-${entity.id}`}>
            {saveBulk.isPending ? "Saving..." : "Save Strategies"}
          </Button>
        </div>
      </div>

      {/* Re-run auto-suggest */}
      <div className="flex justify-end mb-3">
        <Button size="sm" variant="outline" onClick={() => setLoaded(false)}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Re-run Auto-Suggest
        </Button>
      </div>

      {/* Strategy cards */}
      <Tabs defaultValue="suggested">
        <TabsList>
          <TabsTrigger value="suggested">Included ({activeSelections.length})</TabsTrigger>
          <TabsTrigger value="all">All Strategies ({allStrategies.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="suggested" className="mt-3">
          {activeSelections.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No strategies included yet. Switch to "All Strategies" to add some.</p>
          ) : (
            activeSelections.map(sel => {
              const strat = STRATEGIES.find(s => s.id === sel.strategyId);
              if (!strat) return null;
              return <StrategyCard key={strat.id} strategy={strat} selection={sel} onToggle={handleToggle} onUpdateSavings={handleUpdateSavings} onUpdateRationale={handleUpdateRationale} />;
            })
          )}
        </TabsContent>
        <TabsContent value="all" className="mt-3">
          {allStrategies.map(strat => (
            <StrategyCard
              key={strat.id}
              strategy={strat}
              selection={selections[strat.id]}
              onToggle={handleToggle}
              onUpdateSavings={handleUpdateSavings}
              onUpdateRationale={handleUpdateRationale}
            />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// =================== MAIN WORKFLOW ===================
export default function ClientWorkflow() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [activeEntityId, setActiveEntityId] = useState<number | null>(null);
  const [newEntityForm, setNewEntityForm] = useState({ name: "", entityType: "1040" });
  const [generating, setGenerating] = useState(false);
  const [generatingPremium, setGeneratingPremium] = useState(false);

  const clientId = Number(params.id);

  const { data: client } = useQuery<Client>({
    queryKey: ["/api/clients", clientId],
  });

  const { data: entities = [] } = useQuery<Entity[]>({
    queryKey: ["/api/clients", clientId, "entities"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/clients/${clientId}/entities`);
      return res.json();
    },
  });

  const createEntity = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/entities", { ...data, clientId }),
    onSuccess: async (res) => {
      const entity = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "entities"] });
      setActiveEntityId(entity.id);
      setNewEntityForm({ name: "", entityType: "1040" });
    },
  });

  const updateEntity = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Partial<Entity> }) =>
      apiRequest("PATCH", `/api/entities/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "entities"] });
      toast({ title: "Entity saved" });
    },
  });

  const deleteEntity = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/entities/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "entities"] });
      if (activeEntityId && entities.find(e => e.id === activeEntityId)) setActiveEntityId(null);
    },
  });

  const generatePdf = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/api/clients/${clientId}/generate-pdf`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || err.message || "PDF generation failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Tax-Roadmap-${client?.name?.replace(/\s+/g, "-") || "Client"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "PDF downloaded successfully" });
    } catch (e: any) {
      toast({ title: "PDF generation failed", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const generatePremiumPdf = async () => {
    setGeneratingPremium(true);
    try {
      const res = await fetch(`${API_BASE}/api/clients/${clientId}/generate-premium-pdf`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || err.message || "Premium PDF generation failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Premium-Analysis-${client?.name?.replace(/\s+/g, "-") || "Client"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Premium report downloaded" });
    } catch (e: any) {
      toast({ title: "Premium PDF failed", description: e.message, variant: "destructive" });
    } finally {
      setGeneratingPremium(false);
    }
  };

  if (!client) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;

  const activeEntity = entities.find(e => e.id === activeEntityId) ?? entities[0] ?? null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-primary text-primary-foreground">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-4">
          <Button variant="ghost" size="sm" className="text-primary-foreground hover:bg-white/10" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div className="flex-1">
            <h1 className="font-semibold" style={{ fontFamily: "serif" }}>{client.name}</h1>
            <p className="text-xs opacity-70">Tax Year {client.taxYear} · {client.filingStatus} · {client.inputMode === "financials" ? "Financials Only" : "Tax Return"}</p>
          </div>
          {step === 4 && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={generatePdf} disabled={generating} data-testid="button-generate-pdf">
                <FileDown className="w-4 h-4 mr-1" />
                {generating ? "Generating..." : "Standard Roadmap"}
              </Button>
              <Button
                onClick={generatePremiumPdf}
                disabled={generatingPremium}
                data-testid="button-generate-premium-pdf"
                style={{ backgroundColor: "#b5cc42", color: "#1b2951", fontWeight: 600 }}
              >
                <FileDown className="w-4 h-4 mr-1" />
                {generatingPremium ? "Generating..." : "Premium Report"}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Step bar */}
      <div className="border-b bg-white">
        <div className="max-w-6xl mx-auto px-6 py-3 overflow-x-auto">
          <StepBar step={step} total={4} />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">

        {/* STEP 1: Client Info (already set, just confirm) */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Client Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Client Name</Label>
                  <Input defaultValue={client.name} onBlur={e => apiRequest("PATCH", `/api/clients/${clientId}`, { name: e.target.value })} /></div>
                <div><Label>Tax Year</Label>
                  <Input type="number" defaultValue={client.taxYear} onBlur={e => apiRequest("PATCH", `/api/clients/${clientId}`, { taxYear: Number(e.target.value) })} /></div>
                <div><Label>Filing Status</Label>
                  <Select defaultValue={client.filingStatus} onValueChange={v => apiRequest("PATCH", `/api/clients/${clientId}`, { filingStatus: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MFJ">Married Filing Jointly</SelectItem>
                      <SelectItem value="Single">Single</SelectItem>
                      <SelectItem value="HOH">Head of Household</SelectItem>
                      <SelectItem value="MFS">Married Filing Separately</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Preparation Date</Label>
                  <Input type="date" defaultValue={client.preparationDate} onBlur={e => apiRequest("PATCH", `/api/clients/${clientId}`, { preparationDate: e.target.value })} /></div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
                <strong>Input Mode:</strong> {client.inputMode === "financials"
                  ? "Financials Only — strategies will be suggested based on P&L / balance sheet data"
                  : "Tax Return — strategies will be suggested from actual return data"}
              </div>
              <Button onClick={() => setStep(2)} className="mt-2">
                Continue to Entities →
              </Button>
            </CardContent>
          </Card>
        )}

        {/* STEP 2: Entities */}
        {step === 2 && (
          <div className="grid grid-cols-12 gap-4">
            {/* Sidebar: entity list */}
            <div className="col-span-12 md:col-span-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Entities</CardTitle>
                </CardHeader>
                <CardContent className="p-2 space-y-1">
                  {entities.map(e => (
                    <div
                      key={e.id}
                      className={`flex items-center justify-between p-2 rounded cursor-pointer text-sm ${activeEntityId === e.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                      onClick={() => setActiveEntityId(e.id)}
                      data-testid={`entity-tab-${e.id}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {e.entityType === "1040" ? <User className="w-3.5 h-3.5 flex-shrink-0" /> : <Building2 className="w-3.5 h-3.5 flex-shrink-0" />}
                        <span className="truncate">{e.name}</span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-5 w-5 flex-shrink-0" onClick={ev => { ev.stopPropagation(); deleteEntity.mutate(e.id); }}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}

                  {/* Add entity form */}
                  <div className="border-t pt-2 mt-2 space-y-2">
                    <Input
                      placeholder="Entity name"
                      className="h-8 text-xs"
                      value={newEntityForm.name}
                      onChange={e => setNewEntityForm(f => ({ ...f, name: e.target.value }))}
                      data-testid="input-new-entity-name"
                    />
                    <Select value={newEntityForm.entityType} onValueChange={v => setNewEntityForm(f => ({ ...f, entityType: v }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1040">Individual (1040)</SelectItem>
                        <SelectItem value="1120S">S-Corp (1120-S)</SelectItem>
                        <SelectItem value="1065">Partnership (1065)</SelectItem>
                        <SelectItem value="C-Corp">C-Corp (1120)</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="w-full h-8" data-testid="button-add-entity" disabled={!newEntityForm.name.trim()} onClick={() => createEntity.mutate(newEntityForm)}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add Entity
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Main: entity form */}
            <div className="col-span-12 md:col-span-9">
              {activeEntity ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {activeEntity.entityType === "1040" ? <User className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                      {activeEntity.name}
                      <Badge variant="outline" className="text-xs">{activeEntity.entityType}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DocumentUploadPanel
                      entity={activeEntity}
                      onFieldsExtracted={() => {
                        queryClient.invalidateQueries({ queryKey: ["/api/clients", client.id, "entities"] });
                      }}
                    />
                    <Separator className="my-4" />
                    <EntityDataForm
                      entity={activeEntity}
                      inputMode={client.inputMode}
                      onSave={updates => updateEntity.mutate({ id: activeEntity.id, updates })}
                    />
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="text-center py-16 text-muted-foreground">
                    <Building2 className="w-10 h-10 mx-auto mb-3" />
                    <p>Add an entity on the left to get started.</p>
                    <p className="text-sm mt-1">For most clients, start with the Individual (1040), then add business entities.</p>
                  </CardContent>
                </Card>
              )}

              {entities.length > 0 && (
                <div className="flex justify-end mt-4 gap-2">
                  <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
                  <Button onClick={() => setStep(3)}>Continue to Strategies →</Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: Strategies */}
        {step === 3 && (
          <div>
            <div className="flex gap-2 mb-4 flex-wrap">
              {entities.map(e => (
                <Button
                  key={e.id}
                  variant={activeEntityId === e.id || (activeEntityId === null && e.id === entities[0]?.id) ? "default" : "outline"}
                  size="sm"
                  onClick={() => setActiveEntityId(e.id)}
                  data-testid={`strategy-tab-${e.id}`}
                >
                  {e.entityType === "1040" ? <User className="w-3.5 h-3.5 mr-1" /> : <Building2 className="w-3.5 h-3.5 mr-1" />}
                  {e.name}
                </Button>
              ))}
            </div>

            {entities.length === 0 ? (
              <p className="text-muted-foreground">No entities added yet. Go back to Step 2.</p>
            ) : (
              <EntityStrategiesPanel
                entity={activeEntity ?? entities[0]}
                clientName={client.name}
              />
            )}

            <div className="flex justify-end mt-6 gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>← Back</Button>
              <Button onClick={() => setStep(4)}>Continue to Review →</Button>
            </div>
          </div>
        )}

        {/* STEP 4: Review & Export */}
        {step === 4 && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Review Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="bg-muted/50 rounded p-3">
                      <p className="text-muted-foreground">Client</p>
                      <p className="font-semibold">{client.name}</p>
                    </div>
                    <div className="bg-muted/50 rounded p-3">
                      <p className="text-muted-foreground">Tax Year</p>
                      <p className="font-semibold">{client.taxYear}</p>
                    </div>
                    <div className="bg-muted/50 rounded p-3">
                      <p className="text-muted-foreground">Entities</p>
                      <p className="font-semibold">{entities.length}</p>
                    </div>
                  </div>

                  <Separator />

                  <p className="text-sm font-medium">Entities & Strategies:</p>
                  {entities.map(e => (
                    <div key={e.id} className="flex items-center justify-between p-2 bg-muted/30 rounded text-sm">
                      <span className="flex items-center gap-2">
                        {e.entityType === "1040" ? <User className="w-3.5 h-3.5" /> : <Building2 className="w-3.5 h-3.5" />}
                        {e.name}
                        <Badge variant="outline" className="text-xs">{e.entityType}</Badge>
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => { setActiveEntityId(e.id); setStep(3); }}>
                        <PencilLine className="w-3.5 h-3.5 mr-1" /> Edit
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center space-y-4">
                    <FileDown className="w-10 h-10 mx-auto text-primary" />
                    <h3 className="text-lg font-semibold">Standard Roadmap</h3>
                    <p className="text-muted-foreground text-sm">
                      Clean cover page, entity summary, suggested strategies with savings ranges, excluded strategies, and next steps.
                    </p>
                    <Button size="lg" onClick={generatePdf} disabled={generating} data-testid="button-generate-pdf-review">
                      <FileDown className="w-4 h-4 mr-2" />
                      {generating ? "Generating..." : "Download Roadmap PDF"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card style={{ border: "2px solid #b5cc42" }}>
                <CardContent className="pt-6">
                  <div className="text-center space-y-4">
                    <div className="w-10 h-10 mx-auto rounded-full flex items-center justify-center" style={{ backgroundColor: "#b5cc42" }}>
                      <FileDown className="w-5 h-5" style={{ color: "#1b2951" }} />
                    </div>
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ backgroundColor: "#b5cc42", color: "#1b2951" }}>Premium</span>
                      <h3 className="text-lg font-semibold mt-2">Multi-Year Analysis Report</h3>
                    </div>
                    <p className="text-muted-foreground text-sm">
                      5-year projections per strategy, cumulative savings chart, and a quarterly action plan for maximum implementation and audit protection.
                    </p>
                    <Button
                      size="lg"
                      onClick={generatePremiumPdf}
                      disabled={generatingPremium}
                      data-testid="button-generate-premium-pdf-review"
                      style={{ backgroundColor: "#b5cc42", color: "#1b2951", fontWeight: 600 }}
                    >
                      <FileDown className="w-4 h-4 mr-2" />
                      {generatingPremium ? "Generating..." : "Download Premium Report"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-start mt-2">
              <Button variant="outline" onClick={() => setStep(3)}>← Back to Strategies</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
