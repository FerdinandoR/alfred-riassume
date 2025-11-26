import PDFDocument from 'pdfkit';
import { ReportSummary } from '../types';
import { Response } from 'express';

export function streamReportPdf(
  res: Response,
  report: ReportSummary,
  placeName?: string,
) {
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="review-report.pdf"`,
  );

  doc.pipe(res);

  const title = placeName || report.placeName || 'Google Maps Location';

  doc.fontSize(20).text(`Review Analysis Report`, { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(14).text(title, { align: 'center' });
  doc.moveDown();

  doc.fontSize(12).text(`Generated at: ${new Date().toISOString()}`);
  doc.moveDown();

  // Ratings distribution
  doc.fontSize(16).text('Ratings distribution', { underline: true });
  doc.moveDown(0.5);
  const total = report.totalReviews || 1;
  Object.entries(report.ratingsHistogram)
    .sort(([a], [b]) => Number(a) - Number(b))
    .forEach(([stars, count]) => {
      const pct = ((count / total) * 100).toFixed(1);
      doc
        .fontSize(12)
        .text(`${stars} stars: ${count} reviews (${pct}%)`);
    });
  doc.moveDown();

  // Sentiment breakdown
  doc.fontSize(16).text('Sentiment breakdown', { underline: true });
  doc.moveDown(0.5);
  const sc = report.sentimentCounts;
  const addSentiment = (label: string, count: number) => {
    const pct = ((count / total) * 100).toFixed(1);
    doc.fontSize(12).text(`${label}: ${count} reviews (${pct}%)`);
  };
  addSentiment('Positive', sc.positive);
  addSentiment('Negative', sc.negative);
  addSentiment('Neutral', sc.neutral);
  doc.moveDown();

  // Recurring issues
  if (report.recurringIssues.length) {
    doc
      .fontSize(16)
      .text('Key recurring requests / complaints / recommendations', {
        underline: true,
      });
    doc.moveDown(0.5);
    report.recurringIssues.forEach((issue, idx) => {
      doc
        .fontSize(13)
        .text(`${idx + 1}. ${issue.label} (${issue.frequency} mentions)`, {
          continued: false,
        });
      doc.moveDown(0.25);
      doc.fontSize(12).text(issue.description);
      doc.moveDown();
    });
  }

  if (report.notes) {
    doc.fontSize(14).text('Notes', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).text(report.notes);
  }

  doc.end();
}


