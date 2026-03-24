import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { queryClient, apiRequest, API_BASE } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Download, CheckCircle, XCircle, Plus, DollarSign,
  Building2, User, Mail, Phone, TrendingUp
} from "lucide-react";
import type { QuizSubmission } from "@shared/schema";
import {
  mapQuizToStrategies,
  structureLabel, revenueLabel, profitLabel, taxBillLabel,
  entityTypeFromStructure,
} from "@/lib/quizStrategies";
import { STRATEGIES } from "@/lib/strategies";

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtRange(min: number, max: number) {
  return `${fmt(min)} – ${fmt(max)}`;
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-800">{value}</span>
    </div>
  );
}

const FRUSTRATION_LABELS: Record<string, string> = {
  paying_too_much: "Paying too much in taxes",
  no_strategy: "No proactive strategy",
  surprise_bill: "Surprise tax bill every April",
  dont_understand: "Don't understand tax situation",
  not_optimized: "Knows they're not optimized",
};
const CURRENT_PREP_LABELS: Record<string, string> = {
  self: "Self (TurboTax / H&R Block)",
  cpa: "Local CPA / Accounting firm",
  national_chain: "National chain",
  bookkeeper: "Bookkeeper",
  none: "Hasn't filed recently",
};
const INVESTMENT_LABELS: Record<string, string> = {
  business_only: "Business income only",
  stocks: "Stocks / mutual funds",
  real_estate: "Rental real estate",
  multiple: "Multiple investment types",
};
const DEPENDENTS_LABELS: Record<string, string> = {
  no: "No",
  yes: "Yes",
  yes_earned_income: "Yes, with earned income",
};
const HOME_LABELS: Record<string, string> = {
  no: "Renter",
  yes: "Homeowner",
  yes_home_office: "Homeowner with home office",
};
const EMPLOYEES_LABELS: Record<string, string> = {
  no: "No employees",
  yes_1_5: "1–5 employees",
  yes_6plus: "6+ employees",
};
const INCOME_LABELS: Record<string, string> = {
  increasing_both: "Income & taxes increasing",
  increasing_expect: "Income rising, tax bill expected to grow",
  stable: "Stable income, small changes",
  declining: "Income declining / inconsistent",
};

export default function QuizReview() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: quiz, isLoading } = useQuery<QuizSubmission>({
    queryKey: ["/api/quiz", id],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/quiz/${id}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
  });

  const markViewed = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/quiz/${id}`, { status: "viewed" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/quiz"] }),
  });

  const { data: pdfStatus, refetch: refetchPdfStatus } = useQuery<{ ready: boolean; generatedAt: string | null }>({
    queryKey: ["/api/quiz", id, "pdf-status"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/quiz/${id}/pdf-status`);
      return res.json();
    },
    refetchInterval: (query) => (query.state.data?.ready ? false : 5000),
  });

  const pdfReady = pdfStatus?.ready ?? false;

  // Mark as viewed on load — must be before early returns (Rules of Hooks)
  const hasMarkedViewed = useRef(false);
  useEffect(() => {
    if (quiz && quiz.status === "new" && !hasMarkedViewed.current) {
      hasMarkedViewed.current = true;
      markViewed.mutate();
    }
  }, [quiz?.id, quiz?.status]);

  function downloadCachedPdf() {
    const a = document.createElement("a");
    a.href = `${API_BASE}/api/quiz/${id}/pdf`;
    a.download = `Tax-Roadmap-${quiz?.firstName}-${quiz?.lastName}.pdf`;
    a.click();
    toast({ title: "Downloading Roadmap PDF..." });
  }

  const generatePdf = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/quiz/${id}`, { status: "viewed" });
      const res = await fetch(`${API_BASE}/api/quiz/${id}/generate-pdf`, { method: "POST" });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Tax-Roadmap-${quiz?.firstName}-${quiz?.lastName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quiz"] });
      refetchPdfStatus();
      toast({ title: "PDF generated and downloaded" });
    },
    onError: () => toast({ title: "PDF generation failed", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center">
        <div className="text-gray-500">Loading submission...</div>
      </div>
    );
  }
  if (!quiz) {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center">
        <div className="text-gray-500">Submission not found.</div>
      </div>
    );
  }

  const strategies = mapQuizToStrategies(quiz);
  const suggested = strategies.filter(s => s.status === "suggested");
  const excluded  = strategies.filter(s => s.status === "excluded");
  const totalMin = suggested.reduce((acc, s) => acc + s.savingsMin, 0);
  const totalMax = suggested.reduce((acc, s) => acc + s.savingsMax, 0);

  return (
    <div className="min-h-screen bg-[#f5f5f0]">
      {/* Header */}
      <div className="bg-[#1b2951] text-white px-4 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/")}
              className="text-white hover:bg-white/10 -ml-2"
              data-testid="button-back"
            >
              <ArrowLeft className="w-4 h-4 mr-1" /> Dashboard
            </Button>
            <div className="h-5 w-px bg-white/30" />
            <div>
              <h1 className="text-base font-semibold">{quiz.firstName} {quiz.lastName}</h1>
              <p className="text-xs opacity-60">Quiz Submission · {new Date(quiz.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
          {pdfReady ? (
            <Button
              onClick={downloadCachedPdf}
              data-testid="button-download-pdf"
              className="bg-[#b5cc42] hover:bg-[#a3b83a] text-[#1b2951] font-semibold text-sm"
            >
              <Download className="w-4 h-4 mr-1.5" /> Download Roadmap PDF
            </Button>
          ) : (
            <Button
              onClick={() => generatePdf.mutate()}
              disabled={generatePdf.isPending}
              data-testid="button-generate-pdf"
              className="bg-[#b5cc42] hover:bg-[#b5cc42]/90 text-[#1b2951] font-semibold text-sm"
            >
              <Download className="w-4 h-4 mr-1.5" />
              {generatePdf.isPending ? "Generating..." : "Generate Roadmap PDF"}
            </Button>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left column: Client info ── */}
        <div className="space-y-4">
          {/* Contact */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h3 className="text-xs font-semibold text-[#1b2951] uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" /> Contact
            </h3>
            <InfoRow label="Name" value={`${quiz.firstName} ${quiz.lastName}`} />
            <InfoRow label="Email" value={quiz.email} />
            <InfoRow label="Phone" value={quiz.phone} />
          </div>

          {/* Business */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h3 className="text-xs font-semibold text-[#1b2951] uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" /> Business
            </h3>
            <InfoRow label="Structure" value={structureLabel(quiz.businessStructure)} />
            <InfoRow label="Entity Type" value={entityTypeFromStructure(quiz.businessStructure)} />
            <InfoRow label="Employees" value={EMPLOYEES_LABELS[quiz.hasEmployees ?? ""] ?? quiz.hasEmployees} />
          </div>

          {/* Financials */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h3 className="text-xs font-semibold text-[#1b2951] uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5" /> Financials
            </h3>
            <InfoRow label="Revenue" value={revenueLabel(quiz.annualRevenue)} />
            <InfoRow label="Profit" value={profitLabel(quiz.annualProfit)} />
            <InfoRow label="Tax Bill" value={taxBillLabel(quiz.annualTaxBill)} />
            <InfoRow label="Income trend" value={INCOME_LABELS[quiz.overallIncomeDetails ?? ""] ?? quiz.overallIncomeDetails} />
          </div>

          {/* Situation */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h3 className="text-xs font-semibold text-[#1b2951] uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" /> Situation
            </h3>
            <InfoRow label="Home ownership" value={HOME_LABELS[quiz.ownsHome ?? ""] ?? quiz.ownsHome} />
            <InfoRow label="Dependents" value={DEPENDENTS_LABELS[quiz.hasDependents ?? ""] ?? quiz.hasDependents} />
            <InfoRow label="Investments" value={INVESTMENT_LABELS[quiz.investmentActivity ?? ""] ?? quiz.investmentActivity} />
            <InfoRow label="Tax prep" value={CURRENT_PREP_LABELS[quiz.currentTaxPrep ?? ""] ?? quiz.currentTaxPrep} />
            <InfoRow label="Biggest frustration" value={FRUSTRATION_LABELS[quiz.biggestFrustration ?? ""] ?? quiz.biggestFrustration} />
          </div>
        </div>

        {/* ── Right column: Strategies ── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Savings banner */}
          <div className="bg-[#1b2951] rounded-xl p-5 text-white">
            <p className="text-xs opacity-60 uppercase tracking-wider mb-1">Estimated Annual Tax Savings</p>
            <p className="text-3xl font-bold" style={{ fontFamily: "serif" }}>
              {fmtRange(totalMin, totalMax)}
            </p>
            <p className="text-sm opacity-70 mt-1">
              Based on {suggested.length} applicable strategies · {entityTypeFromStructure(quiz.businessStructure)} · {profitLabel(quiz.annualProfit)} profit
            </p>
            <div className="mt-3 h-px bg-[#b5cc42]" />
          </div>

          {/* Suggested strategies */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-green-600" />
              Suggested Strategies ({suggested.length})
            </h3>
            <div className="space-y-2">
              {suggested.map(sel => {
                const strat = STRATEGIES.find(s => s.id === sel.strategyId);
                return (
                  <div key={sel.strategyId}
                    data-testid={`strategy-card-${sel.strategyId}`}
                    className="bg-white rounded-xl border-l-4 border-l-[#b5cc42] border border-gray-100 shadow-sm p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-green-600 font-bold text-lg leading-none">+</span>
                          <p className="font-semibold text-gray-900 text-sm">{strat?.name ?? sel.strategyId}</p>
                        </div>
                        <p className="text-xs text-gray-500 mb-2">{strat?.shortDescription}</p>
                        <p className="text-xs text-gray-600 leading-relaxed">{sel.rationale}</p>
                        {strat?.irsRefs && (
                          <p className="text-xs text-gray-400 mt-2 italic">{strat.irsRefs}</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-[#1b2951]">
                          {fmtRange(sel.savingsMin, sel.savingsMax)}
                        </p>
                        <p className="text-xs text-gray-400">est. savings</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Excluded strategies */}
          {excluded.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
                <XCircle className="w-4 h-4 text-gray-400" />
                Not Applicable ({excluded.length})
              </h3>
              <div className="space-y-2">
                {excluded.map(sel => {
                  const strat = STRATEGIES.find(s => s.id === sel.strategyId);
                  return (
                    <div key={sel.strategyId}
                      data-testid={`excluded-card-${sel.strategyId}`}
                      className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 opacity-70">
                      <div className="flex items-start gap-2">
                        <span className="text-gray-400 font-bold text-base leading-none mt-0.5">×</span>
                        <div>
                          <p className="font-medium text-gray-600 text-sm">{strat?.name ?? sel.strategyId}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{sel.rationale}</p>
                        </div>
                        <span className="ml-auto text-xs text-gray-400 flex-shrink-0">$0</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
