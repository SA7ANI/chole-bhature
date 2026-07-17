<h1 align="center">
  🍲 Chole Bhature <br>
  <span style="font-size: 20px; font-weight: 400;">Advanced Meta-Sorter Addon for Nuvio & Stremio</span>
</h1>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.0.0-blue.svg?cacheSeconds=2592000" />
  <img alt="License: ISC" src="https://img.shields.io/badge/License-ISC-yellow.svg" />
  <img alt="Node Version" src="https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen" />
</p>

## 🎬 What is this?
**Chole Bhature** is a blazing-fast, dynamic Meta-Sorter backend for Nuvio and Stremio. 

Instead of dealing with endless buffering and dead links, this addon intercepts your stream requests, concurrently executes 40+ provider scrapers, **live-pings every single stream**, and perfectly sorts them based on latency and quality before serving them to your screen. 

## ✨ Features
* ⚡ **Lightning Fast Ping Sorting:** Streams are sorted dynamically by how fast they respond to your device.
* 💀 **Auto-Hide Dead/Slow Streams:** Optionally filter out slow (🐢) or dead (💀) streams entirely so you only ever see fast links.
* 📺 **Prioritize Quality:** Optionally sort by highest resolution (4K > 1080p > 720p) first, using ping speed as a tie-breaker.
* 📊 **Live Analytics Dashboard:** See real-time metrics on which providers are giving you the most fast, slow, or dead links.
* 🧠 **Smart Caching:** Identical requests are cached in memory so repeating a search is instantaneous.
* ⚙️ **One-Click Configuration UI:** A beautiful, mobile-friendly configuration page to manage your repositories and install the addon directly into Stremio/Nuvio.

---

## 🚀 How to Host on Render (Free 24/7 Cloud Hosting)

The easiest way to run this addon without keeping your computer turned on is to host it on [Render](https://render.com).

1. **Fork or Push** this repository to your own GitHub account.
2. Sign up for a free account at [Render.com](https://render.com).
3. Click **New** -> **Web Service**.
4. Choose **Build and deploy from a Git repository** and select this repo.
5. Fill out the settings:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
6. Click **Create Web Service**. 
7. Once deployed, open the URL Render gives you to access the Configuration Page and install it into Nuvio!

---

## 💻 Local Development

Want to run it locally on your own machine?

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/chole_bhature-metasorter-addon.git
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open [http://localhost:7000/configure](http://localhost:7000/configure) in your browser.

---

## 🛠️ Built With
- **Node.js** & **Express** - Backend server & routing
- **Stremio Addon SDK** - Interfacing with Nuvio/Stremio
- **Crypto-JS & Cheerio** - Parsing provider manifests and links
- **Vanilla CSS/JS** - Beautiful, lightweight frontend configuration page

## 📝 License
This project is licensed under the ISC License.
