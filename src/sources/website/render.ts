import { log } from "../../logger.js";

export interface RenderedPage {
  html: string;
  finalUrl: string;
}

export interface PageRenderer {
  render(url: string): Promise<RenderedPage | null>;
  close(): Promise<void>;
}

export interface ChromiumRendererOptions {
  userAgent: string;
  timeoutMs: number;
  /** Path to a Chromium binary; the container installs one and sets RENDER_BROWSER_PATH. */
  executablePath?: string | undefined;
  /** Extra settle time after the network goes quiet, for late client-side paints. */
  settleMs: number;
}

/** Assets that never carry text we read; skipping them cuts a render to a fraction of the bytes. */
const SKIPPED_RESOURCES = new Set(["image", "media", "font"]);

/**
 * Renders a page in headless Chromium for sites that ship an empty shell plus
 * JavaScript. It is a fallback: the pipeline only reaches for it when a plain
 * fetch came back with no readable text, and never for a URL robots.txt refuses.
 *
 * The browser is started on first use and kept for the process; renders are
 * serialised so one queue of pages cannot open a dozen Chromiums at once.
 */
export class ChromiumRenderer implements PageRenderer {
  private browser: { newContext: (o: object) => Promise<BrowserContext>; close: () => Promise<void> } | null = null;
  private starting: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: ChromiumRendererOptions) {}

  async render(url: string): Promise<RenderedPage | null> {
    const run = this.queue.then(() => this.renderOne(url)).catch((err) => {
      log.warn("render failed", { url, error: (err as Error).message });
      return null;
    });
    this.queue = run;
    return run;
  }

  private async renderOne(url: string): Promise<RenderedPage | null> {
    await this.start();
    if (!this.browser) return null;
    const context = await this.browser.newContext({ userAgent: this.opts.userAgent, javaScriptEnabled: true });
    try {
      const page = await context.newPage();
      await page.route("**/*", (route) => {
        const type = route.request().resourceType();
        return SKIPPED_RESOURCES.has(type) ? route.abort() : route.continue();
      });
      const response = await page.goto(url, { waitUntil: "networkidle", timeout: this.opts.timeoutMs });
      if (this.opts.settleMs > 0) await page.waitForTimeout(this.opts.settleMs);
      const html = await page.content();
      return { html, finalUrl: response?.url() ?? url };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  private async start(): Promise<void> {
    if (this.browser) return;
    this.starting ??= (async () => {
      try {
        const { chromium } = (await import("playwright-core")) as unknown as { chromium: ChromiumLauncher };
        this.browser = await chromium.launch({
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
          ...(this.opts.executablePath ? { executablePath: this.opts.executablePath } : {}),
        });
      } catch (err) {
        // A missing browser must degrade to "we could not read this page", not crash the scan.
        log.warn("headless browser unavailable; pages needing JavaScript stay unreadable", { error: (err as Error).message });
      }
    })();
    await this.starting;
    this.starting = null;
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    await browser?.close().catch(() => undefined);
  }
}

interface Route {
  request(): { resourceType(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}

interface Page {
  route(pattern: string, handler: (route: Route) => Promise<void>): Promise<void>;
  goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<{ url(): string } | null>;
  waitForTimeout(ms: number): Promise<void>;
  content(): Promise<string>;
}

interface BrowserContext {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

interface ChromiumLauncher {
  launch(opts: { args: string[]; executablePath?: string }): Promise<{ newContext: (o: object) => Promise<BrowserContext>; close: () => Promise<void> }>;
}
