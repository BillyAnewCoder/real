# Website File Extractor - Render Deployment

A web application that extracts files and resources from websites and packages them into downloadable ZIP archives.

## Features

- **Comprehensive File Extraction**: Automatically extracts HTML, CSS, JavaScript, images, fonts, and other assets
- **Inline Asset Processing**: Captures inline styles and scripts as separate files
- **Real-time Progress Tracking**: Shows extraction progress with live updates
- **File Explorer Interface**: Browse extracted files with type-based organization
- **ZIP Download**: Package all extracted files into a downloadable archive
- **Enhanced Asset Discovery**: Finds CSS imports, dynamic JS imports, and linked resources

## Deployment on Render

### Quick Deploy

1. **Fork/Upload this folder** to your GitHub repository
2. **Connect to Render**:
   - Go to [Render Dashboard](https://dashboard.render.com/)
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Select this folder/branch

3. **Configure Settings**:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
   - **Node Version**: 18+ (automatically detected)
   - **Environment**: Production

4. **Deploy**: Click "Create Web Service"

### Environment Variables (Optional)

- `SESSION_SECRET`: Secret key for session management (auto-generated if not set)
- `NODE_ENV`: Set to `production` for production builds

### Build Process

The deployment uses a streamlined build process:
1. `npm install` - Install dependencies
2. `npm run build` - Build the React frontend with Vite
3. `npm start` - Start the Express server

## Architecture

- **Frontend**: React with TypeScript, Vite build system, shadcn/ui components
- **Backend**: Express.js with in-memory storage for simplicity
- **Extraction Engine**: Axios + Cheerio for fast, reliable web scraping
- **File Processing**: JSZip for archive creation, comprehensive MIME type detection

## Usage

1. Enter a website URL
2. Configure extraction options:
   - **Include Payloads**: Download actual CSS/JS/image files (enabled by default)
   - **Include Source Page**: Include the original HTML page
3. Click "Extract Files"
4. Monitor real-time progress
5. Browse extracted files in the file explorer
6. Download complete ZIP archive

## Technology Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Frontend**: React + TypeScript + Vite
- **UI Components**: shadcn/ui (Radix UI + Tailwind CSS)
- **Web Scraping**: Axios + Cheerio
- **Archive Creation**: JSZip
- **Styling**: Tailwind CSS

## Performance

- **Fast Extraction**: Axios + Cheerio approach is significantly faster than browser automation
- **Concurrent Downloads**: Parallel asset fetching for improved speed
- **Memory Efficient**: Streaming approach for large files
- **Error Resilient**: Graceful handling of failed asset downloads

## License

MIT License - feel free to use this for your own projects!