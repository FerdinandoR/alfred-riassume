export type Review = {
  id: string;
  authorName?: string;
  rating: number; // 1–5
  text: string;
  date?: string;
  language?: string;
  rawSourceMeta?: Record<string, unknown>;
};

export type ReviewSentiment = 'positive' | 'negative' | 'neutral';

export type ReviewWithSentiment = {
  review: Review;
  sentiment: ReviewSentiment;
};

export type RecurringIssue = {
  label: string;
  description: string;
  frequency: number;
  exampleReviewIds: string[];
};

export type RatingsHistogram = {
  [rating: number]: number;
};

export type SentimentCounts = {
  positive: number;
  negative: number;
  neutral: number;
};

export type ReportSummary = {
  placeName?: string;
  totalReviews: number;
  ratingsHistogram: RatingsHistogram;
  sentimentCounts: SentimentCounts;
  recurringIssues: RecurringIssue[];
  notes?: string;
};

export type SourceMode = 'scraper' | 'placesApi';

export type PlaceInput = {
  url?: string; // for scraper
  placeId?: string; // for future Places API integration
};

export interface ReviewSource {
  mode: SourceMode;
  fetchReviews(input: PlaceInput): Promise<Review[]>;
}


