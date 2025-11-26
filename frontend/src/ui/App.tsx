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

type LogLevel = 'info' | 'error';

type LogEntry = {
  id: number;
  level: LogLevel;
  message: string;
};

export const App: React.FC = () => {
  const [url, setUrl] = useState('');
  const [sourceMode] = useState<'scraper' | 'placesApi'>('scraper');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logCounter, setLogCounter] = useState(0);

  const pushLog = (message: string, level: LogLevel = 'info') => {
    setLogCounter((prev) => prev + 1);
    const id = logCounter + 1;
    setLogs((prev) => [...prev, { id, level, message }]);
  };

  const handleAnalyze = async () => {
    setError(null);
    setData(null);
    setLogs([]);
    pushLog('Starting analysis for the provided Google Maps place URL…');

    if (!url.trim()) {
      const msg = 'Validation failed: please paste a Google Maps place URL.';
      setError(msg);
      pushLog(msg, 'error');
      return;
    }

    setLoading(true);
    pushLog('Sending request to backend and starting headless scraping…');
    pushLog(
      'Backend will launch a headless browser, open the reviews panel, scroll to load reviews, and then run Groq analysis. This can take up to ~60 seconds for busy places.',
    );

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), sourceMode }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const backendMessage =
          errBody.message ||
          errBody.error ||
          'Backend returned a non‑OK status.';
        pushLog(`Backend error during analysis: ${backendMessage}`, 'error');
        throw new Error(backendMessage);
      }

      pushLog('Backend finished scraping, now returning analysis results…');
      const json = (await res.json()) as AnalyzeResponse;
      setData(json);
      pushLog(
        `Analysis completed. Retrieved ${json.report.totalReviews} reviews and computed sentiment + recurring themes.`,
      );
    } catch (e: any) {
      const msg = e?.message || 'Unexpected error during analysis.';
      setError(msg);
      pushLog(msg, 'error');
    } finally {
      setLoading(false);
      pushLog('Analysis request finished.');
    }
  };

  const handleExportPdf = async () => {
    if (!data) return;
    pushLog('Requesting PDF generation from backend…');
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
        const errBody = await res.json().catch(() => ({}));
        const backendMessage =
          errBody.message ||
          errBody.error ||
          'Failed to generate PDF on backend.';
        pushLog(`Backend error during PDF generation: ${backendMessage}`, 'error');
        throw new Error(backendMessage);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'review-report.pdf';
      a.click();
      window.URL.revokeObjectURL(url);
      pushLog('PDF generated and download started.');
    } catch (e: any) {
      const msg = e?.message || 'Failed to export PDF.';
      setError(msg);
      pushLog(msg, 'error');
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

        {logs.length > 0 && (
          <div className="log-panel" aria-live="polite">
            <h3 className="log-panel-title">Activity log</h3>
            <ul className="log-list">
              {logs.map((log) => (
                <li
                  key={log.id}
                  className={`log-entry log-entry-${log.level}`}
                >
                  {log.message}
                </li>
              ))}
            </ul>
          </div>
        )}
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


