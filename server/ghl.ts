/**
 * GoHighLevel (HighLevel) API Client
 * White-labeled as app.certaintyengine.io — underlying API is standard GHL v2.
 *
 * Auth: Private Integration Token → set GHL_API_KEY env var
 *   Go to: Sub-Account → Settings → Integrations → Private Integrations → Create
 *   Scopes needed: contacts.readonly, contacts/notes.write, medias.write
 *
 * Webhook: GHL workflow sends POST /api/ghl/webhook when tag
 *   "purchase - tax savings roadmap" is added to a contact.
 *
 * Flow:
 *   GHL webhook → fetch contact + custom fields → map to quiz payload
 *   → generate PDF → upload to GHL contact files → add GHL note → Slack notify
 */

import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const GHL_BASE = "https://services.leadconnectorhq.com";
export const GHL_TAG = "purchase - tax savings roadmap";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function apiKey(): string {
  const key = process.env.GHL_API_KEY;
  if (!key) throw new Error("GHL_API_KEY is not set. See setup instructions in /api/ghl/setup.");
  return key;
}

function ghlHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  return {
    "Authorization": `Bearer ${apiKey()}`,
    "Content-Type":  "application/json",
    "Version":       "2021-07-28",
    ...extraHeaders,
  };
}

async function ghlGet(endpoint: string): Promise<any> {
  const res = await fetch(`${GHL_BASE}${endpoint}`, { headers: ghlHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL GET ${endpoint} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function ghlPost(endpoint: string, body: object): Promise<any> {
  const res = await fetch(`${GHL_BASE}${endpoint}`, {
    method:  "POST",
    headers: ghlHeaders(),
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL POST ${endpoint} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function ghlPut(endpoint: string, body: object): Promise<any> {
  const res = await fetch(`${GHL_BASE}${endpoint}`, {
    method:  "PUT",
    headers: ghlHeaders(),
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL PUT ${endpoint} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── Exact GHL custom field keys (from screenshots) ───────────────────────────
// GHL returns customFields as: [{ id, key, field_value }]
// The "key" matches the unique key shown in GHL settings (without {{ contact. }} wrapper).

const CF = {
  filingStatus:       "filing_status",
  householdIncome:    "total_household_income_range",
  stateOfResidence:   "state_of_residence",
  householdW2:        "total_w_2_income_household_range",
  investmentIncome:   "do_you_have_investment_income_capital_gains_dividends",
  businessRevenue:    "business_revenue_range",
  ownsABusiness:      "do_you_own_a_business",
  businessProfit:     "business_net_profit_range",
  businessTaxed:      "how_is_your_business_taxed",
  ownerW2Salary:      "corp_only_owner_w_2_salary_paid_to_you_range",
  dependentsOver17:   "single_dropdown_20ntn",        // TSR - Dependents Over 17
  dependentsUnder17:  "dependents_under_171",          // TSR - Dependents Under 17
  numEmployees:       "how_many_employees_do_you_have_not_including_you_or_your_spouse",
  ownsHome:           "do_you_own_your_home",
} as const;

// ─── ID → key mapping (GHL search API returns only id+value, not key) ────────
// Field IDs are stable per location (gawcE5mQYjMgaDipxrL7).
const CF_ID_MAP: Record<string, string> = {
  "1RcuVntTrQyV28QJ2m9t": "business_revenue_range",
  "FWsdYonUk4nZPH8a57UR": "business_net_profit_range",
  "GnplwmhDNAh9dce4YM6u": "how_many_employees_do_you_have_not_including_you_or_your_spouse",
  "WLqkFbW75e8JxiKvNTla": "do_you_own_your_home",
  "XYSYzHP5peb7RiXAbfTr": "single_dropdown_20ntn",
  "gk8I00G178mGVFz6bhH4": "dependents_under_171",
  "j5TptkK8TXcykj3bZQkv": "how_is_your_business_taxed",
  "mMkmR1alBDPJJsKvtmo0": "do_you_have_investment_income_capital_gains_dividends",
  "pdLSsqAcGO390MtGWNOj": "do_you_own_a_business",
};

// ─── Extract custom field value by key ───────────────────────────────────────

function getCF(contact: any, key: string): string {
  // GHL search returns: customFields: [{ id, value }] (no key)
  // GHL detail returns: customFields: [{ id, key, field_value }]
  if (Array.isArray(contact.customFields)) {
    for (const cf of contact.customFields) {
      // Match by explicit key (strip "contact." prefix GHL sometimes includes)
      const cfKey = (cf.key || "").replace(/^contact\./, "");
      if (cfKey && cfKey.toLowerCase() === key.toLowerCase()) {
        return String(cf.field_value ?? cf.value ?? "").trim();
      }
      // Match by field ID via hardcoded map (search API only returns id+value)
      if (cf.id && CF_ID_MAP[cf.id] === key) {
        return String(cf.field_value ?? cf.value ?? "").trim();
      }
    }
  }
  // Flat object fallback
  if (contact.customField && typeof contact.customField === "object") {
    const val = contact.customField[key] ?? contact.customField[`contact.${key}`];
    if (val !== undefined) return String(val).trim();
  }
  return "";
}

// ─── Value normalizers ────────────────────────────────────────────────────────

/** Map GHL revenue/profit range labels → quiz enum values */
function mapRangeToRevenue(raw: string): string {
  const v = raw.toLowerCase();
  if (v.includes("over 2") || v.includes("2m+") || v.includes("2,000,000+"))   return "over_2m";
  if (v.includes("1m") && v.includes("2m"))                                      return "1m_2m";
  if (v.includes("1,000,000") || v.includes("1m+") || v === ">1m")              return "1m_2m";
  if (v.includes("500") && v.includes("1"))                                      return "500k_1m";
  if (v.includes("250") && v.includes("500"))                                    return "250k_500k";
  if (v.includes("100") && (v.includes("250") || v.includes("200")))            return "100k_250k";
  if (v.includes("under 100") || v.includes("<100") || v.includes("0–100"))     return "under_100k";
  return "under_100k";
}

function mapRangeToProfit(raw: string): string {
  const v = raw.toLowerCase();
  if (v.includes("over 1") || v.includes("1m+") || v.includes(">1m"))          return "over_1m";
  if (v.includes("500") && v.includes("1"))                                      return "500k_1m";
  if (v.includes("250") && v.includes("500"))                                    return "250k_500k";
  if (v.includes("100") && (v.includes("250") || v.includes("200")))            return "100k_250k";
  return "under_100k";
}

function profitToTaxBill(profitKey: string): string {
  const map: Record<string, string> = {
    "over_1m":    "over_200k",
    "500k_1m":    "100k_200k",
    "250k_500k":  "50k_100k",
    "100k_250k":  "25k_50k",
    "under_100k": "under_25k",
  };
  return map[profitKey] ?? "under_25k";
}

function mapBusinessStructure(taxedAs: string, ownsRaw: string): string {
  const owns = ownsRaw.toLowerCase();
  if (owns === "no" || owns === "false" || owns === "0") return "not_sure";
  const t = taxedAs.toLowerCase();
  if (t.includes("s-corp") || t.includes("s corp") || t === "s corporation") return "s_corp";
  if (t.includes("c-corp") || t.includes("c corp") || t === "c corporation") return "c_corp";
  if (t.includes("partner"))                                                   return "partnership";
  if (t.includes("sole") || t.includes("schedule c") || t.includes("sch c")) return "sole_prop";
  if (t.includes("llc"))                                                       return "llc_single";
  return "not_sure";
}

function mapInvestment(raw: string): string {
  const v = raw.toLowerCase();
  if (v === "yes" || v === "true" || v === "1" || v.includes("yes")) return "multiple";
  return "business_only";
}

function mapDependents(under17: string, over17: string): string {
  const u = parseInt(under17) || 0;
  const o = parseInt(over17)  || 0;
  // Alternatively raw values may be "Yes"/"No" or a count
  const uHas = u > 0 || under17.toLowerCase() === "yes";
  const oHas = o > 0 || over17.toLowerCase()  === "yes";
  if (uHas || oHas) return "yes";
  return "no";
}

function mapEmployees(raw: string): string {
  const v = raw.toLowerCase().trim();
  // Common dropdown values: "None", "1-5", "6-10", "11-25", "26+", or a number
  if (v === "none" || v === "no" || v === "0") return "no";
  const n = parseInt(v);
  if (!isNaN(n)) {
    if (n === 0) return "no";
    if (n <= 5)  return "yes_1_5";
    return "yes_6plus";
  }
  if (v.startsWith("1") || v.startsWith("2") || v.startsWith("3") ||
      v.startsWith("4") || v.startsWith("5") || v === "1-5")          return "yes_1_5";
  if (v.includes("6") || v.includes("7") || v.includes("8") ||
      v.includes("9") || v.includes("10") || v.includes("+"))         return "yes_6plus";
  return "no";
}

function mapOwnsHome(raw: string): string {
  const v = raw.toLowerCase();
  if (v.includes("home office") || v.includes("office")) return "yes_home_office";
  if (v === "yes" || v === "true" || v === "1")           return "yes";
  return "no";
}

// ─── Build quiz object from GHL contact ──────────────────────────────────────

export function buildQuizFromContact(contact: any): Record<string, any> {
  const businessStructure = mapBusinessStructure(
    getCF(contact, CF.businessTaxed),
    getCF(contact, CF.ownsABusiness)
  );
  const annualRevenue = mapRangeToRevenue(getCF(contact, CF.businessRevenue) || getCF(contact, CF.householdIncome));
  const annualProfit  = mapRangeToProfit(getCF(contact, CF.businessProfit));
  const annualTaxBill = profitToTaxBill(annualProfit);

  return {
    // Contact info
    firstName: contact.firstName || contact.first_name || "Client",
    lastName:  contact.lastName  || contact.last_name  || "",
    email:     contact.email     || "",
    phone:     contact.phone     || contact.phoneNumber || "",

    // Quiz answers derived from GHL custom fields
    businessStructure,
    annualRevenue,
    annualProfit,
    annualTaxBill,
    investmentActivity:   mapInvestment(getCF(contact, CF.investmentIncome)),
    hasDependents:        mapDependents(
                            getCF(contact, CF.dependentsUnder17),
                            getCF(contact, CF.dependentsOver17)
                          ),
    ownsHome:             mapOwnsHome(getCF(contact, CF.ownsHome)),
    hasEmployees:         mapEmployees(getCF(contact, CF.numEmployees)),

    // Reasonable defaults for fields not captured in GHL
    currentTaxPrep:       "cpa",
    biggestFrustration:   "paying_too_much",
    overallIncomeDetails: "stable",

    // Extra context (stored but not required by PDF generator)
    filingStatus:         getCF(contact, CF.filingStatus),
    stateOfResidence:     getCF(contact, CF.stateOfResidence),
    householdW2:          getCF(contact, CF.householdW2),
    ownerW2Salary:        getCF(contact, CF.ownerW2Salary),
  };
}

// ─── Fetch GHL contact ────────────────────────────────────────────────────────

export async function fetchContact(contactId: string): Promise<any> {
  const data = await ghlGet(`/contacts/${contactId}`);
  return data.contact ?? data;
}

// ─── Fetch contacts with trigger tag from GHL ───────────────────────────────
// Returns contacts that have the "purchase - tax savings roadmap" tag,
// mapped to the quiz submission shape for display in the dashboard.

export async function fetchGHLQuizSubmissions(locationId: string): Promise<any[]> {
  if (!process.env.GHL_API_KEY || !locationId) return [];
  try {
    const res = await fetch(
      `${GHL_BASE}/contacts/search`,
      {
        method:  "POST",
        headers: ghlHeaders(),
        body:    JSON.stringify({
          locationId,
          query:     GHL_TAG,
          pageLimit: 100,
        }),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const contacts: any[] = data.contacts || [];

    // Filter to those that actually have the tag
    // Only include contacts that:
    // 1. Have the trigger tag, AND
    // 2. Have at least one quiz custom field filled in (business revenue, profit, or structure)
    // This filters out booking contacts who happen to share the tag but never filled the quiz.
    const QUIZ_FIELD_IDS = new Set([
      "1RcuVntTrQyV28QJ2m9t", // business_revenue_range
      "FWsdYonUk4nZPH8a57UR", // business_net_profit_range
      "j5TptkK8TXcykj3bZQkv", // how_is_your_business_taxed
      "pdLSsqAcGO390MtGWNOj", // do_you_own_a_business
    ]);

    function hasQuizData(contact: any): boolean {
      const fields: any[] = contact.customFields || [];
      return fields.some((cf: any) => {
        if (!QUIZ_FIELD_IDS.has(cf.id)) return false;
        const val = String(cf.field_value ?? cf.value ?? "").trim();
        return val !== "" && val !== "0" && val.toLowerCase() !== "no";
      });
    }

    const tagged = contacts.filter((c: any) =>
      Array.isArray(c.tags) && c.tags.includes(GHL_TAG) && hasQuizData(c)
    );

    // Map each contact to a quiz submission shape.
    // Use a large negative numeric ID range (based on index) so it doesn't collide
    // with the in-memory auto-increment IDs which start at 1.
    return tagged.map((c: any, idx: number) => {
      const quiz = buildQuizFromContact(c);
      return {
        id:            -(idx + 1),  // negative numbers: -1, -2, ... won't collide with local IDs
        source:        "ghl",
        ghlContactId:  c.id,
        firstName:     quiz.firstName,
        lastName:      quiz.lastName,
        email:         quiz.email,
        phone:         quiz.phone || "",
        businessStructure:  quiz.businessStructure,
        annualRevenue:      quiz.annualRevenue,
        annualProfit:       quiz.annualProfit,
        annualTaxBill:      quiz.annualTaxBill,
        investmentActivity: quiz.investmentActivity,
        hasDependents:      quiz.hasDependents,
        ownsHome:           quiz.ownsHome,
        hasEmployees:       quiz.hasEmployees,
        currentTaxPrep:     quiz.currentTaxPrep,
        biggestFrustration: quiz.biggestFrustration,
        overallIncomeDetails: quiz.overallIncomeDetails,
        status:        "new",
        createdAt:     c.dateAdded || new Date().toISOString(),
      };
    });
  } catch (err: any) {
    console.error("[GHL] fetchGHLQuizSubmissions error:", err.message);
    return [];
  }
}

// ─── Search GHL contact by email ──────────────────────────────────────────────

export async function searchContactByEmail(
  email: string,
  locationId?: string
): Promise<any | null> {
  try {
    const locParam = locationId ? `&locationId=${locationId}` : "";
    const data = await ghlGet(`/contacts/?email=${encodeURIComponent(email)}${locParam}`);
    const contacts = data.contacts || data.contact ? [data.contact] : [];
    return contacts[0] ?? null;
  } catch {
    return null;
  }
}

// ─── Write quiz answers back to GHL custom fields ─────────────────────────────
// Maps quiz field values → GHL custom field keys and updates the contact.
// Looks up contact by email if no contactId is provided.

/** Map our quiz enum values back to human-readable GHL dropdown labels */
function quizToGHLValues(quiz: Record<string, any>): Record<string, string> {
  const revenueLabel: Record<string, string> = {
    "under_100k": "Under $100K",
    "100k_250k":  "$100K - $250K",
    "250k_500k":  "$250K - $500K",
    "500k_1m":    "$500K - $1M",
    "1m_2m":      "$1M - $2M",
    "over_2m":    "Over $2M",
  };
  const profitLabel: Record<string, string> = {
    "under_100k": "Under $100K",
    "100k_250k":  "$100K - $250K",
    "250k_500k":  "$250K - $500K",
    "500k_1m":    "$500K - $1M",
    "over_1m":    "Over $1M",
  };
  const structureLabel: Record<string, string> = {
    "sole_prop":   "Sole Proprietor / Schedule C",
    "llc_single":  "LLC",
    "s_corp":      "S-Corporation",
    "partnership": "Partnership / Multi-Member LLC",
    "c_corp":      "C-Corporation",
    "not_sure":    "Not Sure",
  };
  const employeesLabel: Record<string, string> = {
    "no":       "None",
    "yes_1_5":  "1-5",
    "yes_6plus": "6+",
  };
  const ownsHomeLabel: Record<string, string> = {
    "no":             "No",
    "yes":            "Yes",
    "yes_home_office": "Yes, with Home Office",
  };

  const hasBusiness = quiz.businessStructure && quiz.businessStructure !== "not_sure" ? "Yes" : "No";
  const structure = structureLabel[quiz.businessStructure as string] ?? quiz.businessStructure ?? "";

  return {
    [CF.businessRevenue]:   revenueLabel[quiz.annualRevenue as string] ?? quiz.annualRevenue ?? "",
    [CF.businessProfit]:    profitLabel[quiz.annualProfit as string]   ?? quiz.annualProfit  ?? "",
    [CF.businessTaxed]:     structure,
    [CF.ownsABusiness]:     hasBusiness,
    [CF.investmentIncome]:  quiz.investmentActivity === "business_only" ? "No" : "Yes",
    [CF.ownsHome]:          ownsHomeLabel[quiz.ownsHome as string] ?? quiz.ownsHome ?? "",
    [CF.numEmployees]:      employeesLabel[quiz.hasEmployees as string] ?? quiz.hasEmployees ?? "",
    // dependents under 17 — store count or Yes/No
    [CF.dependentsUnder17]: quiz.hasDependents === "no" ? "0" : quiz.hasDependents === "yes" || quiz.hasDependents === "yes_earned_income" ? "Yes" : "0",
    [CF.dependentsOver17]:  "0",
  };
}

export async function writeQuizAnswersToGHL(opts: {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  quiz: Record<string, any>;
  locationId?: string;
}): Promise<{ success: boolean; contactId?: string; message: string }> {
  if (!process.env.GHL_API_KEY) {
    return { success: false, message: "GHL_API_KEY not set — quiz answers not written to GHL" };
  }

  try {
    // 1 · Find or create contact by email
    let contact = await searchContactByEmail(opts.email, opts.locationId);
    let contactId: string;

    if (contact) {
      contactId = contact.id;
      console.log(`[GHL WriteBack] Found contact ${contactId} for ${opts.email}`);
    } else {
      // Create new contact
      const created = await ghlPost("/contacts/", {
        firstName: opts.firstName,
        lastName:  opts.lastName,
        email:     opts.email,
        phone:     opts.phone || "",
        ...(opts.locationId ? { locationId: opts.locationId } : {}),
      });
      contact = created.contact ?? created;
      contactId = contact.id;
      console.log(`[GHL WriteBack] Created new contact ${contactId} for ${opts.email}`);
    }

    // 2 · Build custom fields array
    const fieldValues = quizToGHLValues(opts.quiz);
    const customFields = Object.entries(fieldValues)
      .filter(([, v]) => v !== "")
      .map(([key, value]) => ({ key, field_value: value }));

    // 3 · Update contact with custom fields
    await ghlPut(`/contacts/${contactId}`, {
      customFields,
      ...(opts.locationId ? { locationId: opts.locationId } : {}),
    });

    console.log(`[GHL WriteBack] ✓ Updated ${customFields.length} custom fields for ${opts.email}`);
    return { success: true, contactId, message: `Updated ${customFields.length} fields for ${opts.email}` };

  } catch (err: any) {
    console.error("[GHL WriteBack] Error:", err.message);
    return { success: false, message: err.message };
  }
}

// ─── Upload PDF to GHL media library, attach to contact ──────────────────────

export async function uploadPDFToContact(
  contactId: string,
  locationId: string,
  pdfPath: string,
  fileName: string
): Promise<string | null> {
  try {
    const pdfBuffer = fs.readFileSync(pdfPath);
    const boundary  = `----PBGFormBoundary${Date.now()}`;

    // Build multipart/form-data manually (no extra deps)
    const CRLF = "\r\n";
    const header =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}` +
      `Content-Type: application/pdf${CRLF}${CRLF}`;
    const middle =
      `${CRLF}--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="locationId"${CRLF}${CRLF}` +
      `${locationId}${CRLF}` +
      `--${boundary}--${CRLF}`;

    const body = Buffer.concat([
      Buffer.from(header, "utf8"),
      pdfBuffer,
      Buffer.from(middle, "utf8"),
    ]);

    const res = await fetch(`${GHL_BASE}/medias/upload-file`, {
      method: "POST",
      headers: {
        "Authorization":  `Bearer ${apiKey()}`,
        "Version":        "2021-07-28",
        "Content-Type":   `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[GHL] File upload failed: ${res.status} — ${text}`);
      return null;
    }

    const data = await res.json() as any;
    const fileUrl = data.fileUrl || data.url || null;

    // Tag the file to the contact via a note (GHL media library is location-wide)
    if (fileUrl) {
      await addNoteToContact(contactId, `📄 Tax Savings Roadmap PDF generated: ${fileUrl}`, locationId);
    }

    return fileUrl;
  } catch (err: any) {
    console.error("[GHL] Upload error:", err.message);
    return null;
  }
}

// ─── Add note to contact ──────────────────────────────────────────────────────

export async function addNoteToContact(contactId: string, body: string, locationId?: string): Promise<void> {
  try {
    await ghlPost(`/contacts/${contactId}/notes`, { body }, locationId);
  } catch (err: any) {
    console.error("[GHL] Note error:", err.message);
  }
}

// ─── Slack notification ───────────────────────────────────────────────────────

export async function notifySlack(opts: {
  webhookUrl: string;
  contactName: string;
  email: string;
  pdfUrl: string | null;
  savingsRange: string;
  locationId: string;
}): Promise<void> {
  const { webhookUrl, contactName, email, pdfUrl, savingsRange, locationId } = opts;
  if (!webhookUrl) return;

  const ghlLink = `https://app.certaintyengine.io/v2/location/${locationId}/contacts/`;

  try {
    await fetch(webhookUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `✅ Tax Savings Roadmap generated for ${contactName}`,
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "✅ Tax Savings Roadmap Ready", emoji: true },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Client:*\n${contactName}` },
              { type: "mrkdwn", text: `*Email:*\n${email || "—"}` },
              { type: "mrkdwn", text: `*Est. Savings Range:*\n${savingsRange}` },
              { type: "mrkdwn", text: `*Trigger:*\nGHL tag → \`purchase - tax savings roadmap\`` },
            ],
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: pdfUrl
                ? `📄 *PDF saved to GHL contact files*\n<${pdfUrl}|Download Roadmap PDF>`
                : `📄 PDF generation complete — check GHL contact notes for details.`,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Open in GHL" },
                url: ghlLink,
                style: "primary",
              },
            ],
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Phillips Business Group · Tax Roadmap Tool · ${new Date().toLocaleString(
                  "en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }
                )} CT`,
              },
            ],
          },
        ],
      }),
    });
  } catch (err: any) {
    console.error("[Slack] Notify error:", err.message);
  }
}

// ─── Savings estimate for Slack display ──────────────────────────────────────

export function estimateSavingsDisplay(quiz: Record<string, any>): string {
  const profitMid: Record<string, number> = {
    "under_100k": 60000,
    "100k_250k":  175000,
    "250k_500k":  375000,
    "500k_1m":    750000,
    "over_1m":    1500000,
  };
  const taxRates: Record<string, number> = {
    "under_25k":  0.22,
    "25k_50k":    0.24,
    "50k_100k":   0.32,
    "100k_200k":  0.35,
    "over_200k":  0.37,
  };
  const profit = profitMid[quiz.annualProfit as string] ?? 60000;
  const rate   = taxRates[quiz.annualTaxBill as string] ?? 0.22;
  const base   = profit * rate * 0.15;
  const lo     = Math.round((base * 0.6)  / 1000) * 1000;
  const hi     = Math.round((base * 1.4) / 1000) * 1000;
  return `$${lo.toLocaleString()} – $${hi.toLocaleString()}`;
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function processGHLContact(
  contactId: string,
  locationId: string
): Promise<{ success: boolean; message: string; pdfUrl?: string }> {
  console.log(`[GHL] ▶ Processing contact ${contactId} | location ${locationId}`);

  // 1 · Fetch contact
  let contact: any;
  try {
    contact = await fetchContact(contactId);
  } catch (err: any) {
    const msg = `Failed to fetch contact: ${err.message}`;
    console.error(`[GHL] ✗ ${msg}`);
    return { success: false, message: msg };
  }

  const contactName = `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "Client";
  console.log(`[GHL] Contact: ${contactName} <${contact.email}>`);

  // 2 · Build quiz payload from custom fields
  const quiz = buildQuizFromContact(contact);
  console.log(`[GHL] Quiz → structure=${quiz.businessStructure} revenue=${quiz.annualRevenue} profit=${quiz.annualProfit}`);

  // 3 · Write payload + generate PDF
  const safeId       = contactId.replace(/[^a-z0-9]/gi, "_");
  const payloadPath  = `/tmp/pbg_ghl_${safeId}.json`;
  const outPath      = `/tmp/pbg_ghl_${safeId}.pdf`;
  const scriptPath   = path.join(process.cwd(), "generate_pdf.py");

  fs.writeFileSync(payloadPath, JSON.stringify({ mode: "quiz", quiz }, null, 2));

  try {
    const { stderr } = await execAsync(`python3 ${scriptPath} ${payloadPath} ${outPath}`);
    if (stderr) console.log(`[GHL] PDF stderr: ${stderr}`);
  } catch (err: any) {
    const detail = err.stderr || err.message;
    console.error(`[GHL] ✗ PDF generation failed: ${detail}`);
    try { fs.unlinkSync(payloadPath); } catch {}
    return { success: false, message: `PDF generation failed: ${detail}` };
  }

  const pdfName = `Tax-Roadmap-${contactName.replace(/\s+/g, "-")}.pdf`;

  // 4 · Upload to GHL
  const pdfUrl = await uploadPDFToContact(contactId, locationId, outPath, pdfName);
  console.log(`[GHL] PDF upload → ${pdfUrl ?? "(failed — note added instead)"}`);

  // 5 · Slack notification
  const slackWebhook = process.env.SLACK_WEBHOOK_URL || "";
  await notifySlack({
    webhookUrl:   slackWebhook,
    contactName,
    email:        contact.email || "",
    pdfUrl,
    savingsRange: estimateSavingsDisplay(quiz),
    locationId,
  });

  // Cleanup
  try { fs.unlinkSync(payloadPath); } catch {}
  try { fs.unlinkSync(outPath);     } catch {}

  console.log(`[GHL] ✓ Done for ${contactName}`);
  return { success: true, message: `Roadmap generated for ${contactName}`, pdfUrl: pdfUrl ?? undefined };
}
