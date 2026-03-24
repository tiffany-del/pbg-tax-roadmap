import { pgTable, text, serial, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ========================
// CLIENTS
// ========================
export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),               // "John & Mary Smith"
  taxYear: integer("tax_year").notNull(),
  filingStatus: text("filing_status").notNull(), // MFJ, Single, HOH, MFS, QW
  preparationDate: text("preparation_date").notNull(),
  inputMode: text("input_mode").notNull(),     // "tax_return" | "financials"
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertClientSchema = createInsertSchema(clients).omit({ id: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

// ========================
// ENTITIES (per client)
// ========================
export const entities = pgTable("entities", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  name: text("name").notNull(),              // "IAMUS Consulting Inc." or "John & Mary Smith"
  entityType: text("entity_type").notNull(), // "1040" | "1120S" | "1065" | "C-Corp"
  
  // Financial data — used for both tax return and financials-only paths
  grossRevenue: integer("gross_revenue"),
  netProfit: integer("net_profit"),          // ordinary income/loss
  w2Wages: integer("w2_wages"),              // wages paid to employees (not owner)
  ownerCompensation: integer("owner_compensation"), // officer W-2 / guaranteed payments
  
  // 1040-specific fields
  agi: integer("agi"),
  totalIncome: integer("total_income"),
  filingStatus: text("filing_status"),       // override if different from client
  mortgageInterest: integer("mortgage_interest"),
  stateLocalTaxes: integer("state_local_taxes"),
  charitableDonations: integer("charitable_donations"),
  medicalExpenses: integer("medical_expenses"),
  capitalGains: integer("capital_gains"),
  capitalLosses: integer("capital_losses"),
  iraDistributions: integer("ira_distributions"),
  rentalIncome: integer("rental_income"),
  partnershipIncome: integer("partnership_income"),
  
  // Business-specific fields
  mealExpenses: integer("meal_expenses"),
  travelExpenses: integer("travel_expenses"),
  vehicleExpenses: integer("vehicle_expenses"),
  homeOfficeExpenses: integer("home_office_expenses"),
  depreciation: integer("depreciation"),
  
  // Boolean qualifiers
  hasEmployees: boolean("has_employees"),
  hasNonOwnerEmployees: boolean("has_non_owner_employees"),
  hasBusinessVehiclePurchase: boolean("has_business_vehicle_purchase"),
  hasHealthInsurancePersonal: boolean("has_health_insurance_personal"),
  hasRealProperty: boolean("has_real_property"),
  alreadyHasRetirementPlan: boolean("already_has_retirement_plan"),
  numberOfDependents: integer("number_of_dependents"),
  dependentsHaveEarnedIncome: boolean("dependents_have_earned_income"),
  
  notes: text("notes"),
});

export const insertEntitySchema = createInsertSchema(entities).omit({ id: true });
export type InsertEntity = z.infer<typeof insertEntitySchema>;
export type Entity = typeof entities.$inferSelect;

// ========================
// STRATEGY SELECTIONS (per entity)
// ========================
export const strategySelections = pgTable("strategy_selections", {
  id: serial("id").primaryKey(),
  entityId: integer("entity_id").notNull(),
  strategyId: text("strategy_id").notNull(),   // references STRATEGIES array
  status: text("status").notNull(),             // "suggested" | "excluded" | "manual_add" | "manual_remove"
  savingsMin: integer("savings_min"),
  savingsMax: integer("savings_max"),
  rationale: text("rationale"),                 // editable "why recommended" text
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertStrategySelectionSchema = createInsertSchema(strategySelections).omit({ id: true });
export type InsertStrategySelection = z.infer<typeof insertStrategySelectionSchema>;
export type StrategySelection = typeof strategySelections.$inferSelect;

// ========================
// REPORTS (generated)
// ========================
export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  status: text("status").notNull(),             // "draft" | "final"
  pdfUrl: text("pdf_url"),
  generatedAt: text("generated_at"),
  createdAt: text("created_at").notNull(),
});

export const insertReportSchema = createInsertSchema(reports).omit({ id: true });
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reports.$inferSelect;

// ========================
// QUIZ SUBMISSIONS
// ========================
export const quizSubmissions = pgTable("quiz_submissions", {
  id: serial("id").primaryKey(),
  // Contact info
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  // Quiz answers
  businessStructure: text("business_structure").notNull(),  // "sole_prop" | "llc_single" | "s_corp" | "partnership" | "c_corp" | "not_sure"
  annualRevenue: text("annual_revenue").notNull(),           // "under_100k" | "100k_250k" | "250k_500k" | "500k_1m" | "1m_2m" | "over_2m"
  annualProfit: text("annual_profit").notNull(),             // "under_100k" | "100k_250k" | "250k_500k" | "500k_1m" | "over_1m"
  annualTaxBill: text("annual_tax_bill").notNull(),          // "under_25k" | "25k_50k" | "50k_100k" | "100k_200k" | "over_200k"
  currentTaxPrep: text("current_tax_prep"),                  // "self" | "cpa" | "national_chain" | "bookkeeper" | "none"
  investmentActivity: text("investment_activity"),           // "business_only" | "stocks" | "real_estate" | "multiple"
  biggestFrustration: text("biggest_frustration"),
  overallIncomeDetails: text("overall_income_details"),      // "increasing_both" | "increasing_expect" | "stable" | "declining"
  hasDependents: text("has_dependents"),                     // "no" | "yes" | "yes_earned_income"
  ownsHome: text("owns_home"),                               // "no" | "yes" | "yes_home_office"
  hasEmployees: text("has_employees"),                       // "no" | "yes_1_5" | "yes_6_plus"
  // Status
  status: text("status").notNull().default("new"),           // "new" | "viewed" | "converted"
  createdAt: text("created_at").notNull(),
  // If converted to a full client roadmap
  convertedClientId: integer("converted_client_id"),
});

export const insertQuizSchema = createInsertSchema(quizSubmissions).omit({ id: true });
export type InsertQuiz = z.infer<typeof insertQuizSchema>;
export type QuizSubmission = typeof quizSubmissions.$inferSelect;

// ========================
// UPLOADED FILES (per entity)
// ========================
export const uploadedFiles = pgTable("uploaded_files", {
  id: serial("id").primaryKey(),
  entityId: integer("entity_id").notNull(),
  clientId: integer("client_id").notNull(),
  filename: text("filename").notNull(),        // original filename
  fileType: text("file_type").notNull(),       // "1040" | "1120S" | "1065" | "financials"
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes"),
  uploadedAt: text("uploaded_at").notNull(),
  extractionStatus: text("extraction_status").notNull().default("pending"), // "pending" | "processing" | "done" | "error"
  extractedData: text("extracted_data"),       // JSON string of extracted fields
  errorMessage: text("error_message"),
});

export const insertUploadedFileSchema = createInsertSchema(uploadedFiles).omit({ id: true });
export type InsertUploadedFile = z.infer<typeof insertUploadedFileSchema>;
export type UploadedFile = typeof uploadedFiles.$inferSelect;
