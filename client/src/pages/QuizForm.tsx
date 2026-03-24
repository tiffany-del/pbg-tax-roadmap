import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, ChevronRight, ChevronLeft, FileText, Building2, DollarSign, Users, Home } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────
interface QuizAnswers {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  businessStructure: string;
  annualRevenue: string;
  annualProfit: string;
  annualTaxBill: string;
  currentTaxPrep: string;
  investmentActivity: string;
  biggestFrustration: string;
  overallIncomeDetails: string;
  hasDependents: string;
  ownsHome: string;
  hasEmployees: string;
}

// ─── Radio option component ───────────────────────
function RadioOption({
  value,
  selected,
  label,
  desc,
  onClick,
}: {
  value: string;
  selected: boolean;
  label: string;
  desc?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`radio-${value}`}
      className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all flex items-start gap-3 ${
        selected
          ? "border-[#1b2951] bg-[#1b2951]/5"
          : "border-gray-200 hover:border-gray-300 bg-white"
      }`}
    >
      <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
        selected ? "border-[#1b2951]" : "border-gray-300"
      }`}>
        {selected && <div className="w-2.5 h-2.5 rounded-full bg-[#1b2951]" />}
      </div>
      <div>
        <div className={`font-medium text-sm ${selected ? "text-[#1b2951]" : "text-gray-800"}`}>{label}</div>
        {desc && <div className="text-xs text-gray-500 mt-0.5">{desc}</div>}
      </div>
    </button>
  );
}

// ─── Step definitions ─────────────────────────────
const STEPS = [
  { id: "contact",     label: "Contact Info",        icon: <FileText className="w-4 h-4" /> },
  { id: "business",    label: "Business",            icon: <Building2 className="w-4 h-4" /> },
  { id: "financials",  label: "Financials",          icon: <DollarSign className="w-4 h-4" /> },
  { id: "situation",   label: "Your Situation",      icon: <Users className="w-4 h-4" /> },
  { id: "details",     label: "Details",             icon: <Home className="w-4 h-4" /> },
];

const EMPTY: QuizAnswers = {
  firstName: "", lastName: "", email: "", phone: "",
  businessStructure: "", annualRevenue: "", annualProfit: "",
  annualTaxBill: "", currentTaxPrep: "", investmentActivity: "",
  biggestFrustration: "", overallIncomeDetails: "",
  hasDependents: "", ownsHome: "", hasEmployees: "",
};

export default function QuizForm() {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswers>(EMPTY);
  const [submitted, setSubmitted] = useState(false);

  const set = (key: keyof QuizAnswers, val: string) =>
    setAnswers(prev => ({ ...prev, [key]: val }));

  const submitQuiz = useMutation({
    mutationFn: async () => {
      // Netlify Function endpoint — works on Netlify without a backend
      const endpoint = "/.netlify/functions/submit-quiz";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...answers,
          status: "new",
          createdAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Submission failed");
      }
      return res.json();
    },
    onSuccess: () => setSubmitted(true),
    onError: () => toast({ title: "Something went wrong. Please try again.", variant: "destructive" }),
  });

  // ── Step validation ──
  const canAdvance = () => {
    if (step === 0) return answers.firstName && answers.lastName && answers.email;
    if (step === 1) return !!answers.businessStructure;
    if (step === 2) return answers.annualRevenue && answers.annualProfit && answers.annualTaxBill;
    if (step === 3) return true; // optional fields
    if (step === 4) return true;
    return true;
  };

  // ── Success screen ──
  if (submitted) {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-[#1b2951] rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-[#1b2951] mb-2" style={{ fontFamily: "serif" }}>
            You're all set, {answers.firstName}!
          </h2>
          <p className="text-gray-600 text-sm leading-relaxed mb-6">
            Our CPA team at Phillips Business Group will review your answers and build your custom Tax Savings
            Roadmap — a personalized plan showing exactly where you're leaving money on the table. You'll hear
            from us at <strong>{answers.email}</strong> within 1–2 business days.
          </p>
          <div className="bg-[#f5f5f0] rounded-xl p-4 text-left space-y-2 mb-5">
            <p className="text-xs font-semibold text-[#1b2951] uppercase tracking-wide">What happens next</p>
            <div className="flex items-start gap-2 text-sm text-gray-700">
              <span className="text-[#b5cc42] font-bold mt-0.5">1.</span>
              <span>Our CPAs review your profile and identify your highest-impact tax reduction opportunities</span>
            </div>
            <div className="flex items-start gap-2 text-sm text-gray-700">
              <span className="text-[#b5cc42] font-bold mt-0.5">2.</span>
              <span>We build your personalized Tax Savings Roadmap PDF with specific strategies and estimated savings</span>
            </div>
            <div className="flex items-start gap-2 text-sm text-gray-700">
              <span className="text-[#b5cc42] font-bold mt-0.5">3.</span>
              <span>We walk you through every opportunity on a 1-on-1 strategy call — no fluff, just your numbers</span>
            </div>
          </div>
          <div className="bg-[#1b2951] rounded-xl p-5 text-center">
            <p className="text-white text-xs font-semibold uppercase tracking-wide mb-1">Ready to see your savings?</p>
            <p className="text-[#f7cac9] text-sm mb-4">Book your Roadmap review call now — it's free.</p>
            <a
              href="https://link.phillipsbusinessgroup.com/widget/bookings/tax-savings-roadmap"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-[#b5cc42] text-[#1b2951] font-bold text-sm px-6 py-3 rounded-lg hover:bg-[#a3b83a] transition-colors"
            >
              Schedule My Strategy Call
            </a>
          </div>
          <p className="text-xs text-gray-400 mt-6">Phillips Business Group · 713-955-2900 · phillipsbusinessgroup.com</p>
        </div>
      </div>
    );
  }

  // ── Progress bar ──
  const progress = ((step) / (STEPS.length - 1)) * 100;

  return (
    <div className="min-h-screen bg-[#f5f5f0]">
      {/* Header */}
      <div className="bg-[#1b2951] text-white px-4 py-4">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs opacity-60 uppercase tracking-wider">Phillips Business Group</p>
            <h1 className="text-lg font-semibold" style={{ fontFamily: "serif" }}>
              Free Tax Savings Assessment
            </h1>
          </div>
          <div className="text-right">
            <p className="text-xs opacity-60">Step {step + 1} of {STEPS.length}</p>
            <p className="text-sm font-medium">{STEPS[step].label}</p>
          </div>
        </div>
        {/* Progress bar */}
        <div className="max-w-xl mx-auto mt-3">
          <div className="h-1 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#b5cc42] rounded-full transition-all duration-500"
              style={{ width: `${Math.max(5, progress)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Form card */}
      <div className="max-w-xl mx-auto px-4 py-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">

          {/* ── Step 0: Contact Info ── */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-[#1b2951]" style={{ fontFamily: "serif" }}>
                  Let's start with your name
                </h2>
                <p className="text-sm text-gray-500 mt-1">We'll use this to personalize your Tax Savings Roadmap.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="firstName">First Name</Label>
                  <Input id="firstName" data-testid="input-firstName" value={answers.firstName}
                    onChange={e => set("firstName", e.target.value)} placeholder="Jane" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input id="lastName" data-testid="input-lastName" value={answers.lastName}
                    onChange={e => set("lastName", e.target.value)} placeholder="Smith" className="mt-1" />
                </div>
              </div>
              <div>
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" type="email" data-testid="input-email" value={answers.email}
                  onChange={e => set("email", e.target.value)} placeholder="jane@example.com" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="phone">Phone Number <span className="text-gray-400 font-normal">(optional)</span></Label>
                <Input id="phone" type="tel" data-testid="input-phone" value={answers.phone}
                  onChange={e => set("phone", e.target.value)} placeholder="(555) 000-0000" className="mt-1" />
              </div>
            </div>
          )}

          {/* ── Step 1: Business Structure ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-[#1b2951]" style={{ fontFamily: "serif" }}>
                  How is your business structured?
                </h2>
                <p className="text-sm text-gray-500 mt-1">Your entity type is the single biggest driver of which tax strategies apply.</p>
              </div>
              <div className="space-y-2">
                {[
                  { value: "sole_prop",    label: "Sole Proprietor / 1099 Contractor", desc: "Self-employed, filing on Schedule C" },
                  { value: "llc_single",   label: "LLC (Single Member)",                desc: "One-owner LLC, taxed as sole prop by default" },
                  { value: "s_corp",       label: "S-Corporation",                      desc: "Pass-through entity with salary requirement" },
                  { value: "partnership",  label: "Partnership / Multi-Member LLC",     desc: "Two or more owners, filing Form 1065" },
                  { value: "c_corp",       label: "C-Corporation",                      desc: "Subject to corporate income tax (21% flat rate)" },
                  { value: "not_sure",     label: "I'm not sure",                       desc: "We'll help you figure it out" },
                ].map(o => (
                  <RadioOption key={o.value} {...o} selected={answers.businessStructure === o.value} onClick={() => set("businessStructure", o.value)} />
                ))}
              </div>
            </div>
          )}

          {/* ── Step 2: Financials ── */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-[#1b2951]" style={{ fontFamily: "serif" }}>
                  Tell us about your finances
                </h2>
                <p className="text-sm text-gray-500 mt-1">Approximate ranges are fine — this helps us identify the right strategies.</p>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700">Annual Business Revenue</Label>
                <div className="space-y-2">
                  {[
                    { value: "under_100k",  label: "Under $100K" },
                    { value: "100k_250k",   label: "$100K – $250K" },
                    { value: "250k_500k",   label: "$250K – $500K" },
                    { value: "500k_1m",     label: "$500K – $1M" },
                    { value: "1m_2m",       label: "$1M – $2M" },
                    { value: "over_2m",     label: "Over $2M" },
                  ].map(o => (
                    <RadioOption key={o.value} {...o} selected={answers.annualRevenue === o.value} onClick={() => set("annualRevenue", o.value)} />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700">Annual Profit (after expenses)</Label>
                <div className="space-y-2">
                  {[
                    { value: "under_100k",  label: "Under $100K" },
                    { value: "100k_250k",   label: "$100K – $250K" },
                    { value: "250k_500k",   label: "$250K – $500K" },
                    { value: "500k_1m",     label: "$500K – $1M" },
                    { value: "over_1m",     label: "Over $1M" },
                  ].map(o => (
                    <RadioOption key={o.value} {...o} selected={answers.annualProfit === o.value} onClick={() => set("annualProfit", o.value)} />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700">Annual Tax Bill</Label>
                <div className="space-y-2">
                  {[
                    { value: "under_25k",   label: "Under $25K" },
                    { value: "25k_50k",     label: "$25K – $50K" },
                    { value: "50k_100k",    label: "$50K – $100K" },
                    { value: "100k_200k",   label: "$100K – $200K" },
                    { value: "over_200k",   label: "Over $200K" },
                  ].map(o => (
                    <RadioOption key={o.value} {...o} selected={answers.annualTaxBill === o.value} onClick={() => set("annualTaxBill", o.value)} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: Situation ── */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-[#1b2951]" style={{ fontFamily: "serif" }}>
                  A bit more about your situation
                </h2>
                <p className="text-sm text-gray-500 mt-1">These answers unlock additional strategies specific to your life.</p>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700">Do you have dependent children?</Label>
                <div className="space-y-2">
                  {[
                    { value: "no",               label: "No" },
                    { value: "yes",              label: "Yes", desc: "Dependents under 18 with no earned income" },
                    { value: "yes_earned_income", label: "Yes, and they have earned income", desc: "They have jobs or do work for the business" },
                  ].map(o => (
                    <RadioOption key={o.value} {...o} selected={answers.hasDependents === o.value} onClick={() => set("hasDependents", o.value)} />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700">Do you own your home?</Label>
                <div className="space-y-2">
                  {[
                    { value: "no",              label: "No, I rent" },
                    { value: "yes",             label: "Yes, I own my home" },
                    { value: "yes_home_office", label: "Yes, and I use part of it for business", desc: "Dedicated home office space" },
                  ].map(o => (
                    <RadioOption key={o.value} {...o} selected={answers.ownsHome === o.value} onClick={() => set("ownsHome", o.value)} />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700">Do you have W-2 employees?</Label>
                <div className="space-y-2">
                  {[
                    { value: "no",       label: "No, just me (and possibly contractors)" },
                    { value: "yes_1_5",  label: "Yes, 1–5 employees" },
                    { value: "yes_6plus", label: "Yes, 6 or more employees" },
                  ].map(o => (
                    <RadioOption key={o.value} {...o} selected={answers.hasEmployees === o.value} onClick={() => set("hasEmployees", o.value)} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4: Details ── */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-[#1b2951]" style={{ fontFamily: "serif" }}>
                  Last few questions
                </h2>
                <p className="text-sm text-gray-500 mt-1">These help us understand your investment profile and current tax situation.</p>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700">Who currently prepares your taxes?</Label>
                <div className="space-y-2">
                  {[
                    { value: "self",           label: "I do it myself (TurboTax, H&R Block, etc.)" },
                    { value: "cpa",            label: "A local CPA or accounting firm" },
                    { value: "national_chain", label: "A national tax chain (H&R Block, Jackson Hewitt)" },
                    { value: "bookkeeper",     label: "My bookkeeper handles it" },
                    { value: "none",           label: "I haven't filed recently" },
                  ].map(o => (
                    <RadioOption key={o.value} {...o} selected={answers.currentTaxPrep === o.value} onClick={() => set("currentTaxPrep", o.value)} />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700">Investment Activity</Label>
                <div className="space-y-2">
                  {[
                    { value: "business_only",   label: "I only have my business income" },
                    { value: "stocks",          label: "I invest in stocks / mutual funds" },
                    { value: "real_estate",     label: "I own rental real estate" },
                    { value: "multiple",        label: "I have multiple investment types" },
                  ].map(o => (
                    <RadioOption key={o.value} {...o} selected={answers.investmentActivity === o.value} onClick={() => set("investmentActivity", o.value)} />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700">Overall income trend</Label>
                <div className="space-y-2">
                  {[
                    { value: "increasing_both",   label: "My income and tax bill are both increasing year over year" },
                    { value: "increasing_expect", label: "My income is increasing, and I expect my tax bill to grow" },
                    { value: "stable",            label: "My income is relatively stable with small changes" },
                    { value: "declining",         label: "My income has declined or been inconsistent" },
                  ].map(o => (
                    <RadioOption key={o.value} {...o} selected={answers.overallIncomeDetails === o.value} onClick={() => set("overallIncomeDetails", o.value)} />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700">
                  What's your biggest tax frustration? <span className="text-gray-400 font-normal">(optional)</span>
                </Label>
                <div className="space-y-2">
                  {[
                    { value: "paying_too_much",    label: "I feel like I'm paying way too much in taxes" },
                    { value: "no_strategy",        label: "I don't have a proactive tax strategy" },
                    { value: "surprise_bill",      label: "I always get a surprise tax bill in April" },
                    { value: "dont_understand",    label: "I don't fully understand my tax situation" },
                    { value: "not_optimized",      label: "I know I'm not optimizing but don't know where to start" },
                  ].map(o => (
                    <RadioOption key={o.value} {...o} selected={answers.biggestFrustration === o.value} onClick={() => set("biggestFrustration", o.value)} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Navigation ── */}
          <div className="flex items-center justify-between mt-8 pt-4 border-t border-gray-100">
            {step > 0 ? (
              <Button variant="ghost" onClick={() => setStep(s => s - 1)} data-testid="button-back">
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            ) : <div />}

            {step < STEPS.length - 1 ? (
              <Button
                onClick={() => setStep(s => s + 1)}
                disabled={!canAdvance()}
                data-testid="button-next"
                className="bg-[#1b2951] hover:bg-[#1b2951]/90 text-white px-6"
              >
                Continue <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={() => submitQuiz.mutate()}
                disabled={submitQuiz.isPending}
                data-testid="button-submit"
                className="bg-[#b5cc42] hover:bg-[#b5cc42]/90 text-[#1b2951] font-semibold px-6"
              >
                {submitQuiz.isPending ? "Submitting..." : "Get My Free Roadmap →"}
              </Button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          Phillips Business Group · Tiffany Phillips, CPA · 713-955-2900 · phillipsbusinessgroup.com
        </p>
      </div>
    </div>
  );
}
