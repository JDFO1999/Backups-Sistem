FROM python:3.11-slim

# Install system dependencies, clients for MySQL, PostgreSQL, OpenSSH, and compression tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    openssh-client \
    default-mysql-client \
    postgresql-client \
    gzip \
    pigz \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Create staging directory
RUN mkdir -p /tmp/backup_staging && chmod 777 /tmp/backup_staging

COPY . /app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
