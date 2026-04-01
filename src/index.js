#!/usr/bin/env node
/**
 * gai-cli-crawler - CLI tool for crawling web pages and extracting links
 *
 * Usage:
 *   crawler <url> [options]                  Quick crawl, no persistence
 *   crawler run <url> [options]              Crawl with job persistence
 *   crawler list [--jobs-dir=<dir>]          List all past jobs
 *   crawler status <job-id>                  Show job details
 *   crawler result <job-id> [--format=...]   Print result of a completed job
 *   crawler clear [--jobs-dir=<dir>]         Delete all jobs
 */

import * as cheerio from "cheerio";
import patchright from "patchright";
import {
    writeFileSync,
    readFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    unlinkSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const DEFAULT_DEPTH = 1;
const DEFAULT_MAX_LINKS = 10;
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_JOBS_DIR = join(tmpdir(), "gai-cli-crawler");

// ─── Job Manager ─────────────────────────────────────────────────────────────

function initJobDirs(jobsDir) {
    for (const sub of ["pending", "processing", "completed", "failed"]) {
        const dir = join(jobsDir, sub);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
}

function createJob(jobsDir, rootUrl, maxDepth, maxLinks, sameDomain) {
    const jobId = randomUUID();
    const job = {
        job_id: jobId,
        root_url: rootUrl,
        max_depth: maxDepth,
        max_links: maxLinks,
        same_domain: sameDomain,
        status: "PENDING",
        result: null,
        error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    writeFileSync(join(jobsDir, "pending", `${jobId}.json`), JSON.stringify(job, null, 2));
    return job;
}

function moveToProcessing(jobsDir, jobId) {
    const src = join(jobsDir, "pending", `${jobId}.json`);
    const dest = join(jobsDir, "processing", `${jobId}.json`);
    const job = JSON.parse(readFileSync(src, "utf-8"));
    job.status = "PROCESSING";
    job.updated_at = new Date().toISOString();
    unlinkSync(src);
    writeFileSync(dest, JSON.stringify(job, null, 2));
    return job;
}

function completeJob(jobsDir, jobId, result) {
    const src = join(jobsDir, "processing", `${jobId}.json`);
    const dest = join(jobsDir, "completed", `${jobId}.json`);
    const job = JSON.parse(readFileSync(src, "utf-8"));
    job.status = "COMPLETED";
    job.result = result;
    job.updated_at = new Date().toISOString();
    unlinkSync(src);
    writeFileSync(dest, JSON.stringify(job, null, 2));
    return job;
}

function failJob(jobsDir, jobId, error) {
    const src = join(jobsDir, "processing", `${jobId}.json`);
    const dest = join(jobsDir, "failed", `${jobId}.json`);
    const job = JSON.parse(readFileSync(src, "utf-8"));
    job.status = "FAILED";
    job.error = error;
    job.updated_at = new Date().toISOString();
    unlinkSync(src);
    writeFileSync(dest, JSON.stringify(job, null, 2));
    return job;
}

function getJob(jobsDir, jobId) {
    for (const sub of ["pending", "processing", "completed", "failed"]) {
        const p = join(jobsDir, sub, `${jobId}.json`);
        if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8"));
    }
    return null;
}

function listAllJobs(jobsDir) {
    const jobs = [];
    for (const sub of ["pending", "processing", "completed", "failed"]) {
        const dir = join(jobsDir, sub);
        if (!existsSync(dir)) continue;
        for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
            jobs.push(JSON.parse(readFileSync(join(dir, f), "utf-8")));
        }
    }
    return jobs.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function clearAllJobs(jobsDir) {
    for (const sub of ["pending", "processing", "completed", "failed"]) {
        const dir = join(jobsDir, sub);
        if (!existsSync(dir)) continue;
        for (const f of readdirSync(dir)) unlinkSync(join(dir, f));
    }
}

// ─── Crawler ─────────────────────────────────────────────────────────────────

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
        node.children = links.map((l) => ({ url: l.url, title: l.title, children: [] }));
    } else {
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

function formatOutput(root, format) {
    if (format === "json") return JSON.stringify(root, null, 2);
    const flat = flattenLinks(root);
    return Object.entries(flat)
        .map(([url, title], i) => `${i + 1}. ${title}\n   ${url}`)
        .join("\n\n");
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseFlags(args) {
    const flags = {
        depth: DEFAULT_DEPTH,
        maxLinks: DEFAULT_MAX_LINKS,
        sameDomain: false,
        output: null,
        format: "text",
        headless: true,
        jobsDir: DEFAULT_JOBS_DIR,
    };

    for (const arg of args) {
        if (arg.startsWith("--depth=")) flags.depth = parseInt(arg.split("=")[1], 10);
        else if (arg.startsWith("--max-links=")) flags.maxLinks = parseInt(arg.split("=")[1], 10);
        else if (arg === "--same-domain") flags.sameDomain = true;
        else if (arg.startsWith("--output=")) flags.output = arg.split("=")[1];
        else if (arg.startsWith("--format=")) flags.format = arg.split("=")[1];
        else if (arg.startsWith("--headless=")) flags.headless = arg.split("=")[1] !== "false";
        else if (arg.startsWith("--jobs-dir=")) flags.jobsDir = arg.split("=")[1];
    }

    return flags;
}

function printHelp() {
    console.log(`
crawler - CLI tool for crawling web pages and extracting links

Usage:
  crawler <url> [options]                   Quick crawl, output to stdout
  crawler run <url> [options]               Crawl with job persistence
  crawler list [--jobs-dir=<dir>]           List all past jobs
  crawler status <job-id>                   Show job details
  crawler result <job-id> [--format=...]    Print result of a completed job
  crawler clear [--jobs-dir=<dir>]          Delete all jobs

Crawl Options:
  --depth=N            Crawl depth (default: ${DEFAULT_DEPTH})
  --max-links=N        Max links per page (default: ${DEFAULT_MAX_LINKS})
  --same-domain        Only follow links on the same domain
  --output=<file>      Save output to file
  --format=text|json   Output format (default: text)
  --headless=false     Headless browser mode (default: true)
  --jobs-dir=<dir>     Jobs directory (default: ${DEFAULT_JOBS_DIR})
  --help, -h           Show this help message

Examples:
  crawler "https://example.com"
  crawler run "https://example.com" --depth=2 --same-domain
  crawler list
  crawler result <job-id> --format=json
  crawler clear
`);
}

async function cmdCrawl(args) {
    const url = args.find((a) => !a.startsWith("--"));
    const flags = parseFlags(args);

    if (!url) {
        console.error("Error: URL is required");
        process.exit(1);
    }
    try { new URL(url); } catch { console.error("Error: Invalid URL"); process.exit(1); }

    const root = await crawl(url, flags.depth, flags.maxLinks, flags.sameDomain, flags.headless);
    const output = formatOutput(root, flags.format);

    if (flags.output) {
        writeFileSync(flags.output, output, "utf-8");
        console.error(`Output saved to: ${flags.output}`);
    } else {
        console.log(output);
    }
}

async function cmdRun(args) {
    const url = args.find((a) => !a.startsWith("--"));
    const flags = parseFlags(args);

    if (!url) {
        console.error("Error: URL is required");
        process.exit(1);
    }
    try { new URL(url); } catch { console.error("Error: Invalid URL"); process.exit(1); }

    initJobDirs(flags.jobsDir);
    const job = createJob(flags.jobsDir, url, flags.depth, flags.maxLinks, flags.sameDomain);
    console.error(`Job created: ${job.job_id}`);

    moveToProcessing(flags.jobsDir, job.job_id);

    let root;
    try {
        root = await crawl(url, flags.depth, flags.maxLinks, flags.sameDomain, flags.headless);
        completeJob(flags.jobsDir, job.job_id, root);
        console.error(`Job completed: ${job.job_id}`);
    } catch (e) {
        failJob(flags.jobsDir, job.job_id, e.message);
        console.error(`Job failed: ${e.message}`);
        process.exit(1);
    }

    const output = formatOutput(root, flags.format);

    if (flags.output) {
        writeFileSync(flags.output, output, "utf-8");
        console.error(`Output saved to: ${flags.output}`);
    } else {
        console.log(output);
    }
}

function cmdList(args) {
    const flags = parseFlags(args);
    initJobDirs(flags.jobsDir);
    const jobs = listAllJobs(flags.jobsDir);

    if (jobs.length === 0) {
        console.log("No jobs found.");
        return;
    }

    console.log(`${"JOB ID".padEnd(38)} ${"STATUS".padEnd(12)} ${"DATE".padEnd(24)} URL`);
    console.log("-".repeat(100));
    for (const j of jobs) {
        const date = j.created_at.slice(0, 19).replace("T", " ");
        console.log(`${j.job_id.padEnd(38)} ${j.status.padEnd(12)} ${date.padEnd(24)} ${j.root_url}`);
    }
}

function cmdStatus(args) {
    const jobId = args.find((a) => !a.startsWith("--"));
    const flags = parseFlags(args);

    if (!jobId) { console.error("Error: job-id is required"); process.exit(1); }

    const job = getJob(flags.jobsDir, jobId);
    if (!job) { console.error(`Job not found: ${jobId}`); process.exit(1); }

    console.log(JSON.stringify({ ...job, result: job.result ? "(present)" : null }, null, 2));
}

function cmdResult(args) {
    const jobId = args.find((a) => !a.startsWith("--"));
    const flags = parseFlags(args);

    if (!jobId) { console.error("Error: job-id is required"); process.exit(1); }

    const job = getJob(flags.jobsDir, jobId);
    if (!job) { console.error(`Job not found: ${jobId}`); process.exit(1); }
    if (job.status !== "COMPLETED") { console.error(`Job is ${job.status}, not COMPLETED`); process.exit(1); }

    console.log(formatOutput(job.result, flags.format));
}

function cmdClear(args) {
    const flags = parseFlags(args);
    clearAllJobs(flags.jobsDir);
    console.log("All jobs cleared.");
}

async function main() {
    const [, , subcmd, ...rest] = process.argv;

    if (!subcmd || subcmd === "--help" || subcmd === "-h") {
        printHelp();
        process.exit(0);
    }

    switch (subcmd) {
        case "run":    await cmdRun(rest); break;
        case "list":   cmdList(rest); break;
        case "status": cmdStatus(rest); break;
        case "result": cmdResult(rest); break;
        case "clear":  cmdClear(rest); break;
        default:
            // Treat as quick crawl: crawler <url> [options]
            await cmdCrawl([subcmd, ...rest]);
    }
}

main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
});
