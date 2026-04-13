// capture.js script to help with data collection to identify patterns in network traffic
// mostly generated with copilot, comments explaining each line

const puppeteer = require("puppeteer"); // node js library that allows for monitoring network requests

const fs = require("fs"); // library to write files

(async () => {
  const headers = [
    "date",
    "direction",
    "type",
    "url",
    "status",
    "method",
    "mimeType",
    "encodedDataLength",
    "remoteIPAddress",
    "protocol",
  ]; // empty csv template

  // write the header row immediately
  const date_time = new Date().toLocaleTimeString();
  const output = `./data/${date_time}_output.csv`;
  fs.writeFileSync(output, headers.join(",") + "\n");

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled", // hides automation flag
    ],
    ignoreDefaultArgs: ["--enable-automation"], // removes automation mode
  }); // headless: false shows the browser window, starts the browser
  const page = await browser.newPage(); //
  const client = await page.createCDPSession(); // starts a Chrome Devtools Protocol session attached to the page

  await client.send("Network.enable"); // tells the CDP session to start monitoring network traffic

  client.on("Network.requestWillBeSent", (event) => {
    const row = [
      new Date().toLocaleTimeString(),
      "request",
      event.type,
      event.request.url,
      "",
      event.request.method,
      "",
      "",
      "",
      "",
    ];
    fs.appendFileSync(output, row.join(",") + "\n");
  });

  client.on("Network.responseReceived", (event) => {
    console.log(event.response.url, event.response.status);

    const row = [
      new Date().toLocaleTimeString(),
      "response",
      event.type,
      event.response.url,
      event.response.status,
      "",
      event.response.mimeType,
      event.response.encodedDataLength,
      event.response.remoteIPAddress,
      event.response.protocol,
    ];

    fs.appendFileSync(output, row.join(",") + "\n"); // log the response to the csv
  });

  await page.goto("https://claude.ai/new"); // open claude
})();
