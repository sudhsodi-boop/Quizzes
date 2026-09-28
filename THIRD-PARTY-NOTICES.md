# Third-party notices

Quizzes uses original app branding. It is not affiliated with Kahoot or the other products referenced in the design review.

## QR generation

- Component: `qrcode-generator`, version **2.0.4**, by Kazuhiko Arase.
- Source: https://github.com/kazuhikoarase/qrcode-generator and the published npm package `qrcode-generator@2.0.4`.
- Distribution: upstream `dist/qrcode.js` is vendored **unmodified** as `qr-code.js`. No runtime CDN or external QR service is used.
- License: MIT; see `QR-CODE-LICENSE.txt` and the retained source header.
- SHA-256 of the vendored file: `79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c`.
- The term “QR Code” is a registered trademark of DENSO WAVE INCORPORATED.

## Gujarati font

Noto Sans Gujarati is embedded in the stylesheet for offline/private rendering without a font CDN. The SIL Open Font License 1.1 is supplied in `FONT-LICENSE.txt`. Retain it when redistributing the application.

## Other dependencies

The application’s npm dependencies and exact resolved versions are recorded in `package.json` and `package-lock.json`. Their license files are included in the installed packages. This notice does not replace those licenses. Test tools are development-only dependencies.
