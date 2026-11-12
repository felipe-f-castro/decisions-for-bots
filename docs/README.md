# README screenshots — iteration 3

- `inbox-desktop.png` — 1185 × 1557 CSS pixels, full-page capture of the live production demo.
- `inbox-mobile.png` — 390 × 1600 CSS pixels, a read-only frame of the production server's rendered demo HTML.
- `sign-in.png` — 1200 × 1170 CSS pixels, live production-build email sign-in screen with dummy keys and a loopback Supabase URL. No email was sent and no live backend was used.

All were refreshed for the Supabase iteration. The inbox captures show the explicit **Demo mode** banner, auth bypass, generic seed questions, and local SVG logo examples. They contain no private decisions or credentials.

The production server was started with Supabase variables absent and reset after the HTTP smoke test. The connected browser allowed navigation and screenshots, but session policy denied resizing and interactive input; the CLI browser also could not launch under the macOS sandbox. For the phone capture, the same server-rendered HTML, CSS, fonts, and images were served in a fixed-width local preview. Scripts were removed from that preview to keep it read-only. A 320px frame was also visually reviewed; its extra QA image is ignored under `output/playwright/`.

Screenshots document appearance. API behavior was checked through real production HTTP requests, and answer/edit/undo/filter/add interactions through JSDOM against real API handlers. Hosted Supabase email delivery and interactive browser auth have not been verified.

To refresh in an unrestricted environment, start a fresh demo server without Supabase credentials and capture the live page at desktop and phone widths after fonts and entry animations settle. Keep samples generic and put extra review artifacts in ignored `output/playwright/`.
