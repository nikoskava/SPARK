SPARK (web version 8.0) - phage x antibiotic interaction analysis
================================================================

Hosting
- Upload this whole folder as-is (index.html, app.js, spark_core.js, lib/, example_data_SPARK.xlsx).
- Static files only: no server-side code, no database, no cookies, no external requests.
- All analysis runs in the visitor's browser; no data is uploaded or stored.
- Any HTTPS web server works. If the CMS strips <script> tags from pages, upload the folder
  as files and link to index.html (or embed it in an iframe).
- To update: replace the folder contents.

Files
- index.html      the page
- app.js          user interface (table, charts, downloads)
- spark_core.js   the SPARK analysis (same calculations as spark_app_v3.py)
- lib/            Plotly.js 2.35.2 (MIT) and ExcelJS 4.4.0 (MIT)

Offline use: double-click index.html; it works without internet.
