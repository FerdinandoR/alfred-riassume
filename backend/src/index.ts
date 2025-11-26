import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { analyzePlaceReviews } from './analysis/analyzer';
import { PlaceInput, ReportSummary, SourceMode } from './types';
import { streamReportPdf } from './pdf/reportPdf';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

type AnalyzeRequestBody = {
  url: string;
  sourceMode?: SourceMode;
};

app.post(
  '/api/analyze',
  async (req: Request<unknown, unknown, AnalyzeRequestBody>, res: Response) => {
    try {
      const { url, sourceMode } = req.body || {};
      if (!url) {
        return res.status(400).json({ error: 'Missing url.' });
      }

      const mode: SourceMode = sourceMode || 'scraper';
      const input: PlaceInput = { url };

      const { reviewsWithSentiment, summary } = await analyzePlaceReviews(
        mode,
        input,
      );

      return res.json({
        mode,
        report: summary,
        reviews: reviewsWithSentiment,
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({
        error: 'ANALYSIS_FAILED',
        message: err?.message || 'Unknown error.',
      });
    }
  },
);

type PdfRequestBody = {
  report: ReportSummary;
  placeName?: string;
};

app.post(
  '/api/report/pdf',
  (req: Request<unknown, unknown, PdfRequestBody>, res: Response) => {
    try {
      const { report, placeName } = req.body || {};
      if (!report) {
        return res.status(400).json({ error: 'Missing report.' });
      }
      streamReportPdf(res, report, placeName);
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({
        error: 'PDF_FAILED',
        message: err?.message || 'Unknown error.',
      });
    }
  },
);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on port ${PORT}`);
});


