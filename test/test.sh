#!/bin/bash
# Usage: ./test/test.sh <url>

if [ -z "$1" ]; then
    echo "Usage: $0 <url>"
    exit 1
fi

OUTPUT="test/output.txt"

echo "=== Quick crawl ==="
node src/index.js "$1" --output="$OUTPUT"
echo "Saved to: $OUTPUT"

echo ""
echo "=== Run with job persistence ==="
JOB_OUTPUT=$(node src/index.js run "$1" 2>&1)
echo "$JOB_OUTPUT"

JOB_ID=$(echo "$JOB_OUTPUT" | grep "Job created:" | awk '{print $3}')
echo ""
echo "=== List jobs ==="
node src/index.js list

echo ""
echo "=== Job result ==="
node src/index.js result "$JOB_ID"
