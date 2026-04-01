#!/bin/bash
# Usage: ./test/test.sh <url>

if [ -z "$1" ]; then
    echo "Usage: $0 <url>"
    exit 1
fi

OUTPUT="test/output.txt"
node src/index.js "$1" --output="$OUTPUT"
echo "Saved to: $OUTPUT"
