import { chromium, Browser, Page } from 'playwright';
import { PlaceInput, Review, ReviewSource, SourceMode } from '../types';

const MAX_REVIEWS = 500;
const NAVIGATION_TIMEOUT_MS = 60_000;

export class GoogleMapsScraperSource implements ReviewSource {
  public readonly mode: SourceMode = 'scraper';

  async fetchReviews(input: PlaceInput): Promise<Review[]> {
    if (!input.url || !this.isValidMapsUrl(input.url)) {
      throw new Error('Invalid Google Maps place URL.');
    }

    const browser = await chromium.launch({
      headless: true,
    });
    // Use a browser context to configure user agent and viewport instead of
    // calling page.setUserAgent (which does not exist in Playwright).
    const context = await browser.newContext({
      // Impersonate a regular desktop Chrome on Windows.
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      // Force English UI where possible.
      locale: 'en-US',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    let page: Page | null = null;

    try {
      page = await context.newPage();
      // Ensure the URL explicitly requests English where Maps honors the `hl` parameter.
      let targetUrl = input.url;
      try {
        const u = new URL(input.url);
        if (!u.searchParams.has('hl')) {
          u.searchParams.set('hl', 'en');
          targetUrl = u.toString();
        }
      } catch {
        // If URL parsing fails, fall back to the original input URL.
      }

      await page.goto(targetUrl, {
        timeout: NAVIGATION_TIMEOUT_MS,
        waitUntil: 'networkidle',
      });

      // Some regions / sessions show an interstitial (e.g. cookie consent or
      // "Before you continue to Google Maps") that hides the main UI. Try to
      // dismiss those before looking for the Reviews control.
      await this.dismissInterstitals(page);

      // Capture a debug screenshot of what headless Playwright actually sees.
      // This is very helpful when selectors fail, so we can inspect whether
      // there is a consent wall, a different layout, etc.
      try {
        await page.screenshot({ path: 'maps-debug.png', fullPage: true });
      } catch {
        // Screenshot failure should not break the main flow.
      }

      await this.openReviewsPanel(page);
      const reviews = await this.scrapeReviews(page);
      return reviews;
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }

  private isValidMapsUrl(url: string): boolean {
    try {
      const u = new URL(url);
      return u.hostname.includes('google.') && u.pathname.includes('/maps');
    } catch {
      return false;
    }
  }

  /**
   * Best-effort handling of common Google Maps interstitials (cookie consent,
   * "Before you continue" screens, etc.) that may appear only in headless
   * sessions and prevent us from seeing the actual place UI.
   *
   * This is intentionally defensive and safe to call on pages that do not
   * show any interstitials.
   */
  private async dismissInterstitals(page: Page): Promise<void> {
    try {
      const candidateButtons = [
        // English consent / continue buttons
        page.getByRole('button', { name: /Accept all/i }),
        page.getByRole('button', { name: /I agree/i }),
        page.getByRole('button', { name: /I accept/i }),
        page.getByRole('button', { name: /Agree/i }),
        page.getByRole('button', { name: /Continue/i }),
        // Italian / mixed locale variants (common for en-IT)
        page.getByRole('button', { name: /Accetta tutto/i }),
        page.getByRole('button', { name: /Accetta/i }),
        page.getByRole('button', { name: /Rifiuta tutto/i }),
      ];

      for (const buttonLocator of candidateButtons) {
        const count = await buttonLocator.count().catch(() => 0);
        if (count > 0) {
          await buttonLocator.first().click().catch(() => {});
          await page.waitForTimeout(2_000);
          break;
        }
      }
    } catch {
      // This is purely best-effort; ignore any errors here.
    }
  }

  private async openReviewsPanel(page: Page): Promise<void> {
    /**
     * Try to open the reviews panel.
     *
     * Google Maps is a highly dynamic SPA and its DOM / ARIA attributes change
     * fairly often, so we deliberately keep these selectors broad and layered:
     * - first, look for the historical jsaction hook
     * - then, any element that behaves like a button with an aria-label
     *   containing "review" in English
     *
     * If we cannot find *any* reasonable candidate, fail fast with a clear
     * error rather than silently continuing and timing out later.
     */
    const candidateLocators = [
      // Common pattern: a tab-style control labelled "Reviews"
      page.getByRole('tab', { name: /Reviews/i }),
      // Fallback: anything with visible text containing "Reviews"
      page.getByText('Reviews', { exact: false }),
      // Historical selector used by Google for the reviews dialog
      page.locator('[jsaction*=\"reviewDialog\"]'),
      // Current UI on your page: a div with specific classes and text "Reviews"
      page.locator('div.Gpq6kf.NlVald', { hasText: 'Reviews' }),
      // Generic role/button with an English aria-label mentioning reviews
      page.locator('[role=\"button\"][aria-label*=\"reviews\"]'),
      page.locator('button[aria-label*=\"reviews\"]'),
      page.locator('a[aria-label*=\"reviews\"]'),
    ];

    for (const locator of candidateLocators) {
      const count = await locator.count().catch(() => 0);
      if (count > 0) {
        await locator.first().click();
        // Give the panel a moment to animate / load.
        await page.waitForTimeout(3_000);
        return;
      }
    }

    throw new Error(
      'Could not find a Reviews button on this Google Maps page. ' +
        'Make sure the URL is a direct place page and that the UI exposes reviews.',
    );
  }

  private async scrapeReviews(page: Page): Promise<Review[]> {
    /**
     * Container holding the scrollable list of reviews.
     *
     * The aria-label text has changed over time (and can vary by locale), but
     * in English UIs it typically contains phrases like:
     * - "Google reviews"
     * - "Reviews"
     * - "Reviews for ..."
     *
     * We keep this selector intentionally broad for English while staying
     * restricted to divs that clearly describe a reviews section.
     */
    const containerSelector =
      'div[aria-label*=\"Google reviews\"], ' +
      'div[aria-label*=\"Reviews\"], ' +
      'div[aria-label*=\"Reviews for\"]';

    const container = await page.waitForSelector(containerSelector, {
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    if (!container) {
      throw new Error('Could not find reviews container.');
    }

    const reviews: Review[] = [];
    let lastHeight = 0;

    while (reviews.length < MAX_REVIEWS) {
      const newReviews = await page.evaluate(
        (selector: string) => {
          const container = document.querySelector(selector);
          if (!container) return [];

          const reviewNodes = Array.from(
            container.querySelectorAll('div[data-review-id]'),
          ) as HTMLElement[];

          return reviewNodes.map((node) => {
            const id = node.getAttribute('data-review-id') || '';

            // Rating: look for aria-label like "5 stars"
            const ratingNode =
              node.querySelector('[role=\"img\"][aria-label*=\"star\"]') ||
              node.querySelector('[aria-label*=\"stelle\"]');
            let rating = 0;
            if (ratingNode) {
              const aria = ratingNode.getAttribute('aria-label') || '';
              const match = aria.match(/(\\d+(?:\\.\\d+)?)/);
              if (match) rating = Math.round(parseFloat(match[1]));
            }

            const textNode =
              node.querySelector('[jsname=\"bN97Pc\"]') ||
              node.querySelector('[jsname=\"fbQN7e\"]') ||
              node.querySelector('span[jsname]');
            const text = textNode?.textContent?.trim() || '';

            const authorNode = node.querySelector('div[class*=\"d4r55\"]');
            const authorName = authorNode?.textContent?.trim() || undefined;

            const dateNode = node.querySelector('span[class*=\"rsqaWe\"]');
            const date = dateNode?.textContent?.trim() || undefined;

            return {
              id,
              authorName,
              rating,
              text,
              date,
              language: undefined,
              rawSourceMeta: {},
            };
          });
        },
        containerSelector,
      );

      for (const r of newReviews) {
        if (!r.text || !r.rating) continue;
        if (!reviews.find((existing) => existing.id === r.id)) {
          reviews.push(r);
        }
      }

      if (reviews.length >= MAX_REVIEWS) break;

      const currentHeight = await page.evaluate((selector: string) => {
        const container = document.querySelector(selector);
        if (!container) return 0;
        container.scrollBy(0, 1000);
        return container.scrollTop;
      }, containerSelector);

      if (currentHeight === lastHeight) {
        break;
      }
      lastHeight = currentHeight;
      await page.waitForTimeout(2_000);
    }

    return reviews;
  }
}


