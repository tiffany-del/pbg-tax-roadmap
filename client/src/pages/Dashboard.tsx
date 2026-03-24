import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest, API_BASE } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, FileText, Trash2, ArrowRight, ClipboardList, Users,
  Eye, Download, Mail, Building2, DollarSign, ExternalLink, Copy, Check,
  Zap, CheckCircle2, AlertCircle, ChevronRight, Globe,
} from "lucide-react";
import type { Client } from "@shared/schema";
import type { QuizSubmission } from "@shared/schema";
import {
  structureLabel, revenueLabel, profitLabel, taxBillLabel,
  mapQuizToStrategies,
} from "@/lib/quizStrategies";

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// ─── Tab type ───────────────────────────────────────
type Tab = "clients" | "quiz" | "ghl";

// ─── Status badge ────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    new:       "bg-[#b5cc42]/20 text-[#5a6e00] border-[#b5cc42]/40",
    viewed:    "bg-blue-50 text-blue-700 border-blue-200",
    converted: "bg-green-50 text-green-700 border-green-200",
  };
  const labels: Record<string, string> = { new: "New", viewed: "Viewed", converted: "Converted" };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${styles[status] ?? "bg-gray-100 text-gray-600"}`}>
      {labels[status] ?? status}
    </span>
  );
}

function QuizCard({
  quiz,
  onNavigate,
  onDelete,
}: {
  quiz: QuizSubmission;
  onNavigate: (id: number | string) => void;
  onDelete: (id: number | string) => void;
}) {
  const { toast } = useToast();

  const { data: pdfStatus } = useQuery<{ ready: boolean; generatedAt: string | null }>({
    queryKey: ["/api/quiz", quiz.id, "pdf-status"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/quiz/${quiz.id}/pdf-status`);
      return res.json();
    },
    refetchInterval: (query) => (query.state.data?.ready ? false : 5000),
  });

  const strategies = mapQuizToStrategies(quiz);
  const suggested  = strategies.filter(s => s.status === "suggested");
  const totalMin   = suggested.reduce((a, s) => a + s.savingsMin, 0);
  const totalMax   = suggested.reduce((a, s) => a + s.savingsMax, 0);
  const pdfReady   = pdfStatus?.ready ?? false;

  function downloadPdf() {
    const a = document.createElement("a");
    a.href = `${API_BASE}/api/quiz/${quiz.id}/pdf`;
    a.download = `Tax-Roadmap-${quiz.firstName}-${quiz.lastName}.pdf`;
    a.click();
    toast({ title: "Downloading Roadmap PDF..." });
  }

  return (
    <div
      data-testid={`quiz-card-${quiz.id}`}
      className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Avatar */}
          <div className="w-10 h-10 bg-[#f7cac9] rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-[#1b2951] font-bold text-sm">
              {quiz.firstName[0]}{quiz.lastName[0]}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-gray-900">{quiz.firstName} {quiz.lastName}</p>
              <StatusBadge status={quiz.status} />
              {pdfReady && (
                <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-[#1b2951]/10 text-[#1b2951] border-[#1b2951]/20 flex items-center gap-1">
                  <FileText className="w-3 h-3" /> PDF Ready
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Mail className="w-3 h-3" /> {quiz.email}
              </span>
              {quiz.phone && (
                <span className="text-xs text-gray-400">{quiz.phone}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                <Building2 className="w-3 h-3" />
                {structureLabel(quiz.businessStructure)}
              </span>
              <span className="flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                <DollarSign className="w-3 h-3" />
                {profitLabel(quiz.annualProfit)} profit
              </span>
              <span className="text-xs text-gray-400">
                {new Date(quiz.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        {/* Savings + actions */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <div className="text-right">
            <p className="text-sm font-bold text-[#1b2951]">
              {fmt(totalMin)} – {fmt(totalMax)}
            </p>
            <p className="text-xs text-gray-400">{suggested.length} strategies</p>
          </div>
          <div className="flex items-center gap-1.5">
            {pdfReady && (
              <Button
                size="sm"
                onClick={downloadPdf}
                data-testid={`button-download-pdf-${quiz.id}`}
                className="text-xs bg-[#b5cc42] hover:bg-[#a3b83a] text-[#1b2951] font-semibold"
              >
                <Download className="w-3.5 h-3.5 mr-1" /> Download PDF
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNavigate(quiz.id)}
              data-testid={`button-review-quiz-${quiz.id}`}
              className="text-xs border-[#1b2951] text-[#1b2951] hover:bg-[#1b2951] hover:text-white"
            >
              <Eye className="w-3.5 h-3.5 mr-1" /> Review
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete(quiz.id)}
              data-testid={`button-delete-quiz-${quiz.id}`}
              className="text-gray-400 hover:text-red-500"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("clients");
  const [open, setOpen] = useState(false);
  // GHL sync build: 2026-03-23
  const [copied, setCopied] = useState(false);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [bodyCopied, setBodyCopied] = useState(false);
  const [form, setForm] = useState({
    name: "", taxYear: new Date().getFullYear(), filingStatus: "MFJ", inputMode: "tax_return",
  });

  // ── Clients query ──
  const { data: clients = [], isLoading: clientsLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  // ── Quiz submissions query ──
  const { data: quizzes = [], isLoading: quizzesLoading, error: quizzesError } = useQuery<QuizSubmission[]>({
    queryKey: ["/api/quiz"],
    staleTime: 0,
    refetchOnMount: true,
    retry: 2,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/quiz`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to load quiz submissions: ${res.status} ${text.slice(0, 100)}`);
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const newCount = quizzes.filter(q => q.status === "new").length;

  // ── Create client mutation ──
  const createClient = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/clients", {
      ...data,
      preparationDate: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    onSuccess: async (res) => {
      const client = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setOpen(false);
      navigate(`/client/${client.id}`);
    },
    onError: () => toast({ title: "Error creating client", variant: "destructive" }),
  });

  const deleteClient = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/clients/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/clients"] }),
  });

  const deleteQuiz = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/quiz/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/quiz"] }),
  });

  // Quiz + webhook links
  // Frontend is hosted on Netlify (permanent). Backend API is on sites.pplx.app.
  const quizUrl    = "https://luminous-sopapillas-61551c.netlify.app/#/quiz";
  // Webhook always points to Express backend on sites.pplx.app, never Netlify
  const webhookUrl = "https://sites.pplx.app/api/ghl/webhook";
  const webhookBody = JSON.stringify({ contact_id: "{{contact.id}}", location_id: "{{location.id}}", tags: "{{contact.tags}}" }, null, 2);

  const copyQuizLink = () => {
    navigator.clipboard.writeText(quizUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#f5f5f0]">
      {/* ── Header ── */}
      <div className="bg-[#1b2951] text-white px-4 py-4 shadow-lg">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/pbg_logo_horizontal.png"
              alt="Phillips Business Group"
              className="h-8 object-contain"
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div className="h-6 w-px bg-white/20" />
            <div>
              <h1 className="text-base font-semibold" style={{ fontFamily: "serif" }}>
                Tax Roadmap Generator
              </h1>
              <p className="text-xs opacity-50">Internal Tool · PBG Team</p>
            </div>
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                data-testid="button-new-client"
                className="bg-[#b5cc42] text-[#1b2951] hover:bg-[#b5cc42]/90 font-semibold"
              >
                <Plus className="w-4 h-4 mr-1" /> New Client Roadmap
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Client Roadmap</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <Label htmlFor="name">Client Name</Label>
                  <Input
                    id="name"
                    data-testid="input-client-name"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="John & Mary Smith"
                    className="mt-1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Tax Year</Label>
                    <Input
                      type="number"
                      data-testid="input-tax-year"
                      value={form.taxYear}
                      onChange={e => setForm(f => ({ ...f, taxYear: Number(e.target.value) }))}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Filing Status</Label>
                    <Select value={form.filingStatus} onValueChange={v => setForm(f => ({ ...f, filingStatus: v }))}>
                      <SelectTrigger className="mt-1" data-testid="select-filing-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MFJ">Married Filing Jointly</SelectItem>
                        <SelectItem value="Single">Single</SelectItem>
                        <SelectItem value="HOH">Head of Household</SelectItem>
                        <SelectItem value="MFS">Married Filing Separately</SelectItem>
                        <SelectItem value="QW">Qualifying Widow(er)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Data Source</Label>
                  <Select value={form.inputMode} onValueChange={v => setForm(f => ({ ...f, inputMode: v }))}>
                    <SelectTrigger className="mt-1" data-testid="select-input-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tax_return">Tax Return</SelectItem>
                      <SelectItem value="financials">Financial Statements Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full bg-[#1b2951] hover:bg-[#1b2951]/90"
                  data-testid="button-create-client"
                  onClick={() => createClient.mutate(form)}
                  disabled={!form.name || createClient.isPending}
                >
                  {createClient.isPending ? "Creating..." : "Create & Start Roadmap"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 flex gap-0">
          <button
            onClick={() => setTab("clients")}
            data-testid="tab-clients"
            className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors ${
              tab === "clients"
                ? "border-[#1b2951] text-[#1b2951]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <FileText className="w-4 h-4" />
            Client Roadmaps
            {clients.length > 0 && (
              <span className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">
                {clients.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("quiz")}
            data-testid="tab-quiz"
            className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors ${
              tab === "quiz"
                ? "border-[#1b2951] text-[#1b2951]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <ClipboardList className="w-4 h-4" />
            Quick Quote Submissions
            {newCount > 0 && (
              <span className="bg-[#b5cc42] text-[#1b2951] text-xs px-1.5 py-0.5 rounded-full font-bold">
                {newCount} new
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("ghl")}
            data-testid="tab-ghl"
            className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors ${
              tab === "ghl"
                ? "border-[#1b2951] text-[#1b2951]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <Zap className="w-4 h-4" />
            GHL Automation
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">

        {/* ── CLIENTS TAB ── */}
        {tab === "clients" && (
          <div className="space-y-3">
            {/* Show notice when running on Netlify (no Perplexity proxy in path) */}
            {typeof window !== "undefined" && !window.location.pathname.includes("/computer/a/") && (
              <div className="bg-[#1b2951]/5 border border-[#1b2951]/20 rounded-xl p-5 flex items-start gap-4">
                <div className="w-10 h-10 bg-[#1b2951] rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <ExternalLink className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-[#1b2951] mb-1">Client Roadmaps are managed inside Perplexity</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Creating client roadmaps and generating PDFs requires the backend, which runs inside
                    the Perplexity conversation where this tool was built. To access it:
                  </p>
                  <ol className="text-sm text-gray-600 mt-2 ml-4 space-y-1 list-decimal">
                    <li>Go to <strong>perplexity.ai</strong> and log in</li>
                    <li>Open the <strong>Tax Savings Roadmap</strong> conversation</li>
                    <li>Click the <strong>PBG Tax Roadmap Tool</strong> card in the chat</li>
                    <li>Log in with your team password</li>
                  </ol>
                </div>
              </div>
            )}
            {clientsLoading && (
              <div className="text-center py-12 text-gray-400">Loading clients...</div>
            )}
            {!clientsLoading && clients.length === 0 && !(!window.location.pathname.includes("/computer/a/")) && (
              <div className="text-center py-16 bg-white rounded-xl border border-gray-100 shadow-sm">
                <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <h3 className="font-semibold text-gray-700 mb-1">No client roadmaps yet</h3>
                <p className="text-sm text-gray-400 mb-4">Click "New Client Roadmap" to get started.</p>
                <Button
                  onClick={() => setOpen(true)}
                  className="bg-[#1b2951] hover:bg-[#1b2951]/90 text-white"
                >
                  <Plus className="w-4 h-4 mr-1" /> New Client Roadmap
                </Button>
              </div>
            )}
            {!clientsLoading && clients.length === 0 && !window.location.pathname.includes("/computer/a/") && (
              <div className="text-center py-8 text-gray-400 text-sm">No client roadmaps available here.</div>
            )}
            {clients.map(client => (
              <div
                key={client.id}
                data-testid={`client-card-${client.id}`}
                className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow p-4 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-10 h-10 bg-[#1b2951] rounded-lg flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-bold text-sm">
                      {client.name.split(" ").map(w => w[0]).slice(0, 2).join("")}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{client.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-gray-400">Tax Year {client.taxYear}</span>
                      <span className="text-gray-200">·</span>
                      <span className="text-xs text-gray-400">{client.filingStatus}</span>
                      <span className="text-gray-200">·</span>
                      <span className="text-xs text-gray-400">
                        {client.inputMode === "tax_return" ? "Tax Return" : "Financials"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    onClick={() => navigate(`/client/${client.id}`)}
                    data-testid={`button-open-client-${client.id}`}
                    className="bg-[#1b2951] hover:bg-[#1b2951]/90 text-white text-xs"
                  >
                    Open <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`Delete ${client.name}?`)) deleteClient.mutate(client.id);
                    }}
                    data-testid={`button-delete-client-${client.id}`}
                    className="text-gray-400 hover:text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── GHL TAB ── */}
        {tab === "ghl" && (
          <div className="space-y-5 max-w-3xl">

            {/* Status banner */}
            <div className="bg-[#1b2951] rounded-xl p-5 text-white">
              <div className="flex items-center gap-3 mb-3">
                <Zap className="w-5 h-5 text-[#b5cc42]" />
                <h2 className="font-semibold text-base">GHL → Auto Roadmap Integration</h2>
              </div>
              <p className="text-sm opacity-80 leading-relaxed">
                When a contact in GoHighLevel (app.certaintyengine.io) is tagged with{" "}
                <code className="bg-white/20 px-1.5 py-0.5 rounded text-xs font-mono">purchase - tax savings roadmap</code>,
                their custom field data is automatically pulled, a Tax Savings Roadmap PDF is generated, and the PDF is saved to their GHL contact record. Your team is notified in Slack.
              </p>
            </div>

            {/* Step 1: API Key */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-[#1b2951] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
                <h3 className="font-semibold text-gray-800">Get your GHL Private Integration Token</h3>
              </div>
              <ol className="text-sm text-gray-600 space-y-1.5 ml-8 list-decimal">
                <li>Log in to <a href="https://app.certaintyengine.io" target="_blank" rel="noopener" className="text-[#1b2951] underline font-medium">app.certaintyengine.io</a></li>
                <li>Go to your <strong>Sub-Account</strong> → <strong>Settings</strong> → <strong>Integrations</strong></li>
                <li>Click <strong>Private Integrations</strong> → <strong>+ Create New Integration</strong></li>
                <li>Enable scopes: <code className="bg-gray-100 px-1 rounded text-xs">Contacts (Read)</code>, <code className="bg-gray-100 px-1 rounded text-xs">Contacts/Notes (Write)</code>, <code className="bg-gray-100 px-1 rounded text-xs">Media Library (Write)</code></li>
                <li>Copy the generated token — this is your <strong>GHL_API_KEY</strong></li>
              </ol>
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                <strong>Where to set GHL_API_KEY:</strong> On the server running this app, set the environment variable <code className="font-mono">GHL_API_KEY=&lt;your token&gt;</code> before starting. Contact your IT team or the person who deployed this tool.
              </div>
            </div>

            {/* Step 2: Slack Webhook */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-[#1b2951] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>
                <h3 className="font-semibold text-gray-800">Set up Slack notifications</h3>
              </div>
              <ol className="text-sm text-gray-600 space-y-1.5 ml-8 list-decimal">
                <li>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener" className="text-[#1b2951] underline font-medium">api.slack.com/apps</a> → create or select an app</li>
                <li>Enable <strong>Incoming Webhooks</strong> → Add New Webhook to Workspace</li>
                <li>Choose the channel where PBG should receive notifications</li>
                <li>Copy the Webhook URL — set it as <code className="font-mono bg-gray-100 px-1 rounded text-xs">SLACK_WEBHOOK_URL</code> env var on the server</li>
              </ol>
            </div>

            {/* Step 3: GHL Workflow */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-[#1b2951] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">3</span>
                <h3 className="font-semibold text-gray-800">Create the GHL Workflow</h3>
              </div>
              <ol className="text-sm text-gray-600 space-y-1.5 ml-8 list-decimal">
                <li>In GHL go to <strong>Automation → Workflows → + New Workflow</strong></li>
                <li>Add trigger: <strong>Tag Added</strong> → filter tag = <code className="bg-gray-100 px-1 rounded text-xs">purchase - tax savings roadmap</code></li>
                <li>Add action: <strong>Webhook</strong> → Method: <strong>POST</strong></li>
                <li>
                  Set the Webhook URL to:
                  <div className="flex items-center gap-2 mt-1.5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono text-xs">
                    <span className="flex-1 break-all text-[#1b2951]">{webhookUrl}</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(webhookUrl); setWebhookCopied(true); setTimeout(() => setWebhookCopied(false), 2000); }}
                      className="flex-shrink-0 text-gray-400 hover:text-[#1b2951] transition-colors"
                    >
                      {webhookCopied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </li>
                <li>
                  Set Body Type to <strong>JSON</strong> and paste this body:
                  <div className="relative mt-1.5">
                    <pre className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-gray-700 overflow-x-auto">{webhookBody}</pre>
                    <button
                      onClick={() => { navigator.clipboard.writeText(webhookBody); setBodyCopied(true); setTimeout(() => setBodyCopied(false), 2000); }}
                      className="absolute top-2 right-2 text-gray-400 hover:text-[#1b2951] transition-colors"
                    >
                      {bodyCopied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </li>
                <li><strong>Save and Publish</strong> the workflow</li>
              </ol>
            </div>

            {/* Field mapping reference */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-semibold text-gray-800 mb-3">Custom Fields Mapped</h3>
              <p className="text-xs text-gray-500 mb-3">These 14 GHL custom fields are automatically read and mapped to the roadmap PDF generator.</p>
              <div className="space-y-1.5">
                {[
                  ["filing_status", "Filing Status"],
                  ["total_household_income_range", "Total Household Income (Range)"],
                  ["total_w_2_income_household_range", "Total W-2 Income (Household)"],
                  ["do_you_have_investment_income_capital_gains_dividends", "Investment Income?"],
                  ["business_revenue_range", "Business Revenue (Range)"],
                  ["do_you_own_a_business", "Do You Own A Business?"],
                  ["business_net_profit_range", "Business Net Profit (Range)"],
                  ["how_is_your_business_taxed", "How Is Your Business Taxed?"],
                  ["corp_only_owner_w_2_salary_paid_to_you_range", "Owner W-2 Salary Paid To You"],
                  ["single_dropdown_20ntn", "TSR - Dependents Over 17"],
                  ["dependents_under_171", "TSR - Dependents Under 17"],
                  ["how_many_employees_do_you_have_not_including_you_or_your_spouse", "How Many Employees?"],
                  ["do_you_own_your_home", "Do You Own Your Home?"],
                  ["state_of_residence", "State Of Residence"],
                ].map(([key, label]) => (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#b5cc42] flex-shrink-0" />
                    <span className="text-gray-700 font-medium w-40 flex-shrink-0">{label}</span>
                    <code className="text-gray-400 font-mono truncate">contact.{key}</code>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* ── QUIZ TAB ── */}
        {tab === "quiz" && (
          <div className="space-y-4">
            {/* Quiz link card */}
            <div className="bg-[#1b2951] rounded-xl p-5 text-white">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-xs opacity-60 uppercase tracking-wider mb-1">Client Quiz Link</p>
                  <p className="font-semibold mb-1">Share this link with prospects</p>
                  <p className="text-sm opacity-70 mb-3">
                    Clients complete 5 quick steps. Their answers appear here instantly and you can generate their Tax Savings Roadmap PDF in one click.
                  </p>
                  <div className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2 text-sm font-mono">
                    <span className="flex-1 truncate opacity-80">{quizUrl}</span>
                    <button
                      onClick={copyQuizLink}
                      data-testid="button-copy-quiz-link"
                      className="flex-shrink-0 hover:opacity-80 transition-opacity"
                    >
                      {copied ? <Check className="w-4 h-4 text-[#b5cc42]" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    onClick={() => navigate("/quiz")}
                    data-testid="button-preview-quiz"
                    className="bg-white text-[#1b2951] hover:bg-white/90 font-semibold text-xs"
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1" /> Preview Quiz
                  </Button>
                </div>
              </div>
            </div>

            {/* Submissions list */}
            {quizzesLoading && (
              <div className="text-center py-12 text-gray-400">Loading submissions...</div>
            )}
            {quizzesError && (
              <div className="text-center py-8 bg-red-50 rounded-xl border border-red-100 text-sm text-red-600 px-4">
                Error loading submissions: {(quizzesError as Error).message}
              </div>
            )}
            {!quizzesLoading && !quizzesError && quizzes.length === 0 && (
              <div className="text-center py-16 bg-white rounded-xl border border-gray-100 shadow-sm">
                <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <h3 className="font-semibold text-gray-700 mb-1">No quiz submissions yet</h3>
                {/* synced from GHL */}
                <p className="text-sm text-gray-400">
                  Submissions from the public quiz will appear here automatically.
                </p>
              </div>
            )}
            {quizzes.map(quiz => (
              <QuizCard
                key={quiz.id}
                quiz={quiz}
                onNavigate={(id) => navigate(`/quiz/${id}`)}
                onDelete={(id) => {
                  if (confirm(`Delete ${quiz.firstName} ${quiz.lastName}'s submission?`))
                    deleteQuiz.mutate(id);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
