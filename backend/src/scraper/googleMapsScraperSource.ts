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

    const browser = await chromium.launch({ headless: true });
    let page: Page | null = null;

    try {
      page = await browser.newPage();
      await page.goto(input.url, { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: 'networkidle' });

      await this.openReviewsPanel(page);
      const reviews = await this.scrapeReviews(page);
      return reviews;
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
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

  private async openReviewsPanel(page: Page): Promise<void> {
    // Try clicking the reviews button; selectors can change over time, so we keep this defensive.
    const reviewsButtonSelectors = [
      'button[jsaction*=\"reviewDialog\"]',
      'button[aria-label*=\"reviews\"]',
      'button[aria-label*=\"Recensioni\"]',
    ];

    for (const selector of reviewsButtonSelectors) {
      const button = await page.$(selector);
      if (button) {
        await button.click();
        await page.waitForTimeout(3_000);
        return;
      }
    }
  }

  private async scrapeReviews(page: Page): Promise<Review[]> {
    const containerSelector = 'div[aria-label*=\"Google reviews\"], div[aria-label*=\"Reviews\"]';

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


