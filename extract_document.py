#!/usr/bin/env python3
"""
PBG Document Extraction Script
Usage: python3 extract_document.py <input_file_path> <entity_type> <output_json_path>

Extracts financial data from:
  - 1040 tax returns
  - 1120-S (S-Corp) tax returns
  - 1065 (Partnership) tax returns
  - P&L / Income Statements
  - Balance Sheets

Outputs a JSON object with Entity fields pre-filled.
"""

import sys
import json
import os
import subprocess
import tempfile
import base64

def extract_text_from_pdf(filepath):
    """Extract text from PDF using pdftotext, fallback to OCR."""
    try:
        result = subprocess.run(
            ["pdftotext", "-layout", filepath, "-"],
            capture_output=True, text=True, timeout=30
        )
        text = result.stdout.strip()
        if len(text) > 200:
            return text, "pdftotext"
    except Exception:
        pass

    # Fallback: OCR with tesseract
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            # Convert PDF to images first
            result = subprocess.run(
                ["pdftoppm", "-r", "200", "-png", filepath, os.path.join(tmpdir, "page")],
                capture_output=True, timeout=60
            )
            pages = sorted([f for f in os.listdir(tmpdir) if f.endswith(".png")])
            all_text = []
            for page in pages[:10]:  # limit to 10 pages
                page_path = os.path.join(tmpdir, page)
                ocr = subprocess.run(
                    ["tesseract", page_path, "stdout", "--psm", "6"],
                    capture_output=True, text=True, timeout=30
                )
                all_text.append(ocr.stdout)
            return "\n\n".join(all_text), "ocr"
    except Exception as e:
        return "", f"failed: {e}"

def extract_text_from_image(filepath):
    """Extract text from image file using tesseract OCR."""
    try:
        result = subprocess.run(
            ["tesseract", filepath, "stdout", "--psm", "6"],
            capture_output=True, text=True, timeout=30
        )
        return result.stdout.strip(), "ocr"
    except Exception as e:
        return "", f"failed: {e}"

def get_file_as_base64(filepath):
    """Get file as base64 for vision API."""
    with open(filepath, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

def extract_with_ai(text, entity_type, filepath=None):
    """Use Claude to extract financial fields from document text."""
    
    # Build extraction prompt
    entity_type_desc = {
        "1040": "Individual 1040 tax return",
        "1120S": "S-Corporation 1120-S tax return",
        "1065": "Partnership 1065 tax return",
        "C-Corp": "C-Corporation 1120 tax return",
        "financials": "P&L / Income Statement / Balance Sheet",
    }.get(entity_type, "financial document")
    
    fields_by_type = {
        "1040": """
- agi: Adjusted Gross Income (Form 1040, line 11)
- totalIncome: Total Income (Form 1040, line 9)
- w2Wages: Wages, salaries, tips (Form 1040, line 1a or Schedule W-2 total)
- iraDistributions: IRA distributions (Form 1040, line 4b)
- rentalIncome: Rental real estate income (Schedule E total)
- partnershipIncome: Partnership/S-corp income (Schedule E, Part II)
- capitalGains: Capital gains/losses (Form 1040, line 7, or Schedule D)
- capitalLosses: Capital losses (Schedule D if negative)
- mortgageInterest: Mortgage interest paid (Schedule A, line 8a)
- stateLocalTaxes: State and local taxes paid (Schedule A, line 5a+5b, capped at 10000)
- charitableDonations: Charitable donations (Schedule A, line 16+17)
- medicalExpenses: Medical and dental expenses (Schedule A, line 4)
- numberOfDependents: Number of dependents claimed
- hasHealthInsurancePersonal: true if paying health insurance premiums personally
- hasRealProperty: true if Schedule E shows rental/real estate income
""",
        "1120S": """
- grossRevenue: Gross receipts or sales (Form 1120-S, line 1a)
- netProfit: Ordinary business income/loss (Form 1120-S, line 21)
- w2Wages: Wages and salaries paid to employees (Form 1120-S, line 8)
- ownerCompensation: Officer compensation (Form 1120-S, line 7)
- depreciation: Depreciation not claimed on Schedule A (Form 1120-S, line 14)
- mealExpenses: Meals and entertainment expenses
- travelExpenses: Travel expenses (Form 1120-S, line 11)
- vehicleExpenses: Car and truck expenses (Form 1120-S, line 10)
- homeOfficeExpenses: Home office deduction if applicable
- hasEmployees: true if W2 wages paid (line 8 > 0)
- hasRealProperty: true if any real property on depreciation schedule
""",
        "1065": """
- grossRevenue: Gross receipts or sales (Form 1065, line 1a)
- netProfit: Ordinary business income/loss (Form 1065, line 22)
- w2Wages: Wages and salaries paid (Form 1065, line 9)
- ownerCompensation: Guaranteed payments to partners (Form 1065, line 10)
- depreciation: Depreciation (Form 1065, line 16a)
- mealExpenses: Meals and entertainment
- travelExpenses: Travel expenses
- vehicleExpenses: Car and truck expenses
- hasEmployees: true if wages paid (line 9 > 0)
- hasRealProperty: true if any rental real estate activity
""",
        "financials": """
- grossRevenue: Total Revenue / Gross Sales (top line of P&L)
- netProfit: Net Income / Net Profit (bottom line of P&L, after all expenses and taxes)
- w2Wages: Total wages and salaries paid to employees (from P&L expenses)
- ownerCompensation: Owner draws, officer salary, or guaranteed payments
- depreciation: Depreciation and amortization expense
- mealExpenses: Meals and entertainment expense
- travelExpenses: Travel expense
- vehicleExpenses: Vehicle or auto expense
- hasEmployees: true if wages/payroll expense > 0
""",
    }

    fields_prompt = fields_by_type.get(entity_type, fields_by_type["financials"])
    
    system_prompt = """You are a tax document parser for a CPA firm. Extract financial data from the provided document text and return ONLY a valid JSON object.

Rules:
- All dollar amounts must be integers (no decimals, no $ signs, no commas)
- Negative numbers are allowed for losses
- Use null for any field not found or not applicable
- Boolean fields: true/false
- Do not include any explanation, only the JSON object
- Round to nearest whole dollar"""

    user_prompt = f"""This is a {entity_type_desc}. Extract the following fields:
{fields_prompt}

Document text:
---
{text[:15000]}
---

Return ONLY a JSON object with these exact field names. Example format:
{{
  "grossRevenue": 500000,
  "netProfit": 120000,
  "w2Wages": 80000,
  "hasEmployees": true,
  "notes": "S-Corp with 3 employees, fiscal year 2024"
}}"""

    try:
        import anthropic
        client = anthropic.Anthropic()
        response = client.messages.create(
            model="claude-opus-4-5",
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}]
        )
        raw = response.content[0].text.strip()
        # Extract JSON from response (handle markdown code blocks)
        if "```" in raw:
            import re
            match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", raw)
            if match:
                raw = match.group(1)
        return json.loads(raw)
    except Exception as e:
        return {"notes": f"AI extraction failed: {e}. Please fill fields manually."}


def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Usage: extract_document.py <file> <entity_type> <output_json>"}))
        sys.exit(1)

    filepath = sys.argv[1]
    entity_type = sys.argv[2]  # "1040", "1120S", "1065", "C-Corp", "financials"
    output_path = sys.argv[3]

    if not os.path.exists(filepath):
        result = {"error": f"File not found: {filepath}"}
        with open(output_path, "w") as f:
            json.dump(result, f)
        sys.exit(1)

    # Extract text
    ext = os.path.splitext(filepath)[1].lower()
    if ext in [".pdf"]:
        text, method = extract_text_from_pdf(filepath)
    elif ext in [".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp"]:
        text, method = extract_text_from_image(filepath)
    else:
        result = {"error": f"Unsupported file type: {ext}"}
        with open(output_path, "w") as f:
            json.dump(result, f)
        sys.exit(1)

    if not text or len(text) < 50:
        result = {
            "error": "Could not extract readable text from document. Please fill fields manually.",
            "extraction_method": method
        }
        with open(output_path, "w") as f:
            json.dump(result, f)
        sys.exit(0)

    # AI extraction
    extracted = extract_with_ai(text, entity_type, filepath)
    extracted["_extraction_method"] = method
    extracted["_entity_type"] = entity_type
    
    with open(output_path, "w") as f:
        json.dump(extracted, f, indent=2)
    
    print(json.dumps({"success": True, "output": output_path}))

if __name__ == "__main__":
    main()
