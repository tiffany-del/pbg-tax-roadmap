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

  // Quiz Submissions
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

  // Uploaded Files
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

export const storage = new MemStorage();
