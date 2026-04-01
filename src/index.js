#!/usr/bin/env node
/**
 * gai-cli-crawler - CLI tool for crawling web pages and extracting links
 *
 * Usage: crawler <url> [--depth=1] [--max-links=10] [--same-domain] [--output=file] [--format=text|json]
 */

import * as cheerio from "cheerio";
import patchright from "patchright";
import { writeFileSync } from "fs";

const DEFAULT_DEPTH = 1;
const DEFAULT_MAX_LINKS = 10;
const DEFAULT_TIMEOUT = 30000;

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        url: "",
        depth: DEFAULT_DEPTH,
        maxLinks: DEFAULT_MAX_LINKS,
        sameDomain: false,
        output: null,
        format: "text",
        headless: true,
    };

    for (const arg of args) {
        if (arg.startsWith("--depth=")) {
            options.depth = parseInt(arg.split("=")[1], 10);
        } else if (arg.startsWith("--max-links=")) {
            options.maxLinks = parseInt(arg.split("=")[1], 10);
        } else if (arg === "--same-domain") {
            options.sameDomain = true;
        } else if (arg.startsWith("--output=")) {
            options.output = arg.split("=")[1];
        } else if (arg.startsWith("--format=")) {
            options.format = arg.split("=")[1];
        } else if (arg.startsWith("--headless=")) {
            options.headless = arg.split("=")[1] !== "false";
        } else if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        } else if (!arg.startsWith("--")) {
            options.url = arg;
        }
    }

    if (!options.url) {
        console.error("Error: URL is required");
        printHelp();
        process.exit(1);
    }

    try {
        new URL(options.url);
    } catch {
        console.error("Error: Invalid URL");
        process.exit(1);
    }

    if (!["text", "json"].includes(options.format)) {
        console.error("Error: --format must be 'text' or 'json'");
        process.exit(1);
    }

    return options;
}

function printHelp() {
    console.log(`
crawler - CLI tool for crawling web pages and extracting links

Usage: crawler <url> [options]

Arguments:
  url                  Seed URL to start crawling (required)

Options:
  --depth=N            Crawl depth (default: ${DEFAULT_DEPTH})
  --max-links=N        Max links to follow per page (default: ${DEFAULT_MAX_LINKS})
  --same-domain        Only follow links on the same domain
  --output=<file>      Save output to file
  --format=text|json   Output format: flat text list or JSON tree (default: text)
  --headless=false     Headless browser mode (default: true)
  --help, -h           Show this help message

Examples:
  crawler "https://example.com"
  crawler "https://example.com" --depth=2 --max-links=5
  crawler "https://example.com" --same-domain --format=json
  crawler "https://example.com" --output=links.txt
`);
}

async function fetchHtml(url, headless, timeout = DEFAULT_TIMEOUT) {
    const browser = await patchright.chromium.launch({
        headless,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    try {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.route("**/*", async (route) => {
            const resourceType = route.request().resourceType();
            if (["image", "stylesheet", "font"].includes(resourceType)) {
                await route.abort();
            } else {
                await route.continue();
            }
        });

        await page.goto(url, { waitUntil: "domcontentloaded", timeout });
        const html = await page.content();

        await context.close();
        await browser.close();

        return html;
    } catch (error) {
        await browser.close();
        throw error;
    }
}

function getHostname(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
}

function extractLinks(html, baseHostname, sameDomain, maxLinks) {
    const $ = cheerio.load(html);
    const title =
        $("title").text().trim() ||
        $("h1").first().text().trim() ||
        baseHostname;

    const links = [];
    $("a[href]").each((_, el) => {
        if (links.length >= maxLinks) return false;
        const href = $(el).attr("href");
        const text = $(el).text().trim();
        if (!href || !href.startsWith("http")) return;
        if (sameDomain && getHostname(href) !== baseHostname) return;
        links.push({ url: href, title: text || href });
    });

    return { title, links };
}

async function crawl(url, depth, maxLinks, sameDomain, headless, visited = new Set()) {
    if (visited.has(url)) return { url, title: url, children: [] };
    visited.add(url);

    console.error(`Crawling (depth=${depth}): ${url}`);

    let html;
    try {
        html = await fetchHtml(url, headless);
    } catch (e) {
        console.error(`  Failed: ${e.message}`);
        return { url, title: url, children: [] };
    }

    const baseHostname = getHostname(url);
    const { title, links } = extractLinks(html, baseHostname, sameDomain, maxLinks);
    const node = { url, title, children: [] };

    if (depth <= 1) {
        // Leaf level: list links without fetching them
        node.children = links.map((l) => ({ url: l.url, title: l.title, children: [] }));
    } else {
        // Recurse into each child
        for (const link of links) {
            const child = await crawl(link.url, depth - 1, maxLinks, sameDomain, headless, visited);
            if (!child.title || child.title === link.url) child.title = link.title;
            node.children.push(child);
        }
    }

    return node;
}

function flattenLinks(node, result = {}) {
    result[node.url] = node.title;
    for (const child of node.children) {
        flattenLinks(child, result);
    }
    return result;
}

function formatText(flat) {
    return Object.entries(flat)
        .map(([url, title], i) => `${i + 1}. ${title}\n   ${url}`)
        .join("\n\n");
}

async function main() {
    const options = parseArgs();

    const root = await crawl(
        options.url,
        options.depth,
        options.maxLinks,
        options.sameDomain,
        options.headless
    );

    let output;
    if (options.format === "json") {
        output = JSON.stringify(root, null, 2);
    } else {
        const flat = flattenLinks(root);
        output = formatText(flat);
    }

    if (options.output) {
        writeFileSync(options.output, output, "utf-8");
        console.error(`Output saved to: ${options.output}`);
    } else {
        console.log(output);
    }
}

main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
});
