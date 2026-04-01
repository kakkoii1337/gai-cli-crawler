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
RUN_OUTPUT=$(node src/index.js run "$1" 2>&1)
echo "$RUN_OUTPUT"
JOB_ID=$(echo "$RUN_OUTPUT" | grep "Job created:" | awk '{print $3}')
echo "Job ID: $JOB_ID"

echo ""
echo "=== List jobs ==="
node src/index.js list

echo ""
echo "=== Job status ==="
node src/index.js status "$JOB_ID"

echo ""
echo "=== Job result ==="
node src/index.js result "$JOB_ID"

echo ""
echo "=== Simulate rerun (cancel then rerun) ==="
# Run a job in background and immediately cancel it
node src/index.js run "$1" --depth=2 &
BG_PID=$!
sleep 3
BG_OUTPUT=$(node src/index.js list 2>&1)
RUNNING_JOB=$(echo "$BG_OUTPUT" | grep "SCRAPING" | awk '{print $1}')
if [ -n "$RUNNING_JOB" ]; then
    echo "Cancelling running job: $RUNNING_JOB"
    node src/index.js cancel "$RUNNING_JOB"
fi
wait $BG_PID

echo ""
echo "=== List after cancel ==="
node src/index.js list

if [ -n "$RUNNING_JOB" ]; then
    echo ""
    echo "=== Rerun cancelled job ==="
    node src/index.js rerun "$RUNNING_JOB" 2>&1
fi

echo ""
echo "=== Clear all jobs ==="
node src/index.js clear
node src/index.js list
