import {
  PlaceInput,
  RatingsHistogram,
  ReportSummary,
  Review,
  ReviewSentiment,
  ReviewSource,
  ReviewWithSentiment,
  SentimentCounts,
  SourceMode,
} from '../types';
import { GoogleMapsScraperSource } from '../scraper/googleMapsScraperSource';
import { classifySentiments, detectRecurringIssues } from '../groq/groqClient';

type SourcesRegistry = {
  scraper: ReviewSource;
  placesApi?: ReviewSource;
};

const sources: SourcesRegistry = {
  scraper: new GoogleMapsScraperSource(),
};

function selectSource(mode: SourceMode): ReviewSource {
  if (mode === 'scraper') return sources.scraper;
  if (mode === 'placesApi' && sources.placesApi) return sources.placesApi;
  // For now, if placesApi is requested but not implemented, fall back to scraper.
  return sources.scraper;
}

function buildRatingsHistogram(reviews: Review[]): RatingsHistogram {
  const hist: RatingsHistogram = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of reviews) {
    const rating = Math.round(r.rating);
    if (rating >= 1 && rating <= 5) {
      hist[rating] = (hist[rating] || 0) + 1;
    }
  }
  return hist;
}

function buildSentimentCounts(
  items: ReviewWithSentiment[],
): SentimentCounts {
  const counts: SentimentCounts = {
    positive: 0,
    negative: 0,
    neutral: 0,
  };

  for (const item of items) {
    const s: ReviewSentiment = item.sentiment;
    counts[s] += 1;
  }
  return counts;
}

export async function analyzePlaceReviews(
  mode: SourceMode,
  input: PlaceInput,
): Promise<{
  reviewsWithSentiment: ReviewWithSentiment[];
  summary: ReportSummary;
}> {
  const source = selectSource(mode);
  const reviews: Review[] = await source.fetchReviews(input);

  if (!reviews.length) {
    return {
      reviewsWithSentiment: [],
      summary: {
        placeName: undefined,
        totalReviews: 0,
        ratingsHistogram: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        sentimentCounts: {
          positive: 0,
          negative: 0,
          neutral: 0,
        },
        recurringIssues: [],
        notes: 'No reviews found.',
      },
    };
  }

  const reviewsWithSentiment = await classifySentiments(reviews);
  const recurringIssues = await detectRecurringIssues(
    reviewsWithSentiment,
  );
  const ratingsHistogram = buildRatingsHistogram(reviews);
  const sentimentCounts = buildSentimentCounts(reviewsWithSentiment);

  const summary: ReportSummary = {
    placeName: undefined,
    totalReviews: reviews.length,
    ratingsHistogram,
    sentimentCounts,
    recurringIssues,
    notes: undefined,
  };

  return { reviewsWithSentiment, summary };
}


