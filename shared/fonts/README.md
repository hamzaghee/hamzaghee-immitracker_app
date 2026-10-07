# Fonts

Mulish, the typeface named by the Immitracker design system v1.0.

`mulish-latin.woff2` and `mulish-latin-ext.woff2` are Google Fonts' subsets of
the **variable** font, so one file per subset covers the whole 400–900 weight
axis — the system uses 400, 800 and 900, which would otherwise be three files.

Both are served to the dashboard, which picks between them by `unicode-range`.
Only the latin subset is embedded in the exported report
(`server/src/report/assets.js`), to keep every download smaller.

They live here rather than in `web/public/` because the server's report
renderer needs the same bytes the dashboard uses, and `shared/` is already
where this project puts things both sides read.

Licensed under the SIL Open Font License 1.1 — see `OFL.txt`.
Source: https://github.com/google/fonts/tree/main/ofl/mulish
