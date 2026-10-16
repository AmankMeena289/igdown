# Insta Downloader

A small Express app that retrieves image or video media from public Instagram posts and Reels using Apify's Instagram Scraper.

## Run locally

1. Install [Node.js](https://nodejs.org/).
2. From the project folder, install dependencies:

   ```sh
   npm install
   ```

3. Create an [Apify account](https://console.apify.com/sign-up), then copy your API token from [Apify settings](https://console.apify.com/account/integrations).
4. In PowerShell, create the private environment file and open it:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

   Replace the placeholder with your token, then save and close Notepad:

   ```text
   APIFY_TOKEN=your-apify-api-token
   ```

5. Start the app and open [http://localhost:3000](http://localhost:3000):

   ```sh
   npm start
   ```

## Deploy to Render

The included [`render.yaml`](./render.yaml) configures a free Render web service and asks Render to enter the API token privately during setup.

1. Push this project to a GitHub repository. Do not commit `.env`; it is ignored by Git.
2. Create a [Render account](https://dashboard.render.com/register) and choose **New → Blueprint**.
3. Connect the GitHub repository and follow the Blueprint setup. When prompted for `APIFY_TOKEN`, paste the token from Apify. It is stored as a Render secret; do not put it in GitHub.
4. Wait for the deploy to finish, then open the `onrender.com` URL Render shows for the service.
5. On your phone, open that URL in Safari or Chrome. Use the browser's **Add to Home Screen** option to make it easy to reopen.

Render's free web services sleep after 15 minutes without traffic and can take about a minute to wake when opened. If you need it to respond immediately at all times, choose a paid always-on service plan in Render. Deploying also makes the service public on the internet; keep the Apify token secret and only share the site with people you trust.

If using a different Node.js host, set the build command to `npm install`, the start command to `npm start`, and configure `APIFY_TOKEN` as a secret environment variable in its dashboard.

## Limitations

The app sends submitted Instagram URLs to [Apify's Instagram Scraper](https://apify.com/apify/instagram-scraper), a third-party service. Apify requires an account and API token. Its free plan includes monthly platform credits, and the scraper charges per result; each request from this app is capped at $0.50, but repeated use can consume credits. Check Apify's [current pricing](https://apify.com/pricing) before use. Do not submit private links or links you do not want to share with Apify. Private posts, rate limits, and changes to Instagram's page format may still prevent extraction.

The local `.env` file is excluded from Git so the API token is not committed. For hosted deployment, set `APIFY_TOKEN` in the hosting provider's environment-variable settings instead of uploading `.env`.
