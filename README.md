---
name: crawler
description: "CLI tool for crawling web pages and extracting links. Use when: you need to discover all links on a site or map a site's link structure. NOT for: full-page content scraping (use scraper instead)."
homepage: https://github.com/kakkoii1337/gai-cli-crawler
---

# crawler

CLI tool for crawling web pages and extracting links. Builds a `LinkNode` tree (url, title, children) using patchright and cheerio.

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
crawler <url> [options]
```

### Arguments

- `url` - Seed URL to start crawling (required)

### Options

- `--depth=N` - Crawl depth (default: 1)
- `--max-links=N` - Max links to follow per page (default: 10)
- `--same-domain` - Only follow links on the same domain
- `--output=<file>` - Save output to file
- `--format=text|json` - Output format: flat text list or JSON tree (default: text)
- `--headless=false` - Headless browser mode (default: true)
- `--help, -h` - Show help message

### Examples

```bash
# Crawl and list links (depth 1)
crawler "https://example.com"

# Crawl 2 levels deep, limit 5 links per page
crawler "https://example.com" --depth=2 --max-links=5

# Only follow same-domain links, output as JSON
crawler "https://example.com" --same-domain --format=json

# Save results to file
crawler "https://example.com" --output=links.txt
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

## Notes

- Uses patchright (undetected Chromium) for anti-bot bypass
- Blocks images, stylesheets, and fonts for faster loading
- Visited URLs are tracked to avoid duplicate fetches
- Depth controls how many levels of links are followed
