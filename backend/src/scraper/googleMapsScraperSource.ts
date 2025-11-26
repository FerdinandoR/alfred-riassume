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
      
      // Capture a debug screenshot after opening the reviews panel to see what
      // structure Google actually renders (helps debug container selector issues).
      try {
        await page.screenshot({ path: 'maps-debug-after-reviews.png', fullPage: true });
      } catch {
        // Screenshot failure should not break the main flow.
      }
      
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
    /**
     * Google Maps has changed its reviews panel structure multiple times. We try
     * multiple strategies in order:
     * 1. Look for containers with aria-labels mentioning reviews (historical)
     * 2. Look for scrollable containers that contain review items
     * 3. Look for the review items directly and infer their container
     *
     * This is intentionally defensive to handle various Maps UI versions.
     */
    const containerSelectors = [
      // Historical: divs with aria-label mentioning reviews
      'div[aria-label*="Google reviews"]',
      'div[aria-label*="Reviews"]',
      'div[aria-label*="Reviews for"]',
      // Alternative: look for scrollable containers that likely hold reviews
      'div[role="main"] div[style*="overflow"]',
      'div[data-review-id]',
      // Fallback: any scrollable div that contains review-like elements
      'div[style*="overflow-y"]',
    ];

    let containerSelector: string | null = null;
    for (const selector of containerSelectors) {
      try {
        const element = await page.waitForSelector(selector, {
          timeout: 5_000,
          state: 'visible',
        });
        if (element) {
          // Verify this container actually has review items
          const hasReviews = await page.evaluate((sel: string) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            return el.querySelectorAll('div[data-review-id]').length > 0;
          }, selector);
          if (hasReviews) {
            containerSelector = selector;
            break;
          }
        }
      } catch {
        // Try next selector
        continue;
      }
    }

    if (!containerSelector) {
      throw new Error(
        'Could not find reviews container. The reviews panel may have a different structure than expected.',
      );
    }

    const reviews: Review[] = [];
    let lastHeight = 0;

    // Debug: log how many review nodes we can find initially
    const initialReviewCount = await page.evaluate((selector: string) => {
      const container = document.querySelector(selector);
      if (!container) return 0;
      
      // Count using the same strategies as extraction
      let count = container.querySelectorAll('div[data-review-id]').length;
      if (count === 0) {
        const candidates = Array.from(
          container.querySelectorAll('div[role="listitem"], div[class*="review"], div[class*="Review"]'),
        );
        count = candidates.filter((el: Element) => {
          const hasRating = el.querySelector('[role="img"][aria-label*="star"], [aria-label*="star"]');
          const hasText = Array.from(el.querySelectorAll('span, div')).some(
            (span) => span.textContent && span.textContent.trim().length > 20
          );
          return hasRating && hasText;
        }).length;
      }
      return count;
    }, containerSelector);
    
    console.log(`[GoogleMapsScraper] Found ${initialReviewCount} potential review nodes in container`);

    while (reviews.length < MAX_REVIEWS) {
      const newReviews = await page.evaluate(
        (selector: string) => {
          const container = document.querySelector(selector);
          if (!container) return [];

          // Try multiple strategies to find review items
          // Google Maps uses various structures, so we try common patterns
          let reviewNodes: HTMLElement[] = [];
          
          // Strategy 1: data-review-id attribute (historical)
          reviewNodes = Array.from(
            container.querySelectorAll('div[data-review-id]'),
          ) as HTMLElement[];
          
          // Strategy 2: If no data-review-id, look for elements that contain
          // both a rating (star icon) and text content (likely a review)
          if (reviewNodes.length === 0) {
            const candidates = Array.from(
              container.querySelectorAll('div[role="listitem"], div[class*="review"], div[class*="Review"]'),
            ) as HTMLElement[];
            
            // Filter to only those that have both rating and text
            reviewNodes = candidates.filter((el) => {
              const hasRating = el.querySelector('[role="img"][aria-label*="star"], [aria-label*="star"]');
              const hasText = Array.from(el.querySelectorAll('span, div')).some(
                (span) => span.textContent && span.textContent.trim().length > 20
              );
              return hasRating && hasText;
            });
          }
          
          // Strategy 3: Look for any div that contains a star rating
          if (reviewNodes.length === 0) {
            const allDivs = Array.from(container.querySelectorAll('div')) as HTMLElement[];
            reviewNodes = allDivs.filter((div) => {
              const hasRating = div.querySelector('[role="img"][aria-label*="star"], [aria-label*="star"]');
              const textLength = div.textContent?.trim().length || 0;
              return hasRating && textLength > 30; // Must have substantial text
            });
          }

          return reviewNodes.map((node, index) => {
            // Generate a unique ID if data-review-id doesn't exist
            const id = node.getAttribute('data-review-id') || `review-${index}-${Date.now()}`;

            // Rating: look for aria-label like "5 stars" or "5 stelle"
            let rating = 0;
            const ratingNode =
              node.querySelector('[role="img"][aria-label*="star"]') ||
              node.querySelector('[aria-label*="star"]') ||
              node.querySelector('[aria-label*="stelle"]');
            
            if (ratingNode) {
              const aria = ratingNode.getAttribute('aria-label') || '';
              const match = aria.match(/(\d+(?:\.\d+)?)/);
              if (match) rating = Math.round(parseFloat(match[1]));
            }

            // Text: look for the longest text span/div within the review node
            // This is more reliable than specific jsname attributes
            const allTextNodes = Array.from(
              node.querySelectorAll('span, div, p')
            ) as HTMLElement[];
            
            let text = '';
            let maxLength = 0;
            for (const textNode of allTextNodes) {
              const content = textNode.textContent?.trim() || '';
              // Skip very short text (likely labels) and very long text (likely contains everything)
              if (content.length > maxLength && content.length > 20 && content.length < 2000) {
                // Prefer text that doesn't look like metadata (dates, names, etc.)
                if (!/^\d+\s*(year|month|day|week|ago|years|months|days|weeks)/i.test(content) &&
                    !/^[A-Z][a-z]+\s+[A-Z]/.test(content)) { // Not "John D" format
                  text = content;
                  maxLength = content.length;
                }
              }
            }
            
            // Fallback: if no good text found, use the node's direct text (excluding children)
            if (!text || text.length < 20) {
              const directText = Array.from(node.childNodes)
                .filter((n) => n.nodeType === Node.TEXT_NODE)
                .map((n) => n.textContent?.trim())
                .join(' ')
                .trim();
              if (directText.length > 20) {
                text = directText;
              }
            }

            // Author: look for text that looks like a name (typically near the top)
            let authorName: string | undefined = undefined;
            const authorCandidates = Array.from(
              node.querySelectorAll('div, span')
            ) as HTMLElement[];
            
            for (const candidate of authorCandidates) {
              const text = candidate.textContent?.trim() || '';
              // Name-like patterns: "First Last" or "First M. Last"
              if (text.length > 3 && text.length < 50 && 
                  /^[A-Z][a-z]+(\s+[A-Z][a-z]*\.?)?\s+[A-Z][a-z]+/.test(text)) {
                authorName = text;
                break;
              }
            }

            // Date: look for patterns like "2 months ago", "3 years ago", or date strings
            let date: string | undefined = undefined;
            const datePattern = /(\d+\s*(year|month|day|week|ago|years|months|days|weeks)\s*ago)|(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
            for (const textNode of allTextNodes) {
              const content = textNode.textContent?.trim() || '';
              if (datePattern.test(content)) {
                date = content;
                break;
              }
            }

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

      console.log(`[GoogleMapsScraper] Extracted ${newReviews.length} reviews from this batch`);
      
      for (const r of newReviews) {
        if (!r.text || !r.rating) {
          console.log(`[GoogleMapsScraper] Skipping review: text=${!!r.text}, rating=${r.rating}`);
          continue;
        }
        if (!reviews.find((existing) => existing.id === r.id)) {
          reviews.push(r);
        }
      }
      
      console.log(`[GoogleMapsScraper] Total unique reviews collected so far: ${reviews.length}`);

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


