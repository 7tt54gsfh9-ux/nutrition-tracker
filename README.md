# Nutrition Tracker

A self-contained, mobile-friendly nutrition diary. Log meals and drinks, scan barcodes via Open Food Facts, and track daily calories and macros. Everything is stored in the browser (`localStorage`) — no account or backend.

## Run locally

From this directory:

```bash
python3 -m http.server 8765
```

Then open **http://localhost:8765/** in your browser.

Any static server works (`npx serve`, `php -S`, etc.). Prefer **localhost** (or HTTPS) so the camera barcode scanner can access the device camera.

## Features

- **Today dashboard** — calorie ring vs daily goal, macro bars, entries grouped by meal
- **Add food** — name, meal type, serving, calories, optional protein/carbs/fat, notes
- **Barcode** — camera scan (html5-qrcode) or type/paste; lookup via [Open Food Facts](https://world.openfoodfacts.org/) API; form is prefilled and editable before save
- **Edit / delete** logged entries
- **History** — jump to previous days that have logs
- **Settings** — daily calorie goal (default 2000) and optional macro goals
- **Day navigation** — browse past days from the Today view

## Limitations

- **Camera** needs permission and a secure context (HTTPS or `localhost`). If the camera fails, use **Type / paste**.
- **Open Food Facts** coverage varies by country and product; some barcodes return no data or incomplete nutrition. You can always edit values or add food manually.
- Data lives only in **this browser’s localStorage** — clearing site data or using another device/browser will not carry it over.
- Nutrition values from barcodes are typically per serving or per 100 g as reported by the product database; double-check before relying on them.

## Files

| File        | Role                          |
|-------------|-------------------------------|
| `index.html`| App shell                     |
| `styles.css`| Layout and theme              |
| `app.js`    | Logic, storage, API lookup    |
| `README.md` | This file                     |

No build step. `html5-qrcode` is loaded from a CDN.
