import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertClientSchema, insertEntitySchema, insertStrategySelectionSchema, insertQuizSchema } from "@shared/schema";
import { z } from "zod";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { processGHLContact, GHL_TAG, writeQuizAnswersToGHL, notifySlack, fetchGHLQuizSubmissions } from "./ghl";
import multer from "multer";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const ok = /pdf|png|jpe?g|tiff?/i.test(file.mimetype);
    cb(null, ok);
  },
});

const execAsync = promisify(exec);

// execPython: run python3 reliably on both local and Railway (node:20-slim)
// Uses shell:true to ensure /bin/sh is found regardless of PATH configuration
async function execPython(scriptPath: string, args: string[]): Promise<void> {
  const quotedArgs = args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ');
  const cmd = `python3 "${scriptPath}" ${quotedArgs}`;
  await execAsync(cmd, { shell: true, timeout: 120000 });
}

// In-memory PDF cache: quizId → { buffer, generatedAt }
const quizPdfCache = new Map<number, { buffer: Buffer; generatedAt: Date }>();

async function generateQuizPdf(quiz: any, scriptPath: string): Promise<Buffer | null> {
  const payloadPath = `/tmp/pbg_quiz_payload_${quiz.id}.json`;
  const outPath     = `/tmp/pbg_quiz_report_${quiz.id}.pdf`;
  try {
    fs.writeFileSync(payloadPath, JSON.stringify({ mode: "quiz", quiz }, null, 2));
    await execPython(scriptPath, [payloadPath, outPath]);
    const buf = fs.readFileSync(outPath);
    try { fs.unlinkSync(payloadPath); } catch {}
    try { fs.unlinkSync(outPath); } catch {}
    return buf;
  } catch (e: any) {
    console.error(`[Quiz PDF] Generation failed for #${quiz.id}:`, e.stderr || e.message);
    return null;
  }
}

export function registerRoutes(httpServer: Server, app: Express) {

  // =================== QUIZ REDIRECT ===================
  // Allow sharing a clean URL without the hash: /quiz → /#/quiz
  // This handles direct browser navigation to the quiz page
  app.get("/quiz", (_req, res) => {
    res.redirect(301, "/#/quiz");
  });

  // Return the canonical quiz URL (useful for Dashboard copy-link)
  app.get("/api/quiz-url", (req, res) => {
    const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${process.env.PORT || 5000}`;
    const proto = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
    res.json({ quizUrl: `${proto}://${host}/#/quiz`, cleanUrl: `${proto}://${host}/quiz` });
  });

  // =================== GHL WEBHOOK ===================

  /**
   * POST /api/ghl/webhook
   * Called by a GHL Workflow when the tag "purchase - tax savings roadmap" is added.
   *
   * GHL workflow setup:
   *   Trigger: Tag Added → "purchase - tax savings roadmap"
   *   Action:  Webhook → POST to <your-app-url>/api/ghl/webhook
   *   Body (JSON):
   *     {
   *       "contact_id": "{{contact.id}}",
   *       "location_id": "{{location.id}}",
   *       "tags": "{{contact.tags}}"
   *     }
   *
   * Optional: set a shared secret in GHL and pass it as a header "x-ghl-secret",
   *   then set GHL_WEBHOOK_SECRET env var to validate.
   */
  app.post("/api/ghl/webhook", async (req, res) => {
    try {
      // Validate optional shared secret
      const secret = process.env.GHL_WEBHOOK_SECRET;
      if (secret) {
        const provided = req.headers["x-ghl-secret"] || req.headers["x-webhook-secret"];
        if (provided !== secret) {
          console.warn("[GHL Webhook] Unauthorized — secret mismatch");
          return res.status(401).json({ message: "Unauthorized" });
        }
      }

      const body = req.body as any;
      console.log("[GHL Webhook] Received:", JSON.stringify(body).slice(0, 300));

      // GHL's simple Webhook action sends the full contact object automatically.
      // The payload can come in several shapes depending on GHL version:
      //   Shape A (simple webhook): { id, locationId, firstName, ... , location: { id } }
      //   Shape B (custom data):    { contact_id, location_id, ... }
      //   Shape C (nested):         { contact: { id, ... }, location: { id } }
      const contactId  =
        body.contact_id  || body.contactId  ||
        body.id          ||
        body.contact?.id;

      const locationId =
        body.location_id || body.locationId ||
        body.location?.id ||
        body.location    ||
        body.contact?.locationId;

      if (!contactId) {
        console.warn("[GHL Webhook] Could not find contact ID. Body keys:", Object.keys(body));
        return res.status(400).json({ message: "Missing contact_id in webhook body", received_keys: Object.keys(body) });
      }
      if (!locationId) {
        console.warn("[GHL Webhook] Could not find location ID. Body keys:", Object.keys(body));
        return res.status(400).json({ message: "Missing location_id in webhook body", received_keys: Object.keys(body) });
      }

      // Check GHL_API_KEY is configured
      if (!process.env.GHL_API_KEY) {
        console.error("[GHL Webhook] GHL_API_KEY not set — cannot process");
        return res.status(500).json({ message: "GHL_API_KEY not configured on server. See /api/ghl/setup." });
      }

      // Respond immediately so GHL doesn't time out, then process async
      res.json({ received: true, contactId, message: "Processing started" });

      // Process in background
      processGHLContact(contactId, locationId).then((result) => {
        console.log(`[GHL Webhook] Result for ${contactId}:`, result.message);
      }).catch((err) => {
        console.error(`[GHL Webhook] Error for ${contactId}:`, err.message);
      });

    } catch (err: any) {
      console.error("[GHL Webhook] Unhandled error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * GET /api/ghl/setup
   * Returns setup instructions for connecting GHL.
   */
  app.get("/api/ghl/setup", (req, res) => {
    const appUrl = req.headers["x-forwarded-host"]
      ? `https://${req.headers["x-forwarded-host"]}`
      : `http://localhost:${process.env.PORT || 5000}`;

    res.json({
      webhook_url: `${appUrl}/api/ghl/webhook`,
      trigger_tag: GHL_TAG,
      env_vars_needed: [
        { key: "GHL_API_KEY",         status: process.env.GHL_API_KEY         ? "✅ SET" : "❌ NOT SET", description: "Private Integration Token from GHL → Settings → Integrations → Private Integrations" },
        { key: "SLACK_WEBHOOK_URL",   status: process.env.SLACK_WEBHOOK_URL   ? "✅ SET" : "❌ NOT SET", description: "Slack Incoming Webhook URL from api.slack.com/apps → Incoming Webhooks" },
        { key: "GHL_WEBHOOK_SECRET",  status: process.env.GHL_WEBHOOK_SECRET  ? "✅ SET" : "⚠️  optional", description: "Optional shared secret for webhook validation" },
      ],
      ghl_workflow_instructions: [
        "Step 1: In GHL (app.certaintyengine.io), go to Automation > Workflows > + New Workflow",
        "Step 2: Add trigger: Tag Added > filter for tag: " + GHL_TAG,
        "Step 3: Add action: Webhook > Method: POST",
        "Step 4: Webhook URL: " + appUrl + "/api/ghl/webhook",
        "Step 5: Body type: JSON — see webhook_body field below",
        "Step 6: (Optional) Add header x-ghl-secret > set to same value as GHL_WEBHOOK_SECRET env var",
        "Step 7: Save and publish the workflow",
      ],
      webhook_body: JSON.stringify({ contact_id: "{{contact.id}}", location_id: "{{location.id}}", tags: "{{contact.tags}}" }, null, 2),
      custom_fields_mapped: [
        { ghl_key: "filing_status",                                                               quiz_field: "filingStatus" },
        { ghl_key: "total_household_income_range",                                                quiz_field: "annualRevenue (fallback)" },
        { ghl_key: "state_of_residence",                                                          quiz_field: "stateOfResidence (context)" },
        { ghl_key: "total_w_2_income_household_range",                                            quiz_field: "householdW2 (context)" },
        { ghl_key: "do_you_have_investment_income_capital_gains_dividends",                       quiz_field: "investmentActivity" },
        { ghl_key: "business_revenue_range",                                                      quiz_field: "annualRevenue" },
        { ghl_key: "do_you_own_a_business",                                                       quiz_field: "businessStructure (gating)" },
        { ghl_key: "business_net_profit_range",                                                   quiz_field: "annualProfit" },
        { ghl_key: "how_is_your_business_taxed",                                                  quiz_field: "businessStructure" },
        { ghl_key: "corp_only_owner_w_2_salary_paid_to_you_range",                               quiz_field: "ownerW2Salary (context)" },
        { ghl_key: "single_dropdown_20ntn",                                                       quiz_field: "hasDependents (over 17)" },
        { ghl_key: "dependents_under_171",                                                        quiz_field: "hasDependents (under 17)" },
        { ghl_key: "how_many_employees_do_you_have_not_including_you_or_your_spouse",             quiz_field: "hasEmployees" },
        { ghl_key: "do_you_own_your_home",                                                        quiz_field: "ownsHome" },
      ],
    });
  });

  /**
   * POST /api/ghl/test
   * Test the integration with a mock contact payload (no GHL API key needed).
   */
  app.post("/api/ghl/test", async (req, res) => {
    try {
      const { buildQuizFromContact, estimateSavingsDisplay } = await import("./ghl");
      const mockContact = {
        firstName: req.body.firstName || "Test",
        lastName:  req.body.lastName  || "Client",
        email:     req.body.email     || "test@example.com",
        phone:     req.body.phone     || "",
        customFields: req.body.customFields || [],
      };
      const quiz         = buildQuizFromContact(mockContact);
      const savingsRange = estimateSavingsDisplay(quiz);
      res.json({ quiz, savingsRange, message: "Quiz payload built successfully" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // =================== CLIENTS ===================
  app.get("/api/clients", async (req, res) => {
    const clients = await storage.getClients();
    res.json(clients);
  });

  app.get("/api/clients/:id", async (req, res) => {
    const client = await storage.getClient(Number(req.params.id));
    if (!client) return res.status(404).json({ message: "Client not found" });
    res.json(client);
  });

  app.post("/api/clients", async (req, res) => {
    try {
      const data = insertClientSchema.parse(req.body);
      const client = await storage.createClient(data);
      res.json(client);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/clients/:id", async (req, res) => {
    const client = await storage.updateClient(Number(req.params.id), req.body);
    if (!client) return res.status(404).json({ message: "Client not found" });
    res.json(client);
  });

  app.delete("/api/clients/:id", async (req, res) => {
    await storage.deleteClient(Number(req.params.id));
    res.json({ success: true });
  });

  // =================== ENTITIES ===================
  app.get("/api/clients/:id/entities", async (req, res) => {
    const entities = await storage.getEntitiesByClient(Number(req.params.id));
    res.json(entities);
  });

  app.post("/api/entities", async (req, res) => {
    try {
      const data = insertEntitySchema.parse(req.body);
      const entity = await storage.createEntity(data);
      res.json(entity);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/entities/:id", async (req, res) => {
    const entity = await storage.updateEntity(Number(req.params.id), req.body);
    if (!entity) return res.status(404).json({ message: "Entity not found" });
    res.json(entity);
  });

  app.delete("/api/entities/:id", async (req, res) => {
    await storage.deleteEntity(Number(req.params.id));
    res.json({ success: true });
  });

  // =================== STRATEGY SELECTIONS ===================
  app.get("/api/entities/:id/selections", async (req, res) => {
    const selections = await storage.getSelectionsForEntity(Number(req.params.id));
    res.json(selections);
  });

  app.post("/api/entities/:id/selections/bulk", async (req, res) => {
    const entityId = Number(req.params.id);
    const { selections } = req.body;
    await storage.deleteSelectionsForEntity(entityId);
    const created = [];
    for (const sel of selections) {
      const s = await storage.upsertSelection({ ...sel, entityId });
      created.push(s);
    }
    res.json(created);
  });

  app.patch("/api/selections/:id", async (req, res) => {
    const sel = await storage.updateSelection(Number(req.params.id), req.body);
    if (!sel) return res.status(404).json({ message: "Selection not found" });
    res.json(sel);
  });

  // =================== QUIZ SUBMISSIONS ===================
  app.get("/api/quiz", async (req, res) => {
    // Merge in-memory submissions with GHL-sourced ones (from public quiz via Netlify)
    const localSubmissions = await storage.getQuizSubmissions();
    const locationId = process.env.GHL_LOCATION_ID || "";
    const ghlSubmissions = await fetchGHLQuizSubmissions(locationId);

    // Deduplicate: if a local submission has the same email as a GHL one, prefer local
    const localEmails = new Set(localSubmissions.map((s: any) => (s.email || "").toLowerCase()));
    const uniqueGHL   = ghlSubmissions.filter((s: any) => !localEmails.has((s.email || "").toLowerCase()));

    // Sort combined list newest first
    const combined = [...localSubmissions, ...uniqueGHL].sort((a: any, b: any) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );

    res.json(combined);
  });

  app.get("/api/quiz/:id", async (req, res) => {
    const submission = await resolveQuiz(Number(req.params.id));
    if (!submission) return res.status(404).json({ message: "Not found" });
    res.json(submission);
  });

  app.post("/api/quiz", async (req, res) => {
    try {
      const data = insertQuizSchema.parse(req.body);
      const submission = await storage.createQuizSubmission(data);

      // Respond immediately so the client isn't waiting on GHL
      res.json(submission);

      // Write quiz answers to GHL custom fields in the background
      writeQuizAnswersToGHL({
        email:     submission.email,
        firstName: submission.firstName,
        lastName:  submission.lastName,
        phone:     submission.phone || "",
        quiz: {
          businessStructure:  submission.businessStructure,
          annualRevenue:      submission.annualRevenue,
          annualProfit:       submission.annualProfit,
          annualTaxBill:      submission.annualTaxBill,
          investmentActivity: submission.investmentActivity,
          hasDependents:      submission.hasDependents,
          ownsHome:           submission.ownsHome,
          hasEmployees:       submission.hasEmployees,
        },
      }).then(r => {
        console.log(`[Quiz GHL WriteBack] ${r.message}`);
      }).catch(err => {
        console.error(`[Quiz GHL WriteBack] Error:`, err.message);
      });

      // Auto-generate PDF in the background and send Slack alert
      const scriptPath = path.join(process.cwd(), "generate_pdf.py");
      const slackWebhook = process.env.SLACK_WEBHOOK_URL || "";
      const contactName  = `${submission.firstName} ${submission.lastName}`.trim();
      const reviewUrl    = `https://luminous-sopapillas-61551c.netlify.app/#/`;

      generateQuizPdf(submission, scriptPath).then(pdfBuf => {
        const pdfReady = pdfBuf !== null;
        if (pdfBuf) {
          quizPdfCache.set(submission.id, { buffer: pdfBuf, generatedAt: new Date() });
          console.log(`[Quiz PDF] Cached PDF for submission #${submission.id}`);
        }

        if (!slackWebhook) return;
        const blocks: any[] = [
          {
            type: "header",
            text: { type: "plain_text", text: "New Tax Savings Assessment Submitted", emoji: false },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Name:*\n${contactName || "—"}` },
              { type: "mrkdwn", text: `*Email:*\n${submission.email || "—"}` },
              { type: "mrkdwn", text: `*Phone:*\n${submission.phone || "—"}` },
              { type: "mrkdwn", text: `*Business Structure:*\n${submission.businessStructure || "—"}` },
            ],
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Annual Revenue:*\n${submission.annualRevenue || "—"}` },
              { type: "mrkdwn", text: `*Annual Profit:*\n${submission.annualProfit || "—"}` },
              { type: "mrkdwn", text: `*Est. Tax Bill:*\n${submission.annualTaxBill || "—"}` },
              { type: "mrkdwn", text: `*Owns Home:*\n${submission.ownsHome || "—"}` },
            ],
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: pdfReady
                ? `:white_check_mark: *Roadmap PDF is ready.* Download from the dashboard after the strategy call.`
                : `:warning: PDF auto-generation failed. Open the dashboard to generate manually.`,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Review in Dashboard" },
                url: reviewUrl,
                style: "primary",
              },
            ],
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Phillips Business Group · Quiz Submission #${submission.id} · ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })} CT`,
              },
            ],
          },
        ];

        fetch(slackWebhook, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: `New Tax Savings Assessment submitted by ${contactName}`, blocks }),
        }).catch(err => console.error("[Slack Quiz Alert] Error:", err.message));
      });

    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/quiz/:id", async (req, res) => {
    const updated = await storage.updateQuizSubmission(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  app.delete("/api/quiz/:id", async (req, res) => {
    await storage.deleteQuizSubmission(Number(req.params.id));
    res.json({ success: true });
  });

  // Check if PDF is cached for a quiz submission
  // Helper: resolve quiz by id (handles both local in-memory and GHL-sourced negative ids)
  async function resolveQuiz(id: number): Promise<any | null> {
    if (id > 0) return storage.getQuizSubmission(id);
    // Negative ID = GHL-sourced. Re-fetch from GHL to get full data.
    const locationId = process.env.GHL_LOCATION_ID || "";
    const ghlSubmissions = await fetchGHLQuizSubmissions(locationId);
    return ghlSubmissions.find((s: any) => s.id === id) ?? null;
  }

  app.get("/api/quiz/:id/pdf-status", async (req, res) => {
    const quizId = Number(req.params.id);
    const cached = quizPdfCache.get(quizId);
    res.json({ ready: !!cached, generatedAt: cached?.generatedAt ?? null });
  });

  // Download cached PDF (or re-generate on demand if not cached)
  app.get("/api/quiz/:id/pdf", async (req, res) => {
    const quizId = Number(req.params.id);
    const quiz = await resolveQuiz(quizId);
    if (!quiz) return res.status(404).json({ message: "Quiz not found" });

    let buf = quizPdfCache.get(quizId)?.buffer ?? null;
    if (!buf) {
      // Fallback: generate on demand
      const scriptPath = path.join(process.cwd(), "generate_pdf.py");
      buf = await generateQuizPdf(quiz, scriptPath);
      if (buf) quizPdfCache.set(quizId, { buffer: buf, generatedAt: new Date() });
    }
    if (!buf) return res.status(500).json({ message: "PDF generation failed" });

    const name = `${quiz.firstName} ${quiz.lastName}`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Tax-Roadmap-${name.replace(/\s+/g, '-')}.pdf"`);
    res.send(buf);
  });

  // Generate PDF from quiz submission (re-generate + cache)
  app.post("/api/quiz/:id/generate-pdf", async (req, res) => {
    const quizId = Number(req.params.id);
    const quiz = await resolveQuiz(quizId);
    if (!quiz) return res.status(404).json({ message: "Quiz not found" });

    const scriptPath = path.join(process.cwd(), "generate_pdf.py");
    const buf = await generateQuizPdf(quiz, scriptPath);
    if (!buf) return res.status(500).json({ message: "PDF generation failed" });

    quizPdfCache.set(quizId, { buffer: buf, generatedAt: new Date() });
    const name = `${quiz.firstName} ${quiz.lastName}`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Tax-Roadmap-${name.replace(/\s+/g, '-')}.pdf"`);
    res.send(buf);
  });

  // =================== PDF GENERATION ===================
  app.post("/api/clients/:id/generate-pdf", async (req, res) => {
    const clientId = Number(req.params.id);
    const client = await storage.getClient(clientId);
    if (!client) return res.status(404).json({ message: "Client not found" });

    const entities = await storage.getEntitiesByClient(clientId);
    const allSelections: Record<number, any[]> = {};
    for (const entity of entities) {
      allSelections[entity.id] = await storage.getSelectionsForEntity(entity.id);
    }

    // Write payload to temp file for Python script
    const payload = { client, entities, allSelections };
    const payloadPath = `/tmp/pbg_payload_${clientId}.json`;
    fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2));

    const outPath = `/tmp/pbg_report_${clientId}.pdf`;
    const scriptPath = path.join(process.cwd(), "generate_pdf.py");

    try {
      await execPython(scriptPath, [payloadPath, outPath]);
      const pdfBuffer = fs.readFileSync(outPath);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Tax-Roadmap-${client.name.replace(/\s+/g, '-')}.pdf"`);
      res.send(pdfBuffer);
    } catch (e: any) {
      console.error("PDF generation error:", e.stderr || e.message);
      res.status(500).json({ message: "PDF generation failed", detail: e.stderr || e.message });
    }
  });

  // POST /api/clients/:id/generate-premium-pdf — generate premium multi-year analysis PDF
  app.post("/api/clients/:id/generate-premium-pdf", async (req, res) => {
    const clientId = Number(req.params.id);
    const client = await storage.getClient(clientId);
    if (!client) return res.status(404).json({ message: "Client not found" });

    const entities = await storage.getEntitiesByClient(clientId);
    const allSelections: Record<number, any[]> = {};
    for (const entity of entities) {
      allSelections[entity.id] = await storage.getSelectionsForEntity(entity.id);
    }

    const payload = { client, entities, allSelections };
    const payloadPath = `/tmp/pbg_payload_premium_${clientId}.json`;
    fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2));

    const outPath = `/tmp/pbg_premium_${clientId}.pdf`;
    const scriptPath = path.join(process.cwd(), "generate_premium_pdf.py");

    try {
      await execPython(scriptPath, [payloadPath, outPath]);
      const pdfBuffer = fs.readFileSync(outPath);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Premium-Analysis-${client.name.replace(/\s+/g, '-')}.pdf"`);
      res.send(pdfBuffer);
    } catch (e: any) {
      console.error("Premium PDF generation error:", e.stderr || e.message);
      res.status(500).json({ message: "Premium PDF generation failed", detail: e.stderr || e.message });
    }
  });

  // ─── Document Upload & Extraction ───────────────────────────────

  // GET /api/entities/:id/files — list uploaded files for entity
  app.get("/api/entities/:id/files", async (req, res) => {
    const entityId = Number(req.params.id);
    const files = await storage.getUploadedFilesByEntity(entityId);
    res.json(files);
  });

  // POST /api/entities/:id/upload — upload a file, run extraction async
  app.post("/api/entities/:id/upload", upload.single("file"), async (req: any, res) => {
    const entityId = Number(req.params.id);
    const entity = await storage.getEntity(entityId);
    if (!entity) return res.status(404).json({ message: "Entity not found" });
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const fileType = (req.body.fileType as string) || "financials";
    const savedFile = await storage.createUploadedFile({
      entityId,
      clientId: entity.clientId,
      filename: req.file.originalname,
      fileType,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      uploadedAt: new Date().toISOString(),
      extractionStatus: "processing",
      extractedData: null,
      errorMessage: null,
    });

    // Kick off extraction async (don't block response)
    const scriptPath = path.join(process.cwd(), "extract_document.py");
    const outJsonPath = `/tmp/pbg_extract_${savedFile.id}.json`;
    const uploadedPath = req.file.path;
    (async () => {
      try {
        await execPython(scriptPath, [uploadedPath, fileType, outJsonPath]);
        const raw = fs.readFileSync(outJsonPath, "utf-8");
        const extracted = JSON.parse(raw);
        if (extracted.error) {
          await storage.updateUploadedFile(savedFile.id, {
            extractionStatus: "error",
            errorMessage: extracted.error,
          });
        } else {
          await storage.updateUploadedFile(savedFile.id, {
            extractionStatus: "done",
            extractedData: JSON.stringify(extracted),
          });
          // Auto-apply extracted fields to entity (non-null values only)
          const entityUpdate: Record<string, any> = {};
          const numericFields = [
            "grossRevenue","netProfit","w2Wages","ownerCompensation","agi","totalIncome",
            "mortgageInterest","stateLocalTaxes","charitableDonations","medicalExpenses",
            "capitalGains","capitalLosses","iraDistributions","rentalIncome",
            "partnershipIncome","mealExpenses","travelExpenses","vehicleExpenses",
            "homeOfficeExpenses","depreciation","numberOfDependents",
          ];
          const boolFields = [
            "hasEmployees","hasNonOwnerEmployees","hasBusinessVehiclePurchase",
            "hasHealthInsurancePersonal","hasRealProperty","alreadyHasRetirementPlan",
            "dependentsHaveEarnedIncome",
          ];
          for (const f of numericFields) {
            if (extracted[f] !== null && extracted[f] !== undefined) {
              entityUpdate[f] = Number(extracted[f]);
            }
          }
          for (const f of boolFields) {
            if (extracted[f] !== null && extracted[f] !== undefined) {
              entityUpdate[f] = Boolean(extracted[f]);
            }
          }
          if (extracted.notes) entityUpdate.notes = String(extracted.notes);
          if (Object.keys(entityUpdate).length > 0) {
            await storage.updateEntity(entityId, entityUpdate);
          }
        }
      } catch (e: any) {
        await storage.updateUploadedFile(savedFile.id, {
          extractionStatus: "error",
          errorMessage: e.message || "Extraction failed",
        });
      }
    })();

    res.json(savedFile);
  });

  // DELETE /api/files/:id — delete uploaded file
  app.delete("/api/files/:id", async (req, res) => {
    const id = Number(req.params.id);
    await storage.deleteUploadedFile(id);
    res.json({ success: true });
  });

  // GET /api/files/:id/status — poll extraction status
  app.get("/api/files/:id/status", async (req, res) => {
    const id = Number(req.params.id);
    const files = await storage.getUploadedFilesByClient(0); // get all
    // Simple approach: search all
    const allClients = await storage.getClients();
    let found: any = null;
    for (const c of allClients) {
      const cf = await storage.getUploadedFilesByClient(c.id);
      found = cf.find(f => f.id === id);
      if (found) break;
    }
    if (!found) return res.status(404).json({ message: "File not found" });
    res.json(found);
  });
}
