# DB Tech Nexus - E-Commerce Product Growth & Analytics Platform

An ultra-modern, high-aesthetic web & mobile frontend built with **Ionic 9**, **Angular 22 (Standalone Components)**, and **TypeScript**.

---

## 🚀 Key Modules & Architecture

### 1. 🗂️ Navigation Sidebar
Located on the left with desktop glassmorphism card layout and responsive mobile slide-out drawer:
- **Overview**: High-level store metrics, sales velocity, and product-level ROAS & RTO table.
- **AI Analytics**: Predictive cross-channel anomalies, budget scale alerts, and PostEx RTO protection recommendations.
- **Growth Deck**: Product scaling quadrants (Scale Aggressively, Optimize, RTO Protection Needed).
- **Integrations** *(Highlighted & Active by default)*: Central multi-channel ingestion hub.
- **Settings** *(Located at the bottom)*: Store profile, courier API keys, and currency preferences.
- **Store Status & Profile**: Live Izel Apparel telemetry indicator and quick logout.

---

### 2. 🔌 Integrations Hub (Active View)
Tailored for e-commerce multi-channel product telemetry:

| Platform | Status Badge | Summary & Account Details | Action |
|---|---|---|---|
| **Shopify** | `Connected` (Green Live Dot) | **"1,450 products synced"** • `izelapparel.myshopify.com` | `[ Manage Sync ]` |
| **Meta Ads** | `Connected` (Green Badge) | Account: **"Izel Apparel - Main"** • 3.82x ROAS • PKR 85k/day spend | `[ Switch Account ]` |
| **Google Ads** | `Not Connected` (Grey Badge) | Search, Shopping & Performance Max tracking | 1-Click `[ Connect Google Ads ]` |
| **TikTok Ads** | `Syncing...` (Amber Glowing Badge) | Live video ad pixel events & ROAS ingest stream (86%) | `[ Syncing Live Telemetry ]` |
| **Snapchat Ads** | `Not Connected` (Grey Badge) | Gen-Z catalog sales & Story ads attribution | 1-Click `[ Connect Snapchat ]` |
| **PostEx Courier** | `Connected` (Green Badge) | **"Jo aapke RTO data engine ki jaan hai"** • 89.4% Delivery Success • PKR 420k saved | `[ Configure RTO Rules ]` |

---

### 3. 👗 Product-Level Growth Demo Data
Includes real-world apparel catalog items:
- **Everyday Lawn Daily Pret Kurti** (SKU: `LDP-303` • ROAS: 5.37x • RTO: 7.1% • Growth: +52.8%)
- **Organza Printed Dupatta Ensemble** (SKU: `OPD-882` • ROAS: 5.14x • RTO: 6.8% • Growth: +46.1%)
- **Velvet Embroidered 3-Piece Kurti** (SKU: `VEK-001` • ROAS: 4.49x • RTO: 8.2% • Growth: +34.2%)
- **Handcrafted Raw Silk Angrakha** (SKU: `RSA-104` • ROAS: 3.90x • RTO: 11.4% • Growth: +28.5%)
- **Heavy Jacquard Bridal Shawl** (SKU: `JBS-512` • ROAS: 3.01x • RTO: 19.3% • High RTO Risk)

---

### 4. 🔐 Authentication Pages
- **Login Page (`/login`)**: Responsive 2-column showcase, 1-Click Demo Login, show/hide password, and social sign-in.
- **Signup Page (`/signup`)**: Real-time password strength meter (3 visual bars), live match indicator, and instant account creation.

---

## 💻 Running the App

### Dev Server
```bash
npm start
```
Open **[http://localhost:8100](http://localhost:8100)** in your browser.

### Demo Credentials
- **Email**: `demo@example.com`
- **Password**: `password123`
*(Or click **1-Click Demo Login** on the login page)*
