# Infinit-Audit Deployment Guide for Render

## Quick Start

### Option 1: Deploy via render.yaml (Recommended)

1. **Push to GitHub**
   - Use "Save to GitHub" feature to export your code
   - Make sure all files including `render.yaml` are committed

2. **Connect to Render**
   - Go to [render.com](https://render.com) and sign up/login
   - Click "New" → "Blueprint"
   - Connect your GitHub repository
   - Render will automatically detect `render.yaml` and create both services

3. **Configure MongoDB**
   - Sign up for [MongoDB Atlas](https://www.mongodb.com/atlas) (free tier)
   - Create a cluster and get your connection string
   - In Render dashboard, go to your API service → Environment
   - Add `MONGO_URL` with your MongoDB connection string

### Option 2: Manual Setup

#### Backend API

1. **Create Web Service**
   - Click "New" → "Web Service"
   - Connect your GitHub repo
   - Set Root Directory: `backend`
   - Environment: `Python`
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn server:app --host 0.0.0.0 --port $PORT`

2. **Environment Variables**
   ```
   MONGO_URL=mongodb+srv://user:pass@cluster.mongodb.net/infinit_audit
   DB_NAME=infinit_audit
   JWT_SECRET_KEY=<generate a secure random string>
   ```

#### Frontend

1. **Create Static Site**
   - Click "New" → "Static Site"
   - Connect your GitHub repo
   - Set Root Directory: `frontend`
   - Build Command: `yarn install && yarn build`
   - Publish Directory: `build`

2. **Environment Variables**
   ```
   REACT_APP_BACKEND_URL=https://your-api-service.onrender.com
   ```

3. **Add Rewrite Rule**
   - Go to Redirects/Rewrites
   - Add: Source `/*` → Destination `/index.html` (Rewrite)

## MongoDB Atlas Setup (Free Tier)

1. Go to [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Create free account
3. Create a new cluster (M0 Free tier)
4. Create database user with password
5. Add `0.0.0.0/0` to IP whitelist (for Render access)
6. Get connection string: Click "Connect" → "Connect your application"
7. Replace `<password>` in the string with your database user password

## Post-Deployment

1. **Test the API**
   ```bash
   curl https://your-api-service.onrender.com/api/health
   ```

2. **Access the App**
   - Frontend URL: `https://your-frontend.onrender.com`

3. **Default Login**
   - Email: `admin@infinit-audit.co.uk`
   - Password: `admin123`
   - ⚠️ Change this password immediately after first login!

## Cost Breakdown

| Service | Plan | Cost |
|---------|------|------|
| Render Backend | Free | $0/month |
| Render Frontend | Free | $0/month |
| MongoDB Atlas | M0 Free | $0/month |
| **Total** | | **$0/month** |

### Free Tier Limitations

- **Render Free**: Services spin down after 15 minutes of inactivity (10-30 sec cold start)
- **MongoDB Atlas Free**: 512MB storage limit

### Upgrade Options (when you need more)

- Render Starter: $7/month per service (no cold starts)
- MongoDB Atlas M2: ~$9/month (2GB storage)

## Troubleshooting

### Backend not starting
- Check logs in Render dashboard
- Verify MONGO_URL is correct
- Ensure MongoDB Atlas IP whitelist includes `0.0.0.0/0`

### Frontend can't reach backend
- Verify REACT_APP_BACKEND_URL is set correctly
- Make sure it includes `https://` and no trailing slash
- Rebuild frontend after changing environment variables

### PDF export not working
- WeasyPrint requires specific system libraries
- The Dockerfile includes these dependencies
- If using native Render build, contact support for WeasyPrint libraries
