#!/usr/bin/env python3
"""
PBG Premium Tax Strategy Report PDF Generator
Usage: python3 generate_premium_pdf.py <payload_json_path> <output_pdf_path>

Generates a premium Multi-Year Tax Strategy Report with:
  1. Cover page
  2. Multi-year projections (per-strategy + cumulative bar chart)
  3. Quarterly Action Plan
  4. Disclosures
"""

import sys
import json
import os
import urllib.request
import tempfile
import math
from datetime import datetime

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, white, black, Color
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus.flowables import Flowable
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Group
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics import renderPDF

# ─────────────────────────────────────────────
# BRAND COLORS
# ─────────────────────────────────────────────
NAVY      = HexColor("#1b2951")
BLUSH     = HexColor("#f7cac9")
OFFWHITE  = HexColor("#f5f5f0")
SLATE     = HexColor("#5d737e")
GRAY      = HexColor("#b8b5b2")
ACCENT    = HexColor("#b5cc42")
DARK_TEXT = HexColor("#1a1a1a")
MID_TEXT  = HexColor("#4a4a4a")
LIGHT_TEXT= HexColor("#888888")
WHITE     = white
GREEN     = HexColor("#2d7d46")
CARD_BORDER = HexColor("#e5e5e5")
OFFWHITE2 = HexColor("#f0f0ea")

PAGE_W, PAGE_H = letter
MARGIN = 0.75 * inch
CONTENT_W = PAGE_W - 2 * MARGIN

# ─────────────────────────────────────────────
# FONT SETUP
# ─────────────────────────────────────────────
FONT_DIR = "/tmp/pbg_fonts"
os.makedirs(FONT_DIR, exist_ok=True)

PLAYFAIR_URLS = {
    "Playfair":      "https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf",
    "PlayfairItalic":"https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay-Italic%5Bwght%5D.ttf",
}
NUNITO_URLS = {
    "Nunito":        "https://github.com/google/fonts/raw/main/ofl/nunitosans/NunitoSans%5BLTNS,opsz,wdth,wght%5D.ttf",
}

def _download_font(name, url, path):
    if not os.path.exists(path):
        try:
            urllib.request.urlretrieve(url, path)
        except Exception:
            return False
    return True

def register_fonts():
    """Download and register Playfair Display + Nunito Sans. Falls back to Helvetica."""
    registered = {}

    # Playfair Display (serif heading font)
    pf_path    = os.path.join(FONT_DIR, "PlayfairDisplay.ttf")
    pf_it_path = os.path.join(FONT_DIR, "PlayfairDisplay-Italic.ttf")

    if _download_font("Playfair", PLAYFAIR_URLS["Playfair"], pf_path):
        try:
            pdfmetrics.registerFont(TTFont("Playfair", pf_path))
            registered["display"] = "Playfair"
        except Exception:
            registered["display"] = "Times-Roman"
    else:
        registered["display"] = "Times-Roman"

    if _download_font("PlayfairItalic", PLAYFAIR_URLS["PlayfairItalic"], pf_it_path):
        try:
            pdfmetrics.registerFont(TTFont("PlayfairItalic", pf_it_path))
            registered["display_italic"] = "PlayfairItalic"
        except Exception:
            registered["display_italic"] = "Times-Italic"
    else:
        registered["display_italic"] = "Times-Italic"

    # Nunito Sans (body font)
    nu_path = os.path.join(FONT_DIR, "NunitoSans.ttf")
    if _download_font("Nunito", NUNITO_URLS["Nunito"], nu_path):
        try:
            pdfmetrics.registerFont(TTFont("Nunito", nu_path))
            registered["body"] = "Nunito"
        except Exception:
            registered["body"] = "Helvetica"
    else:
        registered["body"] = "Helvetica"

    return registered


# ─────────────────────────────────────────────
# STRATEGY LOOKUP
# ─────────────────────────────────────────────
STRATEGY_DATA = {
    "augusta_rule": {"name": "Augusta Rule", "short": "Rent your home for up to 14 days annually, tax-free."},
    "itemized_deductions": {"name": "Itemized Deductions", "short": "Deduct eligible expenses to reduce taxable income."},
    "oil_and_gas": {"name": "Oil and Gas", "short": "Tax benefits through oil and gas investments."},
    "qcds": {"name": "Qualified Charitable Distributions", "short": "Transfer IRA funds directly to charity tax-free."},
    "sell_your_home": {"name": "Sell Your Home", "short": "Exclude major home sale profits from taxes."},
    "tax_loss_harvesting": {"name": "Tax Loss Harvesting", "short": "Sell losing investments to offset gains."},
    "traditional_401k_individual": {"name": "Traditional 401k", "short": "Pre-tax retirement contributions reduce taxable income."},
    "roth_401k_individual": {"name": "Roth 401k (Individual)", "short": "After-tax contributions grow and withdraw tax-free."},
    "child_tax_credit": {"name": "Child Tax Credit", "short": "Tax savings through Child Tax Credit."},
    "child_roth_ira": {"name": "Child Roth IRA", "short": "Custodial Roth IRA for minors with earned income."},
    "qsbs": {"name": "QSBS: Small Business Stock", "short": "Exclude gains from qualified small business stock."},
    "health_savings_account": {"name": "Health Savings Account (HSA)", "short": "Triple tax advantage for medical expenses."},
    "accountable_plan": {"name": "Accountable Plan", "short": "Reimburse business expenses tax-free through the entity."},
    "home_office": {"name": "Home Office", "short": "Deduct dedicated business space in your home."},
    "meals": {"name": "Meals", "short": "50% deduction on business-related meals."},
    "travel": {"name": "Travel", "short": "Deduct necessary business travel expenses."},
    "vehicle": {"name": "Vehicle", "short": "Deduct business use of vehicles."},
    "hiring_kids": {"name": "Hiring Your Children", "short": "Shift income to children's lower tax bracket."},
    "traditional_401k_business": {"name": "Traditional 401k (Business)", "short": "Tax-advantaged retirement plan for business owners."},
    "roth_401k_business": {"name": "Roth 401k (Business)", "short": "After-tax retirement plan for business owners."},
    "late_s_election": {"name": "Late S Corporation Election", "short": "Reduce self-employment taxes via S-Corp status."},
    "late_c_election": {"name": "Late C Corporation Election", "short": "C-Corp taxation for potential 21% flat rate."},
    "employee_achievement_award": {"name": "Employee Achievement Award", "short": "Tax-free awards for length of service or safety."},
    "health_reimbursement": {"name": "Health Reimbursement Arrangement", "short": "Employer-funded tax-free medical reimbursements."},
    "qualified_edu_assistance": {"name": "Qualified Educational Assistance", "short": "Up to $5,250/yr tax-free educational assistance."},
    "work_opportunity_credit": {"name": "Work Opportunity Tax Credit", "short": "Federal tax credit for hiring from target groups."},
    "maximize_depreciation": {"name": "Maximize Depreciation (Sec 179/Bonus)", "short": "Immediately deduct cost of qualifying business assets."},
    "cost_segregation": {"name": "Cost Segregation", "short": "Accelerate depreciation on building components."},
    "captive_insurance": {"name": "Captive Insurance", "short": "Create a captive insurer to capture premiums tax-efficiently."},
    "section_199a": {"name": "Section 199A (QBI Deduction)", "short": "Deduct up to 20% of qualified business income."},
    "profit_sharing": {"name": "Profit Sharing Plan", "short": "Variable deductible contributions to employee retirement."},
    "cash_balance_plan": {"name": "Cash Balance / Defined Benefit Plan", "short": "Larger tax-deductible retirement contributions."},
    "deferred_compensation": {"name": "Deferred Compensation", "short": "Defer executive compensation to a future tax year."},
    "1031_exchange": {"name": "1031 Like-Kind Exchange", "short": "Defer capital gains by exchanging investment property."},
    "charitable_remainder_trust": {"name": "Charitable Remainder Trust", "short": "Donate appreciated assets for income + deduction."},
    "opportunity_zone": {"name": "Opportunity Zone Investment", "short": "Defer and reduce taxes via opportunity zone funds."},
}

def get_strategy(strategy_id):
    return STRATEGY_DATA.get(strategy_id, {
        "name": strategy_id.replace("_", " ").title(),
        "short": "",
    })


# ─────────────────────────────────────────────
# CURRENCY HELPERS
# ─────────────────────────────────────────────
def fmt_dollars(amount):
    if amount is None:
        return "$0"
    return f"${amount:,.0f}"

def fmt_range(min_val, max_val):
    if min_val is None and max_val is None:
        return "$0"
    if min_val is None:
        return fmt_dollars(max_val)
    if max_val is None:
        return fmt_dollars(min_val)
    return f"{fmt_dollars(min_val)} \u2013 {fmt_dollars(max_val)}"

def round_to_100(n):
    return round(n / 100) * 100


# ─────────────────────────────────────────────
# BOILERPLATE TEXT
# ─────────────────────────────────────────────
IMPORTANT_INFO_TEXT = (
    "IMPORTANT INFORMATION\n\n"
    "The tax savings estimates presented in this report are based on our proprietary analysis of the "
    "tax return and/or financial information provided. These estimates are illustrative projections "
    "and should not be considered guaranteed outcomes.\n\n"
    "Actual savings will depend on your specific circumstances, implementation of strategies, changes "
    "in tax law, and other factors. We strongly recommend consulting with a licensed tax professional "
    "before implementing any of the strategies described in this report.\n\n"
    "This report is intended for informational purposes only and does not constitute tax advice. "
    "Phillips Business Group is not liable for any financial decisions made based on the information "
    "contained herein.\n\n"
    "All figures presented are approximations based on the data provided and current tax law as of "
    "the preparation date. Tax laws are subject to change, and these strategies may be affected by "
    "future legislative changes.\n\n"
    "The strategies identified in this report require proper documentation and implementation to be "
    "effective. Failure to properly document or implement these strategies may result in disallowance "
    "of deductions or credits by the IRS."
)


# ─────────────────────────────────────────────
# QUARTERLY ACTION MAPPING
# ─────────────────────────────────────────────
# Maps strategy IDs to (quarter, bold_label, action_text, deadline_or_None)
QUARTERLY_ACTIONS = {
    # Q1
    "health_savings_account": [
        (1, "HSA Contribution", "Confirm prior-year HSA contribution before the tax deadline; maximize current-year contribution to reduce taxable income.", "Apr 15"),
    ],
    "traditional_401k_individual": [
        (1, "401k Review", "Review prior-year 401(k) contribution levels; confirm elective deferral limit for the current year.", None),
        (4, "401k Max-Out", "Make all remaining elective 401(k) deferrals before Dec 31 payroll cutoff.", "Dec 31"),
    ],
    "traditional_401k_business": [
        (1, "Business 401k Setup", "Confirm plan is established and contribution election is on file; review employee deferrals.", None),
        (4, "Business 401k Funding", "Process employer profit-sharing or match contribution before Dec 31 (or filing deadline with extension).", "Dec 31"),
    ],
    "roth_401k_individual": [
        (1, "Roth 401k Review", "Confirm Roth 401(k) election is in place for the current year; review tax bracket to validate Roth vs. Traditional split.", None),
        (4, "Roth 401k Max-Out", "Ensure all Roth 401(k) contributions are maximized before Dec 31 payroll cutoff.", "Dec 31"),
    ],
    "roth_401k_business": [
        (4, "Roth 401k Business Funding", "Process Roth 401(k) employer matching before Dec 31 per SECURE 2.0 rules.", "Dec 31"),
    ],
    "child_roth_ira": [
        (1, "Child Roth IRA", "Confirm prior-year earned income for qualifying children; make prior-year Child Roth IRA contribution before tax deadline.", "Apr 15"),
        (4, "Child Roth IRA Year-End", "Make current-year Child Roth IRA contribution if child has earned income.", "Dec 31"),
    ],
    "accountable_plan": [
        (1, "Accountable Plan", "Confirm written accountable plan policy is in place; submit Q4 reimbursement requests with receipts.", None),
        (2, "Accountable Plan Q2", "Submit Q1 reimbursements; reconcile vehicle mileage, home office, and phone expenses.", None),
        (3, "Accountable Plan Q3", "Submit Q2 reimbursements; update mileage log and home office square footage documentation.", None),
        (4, "Accountable Plan Year-End", "Process all outstanding reimbursements before Dec 31 — unprocessed reimbursements cannot cross into the new year.", "Dec 31"),
    ],
    "augusta_rule": [
        (1, "Augusta Rule", "Schedule and document Augusta Rule rental meeting(s) in writing with a business purpose memo; confirm 14-day limit.", None),
        (3, "Augusta Rule Q3", "Schedule remaining Augusta Rule rental days; ensure written rental agreement and fair-market-value documentation are on file.", None),
        (4, "Augusta Rule Last Call", "Last opportunity to schedule remaining rental days before year-end; ensure all documentation is complete.", "Dec 31"),
    ],
    "section_199a": [
        (1, "Section 199A (QBI)", "Review prior-year QBI deduction; confirm W-2 wages paid by the entity meet the wage test for maximum deduction.", None),
        (4, "Section 199A Optimization", "Review entity W-2 wages before Dec 31; consider timing of distributions vs. wages to optimize QBI deduction.", "Dec 31"),
    ],
    "maximize_depreciation": [
        (2, "Depreciation Planning", "Identify planned equipment or vehicle purchases for the year; confirm placed-in-service date requirements for Section 179.", None),
        (3, "Depreciation Mid-Year", "Review planned capital purchases; confirm bonus depreciation rate (60% for 2024) and placed-in-service deadlines.", None),
        (4, "Section 179 / Bonus Depreciation", "Purchase and PLACE IN SERVICE all qualifying equipment before Dec 31 to claim Section 179 or bonus depreciation this tax year.", "Dec 31"),
    ],
    "cost_segregation": [
        (2, "Cost Segregation Study", "Engage a cost segregation engineer if a new property was purchased or renovated; confirm property value exceeds $1M threshold.", None),
        (4, "Cost Segregation Filing", "Confirm cost segregation study is complete and depreciation schedule is ready for tax return preparation.", "Dec 31"),
    ],
    "profit_sharing": [
        (4, "Profit Sharing Contribution", "Make profit-sharing contribution before business tax return due date (with extension). Contribution limit: 25% of compensation, max $69,000.", "Dec 31"),
    ],
    "cash_balance_plan": [
        (1, "Cash Balance Plan Review", "Review actuarial determination for the current year; confirm minimum required contribution with your actuary.", None),
        (4, "Cash Balance Funding", "Fund cash balance plan by tax filing deadline with extension. Actuarially determined amount — confirm with plan administrator.", "Dec 31"),
    ],
    "itemized_deductions": [
        (1, "Itemized Deductions", "Gather prior-year receipts for mortgage interest, property taxes, charitable donations, and medical expenses for tax prep.", "Apr 15"),
        (4, "Itemized Deductions Year-End", "Bundle charitable donations, prepay January mortgage payment in December, and maximize itemizable expenses before Dec 31.", "Dec 31"),
    ],
    "tax_loss_harvesting": [
        (4, "Tax Loss Harvesting", "Review investment portfolio for unrealized losses before Dec 31; sell losing positions to offset capital gains and up to $3,000 ordinary income. Watch wash-sale rule.", "Dec 31"),
    ],
    "vehicle": [
        (1, "Vehicle Log", "Reconcile mileage log for Q4; confirm business-use percentage for annual deduction calculation.", None),
        (2, "Vehicle Log Q2", "Update mileage log for Q1; ensure odometer readings and business-purpose notes are current.", None),
        (3, "Vehicle Log Q3", "Update mileage log for Q2; review actual vs. standard mileage method to determine optimal deduction.", None),
        (4, "Vehicle Documentation", "Finalize full-year mileage log; elect Section 179 or bonus depreciation for any vehicle purchased this year.", "Dec 31"),
    ],
    "home_office": [
        (1, "Home Office", "Calculate home office square footage and total home area for prior-year deduction; gather utility bills, insurance, and mortgage/rent records.", None),
        (2, "Home Office Q2", "Confirm dedicated business space remains exclusive-use; document any changes in home office configuration.", None),
    ],
    "meals": [
        (2, "Business Meals", "Reconcile Q1 meal receipts; ensure each receipt has business purpose, attendees, and date documented.", None),
        (3, "Business Meals Q3", "Reconcile Q2 meal receipts; review running total against budget.", None),
        (4, "Business Meals Year-End", "Reconcile Q3–Q4 meal receipts; finalize annual deductible amount (50% of documented business meals).", "Dec 31"),
    ],
    "travel": [
        (2, "Business Travel", "Reconcile Q1 business travel; confirm primary business purpose for all trips and document itinerary.", None),
        (3, "Business Travel Q3", "Reconcile Q2 travel; verify mixed business/personal trip allocation documentation.", None),
        (4, "Business Travel Year-End", "Finalize annual travel deductions; ensure all international and domestic trips have complete documentation.", "Dec 31"),
    ],
    "hiring_kids": [
        (1, "Hiring Children", "Confirm prior-year W-2 wages paid to qualifying children; verify reasonable compensation documentation for actual work performed.", None),
        (3, "Hiring Children Q3", "Review year-to-date wages paid to children; confirm work log and timesheets are up to date.", None),
        (4, "Hiring Children Year-End", "Issue final paychecks to children before Dec 31; prepare W-2s; confirm under-18 FICA exemption applies.", "Dec 31"),
    ],
    "health_reimbursement": [
        (2, "Health Reimbursement (HRA)", "Confirm HRA plan documents are in place; distribute plan summary to eligible employees.", None),
        (4, "HRA Year-End", "Process all outstanding HRA reimbursement claims before plan year end; confirm unused balance rules per plan type.", "Dec 31"),
    ],
    "late_s_election": [
        (1, "S-Corp Election", "File IRS Form 2553 for S-Corp election; confirm state-level election requirements and effective date.", "Mar 15"),
    ],
    "section_199a": [
        (1, "Section 199A (QBI)", "Review prior-year QBI deduction; confirm W-2 wages paid by entity meet the wage test.", None),
        (4, "Section 199A Year-End", "Review entity W-2 wages before Dec 31; consider timing of distributions vs. wages to optimize QBI.", "Dec 31"),
    ],
    "deferred_compensation": [
        (1, "Deferred Compensation", "Confirm all deferral elections meet IRC 409A requirements; elections must be made BEFORE the compensation is earned.", None),
    ],
    "1031_exchange": [
        (2, "1031 Exchange Planning", "If considering a property sale, engage a qualified intermediary BEFORE closing; 45-day identification and 180-day closing deadlines are strict.", None),
        (4, "1031 Exchange Year-End", "Confirm replacement property acquisition timelines; if exchange is in progress, verify 180-day deadline is met.", "Dec 31"),
    ],
    "charitable_remainder_trust": [
        (4, "Charitable Remainder Trust", "Review appreciated assets for CRT contribution before year-end; coordinate with estate planning attorney.", "Dec 31"),
    ],
    "opportunity_zone": [
        (4, "Opportunity Zone Investment", "Invest capital gains in a Qualified Opportunity Zone Fund before Dec 31 to qualify for gain deferral.", "Dec 31"),
    ],
    "qsbs": [
        (2, "QSBS Documentation", "Confirm C-corporation gross assets were under $50M at time of stock issuance; document original issue certificates.", None),
    ],
    "qcds": [
        (4, "Qualified Charitable Distributions", "Direct IRA distributions to qualified charities before Dec 31 to satisfy RMD and exclude from taxable income (age 70½+ only).", "Dec 31"),
    ],
    "employee_achievement_award": [
        (4, "Employee Achievement Awards", "Identify qualifying employees for length-of-service or safety awards; purchase tangible personal property awards before Dec 31.", "Dec 31"),
    ],
    "work_opportunity_credit": [
        (1, "WOTC Certification", "Ensure Form 8850 pre-screening notices were submitted within 28 days of each qualifying hire's start date.", None),
        (4, "WOTC Year-End", "Compile documentation for all qualifying WOTC hires this year; calculate credit amount for each targeted group.", "Dec 31"),
    ],
}

QUARTER_NAMES = {
    1: "Q1: January – March",
    2: "Q2: April – June",
    3: "Q3: July – September",
    4: "Q4: October – December",
}
QUARTER_SUBTITLES = {
    1: "Prior-year deadline actions & new-year setup",
    2: "Tax filing, new strategy setup & Q1 follow-through",
    3: "Mid-year review & year-end prep",
    4: "Year-end planning — critical window",
}
QUARTER_COLORS = {
    1: SLATE,
    2: NAVY,
    3: ACCENT,
    4: BLUSH,
}
QUARTER_TEXT_COLORS = {
    1: WHITE,
    2: WHITE,
    3: DARK_TEXT,
    4: DARK_TEXT,
}


# ─────────────────────────────────────────────
# QUIZ → PAYLOAD (verbatim from generate_pdf.py)
# ─────────────────────────────────────────────
PROFIT_MIDPOINTS = {
    "under_100k": 60000, "100k_250k": 175000, "250k_500k": 375000,
    "500k_1m": 750000, "over_1m": 1200000,
}
TAX_RATES = {
    "under_100k": 0.22, "100k_250k": 0.24, "250k_500k": 0.32,
    "500k_1m": 0.35, "over_1m": 0.37,
}
STRUCTURE_TO_ENTITY = {
    "sole_prop": "1040", "llc_single": "1065", "s_corp": "1120S",
    "partnership": "1065", "c_corp": "C-Corp", "not_sure": "1040",
}
STRUCTURE_LABELS = {
    "sole_prop": "Sole Proprietor", "llc_single": "LLC (Single Member)",
    "s_corp": "S-Corporation", "partnership": "Partnership / Multi-Member LLC",
    "c_corp": "C-Corporation", "not_sure": "Business",
}

def quiz_to_payload(quiz):
    """Convert a quiz submission dict into the standard PDF payload format."""
    name = f"{quiz.get('firstName', '')} {quiz.get('lastName', '')}".strip()
    profit_key = quiz.get("annualProfit", "under_100k")
    profit_val = PROFIT_MIDPOINTS.get(profit_key, 60000)
    rate = TAX_RATES.get(profit_key, 0.24)
    entity_type = STRUCTURE_TO_ENTITY.get(quiz.get("businessStructure", "sole_prop"), "1040")
    struct_label = STRUCTURE_LABELS.get(quiz.get("businessStructure", ""), "Business")

    client = {
        "id": quiz.get("id", 1),
        "name": name,
        "taxYear": 2024,
        "filingStatus": "MFJ",
        "preparationDate": datetime.today().strftime("%B %d, %Y"),
        "inputMode": "quiz",
        "createdAt": quiz.get("createdAt", ""),
        "updatedAt": quiz.get("createdAt", ""),
    }
    entity = {
        "id": 1,
        "clientId": quiz.get("id", 1),
        "name": f"{name}'s {struct_label}",
        "entityType": entity_type,
        "grossRevenue": None, "netProfit": profit_val,
        "wages": None, "agi": profit_val if entity_type == "1040" else None,
    }
    selections = _quiz_selections(quiz, profit_val, rate, entity_type)
    return {
        "client": client,
        "entities": [entity],
        "allSelections": {"1": selections},
    }


def _quiz_selections(quiz, profit, rate, entity_type):
    """Generate strategy selections from quiz answers."""
    results = []
    biz = quiz.get("businessStructure", "sole_prop")
    is_business = biz in ("sole_prop", "llc_single", "s_corp", "partnership", "c_corp")
    is_s_corp = biz == "s_corp"
    is_partnership = biz in ("llc_single", "partnership")
    profit_key = quiz.get("annualProfit", "under_100k")
    high_income = profit_key in ("250k_500k", "500k_1m", "over_1m")
    has_dependents = quiz.get("hasDependents") and quiz.get("hasDependents") != "no"
    owns_home = quiz.get("ownsHome") and quiz.get("ownsHome") != "no"
    has_employees = quiz.get("hasEmployees") and quiz.get("hasEmployees") != "no"
    has_stocks = quiz.get("investmentActivity") in ("stocks", "multiple")
    has_real_estate = quiz.get("investmentActivity") in ("real_estate", "multiple")

    def sav(deduc, mult_min=0.6, mult_max=1.4):
        return max(500, int(deduc * rate * mult_min)), int(deduc * rate * mult_max)

    i = 0
    def add(strat_id, status, s_min, s_max, rationale):
        nonlocal i
        results.append({
            "strategyId": strat_id, "status": status,
            "savingsMin": s_min, "savingsMax": s_max,
            "rationale": rationale, "sortOrder": i,
        })
        i += 1

    if is_business:
        if biz in ("s_corp", "partnership", "c_corp"):
            mn, mx = sav(min(profit * 0.12, 35000))
            add("accountable_plan", "suggested", max(mn, 3000), min(mx, 35000),
                "Accountable plan reduces income and payroll taxes via tax-free reimbursements.")
        mn, mx = sav(profit * 0.03)
        add("meals", "suggested", max(mn, 500), min(mx, 12000), "Business meals 50% deductible.")
        add("travel", "suggested", max(int(profit * 0.02 * rate), 1000), min(int(profit * 0.05 * rate), 12000), "Business travel deductible.")
        add("vehicle", "suggested", 1500, 12000, "Business vehicle deductible.")
        if biz in ("sole_prop", "llc_single", "s_corp", "partnership"):
            qbi = profit * 0.20
            mn, mx = sav(qbi)
            add("section_199a", "suggested", max(mn, 2000), min(mx, 80000), "Up to 20% QBI deduction.")
        if profit_key != "under_100k":
            add("maximize_depreciation", "suggested", 5000, 50000, "Section 179 / bonus depreciation.")
            ret_min, ret_max = sav(min(profit * 0.1, 69000))
            add("traditional_401k_business", "suggested", max(ret_min, 3000), min(ret_max, 25000), "Employer 401(k) deductible.")
        if high_income:
            ps_min, ps_max = sav(min(profit * 0.15, 69000))
            add("profit_sharing", "suggested", max(ps_min, 8000), min(ps_max, 50000), "Profit-sharing discretionary contributions.")
        if profit_key in ("500k_1m", "over_1m"):
            add("cash_balance_plan", "suggested", 30000, 150000, "Cash balance / defined benefit plan.")
        if is_partnership and profit_key != "under_100k":
            se_sav = max(int(min(profit * 0.35, 150000) * 0.153 * 0.5), 5000)
            add("late_s_election", "suggested", int(se_sav * 0.6), int(se_sav * 1.4), "S-Corp election reduces SE taxes.")
        add("augusta_rule", "suggested", 1500, 15000, "Rent home to business tax-free up to 14 days.")
        if has_dependents:
            add("hiring_kids", "suggested", 3000, 15000, "Hire children to shift income to lower bracket.")
        if has_employees:
            add("health_reimbursement", "suggested", 3000, 20000, "HRA tax-free medical reimbursements.")
            add("work_opportunity_credit", "suggested", 1200, 15000, "WOTC credit for targeted hires.")
            add("employee_achievement_award", "suggested", 500, 3000, "Deductible awards for employees.")
        if has_real_estate:
            add("cost_segregation", "suggested", 15000, 100000, "Accelerated depreciation on real property.")
            add("1031_exchange", "suggested", 10000, 80000, "Defer capital gains on investment property sales.")
    if owns_home:
        add("itemized_deductions", "suggested", 2000, 10000, "Itemize mortgage interest, property taxes.")
        add("sell_your_home", "suggested", 15000, 75000, "Exclude up to $500K gain on home sale.")
    add("health_savings_account", "suggested", 1000, 8300, "HSA triple tax advantage.")
    ret_i_min, ret_i_max = max(1500, int(23000 * rate * 0.6)), int(23000 * rate)
    add("traditional_401k_individual", "suggested", ret_i_min, ret_i_max, "401(k) contribution reduces taxable income.")
    if has_dependents:
        add("child_tax_credit", "suggested", 1000, 5000, "Child Tax Credit up to $2,000/child.")
    if quiz.get("hasDependents") == "yes_earned_income":
        add("child_roth_ira", "suggested", 500, 7000, "Child Roth IRA for children with earned income.")
    elif has_dependents:
        add("child_roth_ira", "excluded", 0, 0, "No earned income — not yet applicable.")
    if has_stocks:
        add("tax_loss_harvesting", "suggested", 2000, 20000, "Offset gains with harvested losses.")
    else:
        add("tax_loss_harvesting", "excluded", 0, 0, "No investment securities.")
    if high_income and has_stocks:
        add("oil_and_gas", "suggested", 10000, 50000, "Oil & gas intangible drilling deductions.")
    if is_s_corp:
        add("late_s_election", "excluded", 0, 0, "Already an S-Corp.")
    if not has_real_estate:
        add("cost_segregation", "excluded", 0, 0, "Requires real property.")
        add("1031_exchange", "excluded", 0, 0, "Requires investment property.")
    return results


# ─────────────────────────────────────────────
# PROJECTION MATH
# ─────────────────────────────────────────────
GROWTH_RATE = 0.03  # 3% annual income growth — savings grow with it

def project_savings(s_min, s_max, years=5):
    """Return list of (min, max) for each year with 3% growth."""
    result = []
    cur_min, cur_max = s_min, s_max
    for y in range(years):
        if y == 0:
            result.append((round_to_100(cur_min), round_to_100(cur_max)))
        else:
            cur_min = cur_min * (1 + GROWTH_RATE)
            cur_max = cur_max * (1 + GROWTH_RATE)
            result.append((round_to_100(cur_min), round_to_100(cur_max)))
    return result


# ─────────────────────────────────────────────
# CUSTOM FLOWABLES
# ─────────────────────────────────────────────
class VSpace(Flowable):
    """Simple vertical spacer."""
    def __init__(self, height):
        Flowable.__init__(self)
        self.height = height
        self.width = 0

    def draw(self):
        pass

    def wrap(self, aw, ah):
        return (0, self.height)


class ColorRect(Flowable):
    """Full-width colored rectangle used as section dividers."""
    def __init__(self, height, color, width=None):
        Flowable.__init__(self)
        self.rect_height = height
        self.color = color
        self._width = width or CONTENT_W

    def wrap(self, aw, ah):
        return (self._width, self.rect_height)

    def draw(self):
        self.canv.setFillColor(self.color)
        self.canv.rect(0, 0, self._width, self.rect_height, fill=1, stroke=0)


class CoverPage(Flowable):
    """Full-page navy cover page — sized to fit within doc frame."""
    def __init__(self, builder):
        Flowable.__init__(self)
        self.b = builder
        self.width = CONTENT_W
        # Frame on interior pages is 650.4pt; keep just under that
        self.height = 648

    def draw(self):
        b = self.b
        c = self.canv
        w = self.width
        h = self.height

        # Navy background covering the entire content area + margins
        c.saveState()
        c.translate(-MARGIN, -MARGIN - 0.4 * inch)
        c.setFillColor(NAVY)
        c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        c.restoreState()

        # "PREMIUM ANALYSIS" badge at top
        badge_y = h - 0.5 * inch
        badge_w = 2.2 * inch
        badge_h = 0.28 * inch
        badge_x = w / 2 - badge_w / 2
        c.setFillColor(ACCENT)
        c.roundRect(badge_x, badge_y, badge_w, badge_h, 4, fill=1, stroke=0)
        c.setFillColor(DARK_TEXT)
        c.setFont(b.F_BODY, 9)
        c.drawCentredString(w / 2, badge_y + 8, "PREMIUM ANALYSIS")

        # Main title
        title_y = h - 1.4 * inch
        c.setFont(b.F_DISPLAY, 28)
        c.setFillColor(WHITE)
        c.drawCentredString(w / 2, title_y, "Multi-Year Tax Strategy Report")

        # Accent rule under title
        c.setStrokeColor(ACCENT)
        c.setLineWidth(2)
        c.line(w * 0.2, title_y - 13, w * 0.8, title_y - 13)

        # Client name
        c.setFont(b.F_DISPLAY, 20)
        c.setFillColor(WHITE)
        c.drawCentredString(w / 2, title_y - 48, b.client.get("name", ""))

        # Tax year
        c.setFont(b.F_BODY, 12)
        c.setFillColor(GRAY)
        c.drawCentredString(w / 2, title_y - 70, f"Tax Year {b.client.get('taxYear', '')}")

        # Subtitle box
        sub_y = title_y - 116
        sub_w = w * 0.85
        sub_x = (w - sub_w) / 2
        c.setFillColor(HexColor("#243566"))
        c.roundRect(sub_x, sub_y - 16, sub_w, 32, 6, fill=1, stroke=0)
        c.setFont(b.F_BODY, 9.5)
        c.setFillColor(HexColor("#c5d8ff"))
        c.drawCentredString(w / 2, sub_y - 4, "Scenario Modeling, Projections & Quarterly Implementation Plan")

        # Savings preview
        sav_y = sub_y - 85
        total_min = b.total_min
        total_max = b.total_max
        c.setFont(b.F_DISPLAY, 30)
        c.setFillColor(ACCENT)
        c.drawCentredString(w / 2, sav_y, fmt_range(total_min, total_max))
        c.setFont(b.F_BODY, 10)
        c.setFillColor(GRAY)
        c.drawCentredString(w / 2, sav_y - 18, "Estimated Year 1 Tax Savings")

        # 5-year cumulative
        five_min = sum(round_to_100(total_min * ((1 + GROWTH_RATE) ** y)) for y in range(5))
        five_max = sum(round_to_100(total_max * ((1 + GROWTH_RATE) ** y)) for y in range(5))
        c.setFont(b.F_BODY, 10)
        c.setFillColor(HexColor("#a8c8ff"))
        c.drawCentredString(w / 2, sav_y - 38,
            f"5-Year Projected Savings: {fmt_range(five_min, five_max)}")

        # Prepared for
        prep_y = sav_y - 105
        c.setFont(b.F_BODY, 9)
        c.setFillColor(GRAY)
        c.drawCentredString(w / 2, prep_y, "Prepared for")
        c.setFont(b.F_DISPLAY, 13)
        c.setFillColor(WHITE)
        c.drawCentredString(w / 2, prep_y - 17, b.client.get("name", ""))
        c.setFont(b.F_BODY, 10)
        c.setFillColor(GRAY)
        prepared_by = b.client.get("preparedBy", "Tiffany Phillips, CPA")
        c.drawCentredString(w / 2, prep_y - 33, f"by {prepared_by}, Phillips Business Group")

        # Logo — use white version on navy background
        logo_path = "/home/user/workspace/pbg_logo_white.png"
        if not os.path.exists(logo_path):
            logo_path = "/home/user/workspace/pbg_logo_horizontal.png"
        if os.path.exists(logo_path):
            logo_w = 2.0 * inch
            logo_h = 0.55 * inch
            c.drawImage(
                logo_path,
                w / 2 - logo_w / 2,
                prep_y - 92,
                width=logo_w, height=logo_h,
                preserveAspectRatio=True, mask="auto"
            )

        # CONFIDENTIAL at bottom
        c.setFont(b.F_BODY, 8)
        c.setFillColor(HexColor("#666688"))
        c.drawCentredString(w / 2, 0.15 * inch, "CONFIDENTIAL — FOR RECIPIENT USE ONLY")


class SummaryCard(Flowable):
    """Executive summary highlight card."""
    def __init__(self, builder, total_min, total_max, five_yr_min, five_yr_max, strategy_count):
        Flowable.__init__(self)
        self.b = builder
        self.total_min = total_min
        self.total_max = total_max
        self.five_yr_min = five_yr_min
        self.five_yr_max = five_yr_max
        self.strategy_count = strategy_count
        self.width = CONTENT_W
        self.height = 1.6 * inch

    def draw(self):
        b = self.b
        c = self.canv
        w = self.width
        h = self.height

        # Card background
        c.setFillColor(NAVY)
        c.roundRect(0, 0, w, h, 8, fill=1, stroke=0)

        # Accent left border
        c.setFillColor(ACCENT)
        c.rect(0, 0, 5, h, fill=1, stroke=0)

        # Three stat blocks
        col_w = w / 3
        stats = [
            ("Year 1 Savings", fmt_range(self.total_min, self.total_max), "(Conservative – Optimistic)"),
            ("5-Year Projection", fmt_range(self.five_yr_min, self.five_yr_max), "(3% annual growth)"),
            (f"{self.strategy_count} Strategies", "Implemented", "Across all entities"),
        ]

        for i, (label, value, sub) in enumerate(stats):
            cx = col_w * i + col_w / 2
            # Divider
            if i > 0:
                c.setStrokeColor(HexColor("#2d3f6b"))
                c.setLineWidth(1)
                c.line(col_w * i, h * 0.2, col_w * i, h * 0.8)
            # Label
            c.setFont(b.F_BODY, 9)
            c.setFillColor(GRAY)
            c.drawCentredString(cx, h * 0.78, label)
            # Value
            c.setFont(b.F_DISPLAY, 14)
            c.setFillColor(ACCENT)
            c.drawCentredString(cx, h * 0.52, value)
            # Sub
            c.setFont(b.F_BODY, 8)
            c.setFillColor(HexColor("#8899bb"))
            c.drawCentredString(cx, h * 0.3, sub)


class QuarterCard(Flowable):
    """A single quarter action card."""
    def __init__(self, builder, quarter, actions, width=None):
        Flowable.__init__(self)
        self.b = builder
        self.quarter = quarter
        self.actions = actions  # list of (bold_label, action_text, deadline_or_None)
        self.width = width or CONTENT_W
        # Estimate height: header ~0.6in + each action ~0.5in
        self.height = 0.65 * inch + max(len(actions), 1) * 0.52 * inch + 0.2 * inch

    def draw(self):
        b = self.b
        c = self.canv
        w = self.width
        h = self.height

        q = self.quarter
        bg_color = QUARTER_COLORS[q]
        text_color = QUARTER_TEXT_COLORS[q]
        header_h = 0.55 * inch

        # Card background
        c.setFillColor(WHITE)
        c.roundRect(0, 0, w, h, 6, fill=1, stroke=0)
        c.setStrokeColor(CARD_BORDER)
        c.setLineWidth(0.5)
        c.roundRect(0, 0, w, h, 6, fill=0, stroke=1)

        # Left color bar (4px)
        c.setFillColor(bg_color)
        c.rect(0, 0, 4, h, fill=1, stroke=0)
        c.roundRect(0, h - header_h, w, header_h, 6, fill=1, stroke=0)
        c.rect(0, h - header_h, 4, header_h, fill=1, stroke=0)  # square left corner

        # Quarter label
        c.setFont(b.F_DISPLAY, 14)
        c.setFillColor(text_color)
        c.drawString(16, h - header_h + 26, QUARTER_NAMES[q])

        # Subtitle
        c.setFont(b.F_BODY, 8)
        c.setFillColor(text_color if q in (3, 4) else HexColor("#c8d8ee"))
        c.drawString(16, h - header_h + 10, QUARTER_SUBTITLES[q])

        # Actions
        if not self.actions:
            c.setFont(b.F_BODY, 9)
            c.setFillColor(LIGHT_TEXT)
            c.drawString(18, h - header_h - 22, "No specific actions required this quarter for selected strategies.")
            return

        y = h - header_h - 14
        for (bold_label, action_text, deadline) in self.actions:
            y -= 0.42 * inch
            if y < 6:
                break
            # Bullet dot
            c.setFillColor(bg_color)
            c.circle(14, y + 4, 3, fill=1, stroke=0)

            # Bold label
            label_x = 24
            c.setFont(b.F_DISPLAY, 9)
            c.setFillColor(DARK_TEXT)
            label_w = c.stringWidth(bold_label + ": ", b.F_DISPLAY, 9)
            c.drawString(label_x, y + 4, bold_label + ":")

            # Deadline tag
            if deadline:
                tag_x = w - 0.85 * inch
                tag_w = 0.75 * inch
                tag_h = 13
                tag_y = y - 1
                # tag background
                dl_bg = HexColor("#fff0c8") if q in (3, 4) else HexColor("#1e3466")
                dl_tc = HexColor("#7a4a00") if q in (3, 4) else WHITE
                c.setFillColor(dl_bg)
                c.roundRect(tag_x, tag_y, tag_w, tag_h, 3, fill=1, stroke=0)
                c.setFont(b.F_BODY, 7)
                c.setFillColor(dl_tc)
                c.drawCentredString(tag_x + tag_w / 2, tag_y + 3, f"Due: {deadline}")

            # Action text (wrapped manually)
            max_text_w = (w - label_x - label_w - 0.95 * inch) if deadline else (w - label_x - label_w - 0.15 * inch)
            c.setFont(b.F_BODY, 8.5)
            c.setFillColor(MID_TEXT)

            # Simple wrapping: draw on same line if fits, else next line
            full_text = action_text
            text_x = label_x + label_w + 2
            avail_w = w - text_x - (0.95 * inch if deadline else 0.15 * inch)
            words = full_text.split()
            lines = []
            cur = ""
            for word in words:
                test = (cur + " " + word).strip()
                if c.stringWidth(test, b.F_BODY, 8.5) <= avail_w:
                    cur = test
                else:
                    if cur:
                        lines.append(cur)
                    cur = word
            if cur:
                lines.append(cur)

            for li, line in enumerate(lines[:3]):
                ly = y + 4 - li * 11
                if li == 0:
                    c.drawString(text_x, ly, line)
                else:
                    c.drawString(label_x + 8, ly, line)


class CumulativeBarChart(Flowable):
    """Pure ReportLab bar chart showing cumulative savings years 1-5."""
    def __init__(self, builder, yearly_min, yearly_max, title="Projected Cumulative Tax Savings (Conservative Estimate)"):
        Flowable.__init__(self)
        self.b = builder
        # Build cumulative sums
        self.cum_min = []
        self.cum_max = []
        run_min = 0
        run_max = 0
        for m, mx in zip(yearly_min, yearly_max):
            run_min += m
            run_max += mx
            self.cum_min.append(run_min)
            self.cum_max.append(run_max)
        self.title = title
        self.width = CONTENT_W
        self.height = 3.2 * inch  # Enough for title + chart + labels

    def draw(self):
        b = self.b
        c = self.canv
        w = self.width
        h = self.height

        # Layout constants — leave room for title at top and labels at bottom
        title_h = 0.28 * inch
        bottom_labels_h = 0.32 * inch
        legend_h = 0.22 * inch
        chart_y = legend_h + bottom_labels_h
        chart_h = h - title_h - chart_y - 0.1 * inch
        chart_x = 0.9 * inch
        chart_w = w - chart_x - 0.3 * inch

        # Title (drawn at top)
        c.setFont(b.F_DISPLAY, 11)
        c.setFillColor(NAVY)
        c.drawString(0, h - title_h + 4, self.title)

        # Background
        c.setFillColor(OFFWHITE)
        c.rect(chart_x, chart_y, chart_w, chart_h, fill=1, stroke=0)

        max_val = max(self.cum_max) if self.cum_max else 1
        # nice round ceiling
        nice_max = math.ceil(max_val / 10000) * 10000

        bar_group_w = chart_w / 5
        bar_w = bar_group_w * 0.55

        years = 5

        for i in range(years):
            bx = chart_x + bar_group_w * i + (bar_group_w - bar_w) / 2

            # Conservative (NAVY) bar
            bh_min = (self.cum_min[i] / nice_max) * chart_h
            c.setFillColor(NAVY)
            c.rect(bx, chart_y, bar_w * 0.48, bh_min, fill=1, stroke=0)

            # Optimistic (ACCENT) bar
            bh_max = (self.cum_max[i] / nice_max) * chart_h
            c.setFillColor(ACCENT)
            c.rect(bx + bar_w * 0.52, chart_y, bar_w * 0.48, bh_max, fill=1, stroke=0)

            # Year label below chart
            c.setFont(b.F_BODY, 8)
            c.setFillColor(MID_TEXT)
            c.drawCentredString(bx + bar_w / 2, chart_y - 14, f"Year {i+1}")

            # Value label on top of taller bar (capped so it doesn't go above chart area)
            taller_h = max(bh_min, bh_max)
            val_to_show = self.cum_max[i]
            label_y = chart_y + taller_h + 3
            # Only draw if there's vertical room (don't clip into title)
            if label_y < h - title_h - 4:
                c.setFont(b.F_BODY, 7)
                c.setFillColor(DARK_TEXT)
                c.drawCentredString(bx + bar_w / 2, label_y, fmt_dollars(val_to_show))

        # Y-axis gridlines and labels
        grid_steps = 4
        for gi in range(grid_steps + 1):
            gy = chart_y + (gi / grid_steps) * chart_h
            gv = int(nice_max * gi / grid_steps)
            c.setStrokeColor(CARD_BORDER)
            c.setLineWidth(0.5)
            c.line(chart_x, gy, chart_x + chart_w, gy)
            c.setFont(b.F_BODY, 7)
            c.setFillColor(LIGHT_TEXT)
            if gv >= 1000000:
                label = f"${gv/1000000:.1f}M"
            elif gv >= 1000:
                label = f"${gv//1000}K"
            else:
                label = fmt_dollars(gv)
            c.drawRightString(chart_x - 3, gy - 3, label)

        # Legend
        leg_x = chart_x
        leg_y = 0.05 * inch
        c.setFillColor(NAVY)
        c.rect(leg_x, leg_y, 10, 8, fill=1, stroke=0)
        c.setFont(b.F_BODY, 7)
        c.setFillColor(MID_TEXT)
        c.drawString(leg_x + 13, leg_y + 1, "Conservative")
        c.setFillColor(ACCENT)
        c.rect(leg_x + 90, leg_y, 10, 8, fill=1, stroke=0)
        c.drawString(leg_x + 103, leg_y + 1, "Optimistic")


# ─────────────────────────────────────────────
# PREMIUM PDF BUILDER
# ─────────────────────────────────────────────
class PremiumRoadmapPDF:
    def __init__(self, payload, output_path, fonts):
        self.payload      = payload
        self.output_path  = output_path
        self.fonts        = fonts
        self.client       = payload["client"]
        self.entities     = payload["entities"]
        self.all_selections = payload.get("allSelections", {})

        # Normalize entity IDs and allSelections keys
        for i, ent in enumerate(self.entities, start=1):
            if "id" not in ent:
                ent["id"] = i
        self.all_selections = {int(k): v for k, v in self.all_selections.items()}

        self.F_DISPLAY    = fonts.get("display", "Times-Roman")
        self.F_DISPLAY_IT = fonts.get("display_italic", "Times-Italic")
        self.F_BODY       = fonts.get("body", "Helvetica")

        # Compute totals
        self.total_min = 0
        self.total_max = 0
        self.strategy_count = 0
        for ent in self.entities:
            for sel in self.all_selections.get(ent["id"], []):
                if sel.get("status") in ("suggested", "manual_add"):
                    self.total_min += sel.get("savingsMin") or 0
                    self.total_max += sel.get("savingsMax") or 0
                    self.strategy_count += 1

    # ─── STYLES ───────────────────────────────────
    def _style(self, kind, size=11, leading=None, color=None, left_indent=0,
               alignment=TA_LEFT, space_before=0, space_after=0):
        if leading is None:
            leading = size * 1.4
        if color is None:
            color = DARK_TEXT
        font = self.F_BODY if kind == "body" else self.F_DISPLAY
        return ParagraphStyle(
            f"prm_{kind}_{size}_{id(color)}_{id(self)}",
            fontName=font,
            fontSize=size,
            leading=leading,
            textColor=color,
            leftIndent=left_indent,
            alignment=alignment,
            spaceBefore=space_before,
            spaceAfter=space_after,
        )

    # ─── PAGE FOOTER ──────────────────────────────
    def _page_footer(self, canvas_obj, doc):
        canvas_obj.saveState()
        canvas_obj.setFont(self.F_BODY, 8)
        canvas_obj.setFillColor(GRAY)
        y = 0.4 * inch
        canvas_obj.drawString(MARGIN, y, "Phillips Business Group | Premium Tax Strategy Report")
        canvas_obj.drawRightString(PAGE_W - MARGIN, y, f"Confidential — {self.client['name']}")
        canvas_obj.setStrokeColor(ACCENT)
        canvas_obj.setLineWidth(1)
        canvas_obj.line(MARGIN, 0.6 * inch, PAGE_W - MARGIN, 0.6 * inch)
        canvas_obj.restoreState()

    # ─── BUILD ────────────────────────────────────
    def build(self):
        doc = SimpleDocTemplate(
            self.output_path,
            pagesize=letter,
            leftMargin=MARGIN,
            rightMargin=MARGIN,
            topMargin=MARGIN,
            bottomMargin=MARGIN + 0.3 * inch,
            title=f"Premium Tax Strategy Report — {self.client['name']}",
            author="Perplexity Computer",
        )

        story = []
        story += self._build_cover()
        story += self._build_projections()
        story += self._build_quarterly_plan()
        story += self._build_disclosures()

        doc.build(story, onFirstPage=self._page_footer, onLaterPages=self._page_footer)

    # ─── SECTION 1: COVER ─────────────────────────
    def _build_cover(self):
        return [CoverPage(self), PageBreak()]

    # ─── SECTION 2: PROJECTIONS ───────────────────
    def _build_projections(self):
        story = []

        # Section header
        story += self._section_header("Section 1: Multi-Year Tax Projections")
        story.append(Spacer(1, 0.15 * inch))

        # Check if any strategies exist
        if self.strategy_count == 0:
            story.append(Paragraph(
                "No strategies selected — please complete the roadmap first.",
                self._style("body", 12, color=MID_TEXT)
            ))
            story.append(PageBreak())
            return story

        # 2a. Executive summary card
        five_yr_min = sum(round_to_100(self.total_min * ((1 + GROWTH_RATE) ** y)) for y in range(5))
        five_yr_max = sum(round_to_100(self.total_max * ((1 + GROWTH_RATE) ** y)) for y in range(5))

        story.append(SummaryCard(
            self, self.total_min, self.total_max,
            five_yr_min, five_yr_max, self.strategy_count
        ))
        story.append(Spacer(1, 0.2 * inch))

        # Intro paragraph
        story.append(Paragraph(
            "The table below shows projected tax savings for each recommended strategy over a 5-year horizon, "
            "assuming 3% annual income growth. Conservative figures represent the minimum savings estimate; "
            "Optimistic figures represent the maximum. The 5-Year Total column sums all projected savings.",
            self._style("body", 9.5, color=MID_TEXT, leading=14)
        ))
        story.append(Spacer(1, 0.15 * inch))

        # 2b. Per-strategy projection table
        story += self._build_projection_table()
        story.append(Spacer(1, 0.25 * inch))

        # 2c. Cumulative bar chart
        story += self._build_bar_chart()

        story.append(PageBreak())
        return story

    def _build_projection_table(self):
        story = []

        # Collect all suggested strategies across entities
        rows_data = []
        total_min_by_year = [0] * 5
        total_max_by_year = [0] * 5

        for ent in self.entities:
            ent_id = ent["id"]
            ent_name = ent.get("name", f"Entity {ent_id}")
            selections = self.all_selections.get(ent_id, [])
            for sel in selections:
                if sel.get("status") not in ("suggested", "manual_add"):
                    continue
                s_id = sel.get("strategyId", "")
                s_name = get_strategy(s_id)["name"]
                s_min = sel.get("savingsMin") or 0
                s_max = sel.get("savingsMax") or 0
                years = project_savings(s_min, s_max, 5)
                five_total_min = sum(y[0] for y in years)
                five_total_max = sum(y[1] for y in years)
                for yi, (ym, ymx) in enumerate(years):
                    total_min_by_year[yi] += ym
                    total_max_by_year[yi] += ymx
                rows_data.append((s_name, ent_name, years, five_total_min, five_total_max))

        if not rows_data:
            return []

        # Header row
        header = ["Strategy", "Entity", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5", "5-Yr Total"]
        col_widths = [
            CONTENT_W * 0.22,   # Strategy
            CONTENT_W * 0.13,   # Entity
            CONTENT_W * 0.10,   # Year 1
            CONTENT_W * 0.10,   # Year 2
            CONTENT_W * 0.10,   # Year 3
            CONTENT_W * 0.10,   # Year 4
            CONTENT_W * 0.10,   # Year 5
            CONTENT_W * 0.15,   # 5-Yr Total
        ]

        F_BODY = self.F_BODY
        F_DISP = self.F_DISPLAY

        h_style = ParagraphStyle("tbl_hdr", fontName=F_BODY, fontSize=8, textColor=WHITE,
                                  leading=10, alignment=TA_CENTER)
        c_style = ParagraphStyle("tbl_cell", fontName=F_BODY, fontSize=7.5, textColor=DARK_TEXT,
                                  leading=10, alignment=TA_CENTER)
        l_style = ParagraphStyle("tbl_left", fontName=F_BODY, fontSize=7.5, textColor=DARK_TEXT,
                                  leading=10, alignment=TA_LEFT)
        s_style = ParagraphStyle("tbl_sub", fontName=F_BODY, fontSize=8, textColor=WHITE,
                                  leading=10, alignment=TA_CENTER, fontWeight="bold")

        table_data = [[Paragraph(h, h_style) for h in header]]

        for idx, (s_name, ent_name, years, five_min, five_max) in enumerate(rows_data):
            row = [
                Paragraph(s_name, l_style),
                Paragraph(ent_name, c_style),
            ]
            for (ym, ymx) in years:
                row.append(Paragraph(fmt_range(ym, ymx), c_style))
            row.append(Paragraph(fmt_range(five_min, five_max), c_style))
            table_data.append(row)

        # Subtotal row
        sub_total_min = sum(total_min_by_year)
        sub_total_max = sum(total_max_by_year)
        sub_row = [
            Paragraph("TOTAL (All Strategies)", ParagraphStyle("sub", fontName=F_DISP, fontSize=8,
                       textColor=WHITE, leading=10, alignment=TA_LEFT)),
            Paragraph("", s_style),
        ]
        for yi in range(5):
            sub_row.append(Paragraph(fmt_range(total_min_by_year[yi], total_max_by_year[yi]),
                                     ParagraphStyle("subv", fontName=F_BODY, fontSize=7.5,
                                                    textColor=WHITE, leading=10, alignment=TA_CENTER)))
        sub_row.append(Paragraph(fmt_range(sub_total_min, sub_total_max),
                                 ParagraphStyle("subtot", fontName=F_DISP, fontSize=8,
                                                textColor=ACCENT, leading=10, alignment=TA_CENTER)))
        table_data.append(sub_row)

        # Build table style
        num_rows = len(table_data)
        last_data_row = num_rows - 2  # index of last data row (before subtotal)

        ts = TableStyle([
            # Header
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ("FONTNAME", (0, 0), (-1, 0), F_BODY),
            ("FONTSIZE", (0, 0), (-1, 0), 8),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ROWBACKGROUNDS", (0, 1), (-1, last_data_row), [WHITE, OFFWHITE]),
            # Subtotal row
            ("BACKGROUND", (0, -1), (-1, -1), NAVY),
            ("FONTNAME", (0, -1), (-1, -1), F_DISP),
            # Padding
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            # Grid
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, ACCENT),
            ("LINEBELOW", (0, 1), (-1, last_data_row), 0.3, CARD_BORDER),
            # Left border accent on strategy name column
            ("LINEBEFORE", (0, 1), (0, last_data_row), 3, ACCENT),
        ])

        t = Table(table_data, colWidths=col_widths, repeatRows=1)
        t.setStyle(ts)
        story.append(t)
        return story

    def _build_bar_chart(self):
        story = []

        # Compute per-year totals
        yearly_min = [0] * 5
        yearly_max = [0] * 5
        for ent in self.entities:
            eid = ent["id"]
            for sel in self.all_selections.get(eid, []):
                if sel.get("status") not in ("suggested", "manual_add"):
                    continue
                s_min = sel.get("savingsMin") or 0
                s_max = sel.get("savingsMax") or 0
                years = project_savings(s_min, s_max, 5)
                for yi, (ym, ymx) in enumerate(years):
                    yearly_min[yi] += ym
                    yearly_max[yi] += ymx

        if sum(yearly_max) == 0:
            return []

        story.append(CumulativeBarChart(self, yearly_min, yearly_max))
        story.append(Spacer(1, 0.1 * inch))
        story.append(Paragraph(
            "Conservative = lower bound of savings range | Optimistic = upper bound. "
            "Bars show cumulative (compounding) savings through each year.",
            self._style("body", 8, color=LIGHT_TEXT, leading=11)
        ))
        return story

    # ─── SECTION 3: QUARTERLY PLAN ────────────────
    def _build_quarterly_plan(self):
        story = []
        story += self._section_header("Section 2: Quarterly Action Plan")
        story.append(Spacer(1, 0.1 * inch))
        story.append(Paragraph(
            "The following action items are tailored to the strategies selected in your roadmap. "
            "Completing each action on schedule maximizes your savings and protects you in the event of an audit.",
            self._style("body", 9.5, color=MID_TEXT, leading=14)
        ))
        story.append(Spacer(1, 0.15 * inch))

        # Gather which strategy IDs are active
        active_strategy_ids = set()
        for ent in self.entities:
            eid = ent["id"]
            for sel in self.all_selections.get(eid, []):
                if sel.get("status") in ("suggested", "manual_add"):
                    active_strategy_ids.add(sel.get("strategyId", ""))

        if not active_strategy_ids:
            story.append(Paragraph(
                "No strategies selected — please complete the roadmap first.",
                self._style("body", 12, color=MID_TEXT)
            ))
            story.append(PageBreak())
            return story

        # Build per-quarter action lists
        quarter_actions = {1: [], 2: [], 3: [], 4: []}
        for strat_id in active_strategy_ids:
            actions = QUARTERLY_ACTIONS.get(strat_id, [])
            for (q, bold_label, action_text, deadline) in actions:
                quarter_actions[q].append((bold_label, action_text, deadline))

        # Also add universal actions that always apply
        universal_q1 = [
            ("Prior-Year Records", "Gather tax documents, prior-year returns, and entity financials for tax preparation.", "Apr 15"),
        ]
        universal_q2 = [
            ("Estimated Taxes (Q1)", "Make Q1 estimated tax payment if applicable to avoid underpayment penalties.", "Apr 15"),
        ]
        universal_q3 = [
            ("Mid-Year Review", "Schedule mid-year tax planning review with your PBG advisor — are you on track with all strategies?", None),
            ("Estimated Taxes (Q2)", "Make Q2 estimated tax payment.", "Jun 15"),
        ]
        universal_q4 = [
            ("Year-End Tax Planning", "Schedule year-end tax planning call with your PBG advisor — Q4 is the critical window for implementation.", None),
            ("Estimated Taxes (Q3)", "Make Q3 estimated tax payment.", "Sep 15"),
            ("Next Year Prep", "Update W-4 withholding, review entity structure, and schedule next year's Annual Roadmap Review.", "Dec 31"),
        ]
        quarter_actions[1] = universal_q1 + quarter_actions[1]
        quarter_actions[2] = universal_q2 + quarter_actions[2]
        quarter_actions[3] = universal_q3 + quarter_actions[3]
        quarter_actions[4] = universal_q4 + quarter_actions[4]

        # Render cards
        for q in [1, 2, 3, 4]:
            actions = quarter_actions[q]
            card = QuarterCard(self, q, actions)
            story.append(KeepTogether([card]))
            story.append(Spacer(1, 0.18 * inch))

        story.append(PageBreak())
        return story

    # ─── SECTION 4: DISCLOSURES ───────────────────
    def _build_disclosures(self):
        story = []
        story += self._section_header("Premium Analysis — Important Disclosures")
        story.append(Spacer(1, 0.15 * inch))

        for para in IMPORTANT_INFO_TEXT.split("\n\n"):
            if para.startswith("IMPORTANT INFORMATION"):
                story.append(Paragraph(
                    para,
                    self._style("display", 13, color=NAVY, leading=18)
                ))
            else:
                story.append(Paragraph(
                    para,
                    self._style("body", 9.5, color=MID_TEXT, leading=14)
                ))
            story.append(Spacer(1, 0.1 * inch))

        # Contact footer
        story.append(Spacer(1, 0.2 * inch))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=ACCENT, spaceAfter=8))
        contact_text = (
            "Phillips Business Group | Tiffany Phillips, CPA\n"
            "Phone: 713-955-2900 | Email: tiffany@phillipsbusinessgroup.com | "
            "Website: phillipsbusinessgroup.com"
        )
        for line in contact_text.split("\n"):
            story.append(Paragraph(line, self._style("body", 9, color=SLATE, alignment=TA_CENTER)))
        return story

    # ─── HELPER: Section header ───────────────────
    def _section_header(self, title):
        """Returns a list of flowables forming a section header."""
        class SectionHdr(Flowable):
            def __init__(hdr_self, t, builder):
                Flowable.__init__(hdr_self)
                hdr_self.title = t
                hdr_self.b = builder
                hdr_self.width = CONTENT_W
                hdr_self.height = 0.42 * inch

            def draw(hdr_self):
                c = hdr_self.canv
                b = hdr_self.b
                w = hdr_self.width
                h = hdr_self.height
                # Navy bg
                c.setFillColor(NAVY)
                c.roundRect(0, 0, w, h, 5, fill=1, stroke=0)
                # Accent left bar
                c.setFillColor(ACCENT)
                c.rect(0, 0, 5, h, fill=1, stroke=0)
                # Title
                c.setFont(b.F_DISPLAY, 13)
                c.setFillColor(WHITE)
                c.drawString(16, h * 0.3, hdr_self.title)

        return [SectionHdr(title, self)]


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    if len(sys.argv) < 3:
        print("Usage: python3 generate_premium_pdf.py <payload_json_path> <output_pdf_path>",
              file=sys.stderr)
        sys.exit(1)

    payload_path = sys.argv[1]
    output_path  = sys.argv[2]

    with open(payload_path, "r") as f:
        payload = json.load(f)

    # Quiz mode conversion
    if payload.get("mode") == "quiz":
        payload = quiz_to_payload(payload["quiz"])

    print("Registering fonts...", file=sys.stderr)
    fonts = register_fonts()
    print(f"  Display: {fonts.get('display')}, Body: {fonts.get('body')}", file=sys.stderr)

    print("Building premium PDF...", file=sys.stderr)
    builder = PremiumRoadmapPDF(payload, output_path, fonts)
    builder.build()

    print(f"Premium PDF written to: {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
