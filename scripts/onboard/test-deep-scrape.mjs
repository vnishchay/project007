// Deep scraper test for a single business: Kashi Chat Bhandar
async function scrapeGoogle() {
  const q = encodeURIComponent("Kashi Chat Bhandar Godowlia Varanasi");
  const url = `https://www.google.com/search?q=${q}&hl=en&gl=in`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });

  console.log("Google Search status:", res.status);
  const html = await res.text();
  console.log("HTML length:", html.length);

  // Match rating and reviews
  const ratingMatch = html.match(/(\d\.\d)\s*★/) || html.match(/class="[^"]*AQ9Kn[^"]*"[^>]*>(\d\.\d)</);
  console.log("Rating:", ratingMatch ? ratingMatch[1] : "N/A");

  const revCountMatch = html.match(/([\d,]+)\s*Google reviews/i) || html.match(/([\d,]+)\s*reviews/i);
  console.log("Review Count:", revCountMatch ? revCountMatch[1] : "N/A");

  // Address
  const addrMatch = html.match(/Address<\/span>:\s*<span[^>]*>([^<]+)<\/span>/i) ||
                    html.match(/class="[^"]*Lrzca[^"]*"[^>]*>([^<]+)</i);
  console.log("Address:", addrMatch ? addrMatch[1] : "N/A");

  // Hours
  const hoursMatch = html.match(/Hours<\/span>:\s*<span[^>]*>([^<]+)<\/span>/i);
  console.log("Hours snippet:", hoursMatch ? hoursMatch[1] : "N/A");

  // Phone
  const phoneMatch = html.match(/Phone<\/span>:\s*<span[^>]*>([^<]+)<\/span>/i);
  console.log("Phone:", phoneMatch ? phoneMatch[1] : "N/A");
}

scrapeGoogle();
