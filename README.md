## Google Maps Review Analyzer

Web app that takes a Google Maps company URL, scrapes its reviews with a headless browser, analyzes sentiment and recurring themes using Groq, and lets you export a PDF report.

### Features

- **Input**: Paste a Google Maps place URL.
- **Headless scraping**: Loads the page and extracts up to a capped number of reviews.
- **Sentiment analysis (Groq)**:
  - Classifies each review as **positive**, **negative**, or **neutral**.
  - Counts how many reviews fall into each sentiment bucket.
- **Ratings breakdown**:
  - Counts how many ratings there are for each star value (1–5).
- **Recurring themes**:
  - Identifies frequently mentioned **requests, complaints, and recommendations**.
  - Shows how many mentions each theme has.
- **PDF export**:
  - Generates a PDF summarizing the distribution, sentiments, and key recurring themes.
- **Future ready**:
  - Backend is structured so a **Google Places API** data source can be added alongside scraping.

### Tech stack

- **Backend**: Node.js + TypeScript, Express, Playwright, PDFKit
- **Frontend**: React + TypeScript (Vite)
- **LLM**: Groq chat completions API

### Setup

1. **Install prerequisites**

   - Node.js 18+ and npm
   - Playwright browser dependencies (Playwright will guide you via `npx playwright install` once npm is available).

2. **Clone this project into**

   `C:\Users\ferdi\coding\alfred-riassume`

3. **Configure environment variables**

   - You have a file: `C:\Users\ferdi\Desktop\groq.txt` that contains your Groq API key.
   - Create a `.env` file in the `backend` directory:

   ```bash
   GROQ_API_KEY=your_key_from_groq_dot_txt
   PORT=4000
   ```

   Do **not** commit the `.env` file.

4. **Install dependencies**

   From the project root:

   ```bash
   cd C:\Users\ferdi\coding\alfred-riassume
   npm install
   cd backend && npm install
   cd ../frontend && npm install
   ```

5. **Run the backend**

   ```bash
   cd backend
   npm run dev
   ```

6. **Run the frontend**

   In another terminal:

   ```bash
   cd frontend
   npm run dev
   ```

   Open the URL Vite prints (typically `http://localhost:5173`).

### Usage

1. Paste a **Google Maps company URL** into the input field.
2. Keep the **Headless scraper** mode selected (Google Places API is marked as “coming soon”).
3. Click **Analyze**.
4. Wait while the backend:
   - Launches Playwright headless browser.
   - Loads reviews (up to a cap).
   - Calls Groq to classify sentiment and detect recurring themes.
5. View the resulting:
   - Ratings histogram.
   - Sentiment breakdown.
   - Recurring issues / recommendations.
6. Click **Export as PDF** to download a PDF report.

### Design notes and future Google Places API mode

- **Review source abstraction**
  - Backend defines a `ReviewSource` interface and currently implements `GoogleMapsScraperSource` for `sourceMode = 'scraper'`.
  - The analysis pipeline only depends on this abstraction, not on scraping details.
  - Later you can add a `GooglePlacesApiSource` that:
    - Takes a Place ID or search string.
    - Calls the official Google Places API.
    - Returns normalized `Review` objects.

- **UI considerations**
  - The frontend already shows a disabled **Google Places API (coming soon)** option.
  - Enabling it later is just a matter of wiring that option to `sourceMode = 'placesApi'` and adding any extra inputs (e.g. Place ID).

- **Configuration**
  - The code is prepared to support another `SourceMode` (`'placesApi'`), but currently only the scraper is implemented.
  - When you add Google Places API, extend the `.env` with:

  ```bash
  GOOGLE_MAPS_API_KEY=your_google_api_key
  ```

  and register a `placesApi` `ReviewSource` in the backend.


