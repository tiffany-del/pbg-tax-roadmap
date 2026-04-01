import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type {
  Client, InsertClient,
  Entity, InsertEntity,
  StrategySelection, InsertStrategySelection,
  Report, InsertReport,
  QuizSubmission, InsertQuiz,
  UploadedFile, InsertUploadedFile,
} from "@shared/schema";

export interface IStorage {
  // Clients
  getClients(): Promise<Client[]>;
  getClient(id: number): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: number, client: Partial<InsertClient>): Promise<Client | undefined>;
  deleteClient(id: number): Promise<boolean>;

  // Entities
  getEntitiesByClient(clientId: number): Promise<Entity[]>;
  getEntity(id: number): Promise<Entity | undefined>;
  createEntity(entity: InsertEntity): Promise<Entity>;
  updateEntity(id: number, entity: Partial<InsertEntity>): Promise<Entity | undefined>;
  deleteEntity(id: number): Promise<boolean>;

  // Strategy Selections
  getSelectionsForEntity(entityId: number): Promise<StrategySelection[]>;
  upsertSelection(selection: InsertStrategySelection): Promise<StrategySelection>;
  updateSelection(id: number, update: Partial<InsertStrategySelection>): Promise<StrategySelection | undefined>;
  deleteSelectionsForEntity(entityId: number): Promise<void>;

  // Reports
  getReportsForClient(clientId: number): Promise<Report[]>;
  createReport(report: InsertReport): Promise<Report>;
  updateReport(id: number, update: Partial<InsertReport>): Promise<Report | undefined>;

  // Quiz Submissions
  getQuizSubmissions(): Promise<QuizSubmission[]>;
  getQuizSubmission(id: number): Promise<QuizSubmission | undefined>;
  createQuizSubmission(quiz: InsertQuiz): Promise<QuizSubmission>;
  updateQuizSubmission(id: number, update: Partial<InsertQuiz>): Promise<QuizSubmission | undefined>;
  deleteQuizSubmission(id: number): Promise<boolean>;

  // Uploaded Files
  getUploadedFilesByEntity(entityId: number): Promise<UploadedFile[]>;
  getUploadedFilesByClient(clientId: number): Promise<UploadedFile[]>;
  createUploadedFile(file: InsertUploadedFile): Promise<UploadedFile>;
  updateUploadedFile(id: number, update: Partial<InsertUploadedFile>): Promise<UploadedFile | undefined>;
  deleteUploadedFile(id: number): Promise<boolean>;
}

function now() {
  return new Date().toISOString();
}

// ─────────────────────────────────────────────────────────
// SQLite Storage — persists data across server restarts
// ─────────────────────────────────────────────────────────
class SqliteStorage implements IStorage {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    console.log(`[storage] SQLite database at ${dbPath}`);
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        taxYear INTEGER,
        filingStatus TEXT,
        preparationDate TEXT,
        inputMode TEXT DEFAULT 'tax_return',
        preparedBy TEXT,
        createdAt TEXT,
        updatedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clientId INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        entityType TEXT NOT NULL,
        grossRevenue REAL, netProfit REAL, w2Wages REAL, ownerCompensation REAL,
        agi REAL, totalIncome REAL, filingStatus TEXT,
        mortgageInterest REAL, stateLocalTaxes REAL, charitableDonations REAL,
        medicalExpenses REAL, capitalGains REAL, capitalLosses REAL,
        iraDistributions REAL, rentalIncome REAL, partnershipIncome REAL,
        mealExpenses REAL, travelExpenses REAL, vehicleExpenses REAL,
        homeOfficeExpenses REAL, depreciation REAL,
        hasEmployees INTEGER, hasNonOwnerEmployees INTEGER,
        hasBusinessVehiclePurchase INTEGER, hasHealthInsurancePersonal INTEGER,
        hasRealProperty INTEGER, alreadyHasRetirementPlan INTEGER,
        numberOfDependents INTEGER, dependentsHaveEarnedIncome INTEGER,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS strategy_selections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entityId INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        strategyId TEXT NOT NULL,
        status TEXT NOT NULL,
        savingsMin REAL, savingsMax REAL,
        rationale TEXT, sortOrder INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clientId INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        type TEXT, pdfUrl TEXT, generatedAt TEXT,
        createdAt TEXT, updatedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS quiz_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firstName TEXT, lastName TEXT, email TEXT, phone TEXT,
        businessStructure TEXT, annualRevenue TEXT, annualProfit TEXT,
        ownerW2Salary TEXT, currentTaxPrep TEXT, investmentActivity TEXT,
        biggestFrustration TEXT, overallIncomeDetails TEXT,
        hasDependents TEXT, ownsHome TEXT, hasEmployees TEXT,
        status TEXT DEFAULT 'new', convertedClientId INTEGER,
        ghlContactId TEXT, submittedAt TEXT, pdfGeneratedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS uploaded_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entityId INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        clientId INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        filename TEXT, fileType TEXT, mimeType TEXT,
        sizeBytes INTEGER, uploadedAt TEXT, filePath TEXT,
        extractionStatus TEXT DEFAULT 'pending',
        extractedData TEXT, errorMessage TEXT
      );
    `);
  }

  // ── helpers ──────────────────────────────────────────────
  private rowToClient(r: any): Client {
    return { ...r } as Client;
  }
  private rowToEntity(r: any): Entity {
    // SQLite stores booleans as 0/1 integers — convert back
    return {
      ...r,
      hasEmployees: r.hasEmployees === null ? null : Boolean(r.hasEmployees),
      hasNonOwnerEmployees: r.hasNonOwnerEmployees === null ? null : Boolean(r.hasNonOwnerEmployees),
      hasBusinessVehiclePurchase: r.hasBusinessVehiclePurchase === null ? null : Boolean(r.hasBusinessVehiclePurchase),
      hasHealthInsurancePersonal: r.hasHealthInsurancePersonal === null ? null : Boolean(r.hasHealthInsurancePersonal),
      hasRealProperty: r.hasRealProperty === null ? null : Boolean(r.hasRealProperty),
      alreadyHasRetirementPlan: r.alreadyHasRetirementPlan === null ? null : Boolean(r.alreadyHasRetirementPlan),
      dependentsHaveEarnedIncome: r.dependentsHaveEarnedIncome === null ? null : Boolean(r.dependentsHaveEarnedIncome),
    } as Entity;
  }
  private rowToSelection(r: any): StrategySelection {
    return { ...r } as StrategySelection;
  }
  private rowToReport(r: any): Report {
    return { ...r } as Report;
  }
  private rowToQuiz(r: any): QuizSubmission {
    return { ...r } as QuizSubmission;
  }
  private rowToFile(r: any): UploadedFile {
    return {
      ...r,
      extractedData: r.extractedData ? JSON.parse(r.extractedData) : null,
    } as UploadedFile;
  }

  // ── Clients ───────────────────────────────────────────────
  async getClients(): Promise<Client[]> {
    return (this.db.prepare("SELECT * FROM clients ORDER BY id DESC").all() as any[]).map(this.rowToClient);
  }
  async getClient(id: number): Promise<Client | undefined> {
    const r = this.db.prepare("SELECT * FROM clients WHERE id = ?").get(id) as any;
    return r ? this.rowToClient(r) : undefined;
  }
  async createClient(c: InsertClient): Promise<Client> {
    const ts = now();
    const stmt = this.db.prepare(
      "INSERT INTO clients (name, taxYear, filingStatus, preparationDate, inputMode, preparedBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const result = stmt.run(c.name, c.taxYear ?? null, c.filingStatus ?? null, c.preparationDate ?? ts, c.inputMode ?? "tax_return", c.preparedBy ?? null, c.createdAt ?? ts, c.updatedAt ?? ts);
    return this.getClient(result.lastInsertRowid as number) as Promise<Client>;
  }
  async updateClient(id: number, updates: Partial<InsertClient>): Promise<Client | undefined> {
    const c = await this.getClient(id);
    if (!c) return undefined;
    const merged = { ...c, ...updates, updatedAt: now() };
    this.db.prepare(
      "UPDATE clients SET name=?, taxYear=?, filingStatus=?, preparationDate=?, inputMode=?, preparedBy=?, updatedAt=? WHERE id=?"
    ).run(merged.name, merged.taxYear ?? null, merged.filingStatus ?? null, merged.preparationDate ?? null, merged.inputMode ?? "tax_return", merged.preparedBy ?? null, merged.updatedAt, id);
    return this.getClient(id);
  }
  async deleteClient(id: number): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM clients WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // ── Entities ──────────────────────────────────────────────
  async getEntitiesByClient(clientId: number): Promise<Entity[]> {
    return (this.db.prepare("SELECT * FROM entities WHERE clientId = ?").all(clientId) as any[]).map(this.rowToEntity.bind(this));
  }
  async getEntity(id: number): Promise<Entity | undefined> {
    const r = this.db.prepare("SELECT * FROM entities WHERE id = ?").get(id) as any;
    return r ? this.rowToEntity(r) : undefined;
  }
  async createEntity(e: InsertEntity): Promise<Entity> {
    const fields = [
      "clientId","name","entityType","grossRevenue","netProfit","w2Wages","ownerCompensation",
      "agi","totalIncome","filingStatus","mortgageInterest","stateLocalTaxes","charitableDonations",
      "medicalExpenses","capitalGains","capitalLosses","iraDistributions","rentalIncome","partnershipIncome",
      "mealExpenses","travelExpenses","vehicleExpenses","homeOfficeExpenses","depreciation",
      "hasEmployees","hasNonOwnerEmployees","hasBusinessVehiclePurchase","hasHealthInsurancePersonal",
      "hasRealProperty","alreadyHasRetirementPlan","numberOfDependents","dependentsHaveEarnedIncome","notes"
    ];
    const placeholders = fields.map(() => "?").join(", ");
    const values = fields.map(f => {
      const v = (e as any)[f];
      if (typeof v === "boolean") return v ? 1 : 0;
      return v ?? null;
    });
    const result = this.db.prepare(`INSERT INTO entities (${fields.join(", ")}) VALUES (${placeholders})`).run(...values);
    return this.getEntity(result.lastInsertRowid as number) as Promise<Entity>;
  }
  async updateEntity(id: number, updates: Partial<InsertEntity>): Promise<Entity | undefined> {
    const e = await this.getEntity(id);
    if (!e) return undefined;
    const merged = { ...e, ...updates };
    const updateFields = Object.keys(updates).map(k => `${k} = ?`).join(", ");
    const vals = Object.values(updates).map(v => typeof v === "boolean" ? (v ? 1 : 0) : v ?? null);
    this.db.prepare(`UPDATE entities SET ${updateFields} WHERE id = ?`).run(...vals, id);
    return this.getEntity(id);
  }
  async deleteEntity(id: number): Promise<boolean> {
    return this.db.prepare("DELETE FROM entities WHERE id = ?").run(id).changes > 0;
  }

  // ── Strategy Selections ───────────────────────────────────
  async getSelectionsForEntity(entityId: number): Promise<StrategySelection[]> {
    return (this.db.prepare("SELECT * FROM strategy_selections WHERE entityId = ? ORDER BY sortOrder ASC").all(entityId) as any[]).map(this.rowToSelection);
  }
  async upsertSelection(sel: InsertStrategySelection): Promise<StrategySelection> {
    const existing = this.db.prepare("SELECT * FROM strategy_selections WHERE entityId = ? AND strategyId = ?").get(sel.entityId, sel.strategyId) as any;
    if (existing) {
      this.db.prepare("UPDATE strategy_selections SET status=?, savingsMin=?, savingsMax=?, rationale=?, sortOrder=? WHERE id=?")
        .run(sel.status, sel.savingsMin ?? null, sel.savingsMax ?? null, sel.rationale ?? null, sel.sortOrder ?? 0, existing.id);
      return this.db.prepare("SELECT * FROM strategy_selections WHERE id = ?").get(existing.id) as StrategySelection;
    }
    const result = this.db.prepare(
      "INSERT INTO strategy_selections (entityId, strategyId, status, savingsMin, savingsMax, rationale, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(sel.entityId, sel.strategyId, sel.status, sel.savingsMin ?? null, sel.savingsMax ?? null, sel.rationale ?? null, sel.sortOrder ?? 0);
    return this.db.prepare("SELECT * FROM strategy_selections WHERE id = ?").get(result.lastInsertRowid) as StrategySelection;
  }
  async updateSelection(id: number, update: Partial<InsertStrategySelection>): Promise<StrategySelection | undefined> {
    const s = this.db.prepare("SELECT * FROM strategy_selections WHERE id = ?").get(id) as any;
    if (!s) return undefined;
    const updateFields = Object.keys(update).map(k => `${k} = ?`).join(", ");
    const vals = Object.values(update).map(v => v ?? null);
    this.db.prepare(`UPDATE strategy_selections SET ${updateFields} WHERE id = ?`).run(...vals, id);
    return this.db.prepare("SELECT * FROM strategy_selections WHERE id = ?").get(id) as StrategySelection;
  }
  async deleteSelectionsForEntity(entityId: number): Promise<void> {
    this.db.prepare("DELETE FROM strategy_selections WHERE entityId = ?").run(entityId);
  }

  // ── Reports ───────────────────────────────────────────────
  async getReportsForClient(clientId: number): Promise<Report[]> {
    return (this.db.prepare("SELECT * FROM reports WHERE clientId = ?").all(clientId) as any[]).map(this.rowToReport);
  }
  async createReport(r: InsertReport): Promise<Report> {
    const ts = now();
    const result = this.db.prepare(
      "INSERT INTO reports (clientId, type, pdfUrl, generatedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(r.clientId, (r as any).type ?? null, (r as any).pdfUrl ?? null, (r as any).generatedAt ?? null, ts, ts);
    return this.db.prepare("SELECT * FROM reports WHERE id = ?").get(result.lastInsertRowid) as Report;
  }
  async updateReport(id: number, update: Partial<InsertReport>): Promise<Report | undefined> {
    const r = this.db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as any;
    if (!r) return undefined;
    const updateFields = Object.keys(update).map(k => `${k} = ?`).join(", ");
    const vals = Object.values(update).map(v => v ?? null);
    this.db.prepare(`UPDATE reports SET ${updateFields} WHERE id = ?`).run(...vals, id);
    return this.db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as Report;
  }

  // ── Quiz Submissions ──────────────────────────────────────
  async getQuizSubmissions(): Promise<QuizSubmission[]> {
    return (this.db.prepare("SELECT * FROM quiz_submissions ORDER BY id DESC").all() as any[]).map(this.rowToQuiz);
  }
  async getQuizSubmission(id: number): Promise<QuizSubmission | undefined> {
    const r = this.db.prepare("SELECT * FROM quiz_submissions WHERE id = ?").get(id) as any;
    return r ? this.rowToQuiz(r) : undefined;
  }
  async createQuizSubmission(q: InsertQuiz): Promise<QuizSubmission> {
    const fields = ["firstName","lastName","email","phone","businessStructure","annualRevenue","annualProfit","ownerW2Salary","currentTaxPrep","investmentActivity","biggestFrustration","overallIncomeDetails","hasDependents","ownsHome","hasEmployees","status","convertedClientId","ghlContactId","submittedAt","pdfGeneratedAt"];
    const vals = fields.map(f => (q as any)[f] ?? null);
    const result = this.db.prepare(
      `INSERT INTO quiz_submissions (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`
    ).run(...vals);
    return this.getQuizSubmission(result.lastInsertRowid as number) as Promise<QuizSubmission>;
  }
  async updateQuizSubmission(id: number, update: Partial<InsertQuiz>): Promise<QuizSubmission | undefined> {
    const q = await this.getQuizSubmission(id);
    if (!q) return undefined;
    const updateFields = Object.keys(update).map(k => `${k} = ?`).join(", ");
    const vals = Object.values(update).map(v => v ?? null);
    this.db.prepare(`UPDATE quiz_submissions SET ${updateFields} WHERE id = ?`).run(...vals, id);
    return this.getQuizSubmission(id);
  }
  async deleteQuizSubmission(id: number): Promise<boolean> {
    return this.db.prepare("DELETE FROM quiz_submissions WHERE id = ?").run(id).changes > 0;
  }

  // ── Uploaded Files ────────────────────────────────────────
  async getUploadedFilesByEntity(entityId: number): Promise<UploadedFile[]> {
    return (this.db.prepare("SELECT * FROM uploaded_files WHERE entityId = ? ORDER BY id DESC").all(entityId) as any[]).map(this.rowToFile.bind(this));
  }
  async getUploadedFilesByClient(clientId: number): Promise<UploadedFile[]> {
    return (this.db.prepare("SELECT * FROM uploaded_files WHERE clientId = ? ORDER BY id DESC").all(clientId) as any[]).map(this.rowToFile.bind(this));
  }
  async createUploadedFile(file: InsertUploadedFile): Promise<UploadedFile> {
    const result = this.db.prepare(
      "INSERT INTO uploaded_files (entityId, clientId, filename, fileType, mimeType, sizeBytes, uploadedAt, filePath, extractionStatus, extractedData, errorMessage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      file.entityId, file.clientId, file.filename ?? null, file.fileType ?? null,
      file.mimeType ?? null, file.sizeBytes ?? null, file.uploadedAt ?? now(),
      (file as any).filePath ?? null, file.extractionStatus ?? "pending",
      file.extractedData ? JSON.stringify(file.extractedData) : null,
      file.errorMessage ?? null
    );
    return this.getUploadedFileById(result.lastInsertRowid as number) as Promise<UploadedFile>;
  }
  private async getUploadedFileById(id: number): Promise<UploadedFile | undefined> {
    const r = this.db.prepare("SELECT * FROM uploaded_files WHERE id = ?").get(id) as any;
    return r ? this.rowToFile(r) : undefined;
  }
  async updateUploadedFile(id: number, update: Partial<InsertUploadedFile>): Promise<UploadedFile | undefined> {
    const f = await this.getUploadedFileById(id);
    if (!f) return undefined;
    const dbUpdate = { ...update } as any;
    if (dbUpdate.extractedData !== undefined) {
      dbUpdate.extractedData = dbUpdate.extractedData ? JSON.stringify(dbUpdate.extractedData) : null;
    }
    const updateFields = Object.keys(dbUpdate).map(k => `${k} = ?`).join(", ");
    const vals = Object.values(dbUpdate).map(v => v ?? null);
    this.db.prepare(`UPDATE uploaded_files SET ${updateFields} WHERE id = ?`).run(...vals, id);
    return this.getUploadedFileById(id);
  }
  async deleteUploadedFile(id: number): Promise<boolean> {
    return this.db.prepare("DELETE FROM uploaded_files WHERE id = ?").run(id).changes > 0;
  }
}

// ─────────────────────────────────────────────────────────
// In-Memory Storage — fallback if SQLite not available
// ─────────────────────────────────────────────────────────
class MemStorage implements IStorage {
  private clients: Map<number, Client> = new Map();
  private entities: Map<number, Entity> = new Map();
  private selections: Map<number, StrategySelection> = new Map();
  private reports: Map<number, Report> = new Map();
  private quizzes: Map<number, QuizSubmission> = new Map();
  private clientSeq = 1;
  private entitySeq = 1;
  private selectionSeq = 1;
  private reportSeq = 1;
  private quizSeq = 1;
  private uploadedFiles: Map<number, UploadedFile> = new Map();
  private uploadedFileSeq = 1;

  async getClients() {
    return Array.from(this.clients.values()).sort((a, b) => b.id - a.id);
  }
  async getClient(id: number) { return this.clients.get(id); }
  async createClient(c: InsertClient) {
    const client: Client = { ...c, id: this.clientSeq++ };
    this.clients.set(client.id, client);
    return client;
  }
  async updateClient(id: number, updates: Partial<InsertClient>) {
    const c = this.clients.get(id);
    if (!c) return undefined;
    const updated = { ...c, ...updates, updatedAt: now() };
    this.clients.set(id, updated);
    return updated;
  }
  async deleteClient(id: number) {
    return this.clients.delete(id);
  }

  async getEntitiesByClient(clientId: number) {
    return Array.from(this.entities.values()).filter(e => e.clientId === clientId);
  }
  async getEntity(id: number) { return this.entities.get(id); }
  async createEntity(e: InsertEntity) {
    const entity: Entity = {
      grossRevenue: null, netProfit: null, w2Wages: null, ownerCompensation: null,
      agi: null, totalIncome: null, filingStatus: null, mortgageInterest: null,
      stateLocalTaxes: null, charitableDonations: null, medicalExpenses: null,
      capitalGains: null, capitalLosses: null, iraDistributions: null, rentalIncome: null,
      partnershipIncome: null, mealExpenses: null, travelExpenses: null, vehicleExpenses: null,
      homeOfficeExpenses: null, depreciation: null, hasEmployees: null,
      hasNonOwnerEmployees: null, hasBusinessVehiclePurchase: null,
      hasHealthInsurancePersonal: null, hasRealProperty: null, alreadyHasRetirementPlan: null,
      numberOfDependents: null, dependentsHaveEarnedIncome: null, notes: null,
      ...e, id: this.entitySeq++
    };
    this.entities.set(entity.id, entity);
    return entity;
  }
  async updateEntity(id: number, updates: Partial<InsertEntity>) {
    const e = this.entities.get(id);
    if (!e) return undefined;
    const updated = { ...e, ...updates };
    this.entities.set(id, updated);
    return updated;
  }
  async deleteEntity(id: number) {
    return this.entities.delete(id);
  }

  async getSelectionsForEntity(entityId: number) {
    return Array.from(this.selections.values())
      .filter(s => s.entityId === entityId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async upsertSelection(sel: InsertStrategySelection) {
    const existing = Array.from(this.selections.values()).find(
      s => s.entityId === sel.entityId && s.strategyId === sel.strategyId
    );
    if (existing) {
      const updated = { ...existing, ...sel };
      this.selections.set(existing.id, updated);
      return updated;
    }
    const s: StrategySelection = { sortOrder: 0, savingsMin: null, savingsMax: null, rationale: null, ...sel, id: this.selectionSeq++ };
    this.selections.set(s.id, s);
    return s;
  }
  async updateSelection(id: number, update: Partial<InsertStrategySelection>) {
    const s = this.selections.get(id);
    if (!s) return undefined;
    const updated = { ...s, ...update };
    this.selections.set(id, updated);
    return updated;
  }
  async deleteSelectionsForEntity(entityId: number) {
    for (const [id, s] of Array.from(this.selections.entries())) {
      if (s.entityId === entityId) this.selections.delete(id);
    }
  }

  async getReportsForClient(clientId: number) {
    return Array.from(this.reports.values()).filter(r => r.clientId === clientId);
  }
  async createReport(r: InsertReport) {
    const report: Report = { pdfUrl: null, generatedAt: null, ...r, id: this.reportSeq++ };
    this.reports.set(report.id, report);
    return report;
  }
  async updateReport(id: number, update: Partial<InsertReport>) {
    const r = this.reports.get(id);
    if (!r) return undefined;
    const updated = { ...r, ...update };
    this.reports.set(id, updated);
    return updated;
  }

  async getQuizSubmissions() {
    return Array.from(this.quizzes.values()).sort((a, b) => b.id - a.id);
  }
  async getQuizSubmission(id: number) { return this.quizzes.get(id); }
  async createQuizSubmission(q: InsertQuiz) {
    const quiz: QuizSubmission = {
      phone: null, currentTaxPrep: null, investmentActivity: null,
      biggestFrustration: null, overallIncomeDetails: null, hasDependents: null,
      ownsHome: null, hasEmployees: null, status: "new", convertedClientId: null,
      ...q, id: this.quizSeq++
    };
    this.quizzes.set(quiz.id, quiz);
    return quiz;
  }
  async updateQuizSubmission(id: number, update: Partial<InsertQuiz>) {
    const q = this.quizzes.get(id);
    if (!q) return undefined;
    const updated = { ...q, ...update };
    this.quizzes.set(id, updated);
    return updated;
  }
  async deleteQuizSubmission(id: number) {
    return this.quizzes.delete(id);
  }

  async getUploadedFilesByEntity(entityId: number) {
    return Array.from(this.uploadedFiles.values())
      .filter(f => f.entityId === entityId)
      .sort((a, b) => b.id - a.id);
  }
  async getUploadedFilesByClient(clientId: number) {
    return Array.from(this.uploadedFiles.values())
      .filter(f => f.clientId === clientId)
      .sort((a, b) => b.id - a.id);
  }
  async createUploadedFile(file: InsertUploadedFile) {
    const f: UploadedFile = {
      sizeBytes: null, extractedData: null, errorMessage: null,
      extractionStatus: "pending",
      ...file, id: this.uploadedFileSeq++
    };
    this.uploadedFiles.set(f.id, f);
    return f;
  }
  async updateUploadedFile(id: number, update: Partial<InsertUploadedFile>) {
    const f = this.uploadedFiles.get(id);
    if (!f) return undefined;
    const updated = { ...f, ...update };
    this.uploadedFiles.set(id, updated);
    return updated;
  }
  async deleteUploadedFile(id: number) {
    return this.uploadedFiles.delete(id);
  }
}

// ─────────────────────────────────────────────────────────
// Factory — use SQLite if a data directory is available
// ─────────────────────────────────────────────────────────
function createStorage(): IStorage {
  // Railway provides a persistent volume or we use /data directory
  // Try multiple locations in order of preference
  const candidates = [
    process.env.DATABASE_PATH,          // explicit override
    "/data/pbg.db",                     // Railway volume mount
    "/app/data/pbg.db",                 // alternate Railway path
    path.join(process.cwd(), "pbg.db"), // current working directory (dist/)
  ].filter(Boolean) as string[];

  for (const dbPath of candidates) {
    try {
      const dir = path.dirname(dbPath);
      // Test if we can write to this directory
      fs.mkdirSync(dir, { recursive: true });
      const testFile = path.join(dir, ".write_test");
      fs.writeFileSync(testFile, "test");
      fs.unlinkSync(testFile);
      return new SqliteStorage(dbPath);
    } catch {
      // This path isn't writable, try the next one
      continue;
    }
  }

  // All paths failed — fall back to in-memory with a warning
  console.warn("[storage] WARNING: Could not create SQLite database. Using in-memory storage (data will be lost on restart).");
  return new MemStorage();
}

export const storage = createStorage();
