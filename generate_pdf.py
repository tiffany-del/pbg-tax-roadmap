#!/usr/bin/env python3
"""
PBG Tax Savings Roadmap PDF Generator
Usage: python3 generate_pdf.py <payload_json_path> <output_pdf_path>

Generates a Tax Return Analysis PDF matching the Phillips Business Group roadmap format.
"""

import sys
import json
import os
import urllib.request
import tempfile
from datetime import datetime

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, HRFlowable, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus.flowables import Flowable

# ─────────────────────────────────────────────
# BRAND COLORS
# ─────────────────────────────────────────────
NAVY      = HexColor("#1b2951")
BLUSH     = HexColor("#f7cac9")
OFFWHITE  = HexColor("#f5f5f0")
SLATE     = HexColor("#5d737e")
GRAY      = HexColor("#b8b5b2")
ACCENT    = HexColor("#b5cc42")   # yellow-green rule from roadmaps
DARK_TEXT = HexColor("#1a1a1a")
MID_TEXT  = HexColor("#4a4a4a")
LIGHT_TEXT= HexColor("#888888")
WHITE     = white
PLUS_COLOR = HexColor("#2d7d46")   # green for suggested
X_COLOR    = HexColor("#b0b0b0")   # gray for excluded
CARD_BORDER= HexColor("#e5e5e5")

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
    pf_path = os.path.join(FONT_DIR, "PlayfairDisplay.ttf")
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
# STRATEGY LOOKUP (mirrors strategies.ts)
# ─────────────────────────────────────────────
STRATEGY_DATA = {
    "augusta_rule": {"name": "Augusta Rule", "short": "Rent your home for up to 14 days annually, tax-free.", "long": "The IRS allows a business owner to rent their primary residence or vacation home to their business for up to 14 non-consecutive days each year. Income is excluded from taxable income under IRC Section 280A.", "irs": "PLR 8104117, IRC Section 280A, IRC Section 274(a)(1)(B), IRC Section 162, Rev. Rul. 76-287"},
    "itemized_deductions": {"name": "Itemized Deductions", "short": "Deduct eligible expenses like mortgage interest and charitable donations to reduce taxable income.", "long": "Itemizing deductions is advantageous when total eligible expenses (mortgage interest, state/local taxes capped at $10K, medical expenses over 7.5% of AGI, charitable donations) exceed the standard deduction. Most beneficial for homeowners in high-tax states with significant medical or charitable expenses.", "irs": "IRC 63, IRC 67, IRC 68, IRC 164, IRC 163, IRC 170, IRC 213, Rev. Proc. 2023-34"},
    "oil_and_gas": {"name": "Oil and Gas", "short": "Tax benefits and energy market exposure through oil and gas investments.", "long": "Oil and gas investments offer significant tax advantages including intangible drilling cost deductions (often 70-80% of investment in year one), depletion allowances, and passive income offset opportunities. Best for high-income taxpayers seeking to reduce ordinary income.", "irs": "26 U.S.C. 43, 26 U.S.C. 613/613A, 26 U.S.C. 263(c), 26 U.S.C. 199A, IRS Publication 535"},
    "qcds": {"name": "Qualified Charitable Distributions", "short": "Transfer funds directly from your IRA to charity tax-free, satisfying required minimum distributions.", "long": "Taxpayers age 70½ or older can transfer up to $100,000 per year directly from an IRA to a qualified charity, reducing taxable income and satisfying RMD requirements. Particularly valuable when charitable deductions would otherwise be limited.", "irs": "IRC Section 408(d)(8), IRC Section 170(b)(1)(A), IRS Notice 2007-7, Pension Protection Act of 2006, SECURE Act and SECURE 2.0"},
    "sell_your_home": {"name": "Sell Your Home", "short": "Exclude major portion of home sale profits from taxes, if eligibility criteria are met.", "long": "Homeowners who have lived in their primary residence for at least 2 of the past 5 years can exclude up to $250,000 ($500,000 MFJ) of capital gains from sale. This exclusion resets every 2 years and is one of the most powerful tax-free wealth-building strategies available.", "irs": "26 U.S.C. 121, Taxpayer Relief Act of 1997, 26 C.F.R. 1.121-1, IRS Publication 523, IRS Topic no. 701"},
    "tax_loss_harvesting": {"name": "Tax Loss Harvesting", "short": "Sell losing investments to offset gains and reduce capital gains taxes owed.", "long": "Strategically selling securities at a loss to offset capital gains and up to $3,000 of ordinary income per year. Losses in excess of $3,000 carry forward to future years. Most effective for investors with significant unrealized losses and capital gains in the same tax year.", "irs": "IRC Sections 1211, 1212, 1091, 1222, 165, IRS Publications 550 and 544, Form 8949, Schedule D"},
    "traditional_401k_individual": {"name": "Traditional 401k", "short": "A retirement account where you skip taxes now and pay them when you withdraw in retirement.", "long": "Pre-tax contributions to a traditional 401(k) reduce taxable income dollar-for-dollar, up to $23,000 (2024) plus $7,500 catch-up if age 50+. Particularly valuable for taxpayers in higher tax brackets who expect to be in a lower bracket in retirement.", "irs": "26 U.S.C. 401(a), 26 U.S.C. 402(g), 26 U.S.C. 219, IRS Publication 560, SECURE 2.0 Act"},
    "roth_401k_individual": {"name": "Roth 401k (Individual)", "short": "A retirement account where you pay taxes now so you can withdraw tax-free in retirement.", "long": "After-tax Roth 401(k) contributions grow tax-free and qualified withdrawals are tax-free. Best for taxpayers who expect higher tax rates in retirement or want tax diversification. Can be combined with traditional 401(k) contributions up to the annual limit.", "irs": "26 U.S.C. 402A, IRS Notice 2024-02, SECURE 2.0 Act 604, IRS Publication 590-B"},
    "child_tax_credit": {"name": "Child Tax Credit", "short": "Tax savings through the Child Tax Credit, subject to IRS rules.", "long": "Provides up to $2,000 per qualifying child under age 17. Subject to phase-out above $400,000 AGI (MFJ). Partially refundable (up to $1,600). Should be reviewed annually for eligibility and optimization opportunities.", "irs": "IRC 24, IRC 152, IRC 32, Schedule 8812, Pub. L. No. 115-97 (TCJA), IRS Publication 972"},
    "child_roth_ira": {"name": "Child Roth IRA", "short": "A custodial retirement account allowing minors with earned income to make after-tax contributions that grow tax-free.", "long": "Children with earned income can contribute to a Roth IRA (up to the lesser of earned income or the annual limit). Tax-free compound growth over decades makes this one of the most powerful long-term wealth-building strategies for families.", "irs": "IRC Section 408A, IRC Section 219, IRS Retirement Plans FAQs Regarding IRAs, IRS Publication 590-A"},
    "qsbs": {"name": "QSBS: Small Business Stock Sales", "short": "Hold small business stock for 5+ years to avoid paying taxes on up to $10 million in profits when you sell.", "long": "Section 1202 allows taxpayers to exclude 100% of capital gains (up to $10M or 10x cost basis) from the sale of Qualified Small Business Stock held for more than 5 years. The stock must be in a domestic C corporation with gross assets under $50M at time of issuance.", "irs": "IRC Section 1202, IRC Section 1045, IRC Section 1244, IRS Publication 550, Revenue Ruling 2018-27"},
    "health_savings_account": {"name": "Health Savings Account (HSA)", "short": "Save pre-tax money for qualified medical expenses, reducing your out-of-pocket healthcare costs.", "long": "Triple tax advantage: contributions are pre-tax, growth is tax-free, and qualified medical expense withdrawals are tax-free. Must be enrolled in a High Deductible Health Plan. 2024 contribution limits: $4,150 single / $8,300 family, plus $1,000 catch-up if 55+.", "irs": "26 U.S.C. 223, 26 C.F.R. 1.223-1 to 1.223-3, IRS Form 8889, IRS Publication 969"},
    "accountable_plan": {"name": "Accountable Plan", "short": "Allows business owners to reimburse employee expenses tax-free while reducing payroll and income taxes.", "long": "A formal written reimbursement policy that allows the business to reimburse owners/employees for business expenses (home office, vehicle, phone, etc.) tax-free. Reduces both payroll taxes and income taxes. Especially valuable for S-Corp owner-employees.", "irs": "IRC 62(c), IRC 162(a), IRC 274(d), IRC 3121(a)(2)(A), Treas. Reg. 1.62-2, IRS Publication 463"},
    "home_office": {"name": "Home Office", "short": "Tax deductions for dedicated business space in your home.", "long": "Business owners using a dedicated area of their home exclusively and regularly for business can deduct a proportional share of home expenses. S-Corp owners should use an accountable plan to reimburse home office expenses from the business.", "irs": "26 U.S.C. 280A, IRS Form 8829, IRS Publication 587, Revenue Procedure 2013-13"},
    "meals": {"name": "Meals", "short": "50% tax deduction on business-related meals, with some 100% exceptions.", "long": "Business meals with clients, employees, or business associates are 50% deductible. Employer-provided meals on business premises for business convenience may be 100% deductible. Proper documentation (business purpose, attendees, amount) is required.", "irs": "26 U.S.C. 274, 26 U.S.C. 162(a), 26 U.S.C. 274(k), Notice 2018-76, IRS Publication 463"},
    "travel": {"name": "Travel", "short": "Tax deductions for necessary business travel expenses.", "long": "Ordinary and necessary business travel expenses away from home (airfare, hotel, 50% of meals, transportation) are fully deductible. Travel must have a primary business purpose. Mixed business/personal trips require allocation. Documentation is critical.", "irs": "26 U.S.C. 162(a), 26 U.S.C. 274(d), 26 C.F.R. 1.162-2, IRS Publication 463, Revenue Procedure 2019-48"},
    "vehicle": {"name": "Vehicle", "short": "Tax deductions for business use of personal or company vehicles.", "long": "Business vehicle expenses can be deducted using actual expenses (depreciation, fuel, insurance, repairs) or standard mileage rate (67¢/mile for 2024). SUVs and trucks over 6,000 lbs GVW may qualify for accelerated Section 179 expensing.", "irs": "26 U.S.C. 179, 26 U.S.C. 280F, 26 U.S.C. 162(a), 26 U.S.C. 274(d), IRS Form 4562, IRS Publication 463"},
    "hiring_kids": {"name": "Hiring Your Children", "short": "Tax savings through hiring children in family businesses, subject to IRS rules.", "long": "Children under 18 employed by a parent's sole proprietorship or partnership are exempt from FICA taxes. Wages paid are deductible by the business and shift income to the child's lower tax bracket. Wages must be reasonable for actual work performed.", "irs": "26 U.S.C. 3121(b)(3)(A), 26 U.S.C. 3306(c)(5), IRC Section 152(c), IRS Publication 929"},
    "traditional_401k_business": {"name": "Traditional 401k (Business)", "short": "A tax-advantaged retirement savings plan for business owners and employees.", "long": "Employer contributions to a 401(k) plan are deductible business expenses. Combined employee/employer contributions up to $69,000 (2024). Profit-sharing component allows flexible annual contributions. Ideal for businesses with stable profits seeking to maximize retirement savings.", "irs": "26 U.S.C. 401(a), 26 U.S.C. 404(a)(3), 26 U.S.C. 415(c), IRS Publication 560, SECURE 2.0 Act"},
    "roth_401k_business": {"name": "Roth 401k (Business)", "short": "A retirement savings plan for business owners and employees — pay taxes now, withdraw tax-free in retirement.", "long": "Designated Roth accounts within a 401(k) plan allow after-tax contributions that grow tax-free. Employer can make matching contributions to the Roth 401(k) beginning in 2024 (SECURE 2.0). Valuable for employees expecting higher future tax rates.", "irs": "26 U.S.C. 402A, SECURE 2.0 Act Section 604, IRS Notice 2024-02, IRS Publication 575"},
    "late_s_election": {"name": "Late S Corporation Election", "short": "Switch your company to S-Corp taxation to potentially reduce payroll taxes and pass-through income.", "long": "Partnerships and LLCs taxed as partnerships can elect S-Corp status, potentially reducing self-employment taxes on business income. The IRS allows late S-Corp elections under Rev. Proc. 2013-30 with reasonable cause. Most effective when net profit exceeds $50,000.", "irs": "26 U.S.C. 1361, 26 U.S.C. 1362, Rev. Proc. 2013-30, IRS Form 2553, Treas. Reg. 1.1362-6"},
    "late_c_election": {"name": "Late C Corporation Election", "short": "Switch your company to C-Corp taxation for potential access to a flat 21% corporate tax rate.", "long": "Some businesses benefit from C-Corp taxation, particularly those retaining earnings for reinvestment, providing employee benefits, or structuring equity for QSBS purposes. The flat 21% corporate rate may be advantageous for high-income owners in the right circumstances.", "irs": "26 U.S.C. 11, 26 U.S.C. 1363, 26 U.S.C. 1374, 26 U.S.C. 1375, IRS Publication 542, Rev. Proc. 2004-49"},
    "employee_achievement_award": {"name": "Employee Achievement Award", "short": "Tax-free awards for employees based on length of service or safety achievements.", "long": "Employers can deduct up to $400 per employee ($1,600 for qualified plan awards) for tangible personal property awarded for length of service or safety achievements. The award is tax-free to the employee if it meets specific IRS requirements.", "irs": "26 U.S.C. 74(c), 26 U.S.C. 274(j), IRS Publication 535, IRS Publication 15-B, Treas. Reg. 1.274-8"},
    "health_reimbursement": {"name": "Health Reimbursement Arrangement (HRA)", "short": "Employer-funded account for employee medical expense reimbursements.", "long": "HRAs allow employers to reimburse employees tax-free for qualified medical expenses and health insurance premiums. Three types: QSEHRA (small employers), ICHRA (any employer), and integrated HRA. Reduces employer payroll taxes and provides tax-free health benefits to employees.", "irs": "26 U.S.C. 105, 26 U.S.C. 106, IRS Notice 2017-67, IRS Notice 2019-45, Rev. Proc. 2021-45, IRS Publication 15-B"},
    "qualified_edu_assistance": {"name": "Qualified Educational Assistance Program", "short": "Employers can provide up to $5,250 per year in tax-free educational assistance to employees.", "long": "Under Section 127, employers can deduct and employees can exclude up to $5,250 per year in educational assistance. This includes tuition, fees, books, and supplies for any course (not just job-related). The benefit extends to student loan repayments through 2025 under the CARES Act.", "irs": "26 U.S.C. 127, 26 U.S.C. 132(d), CARES Act Section 2206, IRS Publication 15-B, Treas. Reg. 1.127-2"},
    "work_opportunity_credit": {"name": "Work Opportunity Tax Credit (WOTC)", "short": "Federal tax credit for hiring employees from target groups with barriers to employment.", "long": "Federal tax credit equal to 25-40% of first-year wages paid to employees from 10 targeted groups including veterans, ex-felons, long-term unemployment recipients, and Supplemental Security Income recipients. Credit ranges from $1,200 to $9,600 per qualifying employee.", "irs": "26 U.S.C. 51, 26 U.S.C. 52, 26 U.S.C. 3111(e), IRS Form 5884, IRS Publication 954"},
    "maximize_depreciation": {"name": "Maximize Depreciation (Section 179 / Bonus)", "short": "Immediately deduct the full cost of qualifying business assets rather than depreciating them over many years.", "long": "Section 179 allows up to $1,220,000 (2024) of qualifying property to be expensed in year of purchase. 60% bonus depreciation applies to qualifying new and used property in 2024. Phasing down 20% per year through 2026. Ideal for businesses making significant capital investments.", "irs": "26 U.S.C. 179, 26 U.S.C. 168(k), Rev. Proc. 2023-34, IRS Form 4562, IRS Publication 946"},
    "cost_segregation": {"name": "Cost Segregation", "short": "Accelerate depreciation deductions by reclassifying building components into shorter depreciable lives.", "long": "A cost segregation study reclassifies components of commercial or residential real property into 5, 7, or 15-year property (vs. standard 27.5 or 39 years), dramatically accelerating depreciation deductions. Most beneficial for properties valued over $1 million.", "irs": "26 U.S.C. 168, Asset Class 00.3, Rev. Proc. 87-56, IRS Cost Segregation Audit Techniques Guide"},
    "captive_insurance": {"name": "Captive Insurance", "short": "Create an insurance company owned by your business to capture insurance premiums and invest profits.", "long": "A captive insurance company allows business owners to insure their own risks, converting non-deductible risk retention into deductible insurance premiums. The captive accumulates reserves and investment income, potentially providing additional tax-efficient wealth accumulation.", "irs": "26 U.S.C. 831(b), IRS Notice 2016-66, IRS Notice 2023-10, Rev. Rul. 2005-40"},
    "section_199a": {"name": "Section 199A (QBI Deduction)", "short": "Deduct up to 20% of qualified business income from pass-through entities.", "long": "Pass-through business owners may deduct up to 20% of qualified business income (QBI) from their taxable income. Subject to income limits and W-2 wage/property limitations for specified service trades above $383,900 (MFJ, 2024). One of the most valuable deductions for pass-through business owners.", "irs": "26 U.S.C. 199A, Treas. Reg. 1.199A-1 to 1.199A-6, IRS Form 8995/8995-A, Rev. Proc. 2019-38"},
    "profit_sharing": {"name": "Profit Sharing Plan", "short": "Contribute a variable amount of business profits to employee retirement accounts each year.", "long": "A profit-sharing plan allows employers to make discretionary contributions to employee retirement accounts (up to 25% of compensation, max $69,000 in 2024). Contributions are deductible business expenses. Flexible contribution amounts make this ideal for businesses with variable profits.", "irs": "26 U.S.C. 401(a)(3), 26 U.S.C. 404(a)(3), 26 U.S.C. 415, IRS Publication 560, Treas. Reg. 1.401-1(b)(1)(ii)"},
    "cash_balance_plan": {"name": "Cash Balance / Defined Benefit Plan", "short": "A hybrid retirement plan that combines features of traditional pension and 401(k) plans.", "long": "Cash balance plans allow much larger tax-deductible contributions than 401(k) plans — potentially $250,000+ per year for older high earners. Contributions are actuarially determined based on age and targeted retirement benefit. Most effective for business owners over 50 with stable high income.", "irs": "26 U.S.C. 401(a), 26 U.S.C. 412, 26 U.S.C. 415(b), PBGC rules, IRS Publication 560, Treas. Reg. 1.401(a)(4)-8"},
    "deferred_compensation": {"name": "Deferred Compensation", "short": "Defer a portion of executive compensation to a future tax year through a formal agreement.", "long": "Non-qualified deferred compensation (NQDC) plans allow highly compensated employees to defer income to a future tax year. Must be established before the compensation is earned and meet strict IRC 409A requirements. Effective for executives expecting lower tax rates at retirement.", "irs": "26 U.S.C. 409A, IRS Notice 2005-1, Treas. Reg. 1.409A-1 to 1.409A-4, IRS Publication 15-B"},
    "1031_exchange": {"name": "1031 Like-Kind Exchange", "short": "Defer capital gains taxes by exchanging one investment property for another of like-kind.", "long": "Section 1031 allows taxpayers to defer capital gains taxes when selling investment real estate by reinvesting proceeds into like-kind property within strict deadlines (45 days to identify, 180 days to close). Gains accumulate tax-deferred until a taxable sale.", "irs": "26 U.S.C. 1031, Treas. Reg. 1.1031(a)-1, Treas. Reg. 1.1031(k)-1, Rev. Rul. 2004-86, IRS Publication 544"},
    "charitable_remainder_trust": {"name": "Charitable Remainder Trust (CRT)", "short": "Donate appreciated assets to a charitable trust to receive income and a partial deduction.", "long": "A charitable remainder trust allows taxpayers to contribute appreciated assets, receive an immediate partial charitable deduction, avoid capital gains on the sale, and receive an income stream for life or a term of years. The remainder passes to charity.", "irs": "26 U.S.C. 664, 26 U.S.C. 170(f)(2), 26 U.S.C. 4947(a)(2), IRS Publication 561, Rev. Proc. 2005-52"},
    "opportunity_zone": {"name": "Opportunity Zone Investment", "short": "Invest capital gains in designated opportunity zones to defer and potentially reduce taxes.", "long": "Investing capital gains in Qualified Opportunity Zone Funds defers the gain until 2026 (or earlier sale). Gains from the opportunity zone investment held 10+ years are excluded from tax entirely. Particularly powerful for taxpayers with significant capital gains and long investment horizons.", "irs": "26 U.S.C. 1400Z-1, 26 U.S.C. 1400Z-2, Treas. Reg. 1.1400Z2(a)-1, IRS Form 8949, Notice 2018-48"},
}

def get_strategy(strategy_id):
    """Look up strategy data by ID."""
    return STRATEGY_DATA.get(strategy_id, {
        "name": strategy_id.replace("_", " ").title(),
        "short": "",
        "long": "",
        "irs": ""
    })


# ─────────────────────────────────────────────
# HELPER: Format currency
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


# ─────────────────────────────────────────────
# BOILERPLATE TEXT (verbatim from roadmaps)
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

SAVINGS_INTRO_TEXT = (
    "Our proprietary analysis of your financial information has identified specific opportunities "
    "to legally and ethically reduce your tax burden. The strategies presented have been selected "
    "based on three core pillars:"
)

SAVINGS_BULLETS = [
    ("Automated Analysis:", "Our system cross-references your financial data against hundreds of IRS-approved tax strategies to identify the most relevant opportunities for your situation."),
    ("Tailored Tax Strategies:", "Each strategy has been selected specifically for your entity structure, income levels, and financial profile — not as a generic checklist."),
    ("Updated IRS Regulations:", "All strategies reflect current tax law and recent IRS guidance, ensuring that recommendations are both legal and optimally timed."),
]

SAVINGS_FOOTER = (
    "The estimated savings range reflects the potential tax reduction if these strategies are properly "
    "implemented with appropriate documentation. Implementation effectiveness will vary based on your "
    "specific facts and circumstances. A detailed implementation plan will be provided upon engagement."
)

NEXT_STEPS_TEXT = (
    "Ready to implement these strategies and start saving on your taxes?\n\n"
    "Here's how to get started:"
)

NEXT_STEPS_ITEMS = [
    "Schedule a strategy implementation call with your PBG tax advisor",
    "Review and prioritize the strategies that best fit your goals",
    "Gather required documentation for each selected strategy",
    "Implement the strategies with PBG's guidance and oversight",
    "Monitor outcomes and adjust as needed throughout the tax year",
]

NEXT_STEPS_CONTACT = (
    "Contact Phillips Business Group today to schedule your implementation consultation.\n\n"
    "Phone: 713-955-2900\n"
    "Email: tiffany@phillipsbusinessgroup.com\n"
    "Website: phillipsbusinessgroup.com"
)


# ─────────────────────────────────────────────
# PDF BUILDER
# ─────────────────────────────────────────────
class RoadmapPDF:
    def __init__(self, payload, output_path, fonts):
        self.payload = payload
        self.output_path = output_path
        self.fonts = fonts
        self.client = payload["client"]
        self.entities = payload["entities"]
        self.all_selections = payload.get("allSelections", {})
        
        # Convert allSelections keys to int
        self.all_selections = {int(k): v for k, v in self.all_selections.items()}
        
        self.F_DISPLAY = fonts.get("display", "Times-Roman")
        self.F_DISPLAY_IT = fonts.get("display_italic", "Times-Italic")
        self.F_BODY = fonts.get("body", "Helvetica")
        
        # Compute total savings range
        total_min = 0
        total_max = 0
        for entity in self.entities:
            for sel in self.all_selections.get(entity["id"], []):
                if sel.get("status") in ("suggested", "manual_add"):
                    total_min += sel.get("savingsMin") or 0
                    total_max += sel.get("savingsMax") or 0
        self.total_min = total_min
        self.total_max = total_max

    def build(self):
        from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate
        
        doc = SimpleDocTemplate(
            self.output_path,
            pagesize=letter,
            leftMargin=MARGIN,
            rightMargin=MARGIN,
            topMargin=MARGIN,
            bottomMargin=MARGIN + 0.3 * inch,
            title=f"Tax Savings Roadmap — {self.client['name']}",
            author="Perplexity Computer",
        )
        
        story = []
        story += self._build_cover()
        story += self._build_overview()
        story += self._build_important_info()
        story += self._build_savings_summary()
        story += self._build_entity_table()
        
        for entity in self.entities:
            entity_id = entity["id"]
            selections = self.all_selections.get(entity_id, [])
            suggested = [s for s in selections if s.get("status") in ("suggested", "manual_add")]
            excluded  = [s for s in selections if s.get("status") in ("excluded", "manual_remove")]
            
            if suggested:
                story += self._build_entity_strategies(entity, suggested, mode="suggested")
            if excluded:
                story += self._build_entity_strategies(entity, excluded, mode="excluded")
        
        story += self._build_next_steps()
        
        doc.build(story, onFirstPage=self._page_footer, onLaterPages=self._page_footer)
    
    def _page_footer(self, canvas_obj, doc):
        """Draw footer on every page."""
        canvas_obj.saveState()
        canvas_obj.setFont(self.F_BODY, 8)
        canvas_obj.setFillColor(GRAY)
        y = 0.4 * inch
        canvas_obj.drawString(MARGIN, y, "Phillips Business Group | Tax Return Analysis")
        canvas_obj.drawRightString(PAGE_W - MARGIN, y, f"Confidential — {self.client['name']}")
        # Accent line
        canvas_obj.setStrokeColor(ACCENT)
        canvas_obj.setLineWidth(1)
        canvas_obj.line(MARGIN, 0.6 * inch, PAGE_W - MARGIN, 0.6 * inch)
        canvas_obj.restoreState()

    # ─── COVER PAGE ───────────────────────────────
    def _build_cover(self):
        from reportlab.platypus import Flowable
        
        class CoverPage(Flowable):
            def __init__(self, builder):
                Flowable.__init__(self)
                self.b = builder
                self.width = CONTENT_W
                self.height = PAGE_H - MARGIN * 2 - 0.5 * inch
            
            def draw(self):
                b = self.b
                c = self.canv
                w = PAGE_W
                h = PAGE_H
                
                # White background
                c.setFillColor(WHITE)
                c.rect(0, 0, w, h, fill=1, stroke=0)
                
                # Navy top bar
                bar_h = 0.18 * inch
                c.setFillColor(NAVY)
                c.rect(-MARGIN, self.height - bar_h + 0.25*inch, w, bar_h, fill=1, stroke=0)
                
                # "Tax Return Analysis" — large display font centered
                y_title = self.height * 0.72
                c.setFont(b.F_DISPLAY, 36)
                c.setFillColor(DARK_TEXT)
                title = "Tax Return Analysis"
                c.drawCentredString(CONTENT_W / 2, y_title, title)
                
                # Yellow-green accent rule
                rule_y = y_title - 18
                c.setStrokeColor(ACCENT)
                c.setLineWidth(1.5)
                c.line(CONTENT_W * 0.15, rule_y, CONTENT_W * 0.85, rule_y)
                
                # Client name
                c.setFont(b.F_DISPLAY, 22)
                c.setFillColor(DARK_TEXT)
                c.drawCentredString(CONTENT_W / 2, y_title - 50, b.client["name"])
                
                # Tax year
                c.setFont(b.F_BODY, 14)
                c.setFillColor(MID_TEXT)
                c.drawCentredString(CONTENT_W / 2, y_title - 75, f"Tax Year {b.client.get('taxYear', '')}")
                
                # Savings range teaser
                savings_y = y_title - 130
                c.setFont(b.F_DISPLAY, 28)
                c.setFillColor(NAVY)
                savings_text = fmt_range(b.total_min, b.total_max)
                c.drawCentredString(CONTENT_W / 2, savings_y, savings_text)
                c.setFont(b.F_BODY, 11)
                c.setFillColor(SLATE)
                c.drawCentredString(CONTENT_W / 2, savings_y - 20, "Estimated Annual Tax Savings")
                
                # Prepared by section
                prep_y = y_title - 230
                c.setFont(b.F_BODY, 9)
                c.setFillColor(LIGHT_TEXT)
                c.drawCentredString(CONTENT_W / 2, prep_y, "Prepared by")
                
                # Logo
                logo_path = "/home/user/workspace/pbg_logo_horizontal.png"
                if os.path.exists(logo_path):
                    logo_w = 2.2 * inch
                    logo_h = 0.6 * inch
                    c.drawImage(
                        logo_path,
                        CONTENT_W / 2 - logo_w / 2,
                        prep_y - logo_h - 6,
                        width=logo_w, height=logo_h,
                        preserveAspectRatio=True, mask="auto"
                    )
                
                # Preparation date
                date_y = prep_y - 90
                c.setFont(b.F_BODY, 9)
                c.setFillColor(LIGHT_TEXT)
                c.drawCentredString(CONTENT_W / 2, date_y, f"Prepared: {b.client.get('preparationDate', '')}")
                
                # Filing status
                c.drawCentredString(CONTENT_W / 2, date_y - 14, f"Filing Status: {b.client.get('filingStatus', '')}")
                
                # Bottom navy bar
                c.setFillColor(NAVY)
                c.rect(-MARGIN, -MARGIN, w, 0.15 * inch, fill=1, stroke=0)
        
        return [CoverPage(self), PageBreak()]

    # ─── OVERVIEW PAGE ────────────────────────────
    def _build_overview(self):
        story = []
        story.append(self._section_header("Overview"))
        story.append(Spacer(1, 0.18 * inch))
        
        # Calculate entity summaries
        entity_lines = []
        for entity in self.entities:
            entity_id = entity["id"]
            sels = self.all_selections.get(entity_id, [])
            ent_min = sum(s.get("savingsMin") or 0 for s in sels if s.get("status") in ("suggested", "manual_add"))
            ent_max = sum(s.get("savingsMax") or 0 for s in sels if s.get("status") in ("suggested", "manual_add"))
            count = len([s for s in sels if s.get("status") in ("suggested", "manual_add")])
            entity_lines.append(f"{entity['name']} ({entity['entityType']}): {fmt_range(ent_min, ent_max)} — {count} strateg{'y' if count == 1 else 'ies'}")
        
        bullets = [
            f"Tax Return Summary — {self.client['name']}, Tax Year {self.client.get('taxYear', '')}",
            f"Total Estimated Savings — {fmt_range(self.total_min, self.total_max)}",
        ] + [f"Savings by Entity — {line}" for line in entity_lines] + [
            "Next Steps — Schedule an implementation consultation with your PBG advisor",
        ]
        
        for bullet in bullets:
            p = Paragraph(f"• {bullet}", self._style("body", size=11, leading=16, left_indent=14))
            story.append(p)
            story.append(Spacer(1, 0.08 * inch))
        
        story.append(PageBreak())
        return story

    # ─── IMPORTANT INFORMATION ────────────────────
    def _build_important_info(self):
        story = []
        story.append(self._section_header("Important Information"))
        story.append(Spacer(1, 0.18 * inch))
        
        for para in IMPORTANT_INFO_TEXT.strip().split("\n\n"):
            if para.startswith("IMPORTANT INFORMATION"):
                continue
            p = Paragraph(para, self._style("body", size=10, leading=15))
            story.append(p)
            story.append(Spacer(1, 0.12 * inch))
        
        story.append(PageBreak())
        return story

    # ─── SAVINGS SUMMARY PAGE ─────────────────────
    def _build_savings_summary(self):
        story = []
        story.append(self._section_header(f"{self.client['name']}'s Tax Return Summary"))
        story.append(Spacer(1, 0.25 * inch))
        
        # Big savings number
        big_savings = fmt_range(self.total_min, self.total_max)
        p = Paragraph(
            big_savings,
            ParagraphStyle(
                "BigSavings",
                fontName=self.F_DISPLAY,
                fontSize=38,
                leading=44,
                textColor=NAVY,
                alignment=TA_CENTER,
                spaceAfter=6,
            )
        )
        story.append(p)
        
        p2 = Paragraph(
            "Estimated Annual Tax Savings Opportunity",
            ParagraphStyle(
                "SavingsSub",
                fontName=self.F_BODY,
                fontSize=12,
                textColor=SLATE,
                alignment=TA_CENTER,
                spaceAfter=24,
            )
        )
        story.append(p2)
        
        # Accent rule
        story.append(HRFlowable(width="80%", thickness=1.5, color=ACCENT, spaceAfter=18))
        
        # Intro text
        story.append(Paragraph(SAVINGS_INTRO_TEXT, self._style("body", size=11, leading=16)))
        story.append(Spacer(1, 0.18 * inch))
        
        for bold_part, text_part in SAVINGS_BULLETS:
            p = Paragraph(
                f"<b>{bold_part}</b> {text_part}",
                self._style("body", size=11, leading=16, left_indent=20)
            )
            story.append(p)
            story.append(Spacer(1, 0.1 * inch))
        
        story.append(Spacer(1, 0.15 * inch))
        story.append(Paragraph(SAVINGS_FOOTER, self._style("body", size=10, leading=14, color=MID_TEXT)))
        story.append(PageBreak())
        return story

    # ─── ENTITY TABLE PAGE ────────────────────────
    def _build_entity_table(self):
        story = []
        story.append(self._section_header("Tax Savings by Entity"))
        story.append(Spacer(1, 0.18 * inch))
        
        # Table data
        headers = ["Entity", "Potential Savings", "Entity Type", "Strategies"]
        table_data = [headers]
        
        for entity in self.entities:
            entity_id = entity["id"]
            sels = self.all_selections.get(entity_id, [])
            ent_min = sum(s.get("savingsMin") or 0 for s in sels if s.get("status") in ("suggested", "manual_add"))
            ent_max = sum(s.get("savingsMax") or 0 for s in sels if s.get("status") in ("suggested", "manual_add"))
            count = len([s for s in sels if s.get("status") in ("suggested", "manual_add")])
            
            from reportlab.platypus import Paragraph as P2
            from reportlab.lib.styles import ParagraphStyle as PS2
            name_cell = P2(entity["name"], PS2("etname", fontName=self.F_BODY, fontSize=10, leading=13, textColor=(0.1,0.1,0.1)))
            savings_cell = P2(fmt_range(ent_min, ent_max), PS2("etsav", fontName=self.F_BODY, fontSize=10, leading=13, textColor=(0.1,0.1,0.1)))
            table_data.append([
                name_cell,
                savings_cell,
                entity["entityType"],
                str(count),
            ])
        
        col_widths = [CONTENT_W * 0.42, CONTENT_W * 0.30, CONTENT_W * 0.15, CONTENT_W * 0.13]
        
        t = Table(table_data, colWidths=col_widths, repeatRows=1)
        t.setStyle(TableStyle([
            # Header row
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ("FONTNAME", (0, 0), (-1, 0), self.F_BODY),
            ("FONTSIZE", (0, 0), (-1, 0), 10),
            ("FONTNAME", (0, 0), (-1, 0), self.F_BODY),
            ("ALIGN", (0, 0), (-1, 0), "LEFT"),
            ("TOPPADDING", (0, 0), (-1, 0), 10),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 10),
            ("LEFTPADDING", (0, 0), (-1, 0), 12),
            # Data rows
            ("FONTNAME", (0, 1), (-1, -1), self.F_BODY),
            ("VALIGN", (0, 1), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 1), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 1), (-1, -1), 8),
            ("FONTSIZE", (0, 1), (-1, -1), 10),
            ("ALIGN", (0, 1), (-1, -1), "LEFT"),
            ("TOPPADDING", (0, 1), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 1), (-1, -1), 8),
            ("LEFTPADDING", (0, 1), (-1, -1), 12),
            # Alternating rows
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, HexColor("#f8f8f5")]),
            # Grid
            ("LINEBELOW", (0, 0), (-1, 0), 1, NAVY),
            ("LINEBELOW", (0, 1), (-1, -1), 0.5, CARD_BORDER),
            ("BOX", (0, 0), (-1, -1), 1, CARD_BORDER),
            # Savings column — bold navy
            ("TEXTCOLOR", (1, 1), (1, -1), NAVY),
            ("FONTSIZE", (1, 1), (1, -1), 11),
        ]))
        
        story.append(t)
        story.append(PageBreak())
        return story

    # ─── ENTITY STRATEGIES PAGE ───────────────────
    def _build_entity_strategies(self, entity, selections, mode="suggested"):
        story = []
        
        if mode == "suggested":
            title = f"{entity['name']} | Suggested Strategies"
            icon = "+"
            icon_color = PLUS_COLOR
            subtitle = "Potential strategies and savings"
        else:
            title = f"{entity['name']} | Excluded Strategies"
            icon = "\u00d7"
            icon_color = X_COLOR
            subtitle = "Strategies not applicable based on your current financial profile"
        
        story.append(self._section_header(title))
        story.append(Spacer(1, 0.06 * inch))
        
        # Subtitle
        p = Paragraph(subtitle, self._style("body", size=11, color=SLATE))
        story.append(p)
        story.append(Spacer(1, 0.12 * inch))
        
        # Intro line for suggested
        if mode == "suggested":
            total_min = sum(s.get("savingsMin") or 0 for s in selections)
            total_max = sum(s.get("savingsMax") or 0 for s in selections)
            intro = (
                f"The following {len(selections)} {'strategy has' if len(selections)==1 else 'strategies have'} "
                f"been identified for <b>{entity['name']}</b>, with a combined estimated savings of "
                f"<b>{fmt_range(total_min, total_max)}</b>."
            )
            story.append(Paragraph(intro, self._style("body", size=10, leading=14)))
            story.append(Spacer(1, 0.15 * inch))
        
        # Strategy cards
        for sel in selections:
            story += self._build_strategy_card(sel, icon, icon_color, mode)
            story.append(Spacer(1, 0.1 * inch))
        
        story.append(PageBreak())
        return story

    def _build_strategy_card(self, sel, icon, icon_color, mode):
        """Build a single strategy card matching the roadmap layout."""
        strat_id = sel.get("strategyId", "")
        strat = get_strategy(strat_id)
        
        savings_min = sel.get("savingsMin")
        savings_max = sel.get("savingsMax")
        rationale   = sel.get("rationale") or strat.get("long", "")
        
        if mode == "excluded":
            savings_text = "$0"
        else:
            savings_text = fmt_range(savings_min, savings_max)
        
        # Card header row: [icon] [Name]  [Savings]
        name_para = Paragraph(
            f"<font color='#{icon_color.hexval()}'><b>{icon}</b></font>  <b>{strat['name']}</b>",
            ParagraphStyle(
                "CardHeader",
                fontName=self.F_BODY,
                fontSize=12,
                leading=15,
                textColor=DARK_TEXT,
            )
        )
        savings_para = Paragraph(
            f"<b>{savings_text}</b>",
            ParagraphStyle(
                "CardSavings",
                fontName=self.F_BODY,
                fontSize=12,
                leading=15,
                textColor=NAVY if mode == "suggested" else LIGHT_TEXT,
                alignment=TA_RIGHT,
            )
        )
        
        # Short description
        short_desc = strat.get("short", "")
        short_para = Paragraph(
            f"<b>{short_desc}</b>" if short_desc else "",
            self._style("body", size=10, leading=14, color=MID_TEXT)
        )
        
        # Long rationale
        rationale_para = Paragraph(
            rationale,
            self._style("body", size=10, leading=14)
        )
        
        # IRS citations
        irs_refs = strat.get("irs", "")
        irs_para = Paragraph(
            f"<font color='#aaaaaa' size=8>{irs_refs}</font>" if irs_refs else "",
            self._style("body", size=8, leading=11, color=LIGHT_TEXT)
        ) if irs_refs else None
        
        # Build card as nested table for border
        inner_content = [[name_para, savings_para]]
        inner_table = Table(inner_content, colWidths=[CONTENT_W * 0.60, CONTENT_W * 0.36])
        inner_table.setStyle(TableStyle([
            ("ALIGN", (0, 0), (0, 0), "LEFT"),
            ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (0, 0), 0),
            ("RIGHTPADDING", (1, 0), (1, 0), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        
        card_rows = [
            [inner_table],
        ]
        if short_desc:
            card_rows.append([short_para])
        if rationale:
            card_rows.append([rationale_para])
        if irs_refs:
            card_rows.append([irs_para])
        
        card_table = Table(card_rows, colWidths=[CONTENT_W])
        
        # Build style list
        style_cmds = [
            ("LEFTPADDING", (0, 0), (-1, -1), 14),
            ("RIGHTPADDING", (0, 0), (-1, -1), 14),
            ("TOPPADDING", (0, 0), (0, 0), 12),
            ("BOTTOMPADDING", (0, -1), (0, -1), 12),
            ("TOPPADDING", (0, 1), (0, -1), 4),
            ("BOTTOMPADDING", (0, 0), (0, -2), 4),
            ("BOX", (0, 0), (-1, -1), 0.75, CARD_BORDER),
            ("LINEABOVE", (0, 0), (-1, 0), 2.5, ACCENT if mode == "suggested" else GRAY),
            ("BACKGROUND", (0, 0), (-1, -1), WHITE),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [WHITE]),
        ]
        
        card_table.setStyle(TableStyle(style_cmds))
        
        return [card_table]

    # ─── NEXT STEPS ───────────────────────────────
    def _build_next_steps(self):
        story = []
        story.append(self._section_header("Next Steps"))
        story.append(Spacer(1, 0.18 * inch))
        
        story.append(Paragraph(NEXT_STEPS_TEXT, self._style("body", size=11, leading=16)))
        story.append(Spacer(1, 0.15 * inch))
        
        for i, item in enumerate(NEXT_STEPS_ITEMS, 1):
            p = Paragraph(
                f"<b>{i}.</b> {item}",
                self._style("body", size=11, leading=16, left_indent=20)
            )
            story.append(p)
            story.append(Spacer(1, 0.08 * inch))
        
        story.append(Spacer(1, 0.25 * inch))
        story.append(HRFlowable(width="100%", thickness=1, color=ACCENT, spaceAfter=18))
        
        # Contact block with navy background
        contact_para = Paragraph(
            NEXT_STEPS_CONTACT.replace("\n", "<br/>"),
            ParagraphStyle(
                "ContactBlock",
                fontName=self.F_BODY,
                fontSize=11,
                leading=18,
                textColor=WHITE,
                backColor=NAVY,
                alignment=TA_CENTER,
                spaceBefore=0,
                spaceAfter=0,
                leftIndent=0,
                rightIndent=0,
            )
        )
        
        contact_table = Table([[contact_para]], colWidths=[CONTENT_W])
        contact_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), NAVY),
            ("TOPPADDING", (0, 0), (-1, -1), 24),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 24),
            ("LEFTPADDING", (0, 0), (-1, -1), 24),
            ("RIGHTPADDING", (0, 0), (-1, -1), 24),
        ]))
        story.append(contact_table)
        
        return story

    # ─── HELPER: Section Header ────────────────────
    def _section_header(self, title):
        from reportlab.platypus import Flowable
        
        class SectionHeader(Flowable):
            def __init__(self2, text, builder):
                Flowable.__init__(self2)
                self2.text = text
                self2.b = builder
                self2.width = CONTENT_W
                self2.height = 0.55 * inch
            
            def draw(self2):
                c = self2.canv
                b = self2.b
                
                # Navy background bar
                c.setFillColor(NAVY)
                c.rect(0, 0, self2.width, self2.height, fill=1, stroke=0)
                
                # Accent left bar
                c.setFillColor(ACCENT)
                c.rect(0, 0, 4, self2.height, fill=1, stroke=0)
                
                # Title text — shrink font if title is too long
                c.setFillColor(WHITE)
                max_w = self2.width - 32
                font_size = 16
                c.setFont(b.F_DISPLAY, font_size)
                while c.stringWidth(self2.text, b.F_DISPLAY, font_size) > max_w and font_size > 9:
                    font_size -= 1
                    c.setFont(b.F_DISPLAY, font_size)
                c.drawString(18, self2.height * 0.3, self2.text)
        
        return SectionHeader(title, self)

    # ─── HELPER: Paragraph Style ──────────────────
    def _style(self, kind, size=11, leading=None, color=None, left_indent=0, alignment=TA_LEFT):
        if leading is None:
            leading = size * 1.4
        if color is None:
            color = DARK_TEXT
        font = self.F_BODY if kind == "body" else self.F_DISPLAY
        return ParagraphStyle(
            f"custom_{kind}_{size}_{id(color)}",
            fontName=font,
            fontSize=size,
            leading=leading,
            textColor=color,
            leftIndent=left_indent,
            alignment=alignment,
        )


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
# ─────────────────────────────────────────────
# QUIZ → PAYLOAD CONVERSION
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

    # Build client
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

    # Build entity
    entity = {
        "id": 1,
        "clientId": quiz.get("id", 1),
        "name": f"{name}'s {struct_label}",
        "entityType": entity_type,
        "grossRevenue": None, "netProfit": profit_val,
        "w2Wages": None, "ownerCompensation": None,
        "agi": profit_val if entity_type == "1040" else None,
        "totalIncome": profit_val,
        "filingStatus": None, "mortgageInterest": None,
        "stateLocalTaxes": None, "charitableDonations": None,
        "medicalExpenses": None, "capitalGains": None,
        "capitalLosses": None, "iraDistributions": None,
        "rentalIncome": None, "partnershipIncome": None,
        "mealExpenses": None, "travelExpenses": None,
        "vehicleExpenses": None, "homeOfficeExpenses": None,
        "depreciation": None,
        "hasEmployees": quiz.get("hasEmployees") not in (None, "no"),
        "hasNonOwnerEmployees": quiz.get("hasEmployees") == "yes_6plus",
        "hasBusinessVehiclePurchase": False,
        "hasHealthInsurancePersonal": False,
        "hasRealProperty": quiz.get("investmentActivity") in ("real_estate", "multiple"),
        "alreadyHasRetirementPlan": False,
        "numberOfDependents": 1 if quiz.get("hasDependents") and quiz.get("hasDependents") != "no" else 0,
        "dependentsHaveEarnedIncome": quiz.get("hasDependents") == "yes_earned_income",
        "notes": None,
    }

    # Build strategy selections from quiz mapping logic (Python mirror of quizStrategies.ts)
    # We use a simplified version here — the key strategies for each profile
    selections = _quiz_selections(quiz, profit_val, rate, entity_type)

    return {
        "client": client,
        "entities": [entity],
        "allSelections": {"1": selections},
    }


def _quiz_selections(quiz, profit, rate, entity_type):
    """Generate strategy selections from quiz answers (Python mirror of quizStrategies.ts)."""
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
                "An accountable plan allows you to reimburse yourself tax-free for home office, vehicle, and other business expenses, reducing both income and payroll taxes.")

        mn, mx = sav(profit * 0.03)
        add("meals", "suggested", max(mn, 500), min(mx, 12000),
            "Business meals with clients or employees are 50% deductible. Proper documentation of business purpose is essential.")

        add("travel", "suggested", max(int(profit * 0.02 * rate), 1000), min(int(profit * 0.05 * rate), 12000),
            "Ordinary and necessary business travel is fully deductible when the primary purpose is business.")

        add("vehicle", "suggested", 1500, 12000,
            "Business use of your vehicle is deductible via actual expenses or the standard mileage rate (67¢/mile, 2024).")

        if biz in ("sole_prop", "llc_single", "s_corp", "partnership"):
            qbi = profit * 0.20
            mn, mx = sav(qbi)
            add("section_199a", "suggested", max(mn, 2000), min(mx, 80000),
                f"Pass-through business owners may deduct up to 20% of qualified business income — potentially ${int(qbi):,} based on your estimated profit.")

        if profit_key != "under_100k":
            add("maximize_depreciation", "suggested", 5000, 50000,
                "Section 179 and 60% bonus depreciation allow you to immediately expense qualifying equipment and property in the year of purchase.")

            ret_min, ret_max = sav(min(profit * 0.1, 69000))
            add("traditional_401k_business", "suggested", max(ret_min, 3000), min(ret_max, 25000),
                "Employer 401(k) contributions are fully deductible. Combined contributions can reach $69,000 in 2024.")

        if high_income:
            ps_min, ps_max = sav(min(profit * 0.15, 69000))
            add("profit_sharing", "suggested", max(ps_min, 8000), min(ps_max, 50000),
                "A profit-sharing plan allows discretionary contributions of up to 25% of compensation — ideal for your profit level.")

        if profit_key in ("500k_1m", "over_1m"):
            add("cash_balance_plan", "suggested", 30000, 150000,
                "Cash balance / defined benefit plans allow dramatically larger deductions than 401(k)s — up to $300K+ per year for high earners.")

        if is_partnership and profit_key != "under_100k":
            se_sav = max(int(min(profit * 0.35, 150000) * 0.153 * 0.5), 5000)
            add("late_s_election", "suggested", int(se_sav * 0.6), int(se_sav * 1.4),
                "Electing S-Corp status can substantially reduce self-employment taxes by paying yourself a reasonable salary and taking the remainder as a distribution.")

        add("augusta_rule", "suggested", 1500, 15000,
            "Rent your home to your business for up to 14 days/year — income is completely tax-free to you under IRC Section 280A.")

        if has_dependents:
            add("hiring_kids", "suggested", 3000, 15000,
                "Paying your children reasonable wages shifts income from your high bracket to their zero/low bracket. Under-18 children in a parent's sole prop are exempt from FICA.")

        if has_employees:
            add("health_reimbursement", "suggested", 3000, 20000,
                "An HRA allows tax-free reimbursement of employee health insurance premiums and medical expenses, reducing payroll taxes.")
            add("work_opportunity_credit", "suggested", 1200, 15000,
                "Federal tax credit of 25-40% of first-year wages for employees from targeted groups (veterans, ex-felons, long-term unemployed).")
            add("employee_achievement_award", "suggested", 500, 3000,
                "Deductible awards for length of service or safety achievements (up to $1,600/employee). Tax-free to employees.")

        if has_real_estate:
            add("cost_segregation", "suggested", 15000, 100000,
                "Accelerates depreciation on real property by reclassifying components into shorter depreciable lives. Most beneficial for properties over $1M.")
            add("1031_exchange", "suggested", 10000, 80000,
                "Defer all capital gains taxes on investment real estate sales by reinvesting into like-kind property within IRS deadlines.")

    # Individual strategies
    if owns_home:
        add("itemized_deductions", "suggested", 2000, 10000,
            "Homeowners typically benefit from itemizing — mortgage interest and property taxes often exceed the standard deduction.")
        add("sell_your_home", "suggested", 15000, 75000,
            "Exclude up to $500,000 (MFJ) or $250,000 (single) of capital gains when selling your primary residence.")

    add("health_savings_account", "suggested", 1000, 8300,
        "Triple tax advantage: pre-tax contributions, tax-free growth, tax-free medical withdrawals. Requires a High Deductible Health Plan.")

    ret_i_min, ret_i_max = max(1500, int(23000 * rate * 0.6)), int(23000 * rate)
    add("traditional_401k_individual", "suggested", ret_i_min, ret_i_max,
        f"Contributing up to $23,000 (2024) to a traditional 401(k) reduces taxable income dollar-for-dollar. At your bracket, maxing this out saves approximately ${int(23000 * rate):,} in federal taxes.")

    if has_dependents:
        add("child_tax_credit", "suggested", 1000, 5000,
            "Up to $2,000 per qualifying child under 17. Partially refundable up to $1,600. Subject to phase-out above $400,000 AGI (MFJ).")

    if quiz.get("hasDependents") == "yes_earned_income":
        add("child_roth_ira", "suggested", 500, 7000,
            "Children with earned income can contribute to a Roth IRA. Tax-free compound growth from childhood to retirement is one of the most powerful long-term strategies.")
    elif has_dependents:
        add("child_roth_ira", "excluded", 0, 0,
            "Dependents don't currently have earned income. A Child Roth IRA becomes available once children start working.")

    if has_stocks:
        add("tax_loss_harvesting", "suggested", 2000, 20000,
            "Strategically selling losing investments to offset capital gains and up to $3,000 of ordinary income per year.")
    else:
        add("tax_loss_harvesting", "excluded", 0, 0,
            "Tax loss harvesting requires investment securities. Not applicable if income is primarily from business operations.")

    if high_income and has_stocks:
        add("oil_and_gas", "suggested", 10000, 50000,
            "Oil and gas investments offer 70-80% first-year deductions through intangible drilling costs. Best for high-income earners offsetting ordinary income.")

    if not high_income:
        pass

    if is_business:
        pass

    if is_s_corp:
        add("late_s_election", "excluded", 0, 0,
            "Already an S-Corporation — late S-election not applicable. Worth evaluating if S-Corp vs. C-Corp is optimal at current income.")

    if not has_real_estate:
        add("cost_segregation", "excluded", 0, 0,
            "Cost segregation applies to real property. Not applicable without investment real estate.")
        add("1031_exchange", "excluded", 0, 0,
            "1031 exchanges apply to investment real estate. Not applicable without investment property.")

    return results


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 generate_pdf.py <payload_json_path> <output_pdf_path>", file=sys.stderr)
        sys.exit(1)
    
    payload_path = sys.argv[1]
    output_path  = sys.argv[2]
    
    with open(payload_path, "r") as f:
        payload = json.load(f)

    # If this is a quiz submission, convert to standard payload format
    if payload.get("mode") == "quiz":
        payload = quiz_to_payload(payload["quiz"])
    
    print("Registering fonts...", file=sys.stderr)
    fonts = register_fonts()
    print(f"  Display: {fonts.get('display')}, Body: {fonts.get('body')}", file=sys.stderr)
    
    print("Building PDF...", file=sys.stderr)
    builder = RoadmapPDF(payload, output_path, fonts)
    builder.build()
    
    print(f"PDF written to: {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
