const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({ headless: false }); // headless: false shows the browser window
  const page = await browser.newPage();
  const client = await page.createCDPSession();

  await client.send("Network.enable");

  client.on("Network.responseReceived", (event) => {
    console.log(event.response.url, event.response.status);
  });

  await page.goto("https://claude.ai/new"); // navigate wherever you want

  // Keep running — press Ctrl+C to stop
})();
