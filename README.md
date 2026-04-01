---
name: crawler
description: "CLI tool for crawling web pages and extracting links. Use when: you need to discover all links on a site or map a site's link structure. NOT for: full-page content scraping (use scraper instead)."
homepage: https://github.com/kakkoii1337/gai-cli-crawler
---

# crawler

CLI tool for crawling web pages and extracting links. Builds a `LinkNode` tree (url, title, children) using patchright and cheerio, with optional job persistence.

## Installation

```bash
npm install -g gai-cli-crawler
```

Or run directly:

```bash
npx gai-cli-crawler "https://example.com"
```

## Usage

```bash
crawler <url> [options]                   Quick crawl, output to stdout
crawler run <url> [options]               Crawl with job persistence
crawler list [--jobs-dir=<dir>]           List all past jobs
crawler status <job-id>                   Show job details
crawler result <job-id> [--format=...]    Print result of a completed job
crawler clear [--jobs-dir=<dir>]          Delete all jobs
```

### Crawl Options

- `--depth=N` - Crawl depth (default: 1)
- `--max-links=N` - Max links per page (default: 10)
- `--same-domain` - Only follow links on the same domain
- `--output=<file>` - Save output to file
- `--format=text|json` - Output format (default: text)
- `--headless=false` - Headless browser mode (default: true)
- `--jobs-dir=<dir>` - Jobs directory (default: `$TMPDIR/gai-cli-crawler`)
- `--help, -h` - Show help message

### Examples

```bash
# Quick crawl to stdout
crawler "https://example.com"

# Crawl with job persistence
crawler run "https://example.com" --depth=2 --same-domain

# List all past jobs
crawler list

# Show result of a past job
crawler result <job-id>
crawler result <job-id> --format=json

# Show job details and status
crawler status <job-id>

# Delete all jobs
crawler clear
```

## Output Format

### text (default)

```
1. Example Domain
   https://example.com

2. More information...
   https://www.iana.org/domains/reserved
```

### json

```json
{
  "url": "https://example.com",
  "title": "Example Domain",
  "children": [
    {
      "url": "https://www.iana.org/domains/reserved",
      "title": "More information...",
      "children": []
    }
  ]
}
```

## Job Lifecycle

`crawler run` tracks each crawl as a job through: `PENDING → PROCESSING → COMPLETED / FAILED`

Jobs are stored as JSON files under `--jobs-dir`:
```
$TMPDIR/gai-cli-crawler/
  pending/
  processing/
  completed/
  failed/
```

## Notes

- Uses patchright (undetected Chromium) for anti-bot bypass
- Blocks images, stylesheets, and fonts for faster loading
- Visited URLs are tracked to avoid duplicate fetches
- Depth controls how many levels of links are followed
