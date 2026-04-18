# Deployment Guide

## Static Hosting (Recommended)

This is a client-only app with no backend. Deploy the `dist/` folder to any static host.

### Netlify

```bash
npm run build
netlify deploy --prod --dir=dist
```

### Vercel

```bash
npm run build
vercel --prod
```

### GitHub Pages

```bash
npm run build
# Copy dist/* to gh-pages branch or configure GitHub Actions
```

### AWS S3 + CloudFront

```bash
npm run build
aws s3 sync dist/ s3://your-bucket-name/
# Configure CloudFront to point to S3 bucket
```

### Self-Hosted (Nginx/Apache)

```bash
npm run build
# Copy dist/ contents to web server root
```

**Nginx example:**
```nginx
server {
    listen 80;
    server_name example.com;
    root /var/www/html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## Environment Setup

No `.env` variables needed. App works entirely client-side with user-provided GitLab token.

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- ES2020+ JavaScript required
- No IE11 support

## Performance

- Single-page app (~60KB gzipped)
- No server requests except to GitLab API
- All processing happens in browser
- Typical report generation: 5-30 seconds (depends on project size and network)

## Security Notes

- Token is never sent to any server except GitLab instance
- No analytics or tracking
- No external dependencies (except lucide-react for icons)
- Can be deployed on air-gapped networks

## Local Development

```bash
npm install
npm run dev
```

Opens on `http://localhost:5173` with hot module replacement (HMR).

## Building

```bash
npm run build
```

Creates optimized production bundle in `dist/` directory:
- HTML: Minified + inlined critical CSS
- CSS: Minified, vendor-prefixed
- JS: Minified, tree-shaken, code-split if needed

## Troubleshooting Deployment

**Blank page after deploy**
- Check that the web server correctly serves `index.html` for all routes
- Enable gzip compression for smaller file sizes
- Verify no CORS issues with GitLab API (browser should allow cross-origin requests to GitLab)

**GitLab API calls fail from deployed site**
- Some GitLab instances may restrict API access by origin
- Ask your GitLab admin to allow your deployment origin
- Alternatively, run a proxy server that handles GitLab API requests

**High First Contentful Paint (FCP)**
- App loads lazily after initial HTML
- Consider pre-rendering or Server-Side Rendering if needed (currently not done)

## Monitoring

No server-side logs. All debugging happens:
- Browser DevTools Console (F12)
- BuildLog panel in the app (visible during report generation)
