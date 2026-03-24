FROM node:20-slim

# Install Python, pip, and system dependencies for PDF generation and OCR
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    poppler-utils \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci --omit=dev 2>/dev/null || npm ci

# Copy source and build
COPY . .
RUN npm run build

# Install Python dependencies
RUN pip3 install --no-cache-dir --break-system-packages \
    reportlab \
    pillow \
    anthropic \
    pdfplumber \
    pytesseract \
    pdf2image \
    pypdf2 \
    requests

# Copy Python scripts to dist
RUN cp generate_pdf.py dist/ && cp extract_document.py dist/

# Copy logo
RUN cp pbg_logo_horizontal.png dist/public/ 2>/dev/null || true

EXPOSE 5000

WORKDIR /app/dist

CMD ["node", "index.cjs"]
