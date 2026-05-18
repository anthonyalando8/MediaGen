"""
chromium_pool.py
----------------
Manages a pool of headless Chromium instances for parallel frame rendering.

Chromium launch flags for deterministic rendering:
  --disable-gpu-vsync                 → disable vsync
  --disable-frame-rate-limit          → remove FPS cap
  --run-all-compositor-stages-before-draw → flush all compositing before paint
  --disable-smooth-scrolling          → no smooth scroll animations
  --force-color-profile=srgb          → consistent color rendering
"""

from playwright.async_api import async_playwright, Page, Browser


# ── Chromium launch arguments ────────────────────────────────────
CHROMIUM_ARGS = [
    "--disable-gpu-vsync",
    "--disable-frame-rate-limit",
    "--run-all-compositor-stages-before-draw",
    "--disable-smooth-scrolling",
    "--force-color-profile=srgb",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--no-sandbox",
    "--disable-setuid-sandbox",
]


class ChromiumPool:
    """
    Manages one or more headless Chromium browser instances.
    Each instance handles one render job at a time.

    Usage:
        pool = ChromiumPool(runtime_url="http://localhost:5173")
        await pool.launch(workers=2)
        page = await pool.get_page()
        # ... use page ...
        await pool.shutdown()
    """

    def __init__(
        self,
        runtime_url: str = "http://localhost:5173",
        stage_width:  int = 1080,
        headless:    bool = True,
    ):
        self.runtime_url = runtime_url
        self.stage_width = stage_width
        self.headless    = headless

        self._playwright = None
        self._browsers:  list[Browser] = []
        self._pages:     list[Page]    = []
        self._available: list[Page]    = []

    async def launch(self, workers: int = 1):
        """Launch `workers` Chromium instances."""
        self._playwright = await async_playwright().start()

        stage_height = int(self.stage_width * (420 / 360))

        for _ in range(workers):
            browser = await self._playwright.chromium.launch(
                headless=self.headless,
                args=CHROMIUM_ARGS,
            )
            context = await browser.new_context(
                viewport={
                    "width":  self.stage_width,
                    "height": stage_height,
                },
                device_scale_factor=1,
                # Ensure consistent color rendering
                color_scheme="dark",
            )
            page = await context.new_page()

            # Set explicit timeout for all operations
            page.set_default_timeout(30_000)
            page.set_default_navigation_timeout(30_000)

            self._browsers.append(browser)
            self._pages.append(page)
            self._available.append(page)

        print(f"[ChromiumPool] Launched {workers} Chromium instance(s)")

    async def get_page(self) -> Page:
        """Get an available page. Blocks until one is free."""
        while not self._available:
            import asyncio
            await asyncio.sleep(0.05)
        return self._available.pop(0)

    def release_page(self, page: Page):
        """Return a page to the available pool."""
        if page in self._pages:
            self._available.append(page)

    async def shutdown(self):
        """Close all browsers and stop Playwright."""
        for browser in self._browsers:
            try:
                await browser.close()
            except Exception:
                pass

        if self._playwright:
            await self._playwright.stop()

        self._browsers.clear()
        self._pages.clear()
        self._available.clear()
        print("[ChromiumPool] Shutdown complete")

    @property
    def pool_size(self) -> int:
        return len(self._browsers)

    @property
    def available_count(self) -> int:
        return len(self._available)