import React, { useState } from 'react';

type RatingsHistogram = {
  [rating: number]: number;
};

type SentimentCounts = {
  positive: number;
  negative: number;
  neutral: number;
};

type RecurringIssue = {
  label: string;
  description: string;
  frequency: number;
  exampleReviewIds: string[];
};

type ReportSummary = {
  placeName?: string;
  totalReviews: number;
  ratingsHistogram: RatingsHistogram;
  sentimentCounts: SentimentCounts;
  recurringIssues: RecurringIssue[];
  notes?: string;
};

type Sentiment = 'positive' | 'negative' | 'neutral';

type ReviewWithSentiment = {
  review: {
    id: string;
    authorName?: string;
    rating: number;
    text: string;
    date?: string;
  };
  sentiment: Sentiment;
};

type AnalyzeResponse = {
  mode: 'scraper' | 'placesApi';
  report: ReportSummary;
  reviews: ReviewWithSentiment[];
};

export const App: React.FC = () => {
  const [url, setUrl] = useState('');
  const [sourceMode] = useState<'scraper' | 'placesApi'>('scraper');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalyzeResponse | null>(null);

  const handleAnalyze = async () => {
    setError(null);
    setData(null);

    if (!url.trim()) {
      setError('Please paste a Google Maps place URL.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), sourceMode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Request failed');
      }
      const json = (await res.json()) as AnalyzeResponse;
      setData(json);
    } catch (e: any) {
      setError(e.message || 'Unexpected error');
    } finally {
      setLoading(false);
    }
  };

  const handleExportPdf = async () => {
    if (!data) return;
    try {
      const res = await fetch('/api/report/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report: data.report,
          placeName: data.report.placeName,
        }),
      });
      if (!res.ok) {
        throw new Error('Failed to generate PDF');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'review-report.pdf';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || 'Failed to export PDF');
    }
  };

  const sentimentLabel = (s: Sentiment) =>
    s.charAt(0).toUpperCase() + s.slice(1);

  return (
    <div className="app-root">
      <header className="app-header">
        <h1>Google Maps Review Analyzer</h1>
        <p>
          Paste a Google Maps company URL to scrape reviews, analyze
          sentiment with Groq, and generate a PDF report.
        </p>
      </header>

      <section className="card">
        <label className="field-label" htmlFor="url-input">
          Google Maps place URL
        </label>
        <input
          id="url-input"
          className="text-input"
          type="url"
          placeholder="https://www.google.com/maps/place/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />

        <div className="mode-row">
          <span className="mode-label">Source mode</span>
          <div className="mode-options">
            <label className="mode-option">
              <input
                type="radio"
                name="mode"
                value="scraper"
                checked
                readOnly
              />
              Headless scraper (current)
            </label>
            <label className="mode-option disabled">
              <input type="radio" name="mode" value="placesApi" disabled />
              Google Places API (coming soon)
            </label>
          </div>
        </div>

        <button
          className="primary-btn"
          onClick={handleAnalyze}
          disabled={loading}
        >
          {loading ? 'Analyzing…' : 'Analyze'}
        </button>

        {error && <div className="error-banner">{error}</div>}
      </section>

      {data && (
        <section className="results">
          <div className="results-header">
            <h2>Report</h2>
            <button className="secondary-btn" onClick={handleExportPdf}>
              Export as PDF
            </button>
          </div>

          <div className="grid">
            <div className="card">
              <h3>Overview</h3>
              <p>
                <strong>Total reviews:</strong> {data.report.totalReviews}
              </p>
            </div>

            <div className="card">
              <h3>Ratings distribution</h3>
              <ul className="list">
                {[1, 2, 3, 4, 5].map((stars) => {
                  const count = data.report.ratingsHistogram[stars] || 0;
                  const total = data.report.totalReviews || 1;
                  const pct = ((count / total) * 100).toFixed(1);
                  return (
                    <li key={stars}>
                      <strong>{stars}★</strong> – {count} ({pct}%)
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="card">
              <h3>Sentiment breakdown</h3>
              <ul className="list">
                {(['positive', 'negative', 'neutral'] as Sentiment[]).map(
                  (s) => {
                    const count = data.report.sentimentCounts[s] || 0;
                    const total = data.report.totalReviews || 1;
                    const pct = ((count / total) * 100).toFixed(1);
                    return (
                      <li key={s}>
                        <strong>{sentimentLabel(s)}</strong> – {count} (
                        {pct}%)
                      </li>
                    );
                  },
                )}
              </ul>
            </div>

            <div className="card">
              <h3>Key recurring themes</h3>
              {data.report.recurringIssues.length === 0 ? (
                <p>No clear recurring issues detected.</p>
              ) : (
                <ul className="list">
                  {data.report.recurringIssues.map((issue, idx) => (
                    <li key={idx}>
                      <strong>
                        {issue.label} ({issue.frequency} mentions)
                      </strong>
                      <br />
                      <span>{issue.description}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      <footer className="app-footer">
        <span>
          Current mode: <strong>Headless scraping</strong>. Google Places
          API mode is planned.
        </span>
      </footer>
    </div>
  );
};


